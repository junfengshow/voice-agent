// 主逻辑
// 从 localStorage 恢复、保存或清除 API Key 和模型配置，读取时只接受已知字段。

import type { ProviderSettings } from '../types/voice';

const storageKey = 'voice-agent.provider-settings.v1';
const fields = [
  'asrModel',
  'llmModel',
  'ttsModel',
  'ttsVoice',
  'searchEngine',
  'dashscopeRegion',
  'dashscopeApiKey',
  'deepseekApiKey',
  'zhipuApiKey',
] as const satisfies readonly (keyof ProviderSettings)[];

export function readProviderSettings(): ProviderSettings | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return;

    const entries = [];
    for (const field of fields) {
      const value = saved[field];
      if (typeof value !== 'string' || !value.trim()) return;
      entries.push([field, value.trim()]);
    }
    if (saved.dashscopeRegion !== 'cn' && saved.dashscopeRegion !== 'intl') return;
    return Object.fromEntries(entries) as ProviderSettings;
  } catch {
    return;
  }
}

export function saveProviderSettings(settings: ProviderSettings) {
  window.localStorage.setItem(storageKey, JSON.stringify(settings));
}

export function clearProviderSettings() {
  window.localStorage.removeItem(storageKey);
}
