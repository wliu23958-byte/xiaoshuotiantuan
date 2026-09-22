#!/usr/bin/env node
// 章纲密度体检。check-outline.mjs 查「有没有」，这个查「够不够厚」。
//
// 为什么要单独一个脚本：上一轮加厚是盯着「均值」做的，结果把最薄那顶帽子从卷五
// 传给了卷四——均值会被少数很厚的条目拉起来，掩盖掉大量薄条目。
// 所以本脚本的判定基准是「低于硬下限的条数」，均值只作参考。
//
// 口径（与 02-大纲/章纲密度口径.md 一致，改一处要同步改另一处）：
//   · 一条 = 一个「### 第 N 章｜标题」到下一个章标题（或下一个 ## 部分抬头）之间的正文
//   · 只数汉字 [\u4e00-\u9fa5]，不含标点、数字、markdown 符号、章标题那一行
//   · 部分抬头（## …）里的沾锈行不算进上一章
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUTLINE_DIR = '02-大纲/章纲'

/** 硬下限：低于此值判定为「主笔落笔时必须回头翻设定」，机检报错 */
const FLOOR = 180
/** 目标带 */
const TARGET_LO = 200
const TARGET_HI = 260
/** 软上限：超过只提示，不报错——章纲太厚会开始替正文做决定，也更难维护 */
const CEILING = 300

const VOLUMES = [
  { file: '第一卷章纲.md', lo: 1, hi: 30 },
  { file: '第二卷章纲.md', lo: 31, hi: 150 },
  { file: '第三卷章纲.md', lo: 151, hi: 270 },
  { file: '第四卷章纲.md', lo: 271, hi: 390 },
  { file: '第五卷章纲.md', lo: 391, hi: 500 },
]

const readText = async (p) => (await readFile(p, 'utf8')).replace(/^\uFEFF/, '')
const han = (s) => (s.match(/[\u4e00-\u9fa5]/g) ?? []).length

function chapters(text) {
  const lines = text.split(/\r?\n/)
  const marks = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{2,4}\s*第\s*(\d+)\s*章\s*[｜|]\s*(.+?)\s*$/.exec(lines[i])
    if (m) marks.push({ num: Number(m[1]), title: m[2], line: i })
  }
  return marks.map((mk, i) => {
    let end = i + 1 < marks.length ? marks[i + 1].line : lines.length
    for (let j = mk.line + 1; j < end; j++) if (/^##\s/.test(lines[j])) { end = j; break }
    return { num: mk.num, title: mk.title, n: han(lines.slice(mk.line + 1, end).join('\n')) }
  })
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}
const pad = (s, w) => String(s).padStart(w)

const rows = []
const failures = []

for (const vol of VOLUMES) {
  let text
  try { text = await readText(join(OUTLINE_DIR, vol.file)) } catch { console.log(`  ! ${vol.file}：读不到`); continue }
  const cs = chapters(text).filter((c) => c.num >= vol.lo && c.num <= vol.hi)
  if (cs.length === 0) continue
  const ns = cs.map((c) => c.n)
  const thin = cs.filter((c) => c.n < FLOOR)
  const fat = cs.filter((c) => c.n > CEILING)
  rows.push({
    file: vol.file,
    count: cs.length,
    mean: (ns.reduce((a, b) => a + b, 0) / cs.length).toFixed(1),
    med: median(ns),
    min: Math.min(...ns),
    max: Math.max(...ns),
    thin: thin.length,
    fat: fat.length,
    inBand: ns.filter((n) => n >= TARGET_LO && n <= TARGET_HI).length,
  })
  if (thin.length) failures.push({ file: vol.file, thin })
}

console.log(`\n章纲密度体检　　硬下限 ${FLOOR}　目标带 ${TARGET_LO}~${TARGET_HI}　软上限 ${CEILING}`)
console.log('='.repeat(76))
console.log('  文件              条数     均     中位    最短    最长   低于下限  在目标带')
for (const r of rows) {
  console.log(
    `  ${r.file.padEnd(16, '　')}${pad(r.count, 4)}${pad(r.mean, 8)}${pad(r.med, 7)}${pad(r.min, 8)}${pad(r.max, 8)}${pad(r.thin, 10)}${pad(r.inBand, 10)}`,
  )
}
const total = rows.reduce((a, r) => a + r.count, 0)
const totalThin = rows.reduce((a, r) => a + r.thin, 0)
const totalBand = rows.reduce((a, r) => a + r.inBand, 0)
console.log('-'.repeat(76))
console.log(`  ${'合计'.padEnd(16, '　')}${pad(total, 4)}${pad('', 8)}${pad('', 7)}${pad('', 8)}${pad('', 8)}${pad(totalThin, 10)}${pad(totalBand, 10)}`)

if (failures.length) {
  console.log('\n低于硬下限的章（这些是主笔落笔时会卡住的地方）')
  console.log('-'.repeat(76))
  for (const f of failures) {
    const list = f.thin.map((c) => `${c.num}(${c.n})`)
    const shown = list.length > 18 ? `${list.slice(0, 18).join(' ')} …共 ${list.length} 条` : list.join(' ')
    console.log(`  ${f.file}\n    ${shown}`)
  }
}

console.log('\n' + '='.repeat(76))
if (totalThin === 0) {
  console.log(`密度检查：干净。${total} 条全部达到硬下限 ${FLOOR}，其中 ${totalBand} 条落在目标带内。`)
} else {
  console.log(`密度检查：${totalThin}/${total} 条低于硬下限 ${FLOOR}，需要加厚。`)
  console.log('判定基准是「低于下限的条数」，不是均值——均值会被少数很厚的条目拉起来，掩盖大量薄条目。')
  process.exitCode = 1
}
