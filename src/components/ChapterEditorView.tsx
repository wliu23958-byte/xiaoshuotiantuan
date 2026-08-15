import { useEffect, useRef, useState } from 'react'
import type { Chapter, Novel } from '../types'
import { countWords, formatWordCount } from '../lib/utils'
import { contentPath } from '../lib/content'

interface Props {
  novel: Novel
  chapter: Chapter
  onBack: () => void
  onRead: () => void
  onChange: (patch: { title: string; content: string }) => void
}

export function ChapterEditorView({ novel, chapter, onBack, onRead, onChange }: Props) {
  const [title, setTitle] = useState(chapter.title)
  const [content, setContent] = useState(chapter.content)
  const [dirty, setDirty] = useState(false)

  // 已落盘的内容。自动保存会触发 chapter 回流，拿它比对才不会把用户刚敲的字覆盖掉
  const committed = useRef({ id: chapter.id, title: chapter.title, content: chapter.content })
  const commit = useRef(onChange)
  commit.current = onChange

  useEffect(() => {
    if (committed.current.id === chapter.id) return
    committed.current = { id: chapter.id, title: chapter.title, content: chapter.content }
    setTitle(chapter.title)
    setContent(chapter.content)
    setDirty(false)
  }, [chapter])

  useEffect(() => {
    if (title === committed.current.title && content === committed.current.content) return
    setDirty(true)
    const timer = window.setTimeout(() => {
      const patch = { title: title.trim() || '无题', content }
      committed.current = { id: committed.current.id, ...patch }
      commit.current(patch)
      setDirty(false)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [title, content])

  const latest = useRef({ title, content })
  latest.current = { title, content }

  // 离开编辑器时把还没到点的那次自动保存补上，否则最后 600ms 内敲的字会跟着定时器一起被清掉
  useEffect(() => {
    return () => {
      const { title: t, content: c } = latest.current
      if (t === committed.current.title && c === committed.current.content) return
      commit.current({ title: t.trim() || '无题', content: c })
    }
  }, [])

  const words = countWords(content)

  return (
    <div className="view">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>
          ← {novel.title}
        </button>
        <span className={`save-hint ${dirty ? 'saving' : ''}`}>
          {dirty ? '正在写入…' : `已写入 ${contentPath(novel.dir, chapter.file)}`}
        </span>
        <div className="topbar-actions">
          <button className="btn ghost" onClick={onRead}>
            预览阅读
          </button>
        </div>
      </header>

      <div className="scroll">
        <div className="editor">
          <input
            className="editor-title"
            value={title}
            placeholder="章节标题"
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="editor-body"
            value={content}
            placeholder={'在这里写正文。\n\n空一行分段，阅读时会按段落排版。'}
            onChange={(e) => setContent(e.target.value)}
          />
          <footer className="editor-foot">
            <span>{formatWordCount(words)}</span>
            <span>{content.split('\n').filter((l) => l.trim()).length} 段</span>
          </footer>
        </div>
      </div>
    </div>
  )
}
