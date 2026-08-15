import { useCallback, useEffect, useRef, useState } from 'react'
import type { Chapter, Novel, Progress, ReaderSettings, ReadingState } from '../types'
import { defaultReadingState, loadReadingState, saveReadingState } from '../lib/storage'
import { loadNovels, nextChapterFile, novelId, uniqueDir } from '../lib/content'
import { bookMarkdown, canEdit, chapterMarkdown, contentApi } from '../lib/api'

export type NovelDraft = Pick<Novel, 'title' | 'author' | 'intro' | 'tags' | 'status' | 'hue'>

export function useLibrary() {
  // 生产构建直接用打包进来的内容快照；开发模式等接口读盘，避免读到模块缓存里的旧目录
  const [novels, setNovels] = useState<Novel[]>(() => (canEdit ? [] : loadNovels()))
  const [loading, setLoading] = useState(canEdit)
  const [reading, setReading] = useState<ReadingState>(loadReadingState)
  const [error, setError] = useState('')

  const novelsRef = useRef(novels)
  novelsRef.current = novels

  useEffect(() => {
    saveReadingState(reading)
  }, [reading])

  /** keepError 供写失败后的重建使用：那条写入错误要留在界面上，别被这次成功的读取抹掉 */
  const reload = useCallback(async (keepError = false) => {
    if (!canEdit) return
    try {
      setNovels(loadNovels(await contentApi.list()))
      if (!keepError) setError('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '读取 正文/ 目录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * 每个改动都是先改界面再写盘。写失败时光弹个提示不够——界面已经停在一个假的成功态上了，
   * 得按磁盘的实际内容重建，否则用户看到的书架和盘上的文件会一直对不上。
   */
  const guard = useCallback(
    (run: Promise<unknown>) => {
      run.then(
        () => setError(''),
        (e: unknown) => {
          setError(e instanceof Error ? e.message : '写入 正文/ 目录失败')
          void reload(true)
        },
      )
    },
    [reload],
  )

  const patchNovel = useCallback((id: string, fn: (novel: Novel) => Novel) => {
    setNovels((prev) => prev.map((n) => (n.id === id ? { ...fn(n), updatedAt: Date.now() } : n)))
  }, [])

  const addNovel = useCallback(
    (draft: NovelDraft) => {
      const dir = uniqueDir(
        draft.title,
        novelsRef.current.map((n) => n.dir),
      )
      const novel: Novel = { ...draft, id: novelId(dir), dir, chapters: [], updatedAt: Date.now() }
      setNovels((prev) => [novel, ...prev])
      guard(contentApi.write(dir, '_book.md', bookMarkdown(novel)))
      return novel.id
    },
    [guard],
  )

  const updateNovel = useCallback(
    (id: string, patch: Partial<NovelDraft>) => {
      const current = novelsRef.current.find((n) => n.id === id)
      if (!current) return
      const next = { ...current, ...patch }
      patchNovel(id, () => next)
      guard(contentApi.write(next.dir, '_book.md', bookMarkdown(next)))
    },
    [guard, patchNovel],
  )

  const removeNovel = useCallback(
    (id: string) => {
      const target = novelsRef.current.find((n) => n.id === id)
      if (!target) return
      setNovels((prev) => prev.filter((n) => n.id !== id))
      // 阅读进度等删成功了再丢。删失败时这本书会被重新读回来，进度不该跟着陪葬
      guard(
        contentApi.remove(target.dir).then(() => {
          setReading((prev) => {
            const progress = { ...prev.progress }
            delete progress[id]
            return { ...prev, progress }
          })
        }),
      )
    },
    [guard],
  )

  const addChapter = useCallback(
    (id: string, title: string) => {
      const novel = novelsRef.current.find((n) => n.id === id)
      if (!novel) return ''
      const file = nextChapterFile(novel, title)
      const chapter: Chapter = {
        id: `${novel.id}/${file}`,
        file,
        title,
        content: '',
        updatedAt: Date.now(),
      }
      patchNovel(id, (n) => ({ ...n, chapters: [...n.chapters, chapter] }))
      guard(contentApi.write(novel.dir, file, chapterMarkdown(chapter)))
      return chapter.id
    },
    [guard, patchNovel],
  )

  const updateChapter = useCallback(
    (id: string, chapterId: string, patch: { title: string; content: string }) => {
      const novel = novelsRef.current.find((n) => n.id === id)
      const chapter = novel?.chapters.find((c) => c.id === chapterId)
      if (!novel || !chapter) return
      patchNovel(id, (n) => ({
        ...n,
        chapters: n.chapters.map((c) =>
          c.id === chapterId ? { ...c, ...patch, updatedAt: Date.now() } : c,
        ),
      }))
      guard(contentApi.write(novel.dir, chapter.file, chapterMarkdown(patch)))
    },
    [guard, patchNovel],
  )

  const removeChapter = useCallback(
    (id: string, chapterId: string) => {
      const novel = novelsRef.current.find((n) => n.id === id)
      const chapter = novel?.chapters.find((c) => c.id === chapterId)
      if (!novel || !chapter) return
      patchNovel(id, (n) => ({ ...n, chapters: n.chapters.filter((c) => c.id !== chapterId) }))
      guard(contentApi.remove(novel.dir, chapter.file))
    },
    [guard, patchNovel],
  )

  const setProgress = useCallback((id: string, progress: Progress) => {
    setReading((prev) => ({ ...prev, progress: { ...prev.progress, [id]: progress } }))
  }, [])

  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setReading((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }))
  }, [])

  const clearReading = useCallback(() => setReading(defaultReadingState), [])

  return {
    novels,
    loading,
    reload,
    progress: reading.progress,
    settings: reading.settings,
    error,
    dismissError: useCallback(() => setError(''), []),
    addNovel,
    updateNovel,
    removeNovel,
    addChapter,
    updateChapter,
    removeChapter,
    setProgress,
    updateSettings,
    clearReading,
  }
}
