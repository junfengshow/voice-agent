"""主逻辑

读取运行配置并启动 Uvicorn。开发模式监听后端源码变化并重新加载服务。
"""

import argparse
from pathlib import Path

import uvicorn

from .settings import Settings


def main():
    parser = argparse.ArgumentParser(description="启动语音 Agent API")
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    try:
        config = Settings.from_env()
    except ValueError as error:
        parser.exit(1, f"{error}\n")
    uvicorn.run(
        "voice_agent.main:app",
        host=config.host,
        port=config.port,
        reload=args.reload,
        reload_dirs=[str(Path(__file__).parent)] if args.reload else None,
        ws="websockets-sansio",
        ws_max_size=8_192,
        ws_per_message_deflate=False,
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    main()
