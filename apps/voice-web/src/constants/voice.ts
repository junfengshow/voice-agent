// 主逻辑
// 集中定义音频采样率、分帧大小、录音时长和 WebSocket 发送缓冲上限。

export const INPUT_RATE = 16_000;
export const OUTPUT_RATE = 24_000;
export const INPUT_FRAME_BYTES = 3_200;
export const FRAME_HEADER_BYTES = 4;
export const MAX_RECORDING_SECONDS = 60;
export const MAX_SOCKET_QUEUE = 128 * 1024;
