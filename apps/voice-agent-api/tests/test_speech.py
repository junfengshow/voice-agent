"""主逻辑

通过本地模拟 WebSocket 检查百炼任务帧、模型参数、结束事件及流式音频回调。
"""

import asyncio
import base64
import json
from urllib.parse import parse_qs, urlsplit

from websockets.asyncio.server import serve

from voice_agent.providers import ProviderSettings
from voice_agent.speech.dashscope import DashScopeSpeech
from voice_agent.voice.protocol import INPUT_RATE, OUTPUT_RATE


async def test_fun_asr_and_qwen_tts_stream_vendor_frames():
    partials = []
    audio = []
    first_partial = asyncio.Event()
    first_audio = asyncio.Event()

    async def handle(socket):
        assert socket.request.headers["Authorization"] == "Bearer test-dashscope"
        if socket.request.path == "/api-ws/v1/inference":
            command = json.loads(await socket.recv())
            task_id = command["header"]["task_id"]
            assert command["header"]["action"] == "run-task"
            assert command["payload"]["model"] == "custom-asr"
            assert command["payload"]["parameters"] == {"format": "pcm", "sample_rate": INPUT_RATE}

            async def event(kind, **payload):
                await socket.send(json.dumps({"header": {"event": kind, "task_id": task_id}, "payload": payload}))

            await event("task-started")
            assert await socket.recv() == b"\x01\0"
            await event("result-generated", output={"sentence": {"sentence_id": 1, "text": "第一"}})
            assert await socket.recv() == b"\x02\0"
            await event("result-generated", output={"sentence": {"sentence_id": 1, "text": "第一句。", "sentence_end": True}})
            await event("result-generated", output={"sentence": {"sentence_id": 0, "text": "", "heartbeat": True}})
            finish = json.loads(await socket.recv())
            assert finish["header"]["action"] == "finish-task"
            assert finish["header"]["task_id"] == task_id
            await event("result-generated", output={"sentence": {"sentence_id": 2, "text": "第二句。", "sentence_end": True}})
            await event("task-finished")
        else:
            url = urlsplit(socket.request.path)
            assert url.path == "/api-ws/v1/realtime"
            assert parse_qs(url.query) == {"model": ["custom+tts"]}
            update = json.loads(await socket.recv())
            assert update["type"] == "session.update"
            assert update["session"]["sample_rate"] == OUTPUT_RATE
            assert update["session"]["mode"] == "server_commit"
            assert update["session"]["voice"] == "custom-voice"
            await socket.send(json.dumps({"type": "session.updated"}))
            assert json.loads(await socket.recv())["text"] == "你好。"
            await socket.send(json.dumps({"type": "response.audio.delta", "delta": base64.b64encode(b"\x01\x02").decode()}))
            assert json.loads(await socket.recv())["text"] == "继续。"
            assert json.loads(await socket.recv())["type"] == "session.finish"
            await socket.send(json.dumps({"type": "response.audio.delta", "delta": base64.b64encode(b"\x03\x04").decode()}))
            await socket.send(json.dumps({"type": "session.finished"}))

    async def microphone():
        yield b"\x01\0"
        await first_partial.wait()
        yield b"\x02\0"

    async def partial(text):
        partials.append(text)
        first_partial.set()

    async def texts():
        yield "你好。"
        await first_audio.wait()
        yield "继续。"

    async def playback(pcm):
        audio.append(pcm)
        first_audio.set()

    async with serve(handle, "127.0.0.1", 0) as server, asyncio.timeout(6):
        port = server.sockets[0].getsockname()[1]
        speech = DashScopeSpeech(ProviderSettings(
            dashscope_key="test-dashscope", deepseek_key="unused", zhipu_key="unused",
            asr_model="custom-asr", tts_model="custom+tts", tts_voice="custom-voice",
        ))
        speech.base = f"ws://127.0.0.1:{port}/api-ws/v1"
        transcript = await speech.recognize(microphone(), partial)
        await speech.synthesize(texts(), playback)

    assert partials == ["第一", "第一句。", "第一句。 第二句。"]
    assert transcript == "第一句。 第二句。"
    assert audio == [b"\x01\x02", b"\x03\x04"]
