"""主逻辑

调用智谱搜索并筛选网页结果。摘要提供给模型，来源链接单独提供给前端。
"""

import json
import logging
from urllib.parse import urlsplit

import httpx
from langchain.tools import tool

from ..providers import ProviderSettings
from ..voice.protocol import Source

LOGGER = logging.getLogger("voice.agent")
SEARCH_URL = "https://open.bigmodel.cn/api/paas/v4/web_search"


def create_web_search(settings: ProviderSettings, http: httpx.AsyncClient):
    @tool(response_format="content_and_artifact")
    async def web_search(query: str) -> tuple[str, dict]:
        """用智谱搜索最新网页和可查证资料。query 为 1 至 70 字的简洁搜索词。"""
        query = query.strip()
        if not 1 <= len(query) <= 70:
            return "搜索词长度超出限制。", {"sources": [], "unavailable": True}
        try:
            response = await http.post(
                SEARCH_URL,
                headers={"Authorization": f"Bearer {settings.zhipu_key.get_secret_value()}"},
                json={"search_engine": settings.search_engine, "search_query": query, "count": 4},
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or "error" in payload:
                raise ValueError("VendorError")
        except (httpx.HTTPError, ValueError) as error:
            LOGGER.warning("web_search_failed type=%s", type(error).__name__)
            return "联网搜索暂不可用。", {"sources": [], "unavailable": True}

        results = []
        sources: list[Source] = []
        for item in (payload.get("search_result") or [])[:4]:
            title, url = item.get("title"), item.get("link")
            if not isinstance(title, str) or not isinstance(url, str):
                continue
            try:
                parsed = urlsplit(url)
                if parsed.scheme not in ("http", "https") or not parsed.hostname or len(url) > 2_048:
                    continue
            except ValueError:
                continue
            sources.append({"title": title[:180], "url": url})
            results.append({
                "title": title[:180], "url": url,
                "content": str(item.get("content", ""))[:1_000],
                "date": item.get("publish_date"),
            })
        return json.dumps(results, ensure_ascii=False) if results else "没有找到相关结果。", {"sources": sources}

    return web_search
