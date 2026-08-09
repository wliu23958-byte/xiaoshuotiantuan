import { useEffect, useRef, useState } from 'react'
import type { Chapter, Novel, ReaderSettings, ReaderTheme } from '../types'
import { splitEmphasis, toBlocks } from '../lib/utils'

interface Props {
  novel: Novel
  chapter: Chapter
  settings: ReaderSettings
  /** 打开阅读器时要恢复到的位置，仅对入口章节生效 */
  entryRatio: number
  onBack: () => void
  onNavigate: (chapterId: string) => void
  onProgress: (chapterId: string, ratio: number) => void
  onSettings: (patch: Partial<ReaderSettings>) => void
}

const themes: { key: ReaderTheme; label: string }[] = [
  { key: 'day', label: '白天' },
  { key: 'sepia', label: '纸色' },
  { key: 'night', label: '夜间' },
]

function RichText({ text }: { text: string }) {
  return (
    <>
      {splitEmphasis(text).map((part, i) =>
        i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
      )}
    </>
  )
}

export function ReaderView({
  novel,
  chapter,
  settings,
  entryRatio,
  onBack,
  onNavigate,
  onProgress,
  onSettings,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef(0)
  const entryChapterId = useRef(chapter.id)
  const entryRatioRef = useRef(entryRatio)
  const [ratio, setRatio] = useState(entryRatio)
  const [panel, setPanel] = useState<'none' | 'toc' | 'settings'>('none')

  const index = novel.chapters.findIndex((c) => c.id === chapter.id)
  const prev = index > 0 ? novel.chapters[index - 1] : null
  const next = index < novel.chapters.length - 1 ? novel.chapters[index + 1] : null
  const blocks = toBlocks(chapter.content)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const restore = chapter.id === entryChapterId.current ? entryRatioRef.current : 0
    // 只认第一次进入时的位置；之后再翻回这一章说明进度已经走远了，从头看更合理
    entryRatioRef.current = 0
    const max = el.scrollHeight - el.clientHeight
    el.scrollTop = max > 0 ? restore * max : 0
    setRatio(restore)
  }, [chapter.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (panel === 'none') onBack()
        else setPanel('none')
        return
      }
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev.id)
      if (e.key === 'ArrowRight' && next) onNavigate(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, onNavigate, prev, next, panel])

  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    const value = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0
    setRatio(value)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => onProgress(chapter.id, value), 300)
  }

  return (
    <div className="view reader" data-theme={settings.theme}>
      <header className="reader-bar">
        <button className="btn ghost" onClick={onBack}>
          ← {novel.title}
        </button>
        <span className="reader-chapter">{chapter.title}</span>
        <div className="topbar-actions">
          <button
            className="btn ghost"
            onClick={() => setPanel(panel === 'toc' ? 'none' : 'toc')}
          >
            目录
          </button>
          <button
            className="btn ghost"
            onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
          >
            Aa
          </button>
        </div>

        {panel === 'settings' && (
          <div className="popover" onMouseLeave={() => setPanel('none')}>
            <div className="popover-row">
              <span>字号</span>
              <div className="stepper">
                <button onClick={() => onSettings({ fontSize: Math.max(14, settings.fontSize - 1) })}>
                  －
                </button>
                <b>{settings.fontSize}</b>
                <button onClick={() => onSettings({ fontSize: Math.min(28, settings.fontSize + 1) })}>
                  ＋
                </button>
              </div>
            </div>
            <div className="popover-row">
              <span>行距</span>
              <div className="stepper">
                <button
                  onClick={() =>
                    onSettings({ lineHeight: Math.max(1.5, +(settings.lineHeight - 0.1).toFixed(1)) })
                  }
                >
                  －
                </button>
                <b>{settings.lineHeight.toFixed(1)}</b>
                <button
                  onClick={() =>
                    onSettings({ lineHeight: Math.min(2.6, +(settings.lineHeight + 0.1).toFixed(1)) })
                  }
                >
                  ＋
                </button>
              </div>
            </div>
            <div className="popover-row">
              <span>主题</span>
              <div className="segmented">
                {themes.map((t) => (
                  <button
                    key={t.key}
                    className={settings.theme === t.key ? 'active' : ''}
                    onClick={() => onSettings({ theme: t.key })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {panel === 'toc' && (
          <div className="popover toc" onMouseLeave={() => setPanel('none')}>
            <ol>
              {novel.chapters.map((c, i) => (
                <li key={c.id}>
                  <button
                    className={c.id === chapter.id ? 'active' : ''}
                    onClick={() => {
                      onNavigate(c.id)
                      setPanel('none')
                    }}
                  >
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    {c.title}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </header>

      <div className="reader-progress">
        <i style={{ width: `${ratio * 100}%` }} />
      </div>

      <div className="scroll reader-scroll" ref={scrollRef} onScroll={handleScroll}>
        <article
          className="page"
          style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}
        >
          <h1>{chapter.title}</h1>
          {blocks.length === 0 ? (
            <p className="page-empty">这一章还是空白的。</p>
          ) : (
            blocks.map((block, i) => {
              if (block.kind === 'divider') return <hr key={i} className="scene-break" />
              if (block.kind === 'quote')
                return (
                  <blockquote key={i}>
                    <RichText text={block.text} />
                  </blockquote>
                )
              return (
                <p key={i}>
                  <RichText text={block.text} />
                </p>
              )
            })
          )}

          <nav className="page-nav">
            <button className="btn ghost" disabled={!prev} onClick={() => prev && onNavigate(prev.id)}>
              {prev ? `← ${prev.title}` : '已是第一章'}
            </button>
            <button className="btn ghost" disabled={!next} onClick={() => next && onNavigate(next.id)}>
              {next ? `${next.title} →` : '已是最后一章'}
            </button>
          </nav>
        </article>
      </div>
    </div>
  )
}
