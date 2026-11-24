"""主逻辑

定义 Agent 的流式输出约定，供会话层区分回复文字和搜索来源。
"""

from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Protocol

from langchain_core.messages import BaseMessage

from ..voice.protocol import Source


@dataclass(frozen=True)
class SearchResults:
    sources: list[Source]
    unavailable: bool = False


class Agent(Protocol):
    def stream(self, messages: list[BaseMessage]) -> AsyncGenerator[str | SearchResults, None]: ...
