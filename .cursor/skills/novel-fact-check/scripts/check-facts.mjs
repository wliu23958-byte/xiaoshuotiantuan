#!/usr/bin/env node
// 事实体检。check-format.mjs 管排版，这个管「说得对不对」。
//
// 真源是 01-设定/名词表.md 和 01-设定/时间线台账.md，本脚本只解析它们，不内置任何设定。
// 想加一条检查，去名词表里加一行，不要改这个文件。
//
// 为什么只扫 03-正文：设定和大纲会正当地讨论那些禁用词（「原写作第八件，已统一」），
// 在那里查会全是误报。真正会砸在读者脸上的只有正文。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const dirArg = process.argv.find((a) => a.startsWith('--dir='))
const CONTENT_DIR = dirArg ? dirArg.slice('--dir='.length) : '03-正文'
const GLOSSARY = '01-设定/名词表.md'
const TIMELINE = '01-设定/时间线台账.md'

/** BOM 会粘在第一行开头，让 frontmatter 的 --- 与各处标题正则全部失配 */
const readText = async (path) => (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')

/** 末尾那根竖线是可选的，`| 甲 | 乙` 也是合法表格行，slice(1, -1) 会把「乙」砍掉 */
const splitRow = (line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/** 取某个 ## 或 ### 标题下面的表格数据行，返回二维数组（已去掉表头与分隔行） */
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
    if (/^\|[\s|:-]+$/.test(line)) continue
    const cells = splitRow(line)
    if (!seenHeader) {
      seenHeader = true
      continue
    }
    rows.push(cells)
  }
  return rows
}

/**
 * 去掉 markdown 强调符号，表格里写了 **五年** 时要能取到「五年」。
 * 少写一列的行会让 row[2] 是 undefined，那是台账的错，不该让整个脚本崩在这里。
 */
const plain = (s) => (s ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim()

function frontmatterEnd(lines) {
  if (lines[0]?.trim() !== '---') return 0
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  return close === -1 ? 0 : close + 1
}

// ── 各项检查 ──────────────────────────────────────────

/** 禁用词：名词表里登记过的旧说法，出现在正文即为错 */
function checkBanned(files, contents, banned) {
  const hits = []
  for (const file of files) {
    const lines = contents.get(file).split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const { word, reason } of banned) {
        if (lines[i].includes(word)) {
          hits.push({ file, line: i + 1, msg: `禁用词「${word}」——${reason}`, text: lines[i].trim() })
        }
      }
    }
  }
  return hits
}

/** 中文之间夹半角标点。全书统一全角，混进来一个就很扎眼 */
function checkHalfWidth(files, contents) {
  const hits = []
  const pattern = /[\u4e00-\u9fa5][,;!?:][\u4e00-\u9fa5]/
  for (const file of files) {
    const lines = contents.get(file).split('\n')
    const start = frontmatterEnd(lines)
    for (let i = start; i < lines.length; i++) {
      const m = pattern.exec(lines[i])
      if (m) {
        hits.push({ file, line: i + 1, msg: `中文里夹了半角「${m[0][1]}」`, text: lines[i].trim() })
      }
    }
  }
  return hits
}

/** 百分比：正文出现的每个 X.X% 都必须在名词表登记过 */
function checkPercents(files, contents, known) {
  const hits = []
  for (const file of files) {
    const lines = contents.get(file).split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
        if (!known.has(m[1])) {
          hits.push({ file, line: i + 1, msg: `未登记的百分比 ${m[1]}%`, text: lines[i].trim() })
        }
      }
    }
  }
  return hits
}

/**
 * 年份检查。
 * 坑：正文写的是「二〇一九年」，台账两种写法都有，只匹配阿拉伯数字等于这一项没跑。
 * 所以两边都归一化成四位阿拉伯数字再比。
 */
const CN_DIGIT = { 〇: '0', 零: '0', 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' }
const AR_YEAR = /(?:19|20)\d{2}/g

/**
 * 正文里要求年份后面跟「年」，否则「二〇一一」这种编号也会被当成年份。
 * 但台账的表格单元格写的是「| 一九五三 |」，后面没有「年」，所以读源时要放宽。
 * 两边宽严不一样是有意的，别统一。
 */
const CN_YEAR_IN_TEXT = /[〇零一二三四五六七八九]{4}(?=年)/g
const CN_YEAR_LOOSE = /[〇零一二三四五六七八九]{4}/g

const cnToArabic = (s) => [...s].map((c) => CN_DIGIT[c]).join('')

/** 读台账用：中文与阿拉伯两种写法都收，中文不要求后跟「年」 */
function collectYears(text) {
  const out = new Set()
  for (const m of text.matchAll(AR_YEAR)) out.add(m[0])
  for (const m of text.matchAll(CN_YEAR_LOOSE)) {
    const year = cnToArabic(m[0])
    if (/^(?:19|20)\d{2}$/.test(year)) out.add(year)
  }
  return out
}

function checkYears(files, contents, known) {
  const hits = []
  for (const file of files) {
    const lines = contents.get(file).split('\n')
    for (let i = 0; i < lines.length; i++) {
      const found = []
      for (const m of lines[i].matchAll(/(?:^|[^\d])((?:19|20)\d{2})\s*年/g)) found.push([m[1], m[1]])
      for (const m of lines[i].matchAll(CN_YEAR_IN_TEXT)) found.push([cnToArabic(m[0]), m[0]])

      for (const [year, raw] of found) {
        if (!known.has(year)) {
          hits.push({ file, line: i + 1, msg: `未登记的年份 ${raw}（${year}）`, text: lines[i].trim() })
        }
      }
    }
  }
  return hits
}

/**
 * 沈姓人名：正文里的「沈X」必须是登记过的人。
 * 「小沈在里头吗」这种句子里，沈后面跟的是虚词而不是名，靠停用字表滤掉。
 */
const NAME_STOP = new Set(
  '在的了是也就还又都会要把被和与之说道看走来去过着能没有想问'.split(''),
)

function checkShenNames(files, contents, known) {
  const hits = []
  const allow = new Set(['沈家', '沈老', '沈师', '沈工'])
  for (const file of files) {
    const lines = contents.get(file).split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(/沈[\u4e00-\u9fa5]/g)) {
        const name3 = lines[i].slice(m.index, m.index + 3)
        if (known.has(name3)) continue
        if (known.has(m[0]) || allow.has(m[0])) continue
        if (NAME_STOP.has(m[0][1])) continue
        hits.push({ file, line: i + 1, msg: `未登记的沈姓称呼「${m[0]}」`, text: lines[i].trim() })
      }
    }
  }
  return hits
}

/**
 * 沾锈那一格的两种写法：`26.6` 是普通结算值，`↓26.6` 是设计内的回退。
 * 标记写在名词表里而不是写在这个脚本里——那张表自己开头就说了，
 * 想加一条检查去表里加一行，不要改脚本。
 */
function parseRust(cell) {
  const text = plain(cell)
  if (text === '-' || text === '') return null
  const planned = text.startsWith('↓')
  // 保留原样的数字文本："3.0" 不能被 Number 化成 "3"，否则正文里的 3.0% 就查无登记了
  const value = (planned ? text.slice(1) : text).trim()
  return { raw: text, value, planned, num: Number(value) }
}

/**
 * 沾锈必须单调不减。这是全书唯一的倒计时，回跳就是硬伤——
 * 但卷五「放一个人出来就退掉一个人的账」那几次是 C4 的兑现，是设计内的。
 * 那种行在沾锈格里写成 ↓X 就放行；没标的下降照旧报错，报错时把标记的写法一并告诉他，
 * 免得看见「沾锈回跳」的第一反应是去把那个数改掉。
 */
function checkRustCurve(rows) {
  const issues = []
  let prev = null
  let prevSeq = null
  let planned = 0
  for (const row of rows) {
    const seq = plain(row[0])
    const cell = parseRust(row[2])
    if (!cell) continue
    if (Number.isNaN(cell.num)) {
      issues.push(`沾锈台账第 ${seq} 次的值「${cell.raw}」不是数字`)
      continue
    }
    if (prev !== null && cell.planned) {
      planned++
      if (cell.num >= prev) {
        issues.push(`沾锈台账第 ${seq} 次标了回退「${cell.raw}」，可 ${cell.num}% 并不比第 ${prevSeq} 次的 ${prev}% 低`)
      }
    } else if (prev !== null && cell.num < prev) {
      issues.push(
        `沾锈回跳：第 ${prevSeq} 次是 ${prev}%，第 ${seq} 次却降到 ${cell.num}%。` +
          `若这是设计内的回退（卷五放人退账那种），把这一格写成「↓${cell.value}」，机检就认它——不要去改这个数`,
      )
    }
    prev = cell.num
    prevSeq = seq
  }
  return { issues, planned }
}

// ── 主流程 ────────────────────────────────────────────

async function main() {
  let glossary
  try {
    glossary = await readText(GLOSSARY)
  } catch {
    console.error(`读不到名词表：${GLOSSARY}`)
    console.error('请在仓库根目录运行。')
    process.exit(2)
  }

  const banned = tableUnder(glossary, '禁用词').map((r) => ({ word: plain(r[0]), reason: plain(r[1]) }))
  const people = new Set(tableUnder(glossary, '人物').map((r) => plain(r[0])))
  const rustRows = tableUnder(glossary, '沾锈台账')

  const percents = new Set()
  for (const heading of ['关键数字', '其他登记数值']) {
    for (const row of tableUnder(glossary, heading)) {
      const m = /^(\d+(?:\.\d+)?)%$/.exec(plain(row[0]))
      if (m) percents.add(m[1])
    }
  }
  for (const row of rustRows) {
    const cell = parseRust(row[2])
    if (cell) percents.add(cell.value)
  }

  let years = new Set()
  try {
    const timeline = await readText(TIMELINE)
    years = collectYears(timeline)
  } catch {
    console.error(`读不到时间线台账：${TIMELINE}，跳过年份检查。`)
  }

  let files
  try {
    files = (await readdir(CONTENT_DIR)).filter((f) => f.endsWith('.md') && f !== '_book.md')
  } catch {
    console.error(`读不到目录：${CONTENT_DIR}`)
    process.exit(2)
  }
  files.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))

  const contents = new Map()
  for (const file of files) contents.set(file, await readText(join(CONTENT_DIR, file)))

  const groups = [
    ['禁用词', checkBanned(files, contents, banned)],
    ['半角标点', checkHalfWidth(files, contents)],
    ['百分比', checkPercents(files, contents, percents)],
    ['年份', checkYears(files, contents, years)],
    ['人名', checkShenNames(files, contents, people)],
  ]

  const curve = checkRustCurve(rustRows)
  const curveIssues = curve.issues
  let total = curveIssues.length

  for (const [label, hits] of groups) {
    if (hits.length === 0) continue
    total += hits.length
    console.log(`\n【${label}】${hits.length} 处`)
    for (const h of hits) {
      const text = h.text.length > 50 ? `${h.text.slice(0, 50)}…` : h.text
      console.log(`  ${h.file}:${h.line}  ${h.msg}`)
      console.log(`      ${text}`)
    }
  }

  if (curveIssues.length > 0) {
    console.log(`\n【沾锈曲线】${curveIssues.length} 处`)
    for (const issue of curveIssues) console.log(`  ! ${issue}`)
  }

  console.log('\n' + '─'.repeat(52))
  if (total === 0) {
    console.log(`事实检查：干净。${files.length} 章，对照名词表 ${banned.length} 条禁用词、`)
    console.log(`          ${people.size} 个登记人物、${percents.size} 个登记数值、${years.size} 个登记年份。`)
    if (curve.planned > 0) {
      console.log(`          沾锈台账里有 ${curve.planned} 处标了 ↓ 的设计内回退，已放行。`)
    }
  } else {
    console.log(`事实检查：${total} 处需要处理。`)
    console.log('若某一处确实是对的，去 01-设定/名词表.md 把它登记进去，不要改脚本。')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
