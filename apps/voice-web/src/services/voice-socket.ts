// 主逻辑
// 读取服务配置并管理 WebSocket 握手。分发 JSON 事件和二进制 PCM，限制客户端的待发送音频。

import { MAX_SOCKET_QUEUE } from '../constants/voice';
import type { ClientEvent, ProviderSettings, ServerEvent, VoiceConfig } from '../types/voice';

export async function getVoiceConfig(signal: AbortSignal): Promise<VoiceConfig> {
  const response = await fetch('/api/voice/config', { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`语音服务请求失败（${response.status}）`);
  return response.json() as Promise<VoiceConfig>;
}

interface Handlers {
  event(event: ServerEvent): void;
  audio(data: ArrayBuffer): void;
  disconnected(connection: VoiceConnection): void;
}

export class VoiceConnection {
  private closed = false;

  private constructor(private readonly socket: WebSocket) {}

  static async open(
    token: string,
    providers: ProviderSettings,
    parent: AbortSignal,
    handlers: Handlers,
  ) {
    const url = new URL('/api/voice/ws', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const signal = AbortSignal.any([parent, AbortSignal.timeout(10_000)]);
    signal.throwIfAborted();
    const socket = new WebSocket(url);
    const connection = new VoiceConnection(socket);
    socket.binaryType = 'arraybuffer';

    return new Promise<VoiceConnection>((resolve, reject) => {
      let ready = false;
      const abort = () => {
        connection.close();
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      const disconnect = () => {
        if (connection.closed) return;
        signal.removeEventListener('abort', abort);
        connection.close();
        if (ready) handlers.disconnected(connection);
        else reject(new Error('语音连接未建立，请检查网络或服务状态。'));
      };
      // 第一步，在连接首帧发送令牌与服务配置。第二步，收到 ready 后才允许录音上行。
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token, providers }));
      socket.onmessage = ({ data }: MessageEvent<string | ArrayBuffer>) => {
        if (connection.closed) return;
        if (typeof data !== 'string') {
          handlers.audio(data);
          return;
        }
        const event = JSON.parse(data) as ServerEvent;
        if (event.type === 'connection_error') {
          signal.removeEventListener('abort', abort);
          connection.close();
          reject(new Error(event.message));
        } else if (event.type === 'ready' && !ready) {
          signal.removeEventListener('abort', abort);
          ready = true;
          resolve(connection);
        } else if (ready) {
          handlers.event(event);
        }
      };
      socket.onerror = disconnect;
      socket.onclose = disconnect;
    });
  }

  control(event: ClientEvent) {
    this.send(JSON.stringify(event));
  }

  audio(data: ArrayBuffer) {
    if (this.socket.bufferedAmount > MAX_SOCKET_QUEUE)
      throw new Error('网络不稳定，本轮录音已停止。');
    this.send(data);
  }

  private send(data: string | ArrayBuffer) {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('语音连接已断开。');
    this.socket.send(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.socket.close();
  }
}
