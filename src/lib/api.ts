import type { Chapter, Novel } from '../types'
import { buildFrontmatter } from './frontmatter'
import { labelByStatus } from './content'

/** 写盘要靠 dev server 插件，构建产物里只能读 */
export const canEdit = import.meta.env.DEV

function today() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
}

export function bookMarkdown(novel: Novel) {
  return buildFrontmatter(
    {
      书名: novel.title,
      作者: novel.author,
      标签: novel.tags.join(', '),
      状态: labelByStatus[novel.status],
      色调: String(novel.hue),
      更新: today(),
    },
    novel.intro,
  )
}

export function chapterMarkdown(chapter: Pick<Chapter, 'title' | 'content'>) {
  return buildFrontmatter({ 标题: chapter.title, 更新: today() }, chapter.content)
}

export const contentApi = {
  write: (dir: string, file: string, text: string) => post('/__content/write', { dir, file, text }),
  remove: (dir: string, file?: string) => post('/__content/remove', { dir, file }),

  /** 直接读盘，绕开 import.meta.glob 的模块缓存，新建的章节立刻可见 */
  async list(): Promise<Record<string, string>> {
    const res = await fetch('/__content/list')
    if (!res.ok) throw new Error((await res.text()) || '读取 正文/ 目录失败')
    const items = (await res.json()) as { path: string; text: string }[]
    return Object.fromEntries(items.map((i) => [i.path, i.text]))
  },
}
