"""主逻辑

用模拟 HTTP 响应验证 DeepSeek 直答、智谱工具调用和带来源的流式回复。
"""

import json

import httpx
from langchain.messages import HumanMessage

from voice_agent.agent import SearchResults
from voice_agent.agent.graph import VoiceAgent
from voice_agent.agent.search import SEARCH_URL
from voice_agent.providers import ProviderSettings


def completion(deltas, finish_reason):
    chunks = [
        {"index": 0, "delta": delta, "finish_reason": None}
        for delta in deltas
    ]
    chunks.append({"index": 0, "delta": {}, "finish_reason": finish_reason})
    data = ""
    for chunk in chunks:
        packet = {
            "id": "test-completion",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "deepseek-custom",
            "choices": [chunk],
        }
        data += f"data: {json.dumps(packet, ensure_ascii=False)}\n\n"
    return httpx.Response(200, text=data + "data: [DONE]\n\n", headers={"Content-Type": "text/event-stream"})


async def test_langgraph_executes_zhipu_tool_and_streams_sourced_reply():
    requests = []

    async def respond(request):
        body = json.loads(request.content)
        requests.append((str(request.url), body))
        if str(request.url) == SEARCH_URL:
            assert request.headers["Authorization"] == "Bearer test-zhipu"
            assert body["search_engine"] == "search_pro"
            assert body["search_query"] == "公开测试新闻"
            return httpx.Response(200, json={"search_result": [
                {"title": "测试新闻", "link": "https://example.org/news", "content": "测试资料"},
                {"title": "无效链接", "link": "javascript:evil()", "content": "不应返回"},
            ]})

        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-deepseek"
        assert body["model"] == "deepseek-custom"
        assert body["thinking"] == {"type": "disabled"}
        assert body["stream"] is True
        if body["messages"][-1]["content"] == "你好":
            return completion([{"role": "assistant", "content": "你好！"}], "stop")
        if body.get("tools"):
            assert body["tools"][0]["function"]["name"] == "web_search"
            return completion([{"role": "assistant", "tool_calls": [{
                "id": "call_search",
                "index": 0,
                "type": "function",
                "function": {"name": "web_search", "arguments": '{"query":"公开测试新闻"}'},
            }]}], "tool_calls")

        assert any(message["role"] == "tool" and "测试资料" in message["content"] for message in body["messages"])
        return completion([{"role": "assistant", "content": "查到了，"}, {"content": "这是测试新闻。"}], "stop")

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond), trust_env=False) as http:
        agent = VoiceAgent(ProviderSettings(
            dashscope_key="unused", deepseek_key="test-deepseek", zhipu_key="test-zhipu",
            llm_model="deepseek-custom", search_engine="search_pro",
        ), http)
        direct = [event async for event in agent.stream([HumanMessage(content="你好")])]
        assert direct == ["你好！"]
        assert len(requests) == 1
        events = [event async for event in agent.stream([HumanMessage(content="请搜索公开测试新闻")])]

    assert len(requests) == 4
    assert events == [
        SearchResults([{"title": "测试新闻", "url": "https://example.org/news"}]),
        "查到了，",
        "这是测试新闻。",
    ]
