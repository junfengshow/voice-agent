// 主逻辑
// 在音频线程将麦克风输入重采样为 16 位小端 PCM，按帧发送并在停止时补发尾包。

class PcmCapture extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.outputRate = processorOptions.rate;
    this.inputRate = sampleRate;
    this.frameBytes = processorOptions.frameBytes;
    this.frame = new ArrayBuffer(this.frameBytes);
    this.view = new DataView(this.frame);
    this.offset = 0;
    this.phase = 0;
    this.sum = 0;
    this.stopped = false;
    this.port.onmessage = () => {
      // 先发送剩余样本，再回执采集已结束，确保主线程能完整上传尾帧。
      this.stopped = true;
      if (this.offset) this.emit();
      this.port.postMessage('flushed');
    };
  }

  emit() {
    const data = this.offset === this.frameBytes ? this.frame : this.frame.slice(0, this.offset);
    // 把缓冲区所有权转给主线程，发送后使用新的缓冲区继续写入。
    this.port.postMessage(data, [data]);
    this.frame = new ArrayBuffer(this.frameBytes);
    this.view = new DataView(this.frame);
    this.offset = 0;
  }

  process(inputs) {
    if (this.stopped) return false;
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    // 用整数累计重采样的时间权重，避免 44.1 kHz 等采样率在帧尾少一个采样点。
    for (const sample of samples) {
      const available = this.inputRate - this.phase;
      if (this.outputRate < available) {
        this.sum += sample * this.outputRate;
        this.phase += this.outputRate;
        continue;
      }
      const averaged = Math.max(-1, Math.min(1, (this.sum + sample * available) / this.inputRate));
      this.view.setInt16(this.offset, Math.round(averaged * (averaged < 0 ? 32768 : 32767)), true);
      this.offset += 2;
      if (this.offset === this.frameBytes) this.emit();
      this.phase = this.outputRate - available;
      this.sum = sample * this.phase;
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
