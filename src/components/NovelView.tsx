import { useMemo, useState } from 'react'
import type { Novel, Progress } from '../types'
import { BookCover } from './BookCover'
import { countWords, formatDate, formatWordCount, novelWordCount } from '../lib/utils'
import { contentPath, labelByStatus } from '../lib/content'
import { canEdit } from '../lib/api'

interface Props {
  novel: Novel
  progress?: Progress
  onBack: () => void
  onRead: (chapterId: string) => void
  onEditChapter: (chapterId: string) => void
  onAddChapter: (title: string) => void
  onRemoveChapter: (chapterId: string) => void
  onEditNovel: () => void
  onRemoveNovel: () => void
}

export function NovelView({
  novel,
  progress,
  onBack,
  onRead,
  onEditChapter,
  onAddChapter,
  onRemoveChapter,
  onEditNovel,
  onRemoveNovel,
}: Props) {
  const [newTitle, setNewTitle] = useState('')

  // 每敲一个字都会重渲染这个组件，字数得跟着章节内容缓存，不能每次都对全书重跑一遍正则
  const chapterWords = useMemo(
    () => new Map(novel.chapters.map((c) => [c.id, countWords(c.content)])),
    [novel.chapters],
  )
  const totalWords = useMemo(() => novelWordCount(novel), [novel])

  const addChapter = () => {
    const title = newTitle.trim() || `第 ${novel.chapters.length + 1} 章`
    onAddChapter(title)
    setNewTitle('')
  }

  return (
    <div className="view">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← 书架
        </button>
        <span className="path-hint">{contentPath(novel.dir)}/</span>
        {canEdit && (
          <div className="topbar-actions">
            <button className="btn ghost" onClick={onEditNovel}>
              编辑信息
            </button>
            <button
              className="btn danger"
              // 平铺作品没有自己的目录，删它等于清空内容根目录，服务端会拒
              disabled={!novel.dir}
              title={novel.dir ? undefined : '这部作品直接摊在内容根目录下，没有自己的目录，删不了'}
              onClick={() => {
                if (
                  confirm(
                    `删除《${novel.title}》会连同 ${contentPath(novel.dir)}/ 整个目录一起删掉，共 ${novel.chapters.length} 章。继续？`,
                  )
                ) {
                  onRemoveNovel()
                }
              }}
            >
              删除作品
            </button>
          </div>
        )}
      </header>

      <div className="scroll">
        <div className="container">
          <section className="novel-hero">
            <BookCover novel={novel} size="lg" />
            <div className="novel-meta">
              <div className="card-head">
                <h1>{novel.title}</h1>
                <span className={`chip chip-${novel.status}`}>{labelByStatus[novel.status]}</span>
              </div>
              <p className="novel-author">{novel.author}</p>
              <p className="novel-intro">{novel.intro || '还没有写简介。'}</p>
              <div className="card-tags">
                {novel.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
              <dl className="stats">
                <div>
                  <dt>章节</dt>
                  <dd>{novel.chapters.length}</dd>
                </div>
                <div>
                  <dt>字数</dt>
                  <dd>{formatWordCount(totalWords)}</dd>
                </div>
                <div>
                  <dt>更新</dt>
                  <dd>{formatDate(novel.updatedAt)}</dd>
                </div>
              </dl>
              {novel.chapters.length > 0 && (
                <button
                  className="btn primary lg"
                  onClick={() => onRead(progress?.chapterId ?? novel.chapters[0].id)}
                >
                  {progress ? '继续阅读' : '从头开始读'}
                </button>
              )}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">目录</h2>
              {canEdit && (
                <div className="toolbar">
                  <input
                    className="search"
                    value={newTitle}
                    placeholder="新章节标题"
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addChapter()}
                  />
                  <button className="btn primary" onClick={addChapter}>
                    + 新建章节
                  </button>
                </div>
              )}
            </div>

            {novel.chapters.length === 0 ? (
              <div className="empty">
                <p>还没有章节，先建一章开个头</p>
              </div>
            ) : (
              <ol className="chapter-list">
                {novel.chapters.map((c, i) => {
                  const words = chapterWords.get(c.id) ?? 0
                  return (
                    <li key={c.id} className={progress?.chapterId === c.id ? 'current' : ''}>
                      <button className="chapter-main" onClick={() => onRead(c.id)}>
                        <span className="chapter-no">{String(i + 1).padStart(2, '0')}</span>
                        <span className="chapter-title">{c.title}</span>
                        <span className="chapter-words">
                          {words ? formatWordCount(words) : '空白'}
                        </span>
                      </button>
                      {canEdit && (
                        <div className="chapter-ops">
                          <button className="btn ghost sm" onClick={() => onEditChapter(c.id)}>
                            编辑
                          </button>
                          <button
                            className="btn ghost sm danger-text"
                            onClick={() => {
                              if (confirm(`删除 ${contentPath(novel.dir, c.file)}？`))
                                onRemoveChapter(c.id)
                            }}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
