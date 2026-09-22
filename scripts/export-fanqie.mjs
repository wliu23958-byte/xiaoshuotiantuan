#!/usr/bin/env node
// 就地处理 03-正文：保留「# 第N章　标题」，段间空行压成单换行。
// 番茄编辑器一次回车就是一段，空行贴进去会变成双倍段距。可重复跑。
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, '03-正文')
const BOOK_FILE = '_book.md'

function collapseBody(raw) {
  let t = raw.replace(/^\uFEFF/, '')
  let heading = ''
  if (t.startsWith('---')) {
    const fm = t.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
    if (fm) {
      heading = fm[0].replace(/\s+$/, '')
      t = t.slice(fm[0].length)
    }
  }
  const hm = t.match(/^(#[^\n]*)\r?\n*/)
  if (hm) {
    heading = heading ? `${heading}\n${hm[1]}` : hm[1]
    t = t.slice(hm[0].length)
  }
  const paras = t
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (!heading) return `${paras.join('\n')}\n`
  return `${heading}\n\n${paras.join('\n')}\n`
}

const files = (await readdir(SRC)).filter((n) => n.endsWith('.md') && n !== BOOK_FILE)
let changed = 0
for (const name of files) {
  const path = join(SRC, name)
  const before = await readFile(path, 'utf8')
  const after = collapseBody(before)
  if (after !== before.replace(/^\uFEFF/, '')) {
    await writeFile(path, after, 'utf8')
    changed += 1
  }
}
console.log(`processed ${files.length} chapters, wrote ${changed}`)
