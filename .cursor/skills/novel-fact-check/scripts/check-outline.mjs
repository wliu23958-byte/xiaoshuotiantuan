#!/usr/bin/env node
// 章纲体检。check-facts.mjs 查正文，这个查 02-大纲/ 下的逐章章纲。
//
// 五百章的章纲靠肉眼查章号和字段不现实，这个脚本管四件机器能管的事：
//   1) 章号在本卷范围内连续、不重复、不越界
//   2) 每一章五个字段齐全（场景 / 出场 / 信息增量 / 不许泄露 / 章末钩子）
//   3) 沾锈数值只出现在单元收束章——中间章写了沾锈就是拆错了
//   4) 禁用词（读名词表，与 check-facts 同一份真源）
//
// 管不了的：情节因果、伏笔有没有回收、有没有提前泄露。那些仍然要人看。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUTLINE_DIR = '02-大纲/章纲'
const GLOSSARY = '01-设定/名词表.md'

/**
 * 各卷的章号范围，越界即报。
 * 卷一原本不在这张表里，于是它那 30 条逐章条目既不会被检查、也不会被算进「N/4 卷通过」。
 * 现已补上——五卷齐全，分母是 5。
 */
const VOLUMES = [
  { file: '第一卷章纲.md', lo: 1, hi: 30 },
  { file: '第二卷章纲.md', lo: 31, hi: 150 },
  { file: '第三卷章纲.md', lo: 151, hi: 270 },
  { file: '第四卷章纲.md', lo: 271, hi: 390 },
  { file: '第五卷章纲.md', lo: 391, hi: 500 },
]

const REQUIRED = ['场景', '出场', '信息增量', '不许泄露', '章末钩子']

function tableUnder(markdown, heading) {
  const lines = markdown.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^#{2,3}\\s+${heading}`).test(l))
  if (start === -1) return []
  const rows = []
  let seenHeader = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (/^#{2,3}\s/.test(line)) break
    if (!line.startsWith('|')) continue
    if (/^\|[\s|:-]+\|$/.test(line)) continue
    const cells = line.slice(1, -1).split('|').map((c) => c.trim())
    if (!seenHeader) { seenHeader = true; continue }
    rows.push(cells)
  }
  return rows
}

const plain = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').trim()

/** 把一份章纲切成 [{num, title, body}]，body 是到下一个章标题之前的全部文本 */
function splitChapters(text) {
  const lines = text.split('\n')
  const marks = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{2,4}\s*第\s*(\d+)\s*章\s*[｜|]\s*(.+?)\s*$/.exec(lines[i])
    if (m) marks.push({ num: Number(m[1]), title: m[2], line: i })
  }
  return marks.map((mk, i) => ({
    ...mk,
    body: lines.slice(mk.line + 1, i + 1 < marks.length ? marks[i + 1].line : lines.length).join('\n'),
  }))
}

function checkVolume(name, text, lo, hi, banned) {
  const issues = []
  const chapters = splitChapters(text)

  if (chapters.length === 0) {
    return [`${name}：一个章标题都没解析到。标题要写成「### 第 NN 章｜章名」`]
  }

  // 章号连续性
  const seen = new Map()
  for (const c of chapters) {
    if (seen.has(c.num)) issues.push(`${name}：第 ${c.num} 章重复出现`)
    seen.set(c.num, c)
    if (c.num < lo || c.num > hi) issues.push(`${name}：第 ${c.num} 章越出本卷范围 ${lo}~${hi}`)
  }
  const missing = []
  for (let n = lo; n <= hi; n++) if (!seen.has(n)) missing.push(n)
  if (missing.length > 0) {
    const shown = missing.length > 12 ? `${missing.slice(0, 12).join(', ')} …共 ${missing.length} 章` : missing.join(', ')
    issues.push(`${name}：缺 ${shown}`)
  }

  // 字段齐全
  for (const c of chapters) {
    const lack = REQUIRED.filter((f) => !new RegExp(`\\*\\*${f}\\*\\*`).test(c.body))
    if (lack.length > 0) issues.push(`${name} 第 ${c.num} 章：缺字段 ${lack.join('、')}`)
  }

  // 沾锈只在单元收束章
  const rusty = chapters.filter((c) => /沾锈/.test(c.body) && /\d+(\.\d+)?\s*%/.test(c.body))
  for (const c of rusty) {
    const isUnitEnd = c.num === hi || /收束|结算|单元末|卷末/.test(c.body)
    if (!isUnitEnd) issues.push(`${name} 第 ${c.num} 章：中间章出现沾锈数值，沾锈只在单元收束章结算`)
  }

  // 禁用词
  for (const c of chapters) {
    for (const { word, reason } of banned) {
      if (c.body.includes(word) || c.title.includes(word)) {
        issues.push(`${name} 第 ${c.num} 章：禁用词「${word}」——${reason}`)
      }
    }
  }

  return issues
}

async function main() {
  let banned = []
  try {
    const glossary = await readFile(GLOSSARY, 'utf8')
    banned = tableUnder(glossary, '禁用词').map((r) => ({ word: plain(r[0]), reason: plain(r[1]) }))
  } catch {
    console.error(`读不到名词表：${GLOSSARY}，跳过禁用词检查。`)
  }

  let present
  try {
    present = new Set(await readdir(OUTLINE_DIR))
  } catch {
    console.error(`读不到目录：${OUTLINE_DIR}`)
    process.exit(2)
  }

  const all = []
  let done = 0
  const stats = []

  for (const vol of VOLUMES) {
    if (!present.has(vol.file)) {
      const msg = `${vol.file}：还不存在（应覆盖 ${vol.lo}~${vol.hi}，共 ${vol.hi - vol.lo + 1} 章）`
      console.log(`  ! ${msg}`)
      all.push(msg)
      continue
    }
    const text = await readFile(join(OUTLINE_DIR, vol.file), 'utf8')
    const issues = checkVolume(vol.file, text, vol.lo, vol.hi, banned)
    stats.push({
      file: vol.file,
      span: `${vol.lo}~${vol.hi}`,
      chapters: splitChapters(text).length,
      expected: vol.hi - vol.lo + 1,
      han: (text.match(/[\u4e00-\u9fa5]/g) ?? []).length,
    })
    if (issues.length === 0) {
      done++
      console.log(`${vol.file}  ${vol.lo}~${vol.hi}  ${vol.hi - vol.lo + 1} 章  干净`)
    } else {
      console.log(`\n${vol.file}  ${issues.length} 处`)
      for (const i of issues) console.log(`  ! ${i}`)
    }
    all.push(...issues)
  }

  if (stats.length > 0) {
    console.log('\n' + '─'.repeat(52))
    console.log('体量统计（汉字数，不含标点与 markdown 符号）\n')
    console.log('  文件              章段        章数/应有      汉字')
    let ch = 0
    let han = 0
    for (const s of stats) {
      ch += s.chapters
      han += s.han
      console.log(
        `  ${s.file.padEnd(16, '　')}${s.span.padStart(9)}${`${s.chapters}/${s.expected}`.padStart(12)}${String(s.han).padStart(11)}`,
      )
    }
    console.log(`  ${'合计'.padEnd(16, '　')}${''.padStart(9)}${String(ch).padStart(12)}${String(han).padStart(11)}`)
  }

  console.log('\n' + '─'.repeat(52))
  if (all.length === 0) {
    console.log(`章纲检查：干净。${VOLUMES.length} 卷全部到位。`)
  } else {
    console.log(`章纲检查：${all.length} 处需要处理，${done}/${VOLUMES.length} 卷通过。`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
