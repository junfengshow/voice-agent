// 主逻辑
// 申请麦克风权限并接入 AudioWorklet，向会话转发 PCM，结束时发出尾包并释放采集资源。

import { INPUT_FRAME_BYTES, INPUT_RATE } from '../../constants/voice';

export interface Capture {
  start(): void;
  flush(): Promise<void>;
  close(): void;
}

export async function captureMicrophone(
  context: AudioContext,
  moduleReady: Promise<void>,
  signal: AbortSignal,
  onAudio: (data: ArrayBuffer) => void,
  onEnded: () => void,
): Promise<Capture> {
  if (!navigator.mediaDevices?.getUserMedia || !context.audioWorklet) {
    throw new Error('请在支持麦克风的浏览器通过 HTTPS 或 localhost 打开页面。');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const tracks = stream.getTracks();
  const stopTracks = () => tracks.forEach((track) => track.stop());
  // 第一步，先为加载 Worklet 期间的取消操作注册麦克风轨道清理。
  signal.addEventListener('abort', stopTracks, { once: true });
  try {
    signal.throwIfAborted();
    await moduleReady;
    signal.throwIfAborted();
    if (context.sampleRate < INPUT_RATE) throw new Error('此音频设备的采样率低于 16 kHz。');

    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, 'pcm-capture', {
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { rate: INPUT_RATE, frameBytes: INPUT_FRAME_BYTES },
    });
    let finish = () => {};
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', close);
      source.disconnect();
      worklet.disconnect();
      worklet.port.close();
      stopTracks();
      finish();
    };
    // 第二步，节点准备好后接管取消操作，同时释放媒体轨道和 Worklet。
    signal.removeEventListener('abort', stopTracks);
    signal.addEventListener('abort', close, { once: true });
    for (const track of tracks) track.addEventListener('ended', onEnded, { once: true });
    worklet.onprocessorerror = onEnded;
    worklet.port.onmessage = ({ data }: MessageEvent<ArrayBuffer | 'flushed'>) => {
      if (data === 'flushed') finish();
      else if (!closed) onAudio(data);
    };

    return {
      start() {
        if (closed) return;
        source.connect(worklet);
        // 连接到输出设备让浏览器持续调度 Worklet，处理器始终输出静音。
        worklet.connect(context.destination);
      },
      async flush() {
        if (closed) return;
        // 收到尾帧回执再关闭采集。若 Worklet 无响应，超时后释放麦克风。
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(resolve, 600);
          finish = () => {
            window.clearTimeout(timeout);
            resolve();
          };
          worklet.port.postMessage('flush');
        });
        close();
      },
      close,
    };
  } catch (error) {
    signal.removeEventListener('abort', stopTracks);
    stopTracks();
    throw error;
  }
}
