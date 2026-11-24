"""主逻辑

读取服务监听地址、会话上限和访问令牌，按部署环境校验允许的页面来源。
"""

from dataclasses import dataclass, field
import os
import re
from urllib.parse import urlsplit

DEFAULT_API_PORT = 8008


def _integer(name: str, default: int, maximum: int) -> int:
    value = int(os.getenv(name, str(default)))
    if not 1 <= value <= maximum:
        raise ValueError(f"{name} 必须在 1 至 {maximum} 之间")
    return value


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = DEFAULT_API_PORT
    max_sessions: int = 24
    origin: str = ""
    access_token: str = field(default="", repr=False)

    @classmethod
    def from_env(cls) -> "Settings":
        settings = cls(
            host=os.getenv("VOICE_HOST", "127.0.0.1"),
            port=_integer("VOICE_PORT", DEFAULT_API_PORT, 65_535),
            max_sessions=_integer("VOICE_MAX_SESSIONS", 24, 1_000),
            origin=os.getenv("VOICE_ORIGIN", "").strip().rstrip("/"),
            access_token=os.getenv("VOICE_ACCESS_TOKEN", "").strip(),
        )
        # 条件 1，指定生产模式。条件 2，监听非回环地址。
        # 满足任一条件就要求 HTTPS 来源和至少 24 个字符的访问令牌。
        public = os.getenv("VOICE_ENV") == "production" or settings.host not in ("127.0.0.1", "::1", "localhost")
        if public:
            origin = urlsplit(settings.origin)
            if origin.scheme != "https" or not origin.hostname or origin.path or origin.query or origin.fragment:
                raise ValueError("VOICE_ORIGIN 必须是页面的 HTTPS 来源")
            if len(settings.access_token) < 24:
                raise ValueError("VOICE_ACCESS_TOKEN 至少需要 24 个字符")
        if len(settings.access_token) > 1_024:
            raise ValueError("VOICE_ACCESS_TOKEN 最多 1024 个字符")
        return settings

    def allows_origin(self, origin: str | None) -> bool:
        if origin is None:
            return True
        if self.origin:
            return origin == self.origin
        return bool(re.fullmatch(r"https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?", origin))
