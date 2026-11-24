"""主逻辑

提供健康检查和默认配置。WebSocket 完成来源、访问令牌及服务配置校验后进入语音会话。
"""

import asyncio
import hmac
import json

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .agent.graph import VoiceAgent
from .providers import ProviderModels, ProviderSettings
from .speech.dashscope import DashScopeSpeech
from .voice.session import VoiceSession

router = APIRouter(prefix="/api")


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/voice/config")
async def config(request: Request):
    current = request.app.state.settings
    return JSONResponse({
        "defaults": ProviderModels().model_dump(by_alias=True),
        "tokenRequired": bool(current.access_token),
    }, headers={"Cache-Control": "no-store"})


@router.websocket("/voice/ws")
async def voice(socket: WebSocket):
    state = socket.app.state
    current = state.settings
    if not current.allows_origin(socket.headers.get("origin")):
        await socket.close(code=1008)
        return
    if state.connections >= current.max_sessions:
        await socket.send_denial_response(JSONResponse({"detail": "语音会话数已达上限。"}, status_code=503))
        return
    state.connections += 1
    try:
        # 第一步，从首帧校验访问令牌，用户的密钥和令牌都不进入 URL。
        await socket.accept()
        auth = await _authenticate(socket, current.access_token)
        if auth is None:
            await _reject(socket, "访问令牌无效。")
            return
        # 第二步，校验服务配置。密钥仅用于此连接，校验错误不回显输入。
        try:
            providers = ProviderSettings.model_validate(auth.get("providers"))
        except ValidationError:
            await _reject(socket, "请在语音设置中填写有效的服务配置。")
            return
        # 第三步，用这条连接的配置创建服务实例，使并发用户的模型和密钥互相隔离。
        speech = state.speech or DashScopeSpeech(providers)
        agent = state.agent or VoiceAgent(providers, state.http)
        await VoiceSession(socket, speech, agent).run()
    except (WebSocketDisconnect, OSError):
        pass
    finally:
        state.connections -= 1


async def _reject(socket: WebSocket, message: str):
    await socket.send_json({"type": "connection_error", "message": message})
    await socket.close(code=1008)


async def _authenticate(socket: WebSocket, expected: str) -> dict | None:
    try:
        async with asyncio.timeout(5):
            message = await socket.receive()
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect()
        text = message.get("text", "")
        event = json.loads(text) if isinstance(text, str) and len(text) <= 7_000 else None
    except (TimeoutError, ValueError):
        return None
    if not isinstance(event, dict) or event.get("type") != "auth":
        return None
    token = event.get("token")
    valid = (
        isinstance(token, str)
        and len(token) <= 1_024
        and hmac.compare_digest(token.encode(errors="surrogatepass"), expected.encode())
    )
    return event if valid else None
