"""主逻辑

初始化百炼识别任务，双向传输 PCM 和转写事件，最后汇总已确认的句段。
"""

import asyncio
import json
from collections.abc import AsyncIterator
from uuid import uuid4

from websockets.asyncio.client import ClientConnection

from ..voice.protocol import INPUT_RATE
from . import OnPartial, SpeechError
from .realtime import run_duplex


async def recognize(socket: ClientConnection, model: str, audio: AsyncIterator[bytes], partial: OnPartial) -> str:
    task_id = uuid4().hex
    # 第一步，等待 task-started，之后才能发送二进制音频帧。
    await _send_task(socket, task_id, "run-task", {
        "task_group": "audio",
        "task": "asr",
        "function": "recognition",
        "model": model,
        "parameters": {"format": "pcm", "sample_rate": INPUT_RATE},
        "input": {},
    })
    async with asyncio.timeout(5):
        while True:
            packet = json.loads(await socket.recv())["header"]
            if packet["event"] == "task-failed":
                raise SpeechError("ASR", packet.get("error_code", "task-failed"))
            if packet["event"] == "task-started":
                break

    async def send():
        async for chunk in audio:
            await socket.send(chunk)
        await _send_task(socket, task_id, "finish-task", {"input": {}})

    async def receive() -> str:
        sentences: dict[int, tuple[str, bool]] = {}
        previous = ""
        async for raw in socket:
            packet = json.loads(raw)
            header = packet["header"]
            kind = header["event"]
            if kind == "task-failed":
                raise SpeechError("ASR", header.get("error_code", "task-failed"))
            if kind == "task-finished":
                return " ".join(piece for piece, final in sentences.values() if final and piece).strip()
            if kind != "result-generated":
                continue
            sentence = packet["payload"]["output"]["sentence"]
            if sentence.get("heartbeat"):
                continue
            # 第二步，覆盖同一句的临时结果，再拼接整轮文本。
            key = sentence["sentence_id"] if "sentence_id" in sentence else sentence["begin_time"]
            final = sentence.get("sentence_end") is True
            # 已确认的句段只接受新的最终结果，忽略迟到的临时转写。
            if key in sentences and sentences[key][1] and not final:
                continue
            sentences[key] = (sentence["text"].strip(), final)
            current = " ".join(piece for piece, _ in sentences.values() if piece)
            if current != previous:
                await partial(current)
                previous = current
        raise SpeechError("ASR", "incomplete-task")

    return await run_duplex(send(), receive(), final_timeout=10)


async def _send_task(socket: ClientConnection, task_id: str, action: str, payload: dict):
    await socket.send(json.dumps({
        "header": {"action": action, "task_id": task_id, "streaming": "duplex"},
        "payload": payload,
    }))
