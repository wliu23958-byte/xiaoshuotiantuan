import type { Novel } from '../types'

/** 中文按字符计，英文按单词计，去掉空白和标点带来的虚高 */
export function countWords(text: string) {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const words = text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g)?.length ?? 0
  return cjk + words
}

export function novelWordCount(novel: Novel) {
  return novel.chapters.reduce((sum, c) => sum + countWords(c.content), 0)
}

export function formatWordCount(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万字`
  return `${n} 字`
}

export function formatDate(ts: number) {
  const diff = Date.now() - ts
  const day = 86400000
  if (diff < day) return '今天'
  if (diff < day * 2) return '昨天'
  if (diff < day * 30) return `${Math.floor(diff / day)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function splitParagraphs(content: string) {
  return content.split('\n').map((p) => p.trim()).filter(Boolean)
}

export type Block =
  | { kind: 'divider' }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string }

/**
 * 分场分隔线有两种写法，都要认：
 * `---` 是 Markdown 习惯；`※　※　※` 是正文里实际用的那种，因为番茄和起点的编辑器
 * 不解析 Markdown，稿子粘过去时只有纯文本符号能活下来。
 */
const DIVIDER = /^(?:([-*_])\1{2,}|[※＊*][\s\u3000※＊*]*[※＊*])$/

/** 稿子里实际用到的只有分场分隔线、引用和加粗，够用就行，不引入 Markdown 解析器 */
export function toBlocks(content: string): Block[] {
  return splitParagraphs(content).map((line) => {
    if (DIVIDER.test(line)) return { kind: 'divider' }
    if (line.startsWith('>')) return { kind: 'quote', text: line.replace(/^>\s?/, '') }
    return { kind: 'para', text: line }
  })
}

/** 把 **加粗** 拆成交替的普通段与加粗段，偶数下标是普通文本 */
export function splitEmphasis(text: string) {
  return text.split(/\*\*(.+?)\*\*/g)
}
