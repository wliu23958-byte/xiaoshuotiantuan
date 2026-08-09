import { useState } from 'react'
import type { FormEvent } from 'react'
import type { NovelDraft } from '../hooks/useLibrary'
import type { NovelStatus } from '../types'
import { CONTENT_ROOT, labelByStatus, safeName, uniqueDir } from '../lib/content'

interface Props {
  initial?: NovelDraft
  /** 已被占用的目录名，用来预告这本书实际会落到哪个目录 */
  takenDirs?: string[]
  onSubmit: (draft: NovelDraft) => void
  onClose: () => void
}

// 每次打开都要重新取色，写成模块常量会让一次会话里新建的书全是同一个封面色
function createEmptyDraft(): NovelDraft {
  return {
    title: '',
    author: '',
    intro: '',
    tags: [],
    status: 'draft',
    hue: Math.floor(Math.random() * 360),
  }
}

export function NovelFormModal({ initial, takenDirs = [], onSubmit, onClose }: Props) {
  const [draft, setDraft] = useState<NovelDraft>(() => initial ?? createEmptyDraft())
  const [tagText, setTagText] = useState((initial?.tags ?? []).join('，'))

  const wantedDir = safeName(draft.title)
  const targetDir = wantedDir ? uniqueDir(wantedDir, takenDirs) : ''

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const title = draft.title.trim()
    if (!title) return
    onSubmit({
      ...draft,
      title,
      author: draft.author.trim() || '佚名',
      intro: draft.intro.trim(),
      tags: tagText
        .split(/[，,、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 5),
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{initial ? '编辑作品信息' : '新建作品'}</h2>

        <label>
          <span>书名</span>
          <input
            autoFocus
            value={draft.title}
            placeholder="例如：长夜行舟"
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          {!initial && (
            <small className="path-hint">
              将创建 {CONTENT_ROOT}/{targetDir || '…'}/_book.md
              {targetDir && targetDir !== wantedDir && ' · 已有同名目录，自动顺延，不会覆盖它'}
            </small>
          )}
        </label>

        <label>
          <span>作者</span>
          <input
            value={draft.author}
            placeholder="留空则记为佚名"
            onChange={(e) => setDraft({ ...draft, author: e.target.value })}
          />
        </label>

        <label>
          <span>简介</span>
          <textarea
            rows={3}
            value={draft.intro}
            placeholder="一两句话说清楚：谁，因为什么，去做什么"
            onChange={(e) => setDraft({ ...draft, intro: e.target.value })}
          />
        </label>

        <label>
          <span>标签</span>
          <input
            value={tagText}
            placeholder="用逗号分隔，最多 5 个"
            onChange={(e) => setTagText(e.target.value)}
          />
        </label>

        <div className="field-row">
          <label>
            <span>状态</span>
            <select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as NovelStatus })}
            >
              {(Object.keys(labelByStatus) as NovelStatus[]).map((s) => (
                <option key={s} value={s}>
                  {labelByStatus[s]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>封面色调</span>
            <input
              type="range"
              min={0}
              max={359}
              value={draft.hue}
              onChange={(e) => setDraft({ ...draft, hue: Number(e.target.value) })}
              style={{ accentColor: `hsl(${draft.hue} 42% 40%)` }}
            />
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn primary" disabled={!draft.title.trim()}>
            {initial ? '保存' : '创建'}
          </button>
        </div>
      </form>
    </div>
  )
}
