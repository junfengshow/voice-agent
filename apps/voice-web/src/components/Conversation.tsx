// 主逻辑
// 展示每轮转写、回复和搜索来源。用户靠近列表底部时跟随流式更新。

import { useEffect, useRef } from 'react';
import { AudioLines, ExternalLink, MessageSquare, Mic } from 'lucide-react';
import type { Round } from '../types/voice';
import './conversation.css';

const clock = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function Conversation({ rounds }: { rounds: Round[] }) {
  const list = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (list.current && follow.current) list.current.scrollTop = list.current.scrollHeight;
  }, [rounds]);

  return (
    <section className="conversation" aria-labelledby="conversation-title">
      <div className="conversation__heading">
        <MessageSquare size={17} aria-hidden />
        <h2 id="conversation-title">对话记录</h2>
        {rounds.length > 0 && <span>{rounds.length} 轮</span>}
      </div>
      <div
        className="conversation__body"
        ref={list}
        onScroll={(event) => {
          const node = event.currentTarget;
          follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 30;
        }}
      >
        {rounds.length === 0 ? (
          <div className="empty">
            <AudioLines size={19} aria-hidden />
            <p>转写和回复会出现在这里</p>
          </div>
        ) : (
          rounds.map((round) => (
            <article className="round" key={round.id}>
              <div className="round__head">
                <time dateTime={round.at.toISOString()}>{clock.format(round.at)}</time>
                {round.result === 'cancelled' && <span>已打断</span>}
                {round.result === 'error' && <span>未完成</span>}
              </div>
              <div className="message">
                <span className="message__icon">
                  <Mic size={14} aria-hidden />
                </span>
                <div>
                  <div className="message__label">
                    语音转写
                    {round.transcript && !round.final && round.result === 'pending' && (
                      <small>实时</small>
                    )}
                  </div>
                  <p className={round.transcript ? '' : 'placeholder'}>
                    {round.transcript || '等待语音转写…'}
                  </p>
                </div>
              </div>
              {(round.final || round.reply || round.sources.length > 0) && (
                <div className="message message--assistant">
                  <span className="message__icon">
                    <AudioLines size={14} aria-hidden />
                  </span>
                  <div>
                    <div className="message__label">助手回复</div>
                    <p className={round.reply ? '' : 'placeholder'}>
                      {round.reply ||
                        (round.result === 'pending' ? '正在生成…' : '本轮未生成回复。')}
                    </p>
                    {round.sources.length > 0 && (
                      <div className="sources" aria-label="搜索来源">
                        <span>搜索来源</span>
                        <ul>
                          {round.sources.map(({ title, url }) => (
                            <li key={url}>
                              <a href={url} target="_blank" rel="noopener noreferrer">
                                {title}
                                <ExternalLink size={12} aria-hidden />
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
