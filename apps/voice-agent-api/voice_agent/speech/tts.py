"""主逻辑

配置百炼实时合成会话，发送模型文字增量，并将合成的 PCM 分片回传给调用方。
"""

import asyncio
import base64
import json
from collections.abc import AsyncIterator
from uuid import uuid4

from websockets.asyncio.client import ClientConnection

from ..voice.protocol import OUTPUT_RATE
from . import OnAudio, SpeechError
from .realtime import run_duplex


async def synthesize(
    socket: ClientConnection,
    speaker: str,
    text: AsyncIterator[str],
    audio: OnAudio,
) -> None:
    # 第一步，确认输出为与前端播放器一致的 24 kHz PCM。
    await _send_event(socket, "session.update", session={
        "mode": "server_commit",
        "voice": speaker,
        "language_type": "Auto",
        "response_format": "pcm",
        "sample_rate": OUTPUT_RATE,
    })
    async with asyncio.timeout(5):
        while True:
            event = _parse_event(await socket.recv())
            if event["type"] == "session.updated":
                break

    async def send():
        async for delta in text:
            await _send_event(socket, "input_text_buffer.append", text=delta)
        await _send_event(socket, "session.finish")

    async def receive():
        received_audio = False
        async for raw in socket:
            event = _parse_event(raw)
            if event["type"] == "response.audio.delta":
                pcm = base64.b64decode(event["delta"], validate=True)
                if pcm:
                    received_audio = True
                    await audio(pcm)
            if event["type"] == "session.finished":
                if not received_audio:
                    raise SpeechError("TTS", "empty-audio")
                return
        raise SpeechError("TTS", "incomplete-session")

    # 第二步，模型增量和音频增量并行，语音合成无需等待完整回复。
    await run_duplex(send(), receive(), final_timeout=30)


async def _send_event(socket: ClientConnection, kind: str, **payload):
    await socket.send(json.dumps({"event_id": f"event_{uuid4().hex}", "type": kind, **payload}))


def _parse_event(raw: str | bytes) -> dict:
    event = json.loads(raw)
    if event["type"] == "error":
        raise SpeechError("TTS", str(event.get("error", {}).get("code", "error")))
    if event["type"] == "response.done":
        status = event.get("response", {}).get("status")
        if status in ("failed", "cancelled", "incomplete"):
            raise SpeechError("TTS", status)
    return event
