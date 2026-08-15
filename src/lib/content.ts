import type { Chapter, Novel, NovelStatus } from '../types'
import { parseFrontmatter } from './frontmatter'

export const CONTENT_ROOT = '03-正文'

/** 构建产物里的内容快照。开发模式下改走 /__content/list 实时读盘 */
export const bundledFiles = import.meta.glob('/03-正文/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const BOOK_FILE = '_book.md'

const statusByLabel: Record<string, NovelStatus> = {
  草稿: 'draft',
  连载中: 'ongoing',
  已完结: 'finished',
}

export const labelByStatus: Record<NovelStatus, string> = {
  draft: '草稿',
  ongoing: '连载中',
  finished: '已完结',
}

/** dir 为空串表示 03-正文/ 根目录本身，也就是"整个目录就是一部作品"的平铺写法 */
export function novelId(dir: string) {
  return `f:${dir}`
}

/** 平铺作品的 dir 是空串，直接插进模板会拼出 03-正文// 这种多一道斜杠的路径 */
export function contentPath(dir: string, file?: string) {
  return [CONTENT_ROOT, dir, file].filter(Boolean).join('/')
}

function chapterId(dir: string, file: string) {
  return `f:${dir}/${file}`
}

function parseDate(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const ts = Date.parse(value)
  return Number.isNaN(ts) ? fallback : ts
}

/** 色调 0 是正红。写成 `Number(x) || 214` 的话，唯独这一个色相取不到 */
function parseHue(value: string | undefined) {
  const text = value?.trim()
  if (!text) return 214
  const hue = Number(text)
  return Number.isFinite(hue) ? hue : 214
}

const H1 = /^#[ \t]+(.+?)[ \t]*$/

/** 团队手写的章节没有 frontmatter，首行 `# 第一章 xxx` 就是标题，展示时要摘掉 */
function splitHeading(body: string) {
  const lines = body.split('\n')
  const first = lines.findIndex((l) => l.trim() !== '')
  if (first === -1) return { heading: '', rest: '' }

  const matched = H1.exec(lines[first].trim())
  if (!matched) return { heading: '', rest: body.trim() }
  return { heading: matched[1].trim(), rest: lines.slice(first + 1).join('\n').trim() }
}

export function loadNovels(files: Record<string, string> = bundledFiles): Novel[] {
  const now = Date.now()
  const dirs = new Map<string, { book?: string; chapters: [string, string][] }>()

  const bucket = (dir: string) => {
    let entry = dirs.get(dir)
    if (!entry) {
      entry = { chapters: [] }
      dirs.set(dir, entry)
    }
    return entry
  }

  for (const [path, raw] of Object.entries(files)) {
    const segments = path.split('/').filter(Boolean)
    if (segments[0] !== CONTENT_ROOT) continue

    const rest = segments.slice(1)
    if (rest.length === 0 || rest.length > 2) continue

    const dir = rest.length === 2 ? rest[0] : ''
    const file = rest[rest.length - 1]
    const entry = bucket(dir)
    if (file === BOOK_FILE) entry.book = raw
    else entry.chapters.push([file, raw])
  }

  const novels: Novel[] = []

  for (const [dir, entry] of dirs) {
    if (entry.chapters.length === 0 && !entry.book) continue

    const meta = parseFrontmatter(entry.book ?? '')
    const bookDate = parseDate(meta.data['更新'], now)

    const chapters: Chapter[] = entry.chapters
      .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN', { numeric: true }))
      .map(([file, raw]) => {
        const { data, body } = parseFrontmatter(raw)
        const { heading, rest } = splitHeading(body)
        return {
          id: chapterId(dir, file),
          file,
          title: data['标题'] || heading || file.replace(/\.md$/, ''),
          content: rest,
          updatedAt: parseDate(data['更新'], bookDate),
        }
      })

    novels.push({
      id: novelId(dir),
      dir,
      title: meta.data['书名'] || dir || CONTENT_ROOT,
      author: meta.data['作者'] || '佚名',
      intro: meta.body,
      tags: (meta.data['标签'] ?? '')
        .split(/[，,、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
      status: statusByLabel[meta.data['状态']] ?? 'draft',
      hue: parseHue(meta.data['色调']),
      chapters,
      updatedAt: chapters.reduce((max, c) => Math.max(max, c.updatedAt), bookDate),
    })
  }

  return novels.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 目录名与文件名要能安全落到磁盘，服务端还会再校验一次 */
export function safeName(input: string) {
  return input
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/**
 * 目录名直接取自书名，重名会覆盖掉别人的 _book.md，所以撞车时往后顺延一个序号。
 * 注意不同书名可能被 safeName 归一到一起（例如只差一个非法字符），这里一并挡掉。
 */
export function uniqueDir(title: string, taken: Iterable<string>) {
  const base = safeName(title) || `未命名-${Date.now().toString(36)}`
  const used = new Set(taken)
  if (!used.has(base)) return base

  for (let i = 2; i <= 999; i++) {
    const candidate = `${base}-${i}`
    if (!used.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

/** 序号取现有文件的最大值加一，用章节数量会在删过章之后撞上已存在的文件 */
export function nextChapterFile(novel: Novel, title: string) {
  const highest = novel.chapters.reduce((max, c) => {
    const matched = /(\d+)/.exec(c.file)
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0)
  const seq = String(highest + 1).padStart(3, '0')
  const name = safeName(title) || `第${seq}章`
  return `第${seq}章-${name}.md`
}
