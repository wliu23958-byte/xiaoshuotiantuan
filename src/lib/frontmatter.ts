export type Frontmatter = Record<string, string>

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/

/**
 * 只支持 `键: 值` 一层键值对，够用且不引入 YAML 依赖。
 * 冒号半角全角都收：check-format 查 标题 字段用的是 `[:：]`，这边只认半角的话，
 * 一份手写成 `标题：断口` 的 frontmatter 会机检判干净、而应用一个键都读不出来，
 * 标题和更新一起丢，阅读器只好退回拿文件名当标题。
 */
export function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const text = raw.replace(/^\uFEFF/, '')
  const match = BLOCK.exec(text)
  if (!match) return { data: {}, body: text.trim() }

  const data: Frontmatter = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.search(/[:：]/)
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    if (key) data[key] = line.slice(at + 1).trim()
  }
  return { data, body: text.slice(match[0].length).trim() }
}

export function buildFrontmatter(data: Frontmatter, body: string) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== '' && v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`
}
