// 主逻辑
// 显示默认或已保存的模型配置，校验 API Key 和访问令牌，提交保存或清除操作。

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { ProviderSettings, VoiceConfig } from '../types/voice';
import './voice-settings.css';

interface Props {
  config: VoiceConfig;
  saved?: ProviderSettings;
  token: string;
  speak: boolean;
  onClose(): void;
  onSave(settings: ProviderSettings, token: string, speak: boolean): void;
  onClear(): void;
}

export function VoiceSettingsDialog({
  config,
  saved,
  token,
  speak,
  onClose,
  onSave,
  onClear,
}: Props) {
  const { defaults } = config;
  const dialog = useRef<HTMLDialogElement>(null);
  const [fields, setFields] = useState<ProviderSettings>(() => ({
    ...defaults,
    dashscopeApiKey: '',
    deepseekApiKey: '',
    zhipuApiKey: '',
    ...saved,
  }));
  const [accessToken, setAccessToken] = useState(token);
  const [autoSpeak, setAutoSpeak] = useState(speak);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 第一步，整理输入，空白模型字段使用服务端提供的默认值。
    const settings: ProviderSettings = {
      asrModel: fields.asrModel.trim() || defaults.asrModel,
      llmModel: fields.llmModel.trim() || defaults.llmModel,
      ttsModel: fields.ttsModel.trim() || defaults.ttsModel,
      ttsVoice: fields.ttsVoice.trim() || defaults.ttsVoice,
      searchEngine: fields.searchEngine.trim() || defaults.searchEngine,
      dashscopeRegion: fields.dashscopeRegion,
      dashscopeApiKey: fields.dashscopeApiKey.trim(),
      deepseekApiKey: fields.deepseekApiKey.trim(),
      zhipuApiKey: fields.zhipuApiKey.trim(),
    };
    if (!settings.dashscopeApiKey || !settings.deepseekApiKey || !settings.zhipuApiKey) {
      setError('请填写三个服务的 API Key。');
      return;
    }
    if (config.tokenRequired && !accessToken.trim()) {
      setError('请填写服务访问令牌。');
      return;
    }
    try {
      // 第二步，校验通过后保存。保存失败时保留输入，便于用户重试。
      onSave(settings, accessToken.trim(), autoSpeak);
    } catch {
      setError('无法写入浏览器存储，请检查站点存储权限后重试。');
    }
  };

  const input = (
    name: Exclude<keyof ProviderSettings, 'dashscopeRegion'>,
    label: string,
    placeholder?: string,
  ) => {
    const isKey = name.endsWith('ApiKey');
    return (
      <label className="voice-settings__field">
        <span>{label}</span>
        <input
          name={name}
          type={isKey ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          maxLength={isKey ? 512 : 128}
          required={isKey}
          placeholder={placeholder}
          value={fields[name]}
          onChange={(event) => setFields({ ...fields, [name]: event.target.value })}
        />
      </label>
    );
  };

  return (
    <dialog
      ref={dialog}
      className="dialog voice-settings"
      aria-labelledby="voice-settings-title"
      onCancel={onClose}
    >
      <button type="button" className="dialog__close" onClick={onClose} aria-label="关闭">
        <X size={18} aria-hidden />
      </button>
      <h2 id="voice-settings-title">语音设置</h2>
      <form onSubmit={submit}>
        <div className="voice-settings__groups">
          <fieldset>
            <legend>阿里云百炼</legend>
            {input('dashscopeApiKey', '百炼 API Key')}
            <div className="voice-settings__grid">
              {input('asrModel', '语音识别模型', defaults.asrModel)}
              {input('ttsModel', '语音合成模型', defaults.ttsModel)}
              {input('ttsVoice', '合成音色', defaults.ttsVoice)}
              <label className="voice-settings__field">
                <span>接入地域</span>
                <select
                  value={fields.dashscopeRegion}
                  onChange={(event) => {
                    setFields({
                      ...fields,
                      dashscopeRegion: event.target.value === 'intl' ? 'intl' : 'cn',
                    });
                  }}
                >
                  <option value="cn">华北 2（北京）</option>
                  <option value="intl">新加坡</option>
                </select>
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>DeepSeek</legend>
            <div className="voice-settings__grid">
              {input('deepseekApiKey', 'DeepSeek API Key')}
              {input('llmModel', '对话模型', defaults.llmModel)}
            </div>
          </fieldset>
          <fieldset>
            <legend>智谱搜索</legend>
            <div className="voice-settings__grid">
              {input('zhipuApiKey', '智谱 API Key')}
              {input('searchEngine', '搜索引擎', defaults.searchEngine)}
            </div>
          </fieldset>
          {config.tokenRequired && (
            <label className="voice-settings__field">
              <span>服务访问令牌</span>
              <input
                type="password"
                autoComplete="off"
                maxLength={1024}
                required
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
              />
            </label>
          )}
          <label className="voice-settings__toggle">
            <input
              type="checkbox"
              checked={autoSpeak}
              onChange={(event) => setAutoSpeak(event.target.checked)}
            />
            自动播报回复
          </label>
        </div>
        <p className="voice-settings__hint">API Key 以明文保存在此浏览器。</p>
        {error && (
          <p className="voice-settings__error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions voice-settings__actions">
          {saved && (
            <button
              className="voice-settings__clear"
              type="button"
              onClick={() => {
                try {
                  onClear();
                } catch {
                  setError('无法清除浏览器中的配置，请检查站点存储权限后重试。');
                }
              }}
            >
              清除本机配置
            </button>
          )}
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit">保存设置</button>
        </div>
      </form>
    </dialog>
  );
}
