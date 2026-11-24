// 主逻辑
// 声明语音会话状态、服务配置和前后端交换的 WebSocket 事件。

export interface ProviderModels {
  asrModel: string;
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;
  searchEngine: string;
  dashscopeRegion: 'cn' | 'intl';
}

export interface ProviderSettings extends ProviderModels {
  dashscopeApiKey: string;
  deepseekApiKey: string;
  zhipuApiKey: string;
}

export interface VoiceConfig {
  defaults: ProviderModels;
  tokenRequired: boolean;
}

export interface Source {
  title: string;
  url: string;
}

export type ClientEvent =
  | { type: 'start'; turnId: number; speak: boolean }
  | { type: 'finish' | 'cancel'; turnId: number }
  | { type: 'reset' };

export type ServerEvent =
  | { type: 'ready' | 'reset' }
  | { type: 'connection_error'; message: string }
  | { type: 'phase'; turnId: number; phase: 'recording' | 'transcribing' | 'thinking' }
  | { type: 'transcript'; turnId: number; text: string; final: boolean }
  | { type: 'delta'; turnId: number; text: string }
  | { type: 'sources'; turnId: number; sources: Source[] }
  | { type: 'warning'; turnId: number; message: string }
  | { type: 'error'; turnId: number; message: string }
  | { type: 'done'; turnId: number }
  | { type: 'cancelled'; turnId: number };

export type Phase = 'idle' | 'connecting' | 'recording' | 'transcribing' | 'thinking' | 'speaking';

export interface Round {
  id: number;
  at: Date;
  transcript: string;
  final: boolean;
  reply: string;
  sources: Source[];
  result: 'pending' | 'done' | 'cancelled' | 'error';
}
