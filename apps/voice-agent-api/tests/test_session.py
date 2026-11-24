"""主逻辑

验证 FastAPI WebSocket 的鉴权、收发、打断和连接间的模型配置隔离。
"""

import asyncio
import struct
import time

from fastapi.testclient import TestClient
from starlette.testclient import WebSocketDenialResponse

from voice_agent import routes
from voice_agent.agent import SearchResults
from voice_agent.main import create_app
from voice_agent.settings import Settings
from voice_agent.voice.protocol import INPUT_FRAME_BYTES

PROVIDERS = {
    "dashscopeApiKey": "test-dashscope",
    "deepseekApiKey": "test-deepseek",
    "zhipuApiKey": "test-zhipu",
}


class StubAgent:
    async def stream(self, messages):
        yield SearchResults([{"title": "测试来源", "url": "https://example.org/news"}])
        for text in ("第一段。", "第二段。", "第三段。"):
            await asyncio.sleep(0.22)
            yield text


class StubSpeech:
    async def recognize(self, audio, partial):
        await anext(audio)
        await partial("测试转写")
        async for _ in audio:
            pass
        return "测试转写完成。"

    async def synthesize(self, text, audio):
        async for _ in text:
            await audio(bytes(4))


def test_websocket_stream_and_cancel():
    token = "voice-test-token"
    app = create_app(
        Settings(access_token=token, max_sessions=1),
        speech=StubSpeech(),
        agent=StubAgent(),
    )
    with TestClient(app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/api/voice/config").json() == {
            "defaults": {
                "asrModel": "fun-asr-realtime",
                "llmModel": "deepseek-flash",
                "ttsModel": "qwen3-tts-flash-realtime",
                "ttsVoice": "Cherry",
                "searchEngine": "search_std",
                "dashscopeRegion": "cn",
            },
            "tokenRequired": True,
        }

        with client.websocket_connect("/api/voice/ws") as connection:
            connection.send_json({"type": "auth", "token": "wrong"})
            assert connection.receive_json()["message"] == "访问令牌无效。"

        with client.websocket_connect("/api/voice/ws") as connection:
            connection.send_json({"type": "auth", "token": token, "providers": {**PROVIDERS, "zhipuApiKey": " "}})
            assert connection.receive_json() == {
                "type": "connection_error", "message": "请在语音设置中填写有效的服务配置。",
            }

        with client.websocket_connect("/api/voice/ws", headers={"Origin": "http://localhost:8007"}) as connection:
            connection.send_json({"type": "auth", "token": token, "providers": PROVIDERS})
            assert connection.receive_json() == {"type": "ready"}
            try:
                with client.websocket_connect("/api/voice/ws"):
                    raise AssertionError("会话数已到上限")
            except WebSocketDenialResponse as error:
                assert error.status_code == 503

            connection.send_json({"type": "start", "turnId": 1, "speak": True})
            connection.send_bytes(bytes(INPUT_FRAME_BYTES))
            assert connection.receive_json()["phase"] == "recording"
            assert connection.receive_json()["final"] is False
            connection.send_json({"type": "finish", "turnId": 1})
            assert connection.receive_json()["phase"] == "transcribing"
            assert connection.receive_json()["final"] is True
            assert connection.receive_json()["phase"] == "thinking"
            assert connection.receive_json()["sources"][0]["title"] == "测试来源"
            assert connection.receive_json()["type"] == "delta"
            out = connection.receive_bytes()
            assert struct.unpack(">I", out[:4]) == (1,)
            assert len(out) > 4
            for _ in range(2):
                assert connection.receive_json()["type"] == "delta"
                assert connection.receive_bytes()[:4] == out[:4]
            assert connection.receive_json()["type"] == "done"

            connection.send_json({"type": "start", "turnId": 2, "speak": False})
            assert connection.receive_json()["phase"] == "recording"
            connection.send_json({"type": "cancel", "turnId": 2})
            assert connection.receive_json() == {"type": "cancelled", "turnId": 2}

            time.sleep(0.51)
            connection.send_json({"type": "start", "turnId": 3, "speak": False})
            connection.send_bytes(bytes(INPUT_FRAME_BYTES))
            connection.send_json({"type": "finish", "turnId": 3})
            events = []
            while not events or events[-1]["type"] != "done":
                events.append(connection.receive_json())
            assert all(event["turnId"] == 3 for event in events)
            assert sum(event["type"] == "delta" for event in events) == 3
            connection.send_json({"type": "reset"})
            assert connection.receive_json() == {"type": "reset"}


def test_provider_settings_are_bound_to_each_connection(monkeypatch):
    speech_settings = []
    agent_settings = []

    def speech_factory(settings):
        speech_settings.append(settings)
        return StubSpeech()

    def agent_factory(settings, http):
        agent_settings.append(settings)
        return StubAgent()

    monkeypatch.setattr(routes, "DashScopeSpeech", speech_factory)
    monkeypatch.setattr(routes, "VoiceAgent", agent_factory)
    with TestClient(create_app(Settings())) as client:
        with client.websocket_connect("/api/voice/ws") as first, client.websocket_connect("/api/voice/ws") as second:
            first.send_json({"type": "auth", "token": "", "providers": PROVIDERS})
            assert first.receive_json() == {"type": "ready"}
            second.send_json({
                "type": "auth", "token": "",
                "providers": {**PROVIDERS, "deepseekApiKey": "second-key", "llmModel": "second-model"},
            })
            assert second.receive_json() == {"type": "ready"}

    assert speech_settings == agent_settings
    assert [settings.llm_model for settings in agent_settings] == ["deepseek-flash", "second-model"]
    assert [settings.deepseek_key.get_secret_value() for settings in agent_settings] == ["test-deepseek", "second-key"]
