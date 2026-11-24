// 主逻辑
// 提供新建对话、语音设置入口和当前模型信息，新建对话前确认清空记录。

import { useEffect, useRef } from 'react';
import { AudioLines, Headphones, MessageSquare, Plus, Settings2, X } from 'lucide-react';
import './session-sidebar.css';

interface SessionSidebarProps {
  model?: string;
  canReset: boolean;
  canConfigure: boolean;
  onRequestReset(): void;
  onOpenSettings(): void;
}

export function SessionSidebar({
  model,
  canReset,
  canConfigure,
  onRequestReset,
  onOpenSettings,
}: SessionSidebarProps) {
  return (
    <aside className="sidebar" aria-label="会话控制">
      <div className="brand">
        <div className="brand__icon">
          <AudioLines size={23} aria-hidden />
        </div>
        <div>
          <strong>声道</strong>
          <span>VOICE AGENT</span>
        </div>
      </div>
      <div className="sidebar__actions">
        <button className="new-chat" type="button" onClick={onRequestReset} disabled={!canReset}>
          <Plus size={17} aria-hidden /> <span>新建对话</span>
        </button>
        <div className="current-chat" aria-current="true">
          <MessageSquare size={16} aria-hidden />
          <span>当前语音会话</span>
        </div>
      </div>
      <div className="sidebar__bottom">
        <button
          type="button"
          className="settings-button"
          onClick={onOpenSettings}
          aria-haspopup="dialog"
          disabled={!canConfigure}
        >
          <Settings2 size={17} aria-hidden /> <span>语音设置</span>
        </button>
        <div className="mode">
          <Headphones size={16} aria-hidden />
          <span>{model ?? '语音服务'}</span>
        </div>
      </div>
    </aside>
  );
}

export function ResetDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="reset-dialog-title" onCancel={onClose}>
      <button type="button" className="dialog__close" onClick={onClose} aria-label="关闭">
        <X size={18} aria-hidden />
      </button>
      <h2 id="reset-dialog-title">新建对话</h2>
      <p>当前对话记录会被清空。</p>
      <div className="dialog__actions">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button type="button" onClick={onConfirm}>
          新建对话
        </button>
      </div>
    </dialog>
  );
}
