"""主逻辑

组装 FastAPI 应用，在应用生命周期内共享 HTTP 客户端，并注册 API 和前端构建产物。
"""

from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .agent import Agent
from .routes import router
from .settings import Settings
from .speech import Speech


def create_app(
    settings: Settings | None = None,
    *,
    speech: Speech | None = None,
    agent: Agent | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # 连接池随应用启动和关闭，各会话复用连接，由应用统一释放。
        config = settings or Settings.from_env()
        app.state.settings = config
        app.state.connections = 0
        async with httpx.AsyncClient(timeout=8, limits=httpx.Limits(max_connections=32)) as http:
            app.state.http = http
            app.state.speech = speech
            app.state.agent = agent
            yield

    app = FastAPI(title="Voice Agent", lifespan=lifespan)

    # 第一步，先注册 API，避免后续根目录的静态路由截获 API 请求。
    app.include_router(router)

    # 第二步，前端构建产物存在时挂载页面，让页面和 API 可以同源访问。
    web = Path(__file__).resolve().parents[2] / "voice-web" / "dist"
    if (web / "index.html").is_file():
        app.mount("/", StaticFiles(directory=web, html=True), name="web")
    return app


app = create_app()
