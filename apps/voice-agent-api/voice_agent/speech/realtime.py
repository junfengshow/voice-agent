"""主逻辑

并行运行 WebSocket 的发送和接收任务。发送完毕后限时等待结束事件，退出时清理两个任务。
"""

import asyncio
from collections.abc import Coroutine
from typing import TypeVar

T = TypeVar("T")


async def run_duplex(
    send: Coroutine[None, None, None],
    receive: Coroutine[None, None, T],
    final_timeout: float,
) -> T:
    sender = asyncio.create_task(send)
    receiver = asyncio.create_task(receive)
    try:
        done, _ = await asyncio.wait((sender, receiver), return_when=asyncio.FIRST_COMPLETED)
        # 条件 1，发送任务先结束，先传播发送异常，再限时收取最终事件。
        if sender in done:
            sender.result()
            async with asyncio.timeout(final_timeout):
                return await receiver
        # 条件 2，接收任务先结束，交还结果，由 finally 收尾尚未停止的发送任务。
        return receiver.result()
    finally:
        # 任一方向失败或用户打断时，清理另一个方向，避免继续消耗模型额度。
        for task in (sender, receiver):
            if not task.done():
                task.cancel()
        await asyncio.gather(sender, receiver, return_exceptions=True)
