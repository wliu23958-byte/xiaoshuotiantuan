import { useState } from 'react'
import './App.css'
import { useLibrary } from './hooks/useLibrary'
import type { NovelDraft } from './hooks/useLibrary'
import { canEdit } from './lib/api'
import { LibraryView } from './components/LibraryView'
import { NovelView } from './components/NovelView'
import { ReaderView } from './components/ReaderView'
import { ChapterEditorView } from './components/ChapterEditorView'
import { NovelFormModal } from './components/NovelFormModal'

type View =
  | { name: 'library' }
  | { name: 'novel'; novelId: string }
  | { name: 'reader'; novelId: string; chapterId: string; entryRatio: number }
  | { name: 'editor'; novelId: string; chapterId: string }

type Modal = { kind: 'create' } | { kind: 'edit'; novelId: string } | null

function App() {
  const lib = useLibrary()
  const [view, setView] = useState<View>({ name: 'library' })
  const [modal, setModal] = useState<Modal>(null)

  const toLibrary = () => setView({ name: 'library' })
  const findNovel = (id: string) => lib.novels.find((n) => n.id === id)

  const openReader = (novelId: string, chapterId: string) => {
    const saved = lib.progress[novelId]
    const entryRatio = saved && saved.chapterId === chapterId ? saved.ratio : 0
    setView({ name: 'reader', novelId, chapterId, entryRatio })
  }

  const renderView = () => {
    if (view.name === 'library') {
      return (
        <LibraryView
          novels={lib.novels}
          progress={lib.progress}
          loading={lib.loading}
          onOpen={(novelId) => setView({ name: 'novel', novelId })}
          onRead={openReader}
          onCreate={() => setModal({ kind: 'create' })}
          onReload={() => void lib.reload()}
          onClearReading={() => {
            if (confirm('清空本机记录的阅读进度和排版偏好？正文文件不受影响。')) lib.clearReading()
          }}
        />
      )
    }

    const novel = findNovel(view.novelId)
    if (!novel) return <MissingView onBack={toLibrary} />

    if (view.name === 'novel') {
      return (
        <NovelView
          novel={novel}
          progress={lib.progress[novel.id]}
          onBack={toLibrary}
          onRead={(chapterId) => openReader(novel.id, chapterId)}
          onEditChapter={(chapterId) => setView({ name: 'editor', novelId: novel.id, chapterId })}
          onAddChapter={(title) => {
            const chapterId = lib.addChapter(novel.id, title)
            if (chapterId) setView({ name: 'editor', novelId: novel.id, chapterId })
          }}
          onRemoveChapter={(chapterId) => lib.removeChapter(novel.id, chapterId)}
          onEditNovel={() => setModal({ kind: 'edit', novelId: novel.id })}
          onRemoveNovel={() => {
            lib.removeNovel(novel.id)
            toLibrary()
          }}
        />
      )
    }

    const chapter = novel.chapters.find((c) => c.id === view.chapterId)
    if (!chapter) return <MissingView onBack={() => setView({ name: 'novel', novelId: novel.id })} />

    if (view.name === 'reader') {
      return (
        <ReaderView
          novel={novel}
          chapter={chapter}
          settings={lib.settings}
          entryRatio={view.entryRatio}
          onBack={() => setView({ name: 'novel', novelId: novel.id })}
          onNavigate={(chapterId) =>
            setView({ name: 'reader', novelId: novel.id, chapterId, entryRatio: 0 })
          }
          onProgress={(chapterId, ratio) =>
            lib.setProgress(novel.id, { chapterId, ratio, at: Date.now() })
          }
          onSettings={lib.updateSettings}
        />
      )
    }

    if (!canEdit) return <MissingView onBack={() => setView({ name: 'novel', novelId: novel.id })} />

    return (
      <ChapterEditorView
        novel={novel}
        chapter={chapter}
        onBack={() => setView({ name: 'novel', novelId: novel.id })}
        onRead={() => openReader(novel.id, chapter.id)}
        onChange={(patch) => lib.updateChapter(novel.id, chapter.id, patch)}
      />
    )
  }

  const editing = modal?.kind === 'edit' ? findNovel(modal.novelId) : undefined

  return (
    <div className="app">
      {renderView()}

      {lib.error && (
        <div className="toast" role="alert">
          <span>{lib.error}</span>
          <button onClick={lib.dismissError}>知道了</button>
        </div>
      )}

      {modal?.kind === 'create' && (
        <NovelFormModal
          takenDirs={lib.novels.map((n) => n.dir)}
          onClose={() => setModal(null)}
          onSubmit={(draft: NovelDraft) => {
            const novelId = lib.addNovel(draft)
            setModal(null)
            setView({ name: 'novel', novelId })
          }}
        />
      )}

      {modal?.kind === 'edit' && editing && (
        <NovelFormModal
          initial={{
            title: editing.title,
            author: editing.author,
            intro: editing.intro,
            tags: editing.tags,
            status: editing.status,
            hue: editing.hue,
          }}
          onClose={() => setModal(null)}
          onSubmit={(draft: NovelDraft) => {
            lib.updateNovel(editing.id, draft)
            setModal(null)
          }}
        />
      )}
    </div>
  )
}

function MissingView({ onBack }: { onBack: () => void }) {
  return (
    <div className="view">
      <div className="empty tall">
        <p>这个内容已经不在了</p>
        <button className="btn primary" onClick={onBack}>
          返回
        </button>
      </div>
    </div>
  )
}

export default App
