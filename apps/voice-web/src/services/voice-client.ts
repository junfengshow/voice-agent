// 主逻辑
// 编排录音、WebSocket 和播放状态，将当前轮次的转写、回复及来源同步给界面。

import { FRAME_HEADER_BYTES, MAX_RECORDING_SECONDS } from '../constants/voice';
import type { Phase, ProviderSettings, Round, ServerEvent } from '../types/voice';
import { captureMicrophone, type Capture } from './audio/capture';
import { PcmPlayer } from './audio/player';
import { VoiceConnection } from './voice-socket';

interface Snapshot {
  phase: Phase;
  connected: boolean;
  rounds: Round[];
  recordingStartedAt?: number;
  notice?: { kind: 'error' | 'warning'; text: string };
}

interface ActiveTurn {
  id: number;
  abort: AbortController;
  capture?: Capture;
  timer?: number;
  started: boolean;
  remoteDone: boolean;
}

function describe(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      return '请允许麦克风访问，再重新录音。';
    if (error.name === 'NotFoundError' || error.name === 'NotReadableError')
      return '麦克风不可用，请检查设备。';
    if (error.name === 'TimeoutError') return '连接超时，请检查网络后重试。';
  }
  return error instanceof Error ? error.message : '语音连接失败，请重试。';
}

export class VoiceClient {
  private snapshot: Snapshot = { phase: 'idle', connected: false, rounds: [] };
  private readonly subscribers = new Set<() => void>();
  private connection?: VoiceConnection;
  private context?: AudioContext;
  private moduleReady?: Promise<void>;
  private player?: PcmPlayer;
  private turn?: ActiveTurn;
  private nextId = 0;

  subscribe = (subscriber: () => void) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  getSnapshot = () => this.snapshot;

  async start(token: string, providers: ProviderSettings, speak: boolean) {
    if (this.turn) return;
    const turn: ActiveTurn = {
      id: ++this.nextId,
      abort: new AbortController(),
      started: false,
      remoteDone: false,
    };
    const signal = turn.abort.signal;
    this.turn = turn;
    const round: Round = {
      id: turn.id,
      at: new Date(),
      transcript: '',
      final: false,
      reply: '',
      sources: [],
      result: 'pending',
    };
    this.update({
      phase: 'connecting',
      notice: undefined,
      rounds: [...this.snapshot.rounds, round].slice(-50),
    });

    try {
      // 第一步，在点击事件中恢复音频设备并申请麦克风，同时发起连接。
      const context = this.audioContext();
      const resumed = context.resume();
      const capture = captureMicrophone(
        context,
        this.moduleReady!,
        signal,
        (data) => {
          if (this.turn !== turn || !turn.started || !this.connection) return;
          try {
            this.connection.audio(data);
          } catch (error) {
            this.fail(turn, describe(error), true);
          }
        },
        () => {
          if (this.turn === turn) this.fail(turn, '录音设备已断开，请重新连接后再试。', true);
        },
      );
      const transport =
        this.connection ??
        VoiceConnection.open(token, providers, signal, {
          event: (event) => this.receive(event),
          audio: (data) => this.receiveAudio(data),
          disconnected: (connection) => this.disconnect(connection),
        }).then((connection) => {
          if (signal.aborted) {
            connection.close();
            signal.throwIfAborted();
          }
          this.connection = connection;
          this.update({ connected: true });
          return connection;
        });
      const [microphone, connection] = await Promise.all([capture, transport, resumed]);
      signal.throwIfAborted();

      // 第二步，先发送开始指令，再放行麦克风音频，保证服务端按序收到。
      turn.capture = microphone;
      connection.control({ type: 'start', turnId: turn.id, speak });
      turn.started = true;
      microphone.start();
      turn.timer = window.setTimeout(() => {
        void this.finish();
      }, MAX_RECORDING_SECONDS * 1_000);
      this.update({ phase: 'recording', recordingStartedAt: Date.now() });
    } catch (error) {
      if (!signal.aborted) this.fail(turn, describe(error), true);
    }
  }

  async finish() {
    const turn = this.turn;
    if (!turn || this.snapshot.phase !== 'recording') return;
    this.update({ phase: 'transcribing', recordingStartedAt: undefined });
    window.clearTimeout(turn.timer);
    try {
      // Worklet 尾包先发出，服务端收到结束指令后才会结束识别。
      await turn.capture?.flush();
      if (this.turn === turn) this.connection?.control({ type: 'finish', turnId: turn.id });
    } catch (error) {
      this.fail(turn, describe(error), true);
    }
  }

  interrupt() {
    const turn = this.turn;
    if (!turn) return;
    this.end(turn, turn.remoteDone ? 'done' : 'cancelled');
    this.cancelRemote(turn);
  }

  reset() {
    this.interrupt();
    try {
      this.connection?.control({ type: 'reset' });
    } catch {
      this.closeConnection();
    }
    this.update({ rounds: [], notice: undefined });
  }

  closeConnection() {
    const connection = this.connection;
    this.connection = undefined;
    connection?.close();
    this.update({ connected: false });
  }

  dispose() {
    this.interrupt();
    this.closeConnection();
    this.player?.stop();
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = undefined;
    this.moduleReady = undefined;
    this.player = undefined;
  }

  private audioContext() {
    if (!this.context) {
      if (!window.isSecureContext)
        throw new Error('请通过 HTTPS 或 localhost 打开页面以使用麦克风。');
      this.context = new AudioContext();
      const context = this.context;
      this.moduleReady = (
        context.audioWorklet?.addModule(`${import.meta.env.BASE_URL}pcm-capture.js`) ??
        Promise.reject(new Error('当前浏览器不支持 AudioWorklet。'))
      ).catch((error: unknown) => {
        void context.close().catch(() => undefined);
        if (this.context === context) {
          this.context = undefined;
          this.moduleReady = undefined;
          this.player = undefined;
        }
        throw error;
      });
      void this.moduleReady.catch(() => undefined);
      this.player = new PcmPlayer(context, () => {
        const turn = this.turn;
        if (turn?.remoteDone) this.end(turn, 'done');
        else if (turn && this.snapshot.phase === 'speaking') this.update({ phase: 'thinking' });
      });
    }
    return this.context;
  }

  private receive(event: ServerEvent) {
    const turn = this.turn;
    // 打断后仍可能收到旧事件，只允许当前轮次更新界面。
    if (!turn || !('turnId' in event) || event.turnId !== turn.id) return;
    switch (event.type) {
      case 'phase':
        if (event.phase === 'recording') break;
        window.clearTimeout(turn.timer);
        turn.capture?.close();
        this.update({ phase: event.phase, recordingStartedAt: undefined });
        break;
      case 'transcript':
        this.editRound(turn.id, (round) => ({
          ...round,
          transcript: event.text,
          final: event.final,
        }));
        break;
      case 'delta':
        this.editRound(turn.id, (round) => ({ ...round, reply: round.reply + event.text }));
        break;
      case 'sources':
        this.editRound(turn.id, (round) => ({ ...round, sources: event.sources }));
        break;
      case 'warning':
        this.update({ notice: { kind: 'warning', text: event.message } });
        break;
      case 'error':
        this.fail(turn, event.message);
        break;
      case 'cancelled':
        this.end(turn, 'cancelled');
        break;
      case 'done':
        turn.remoteDone = true;
        this.editRound(turn.id, (round) => ({ ...round, result: 'done' }));
        // 服务端结束后，若本地还有排队的音频，由播放结束回调收尾。
        if (!this.player?.playing) this.end(turn, 'done');
        break;
    }
  }

  private receiveAudio(data: ArrayBuffer) {
    if (
      !this.turn ||
      !this.player ||
      data.byteLength <= FRAME_HEADER_BYTES ||
      data.byteLength % 2 !== 0
    )
      return;
    if (new DataView(data).getUint32(0) !== this.turn.id) return;
    this.player.append(new DataView(data, FRAME_HEADER_BYTES));
    if (this.snapshot.phase !== 'speaking') this.update({ phase: 'speaking' });
  }

  private disconnect(connection: VoiceConnection) {
    if (this.connection !== connection) return;
    this.closeConnection();
    const turn = this.turn;
    if (turn && !turn.remoteDone) this.fail(turn, '语音连接已断开，重新录音可建立新会话。');
  }

  private cancelRemote(turn: ActiveTurn) {
    if (!turn.started || turn.remoteDone) return;
    try {
      this.connection?.control({ type: 'cancel', turnId: turn.id });
    } catch {
      this.closeConnection();
    }
  }

  private fail(turn: ActiveTurn, message: string, notifyRemote = false) {
    if (this.turn !== turn) return;
    this.end(turn, 'error');
    if (notifyRemote) this.cancelRemote(turn);
    this.update({ notice: { kind: 'error', text: message } });
  }

  private end(turn: ActiveTurn, result: Round['result']) {
    // 先让轮次失效，再取消异步操作，避免清理时产生的回调更新已结束的轮次。
    this.turn = undefined;
    window.clearTimeout(turn.timer);
    turn.abort.abort();
    turn.capture?.close();
    this.player?.stop();
    const rounds = this.snapshot.rounds
      .filter(
        (round) => round.id !== turn.id || round.transcript || round.reply || round.sources.length,
      )
      .map((round) => (round.id === turn.id ? { ...round, result } : round));
    this.update({ phase: 'idle', recordingStartedAt: undefined, rounds });
  }

  private editRound(id: number, edit: (round: Round) => Round) {
    this.update({
      rounds: this.snapshot.rounds.map((round) => (round.id === id ? edit(round) : round)),
    });
  }

  private update(next: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const subscriber of this.subscribers) subscriber();
  }
}
