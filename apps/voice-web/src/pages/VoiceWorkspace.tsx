// 主逻辑
// 组装语音工作台，读取服务默认配置，连接录音、会话设置和对话记录。

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AudioLines, CircleAlert } from 'lucide-react';
import { Conversation } from '../components/Conversation';
import { Recorder } from '../components/Recorder';
import { ResetDialog, SessionSidebar } from '../components/SessionSidebar';
import { VoiceSettingsDialog } from '../components/VoiceSettingsDialog';
import type { ProviderSettings, VoiceConfig } from '../types/voice';
import {
  clearProviderSettings,
  readProviderSettings,
  saveProviderSettings,
} from '../services/provider-settings';
import { getVoiceConfig } from '../services/voice-socket';
import { VoiceClient } from '../services/voice-client';

export function VoiceWorkspace() {
  const [client] = useState(() => new VoiceClient());
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [config, setConfig] = useState<VoiceConfig>();
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [settings, setSettings] = useState(false);
  const [providers, setProviders] = useState(readProviderSettings);
  const [speak, setSpeak] = useState(true);
  const [token, setToken] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);

  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    const request = new AbortController();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
    void getVoiceConfig(signal).then(
      (value) => {
        if (!request.signal.aborted) setConfig(value);
      },
      () => {
        if (!request.signal.aborted) setConfigError(true);
      },
    );
    return () => request.abort();
  }, [configAttempt]);

  const { phase, rounds, notice, connected } = state;
  const ongoing = phase !== 'idle';
  const configured = Boolean(providers) && (!config?.tokenRequired || Boolean(token));
  const action = () => {
    if (phase === 'recording') void client.finish();
    else if (ongoing) client.interrupt();
    else if (!providers || !configured) setSettings(true);
    else void client.start(token, providers, speak);
  };

  const saveSettings = (next: ProviderSettings, accessToken: string, autoSpeak: boolean) => {
    // 第一步，先写入浏览器，再更新界面。写入失败时保留原配置。
    saveProviderSettings(next);
    // 第二步，令牌或服务配置变化时关闭旧连接，下次录音使用新配置。
    if (
      connected &&
      (accessToken !== token || JSON.stringify(next) !== JSON.stringify(providers))
    ) {
      client.closeConnection();
    }
    setProviders(next);
    setToken(accessToken);
    setSpeak(autoSpeak);
    setSettings(false);
  };

  const clearSettings = () => {
    clearProviderSettings();
    client.closeConnection();
    setProviders(undefined);
    setSettings(false);
  };

  const status = connected
    ? '语音已连接'
    : !config
      ? '正在检查服务'
      : configured
        ? '服务就绪'
        : '待配置';

  return (
    <div className="shell">
      <SessionSidebar
        model={providers?.llmModel ?? config?.defaults.llmModel}
        canReset={rounds.length > 0 || ongoing}
        canConfigure={Boolean(config) && !ongoing}
        onRequestReset={() => setResetConfirm(true)}
        onOpenSettings={() => setSettings(true)}
      />

      <main>
        <header className="topbar">
          <div className="topbar__title">
            <AudioLines size={19} aria-hidden />
            <span>语音工作台</span>
          </div>
          <div className="topbar__right">
            {configError ? (
              <button
                type="button"
                className="badge status-badge status-badge--error"
                onClick={() => {
                  setConfigError(false);
                  setConfigAttempt((value) => value + 1);
                }}
              >
                重试连接
              </button>
            ) : (
              <span
                className={`badge status-badge ${config && configured ? 'status-badge--online' : ''}`}
                role="status"
              >
                <i aria-hidden="true" />
                {status}
              </span>
            )}
          </div>
        </header>

        <div className="workspace">
          <Recorder
            phase={phase}
            recordingStartedAt={state.recordingStartedAt}
            disabled={!config}
            speak={speak}
            onAction={action}
            onToggleSpeech={() => setSpeak((value) => !value)}
          />
          {(notice || configError) && (
            <div className={`notice notice--${notice?.kind ?? 'error'}`} role="alert">
              <CircleAlert size={17} aria-hidden />
              {notice?.text ?? '语音服务暂不可用，请重试连接。'}
            </div>
          )}
          <Conversation rounds={rounds} />
        </div>
      </main>

      {settings && config && (
        <VoiceSettingsDialog
          config={config}
          saved={providers}
          token={token}
          speak={speak}
          onClose={() => setSettings(false)}
          onSave={saveSettings}
          onClear={clearSettings}
        />
      )}
      {resetConfirm && (
        <ResetDialog
          onClose={() => setResetConfirm(false)}
          onConfirm={() => {
            client.reset();
            setResetConfirm(false);
          }}
        />
      )}
    </div>
  );
}
