"""主逻辑

定义 WebSocket 控制消息和 PCM 参数，校验浏览器发来的轮次指令。
"""

import json
from typing import TypedDict

INPUT_RATE = 16_000
OUTPUT_RATE = 24_000
INPUT_FRAME_BYTES = 3_200
OUTPUT_FRAME_BYTES = 9_600
MAX_RECORDING_SECONDS = 60
MAX_AUDIO_BYTES = INPUT_RATE * 2 * MAX_RECORDING_SECONDS
MAX_TRANSCRIPT_CHARS = 6_000
MIN_AUDIO_BYTES = INPUT_FRAME_BYTES


class Source(TypedDict):
    title: str
    url: str


def parse_control(text: str) -> dict | None:
    if len(text) > 256:
        return None
    try:
        event = json.loads(text)
    except ValueError:
        return None
    if not isinstance(event, dict):
        return None
    kind = event.get("type")
    if kind == "reset":
        return event
    turn_id = event.get("turnId")
    # 轮次号必须能写入 4 字节无符号帧头，且布尔值不能充当轮次号。
    if type(turn_id) is not int or not 1 <= turn_id <= 0xFFFF_FFFF:
        return None
    # 条件 1，结束和打断只需有效轮次号。条件 2，开始指令还必须明确是否播报。
    if kind in ("finish", "cancel") or kind == "start" and type(event.get("speak")) is bool:
        return event
    return None
