"""主逻辑

管理一条 WebSocket 上的对话轮次。接收录音、流式生成和播报，并保存完整轮次的上下文。
"""

import asyncio
import logging
import struct
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import dataclass, field
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect
from langchain.messages import AIMessage, HumanMessage
from langchain_core.messages import BaseMessage

from ..agent import Agent, SearchResults
from .protocol import (
    INPUT_FRAME_BYTES, MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS, MAX_TRANSCRIPT_CHARS,
    MIN_AUDIO_BYTES, OUTPUT_FRAME_BYTES, OUTPUT_RATE, parse_control,
)
from ..speech import Speech, SpeechError

LOGGER = logging.getLogger("voice.session")
IDLE_SECONDS = 300
MAX_OUTPUT_BYTES = OUTPUT_RATE * 2 * 120


class TurnError(Exception):
    pass


@dataclass
class Turn:
    id: int
    speak: bool
    started: float = field(default_factory=time.monotonic)
    audio: asyncio.Queue[bytes | None] = field(default_factory=lambda: asyncio.Queue(maxsize=64))
    size: int = 0
    recording: bool = True
    task: asyncio.Task | None = None


class VoiceSession:
    def __init__(self, socket: WebSocket, speech: Speech, agent: Agent):
        self.socket = socket
        self.speech = speech
        self.agent = agent
        self.id = uuid4().hex
        self.history: list[BaseMessage] = []
        self.turn: Turn | None = None
        self.last_turn_id = 0
        self.last_start = 0.0
        self.write_lock = asyncio.Lock()

    async def run(self):
        try:
            await self.event("ready")
            while True:
                async with asyncio.timeout(IDLE_SECONDS):
                    message = await self.socket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if (text := message.get("text")) is not None:
                    if event := parse_control(text):
                        await self.control(event)
                elif frame := message.get("bytes"):
                    await self.frame(frame)
        except TimeoutError:
            await self.socket.close(code=1000)
        except (WebSocketDisconnect, OSError):
            pass
        finally:
            await self.cancel_turn()

    async def control(self, event: dict):
        kind = event["type"]
        if kind == "reset":
            await self.cancel_turn()
            self.history.clear()
            await self.event("reset")
            return
        turn_id = event["turnId"]
        if kind == "start":
            await self.start(turn_id, event["speak"])
            return
        turn = self.turn
        if not turn or turn.id != turn_id:
            return
        if kind == "cancel":
            await self.cancel_turn()
            await self.event("cancelled", turn_id)
        elif turn.recording:
            await self.finish_input(turn)

    async def start(self, turn_id: int, speak: bool):
        # 条件 1，轮次号未递增，丢弃重复或过期的开始指令。
        if turn_id <= self.last_turn_id:
            return
        self.last_turn_id = turn_id
        now = time.monotonic()
        # 条件 2，已有轮次或距离上次开始不足 500 ms，拒绝开启新轮次。
        if self.turn or now - self.last_start < 0.5:
            await self.event("error", turn_id, message="请求太快，请稍后再试。")
            return
        self.last_start = now
        turn = Turn(turn_id, speak)
        self.turn = turn
        turn.task = asyncio.create_task(self.respond(turn))

    async def frame(self, frame: bytes):
        turn = self.turn
        if not turn or not turn.recording:
            return
        # 条件 1，帧超长或样本缺少一个字节，取消本轮。
        if len(frame) > INPUT_FRAME_BYTES or len(frame) % 2:
            await self.cancel_turn()
            await self.event("error", turn.id, message="录音帧格式无效。")
        # 条件 2，加入这一帧会超出录音上限，结束输入并处理已收到的音频。
        elif turn.size + len(frame) > MAX_AUDIO_BYTES:
            await self.finish_input(turn)
        # 条件 3，上游队列已满，提示重录，避免阻塞 WebSocket 的控制消息。
        elif turn.audio.full():
            await self.cancel_turn()
            await self.event("error", turn.id, message="语音识别处理较慢，请重新录制。")
        else:
            turn.size += len(frame)
            turn.audio.put_nowait(frame)

    async def finish_input(self, turn: Turn):
        turn.recording = False
        if turn.audio.full():
            await self.cancel_turn()
            await self.event("error", turn.id, message="语音识别处理较慢，请重新录制。")
        else:
            turn.audio.put_nowait(None)

    async def packets(self, turn: Turn) -> AsyncIterator[bytes]:
        # 截止时间从本轮开始计算。遇到结束标记或等待超时，都停止向 ASR 发送音频。
        limit = asyncio.get_running_loop().time() + max(0, MAX_RECORDING_SECONDS + 0.75 - (time.monotonic() - turn.started))
        while True:
            try:
                async with asyncio.timeout_at(limit):
                    frame = await turn.audio.get()
            except TimeoutError:
                break
            if frame is None:
                break
            yield frame
        turn.recording = False
        if turn.size < MIN_AUDIO_BYTES:
            raise TurnError("录音太短，请再说一次。")
        await self.event("phase", turn.id, phase="transcribing")

    async def respond(self, turn: Turn):
        tts: asyncio.Task | None = None
        stage = "语音识别"
        try:
            # 第一步，边接收录音边转写。只有最终转写进入模型上下文。
            await self.event("phase", turn.id, phase="recording")

            async def partial(text: str):
                await self.event("transcript", turn.id, text=text[:MAX_TRANSCRIPT_CHARS], final=False)

            async with asyncio.timeout(MAX_RECORDING_SECONDS + 12):
                transcript = await self.speech.recognize(self.packets(turn), partial)
            transcript = transcript.strip()[:MAX_TRANSCRIPT_CHARS]
            if not transcript:
                raise TurnError("没听清这段语音，请再说一次。")
            await self.event("transcript", turn.id, text=transcript, final=True)
            await self.event("phase", turn.id, phase="thinking")

            # 第二步，模型增量同时发给页面和 TTS。搜索来源以独立事件展示。
            stage = "模型回复"
            queue: asyncio.Queue[str | None] = asyncio.Queue()
            human = HumanMessage(content=transcript)
            reply = ""
            output = self.agent.stream([*self.history, human])
            async with asyncio.timeout(60), aclosing(output):
                async for result in output:
                    if isinstance(result, SearchResults):
                        if result.sources:
                            await self.event("sources", turn.id, sources=result.sources)
                        if result.unavailable:
                            await self.event("warning", turn.id, message="智谱搜索暂不可用。")
                        continue
                    reply += result
                    await self.event("delta", turn.id, text=result)
                    if turn.speak:
                        if not tts:
                            tts = asyncio.create_task(self.playback(turn, queue))
                        if not tts.done():
                            queue.put_nowait(result)
                    if len(reply) > 12_000:
                        raise TurnError("模型回复超过长度限制。")
                if not reply.strip():
                    raise TurnError("本轮未生成回复，请再试一次。")
                if tts:
                    queue.put_nowait(None)
                    await tts

            # 第三步，完整轮次才写入内存上下文，打断时跳过此处。
            self.history = [*self.history, human, AIMessage(content=reply)][-12:]
            LOGGER.info("turn_complete session=%s turn=%d duration_ms=%d",
                        self.id, turn.id, (time.monotonic() - turn.started) * 1000)
            await self.event("done", turn.id)
        except (WebSocketDisconnect, OSError):
            pass
        except TurnError as error:
            await self.event("error", turn.id, message=str(error))
        except Exception as error:
            self.log_failure(turn.id, stage, error)
            message = f"{stage}超时，请重试。" if isinstance(error, TimeoutError) else f"{stage}失败，请重试。"
            try:
                await self.event("error", turn.id, message=message)
            except (WebSocketDisconnect, OSError):
                pass
        finally:
            if tts:
                if not tts.done():
                    tts.cancel()
                await asyncio.gather(tts, return_exceptions=True)
            if self.turn is turn:
                self.turn = None

    async def playback(self, turn: Turn, queue: asyncio.Queue[str | None]):
        async def text() -> AsyncIterator[str]:
            while (value := await queue.get()) is not None:
                yield value

        total = 0
        tail = b""
        # 帧头是大端轮次号，浏览器用它识别打断后晚到的旧音频。
        prefix = struct.pack(">I", turn.id)

        async def audio(data: bytes):
            # PCM 是 16 位采样，跨云端帧拼回未完整的一个采样点。
            nonlocal tail, total
            data = tail + data
            end = len(data) - len(data) % 2
            tail = data[end:]
            total += end
            if total > MAX_OUTPUT_BYTES:
                raise TurnError("合成音频超过限制。")
            for offset in range(0, end, OUTPUT_FRAME_BYTES):
                async with self.write_lock:
                    await self.socket.send_bytes(prefix + data[offset:min(end, offset + OUTPUT_FRAME_BYTES)])

        try:
            await self.speech.synthesize(text(), audio)
            if tail:
                raise SpeechError("TTS", "incomplete-pcm")
        except (WebSocketDisconnect, OSError):
            raise
        except Exception as error:
            self.log_failure(turn.id, "TTS", error)
            await self.event("warning", turn.id, message="语音播报未完成，文字回复仍可查看。")

    async def cancel_turn(self):
        turn, self.turn = self.turn, None
        if turn and turn.task:
            turn.task.cancel()
            await asyncio.gather(turn.task, return_exceptions=True)

    async def event(self, kind: str, turn_id: int | None = None, **data):
        event = {"type": kind, **data}
        if turn_id is not None:
            event["turnId"] = turn_id
        # 文本事件和播报任务共用写锁，串行发送到同一个 WebSocket。
        async with self.write_lock:
            await self.socket.send_json(event)

    def log_failure(self, turn_id: int, stage: str, error: Exception):
        code = error.code if isinstance(error, SpeechError) else type(error).__name__
        LOGGER.warning("turn_failed session=%s turn=%d stage=%s code=%s", self.id, turn_id, stage, code)
