"""主逻辑

按当前连接的地域和凭据建立百炼 WebSocket，分别调用已选的识别和合成模型。
"""

from collections.abc import AsyncIterator
from urllib.parse import urlencode

from websockets.asyncio.client import connect

from ..providers import ProviderSettings
from . import OnAudio, OnPartial
from .asr import recognize
from .tts import synthesize


class DashScopeSpeech:
    def __init__(self, settings: ProviderSettings):
        self.settings = settings
        domain = "dashscope.aliyuncs.com" if settings.dashscope_region == "cn" else "dashscope-intl.aliyuncs.com"
        self.base = f"wss://{domain}/api-ws/v1"
        self.headers = {"Authorization": f"Bearer {settings.dashscope_key.get_secret_value()}"}

    def _connect(self, path: str):
        return connect(
            self.base + path,
            additional_headers=self.headers,
            open_timeout=5,
            close_timeout=1,
            max_size=512 * 1024,
            max_queue=16,
        )

    async def recognize(self, audio: AsyncIterator[bytes], partial: OnPartial) -> str:
        async with self._connect("/inference") as socket:
            return await recognize(socket, self.settings.asr_model, audio, partial)

    async def synthesize(self, text: AsyncIterator[str], audio: OnAudio) -> None:
        query = urlencode({"model": self.settings.tts_model})
        async with self._connect(f"/realtime?{query}") as socket:
            await synthesize(socket, self.settings.tts_voice, text, audio)
