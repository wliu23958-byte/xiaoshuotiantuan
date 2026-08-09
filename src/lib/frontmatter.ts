export type Frontmatter = Record<string, string>

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/

/** 只支持 `键: 值` 一层键值对，够用且不引入 YAML 依赖 */
export function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const text = raw.replace(/^\uFEFF/, '')
  const match = BLOCK.exec(text)
  if (!match) return { data: {}, body: text.trim() }

  const data: Frontmatter = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':')
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
