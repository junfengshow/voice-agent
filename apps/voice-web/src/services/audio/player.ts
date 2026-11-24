// 主逻辑
// 将小端 PCM 解码为 Web Audio 缓冲区，按时间排队播放，并支持立即停止。

import { OUTPUT_RATE } from '../../constants/voice';

export class PcmPlayer {
  private readonly queue = new Set<AudioBufferSourceNode>();
  private nextTime = 0;

  constructor(
    private readonly context: AudioContext,
    private readonly onDrained: () => void,
  ) {}

  get playing() {
    return this.queue.size > 0;
  }

  append(data: DataView) {
    const samples = data.byteLength / 2;
    const buffer = this.context.createBuffer(1, samples, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) channel[i] = data.getInt16(i * 2, true) / 32768;

    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.context.destination);
    node.onended = () => {
      node.disconnect();
      this.queue.delete(node);
      if (!this.playing) this.onDrained();
    };
    this.queue.add(node);
    // 首包留出缓冲，后续音频按播放时间连续排队。
    const now = this.context.currentTime;
    const start = this.nextTime > now ? this.nextTime : now + 0.075;
    this.nextTime = start + buffer.duration;
    node.start(start);
  }

  stop() {
    for (const node of this.queue) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    this.queue.clear();
    this.nextTime = 0;
  }
}
