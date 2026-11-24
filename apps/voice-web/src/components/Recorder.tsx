// 主逻辑
// 按会话阶段显示录音、打断和播报控制，并同步更新计时与声波效果。

import { useEffect, useState, type CSSProperties } from 'react';
import { LoaderCircle, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { MAX_RECORDING_SECONDS } from '../constants/voice';
import type { Phase } from '../types/voice';
import './recorder.css';

const labels: Record<Phase, { status: string; button: string }> = {
  idle: { status: '待命', button: '开始录音' },
  connecting: { status: '连接中', button: '取消连接' },
  recording: { status: '正在录音', button: '结束录音' },
  transcribing: { status: '正在整理转写', button: '取消本轮' },
  thinking: { status: '正在生成回复', button: '停止回复' },
  speaking: { status: '正在播报', button: '停止播报' },
};

const wave = [
  5, 7, 9, 6, 12, 18, 12, 9, 17, 26, 36, 25, 15, 31, 43, 34, 22, 51, 68, 44, 25, 49, 62, 74, 54, 36,
  54, 74, 62, 49, 25, 44, 68, 51, 22, 34, 43, 31, 15, 25, 36, 26, 17, 9, 12, 18, 12, 6, 9, 7, 5,
];

function Waveform({ active }: { active: boolean }) {
  return (
    <div className={`waveform ${active ? 'waveform--active' : ''}`} aria-hidden="true">
      {wave.map((height, i) => (
        <span
          key={i}
          style={
            {
              '--bar-height': `${height}px`,
              '--bar-delay': `${-((i * 67) % 510)}ms`,
              '--bar-opacity': 0.28 + (1 - Math.abs(25 - i) / 25) * 0.66,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function RecorderTime({ start }: { start?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!start) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [start]);
  if (!start) return null;
  const seconds = Math.max(0, Math.min(MAX_RECORDING_SECONDS, Math.floor((now - start) / 1_000)));
  return (
    <span className="timer">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

interface RecorderProps {
  phase: Phase;
  recordingStartedAt?: number;
  disabled: boolean;
  speak: boolean;
  onAction(): void;
  onToggleSpeech(): void;
}

export function Recorder({
  phase,
  recordingStartedAt,
  disabled,
  speak,
  onAction,
  onToggleSpeech,
}: RecorderProps) {
  const ongoing = phase !== 'idle';
  const active = phase === 'recording' || phase === 'speaking';

  return (
    <section className="recorder" aria-labelledby="recorder-title">
      <div className="recorder__grid" aria-hidden="true" />
      <div className="recorder__content">
        <div className={`recorder__state ${active ? 'recorder__state--active' : ''}`}>
          <span aria-hidden="true" />
          <div role="status">{labels[phase].status}</div>
          <RecorderTime start={recordingStartedAt} />
        </div>
        <h1 id="recorder-title">实时语音对话</h1>
        <Waveform active={active} />
        <div className="recorder__controls">
          <button
            className={`record-button ${phase === 'recording' ? 'record-button--recording' : ''}`}
            type="button"
            onClick={onAction}
            disabled={disabled}
            aria-label={labels[phase].button}
          >
            {phase === 'idle' ? (
              <Mic size={21} aria-hidden />
            ) : phase === 'connecting' ? (
              <LoaderCircle size={20} className="spinner" aria-hidden />
            ) : (
              <Square size={15} fill="currentColor" aria-hidden />
            )}
            {labels[phase].button}
          </button>
          <button
            className="audio-button"
            type="button"
            aria-pressed={speak}
            aria-label="自动播报回复"
            title={speak ? '关闭自动播报' : '开启自动播报'}
            disabled={ongoing}
            onClick={onToggleSpeech}
          >
            {speak ? <Volume2 size={19} aria-hidden /> : <VolumeX size={19} aria-hidden />}
          </button>
        </div>
        <p className="recorder__hint">
          {phase === 'recording' ? '最多录制 1 分钟' : '结束录音后，助手会生成回复'}
        </p>
      </div>
    </section>
  );
}
