"""主逻辑

声明流式语音识别、合成的接口和统一的语音服务错误类型。
"""

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Protocol

OnPartial = Callable[[str], Awaitable[None]]
OnAudio = Callable[[bytes], Awaitable[None]]


class Speech(Protocol):
    async def recognize(self, audio: AsyncIterator[bytes], partial: OnPartial) -> str: ...

    async def synthesize(self, text: AsyncIterator[str], audio: OnAudio) -> None: ...


class SpeechError(Exception):
    def __init__(self, stage: str, code: str):
        self.stage = stage
        self.code = code
        super().__init__(stage)
