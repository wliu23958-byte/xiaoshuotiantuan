import { useMemo, useState } from 'react'
import type { Novel, NovelStatus, Progress } from '../types'
import { BookCover } from './BookCover'
import { formatDate, formatWordCount, novelWordCount } from '../lib/utils'
import { labelByStatus } from '../lib/content'
import { canEdit } from '../lib/api'

interface Props {
  novels: Novel[]
  progress: Record<string, Progress>
  loading: boolean
  onOpen: (novelId: string) => void
  onRead: (novelId: string, chapterId: string) => void
  onCreate: () => void
  onReload: () => void
  onClearReading: () => void
}

type Filter = 'all' | NovelStatus

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'ongoing', label: '连载中' },
  { key: 'finished', label: '已完结' },
  { key: 'draft', label: '草稿' },
]

export function LibraryView({
  novels,
  progress,
  loading,
  onOpen,
  onRead,
  onCreate,
  onReload,
  onClearReading,
}: Props) {
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const shown = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return novels
      .filter((n) => filter === 'all' || n.status === filter)
      .filter((n) => {
        if (!kw) return true
        return [n.title, n.author, n.intro, ...n.tags].some((f) => f.toLowerCase().includes(kw))
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [novels, filter, keyword])

  const reading = useMemo(() => {
    return Object.entries(progress)
      .map(([id, p]) => {
        const novel = novels.find((n) => n.id === id)
        const chapter = novel?.chapters.find((c) => c.id === p.chapterId)
        return novel && chapter ? { novel, chapter, progress: p } : null
      })
      .filter((x) => x !== null)
      .sort((a, b) => b.progress.at - a.progress.at)
      .slice(0, 3)
  }, [novels, progress])

  // 搜索框每敲一个字都会重渲染，字数只跟着 novels 变，不能让它跟着按键对全书重跑正则
  const wordCounts = useMemo(
    () => new Map(novels.map((n) => [n.id, novelWordCount(n)])),
    [novels],
  )
  const totalWords = useMemo(
    () => [...wordCounts.values()].reduce((sum, n) => sum + n, 0),
    [wordCounts],
  )

  return (
    <div className="view">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">墨</span>
          <div>
            <h1>小说天团</h1>
            <p>
              {novels.length} 部作品 · 共 {formatWordCount(totalWords)} · 来自 正文/ 目录
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          {canEdit && (
            <button className="btn ghost" onClick={onReload} title="重新读取 正文/ 目录">
              重新载入
            </button>
          )}
          <button className="btn ghost" onClick={onClearReading} title="清空本机的阅读进度与排版偏好">
            清空阅读记录
          </button>
          {canEdit && (
            <button className="btn primary" onClick={onCreate}>
              + 新建作品
            </button>
          )}
        </div>
      </header>

      <div className="scroll">
        <div className="container">
          {reading.length > 0 && (
            <section className="section">
              <h2 className="section-title">继续阅读</h2>
              <div className="continue-row">
                {reading.map(({ novel, chapter, progress }) => (
                  <button
                    key={novel.id}
                    className="continue-card"
                    onClick={() => onRead(novel.id, chapter.id)}
                  >
                    <BookCover novel={novel} size="sm" />
                    <div className="continue-meta">
                      <strong>{novel.title}</strong>
                      <span>{chapter.title}</span>
                      <div className="progress-bar">
                        <i style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                      </div>
                      <small>
                        读到 {Math.round(progress.ratio * 100)}% · {formatDate(progress.at)}
                      </small>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">书架</h2>
              <div className="toolbar">
                <input
                  className="search"
                  value={keyword}
                  placeholder="搜书名、作者、标签"
                  onChange={(e) => setKeyword(e.target.value)}
                />
                <div className="segmented">
                  {filters.map((f) => (
                    <button
                      key={f.key}
                      className={f.key === filter ? 'active' : ''}
                      onClick={() => setFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loading ? (
              <div className="empty">
                <p>正在读取 正文/ 目录…</p>
              </div>
            ) : shown.length === 0 ? (
              <div className="empty">
                <p>
                  {keyword
                    ? `没有匹配「${keyword}」的作品`
                    : '正文/ 目录下还没有内容，每部作品一个子目录，里面放 _book.md 和章节 md'}
                </p>
                {canEdit && !keyword && (
                  <button className="btn primary" onClick={onCreate}>
                    新建作品
                  </button>
                )}
              </div>
            ) : (
              <div className="grid">
                {shown.map((novel) => (
                  <article
                    key={novel.id}
                    className="card"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(novel.id)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      onOpen(novel.id)
                    }}
                  >
                    <BookCover novel={novel} />
                    <div className="card-body">
                      <div className="card-head">
                        <h3>{novel.title}</h3>
                        <span className={`chip chip-${novel.status}`}>
                          {labelByStatus[novel.status]}
                        </span>
                      </div>
                      <p className="card-author">{novel.author}</p>
                      <p className="card-intro">{novel.intro || '还没有写简介'}</p>
                      <div className="card-tags">
                        {novel.tags.map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                      <footer className="card-foot">
                        <span>{novel.chapters.length} 章</span>
                        <span>{formatWordCount(wordCounts.get(novel.id) ?? 0)}</span>
                        <span>{formatDate(novel.updatedAt)}更新</span>
                      </footer>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
