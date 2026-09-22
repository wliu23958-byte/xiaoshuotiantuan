#!/usr/bin/env node
// 章纲体检。check-facts.mjs 查正文，这个查 02-大纲/ 下的逐章章纲。
//
// 五百章的章纲靠肉眼查章号和字段不现实，这个脚本管四件机器能管的事：
//   1) 章号在本卷范围内连续、不重复、不越界
//   2) 每一章五个字段齐全（场景 / 出场 / 信息增量 / 不许泄露 / 章末钩子）
//   3) 沾锈数值只出现在单元收束章——中间章写了沾锈就是拆错了
//   4) 禁用词（读名词表，与 check-facts 同一份真源）
//   5) 章纲章名与已写正文的章名一致（2026-08-15 加）
//   6) 已写正文的章名不重复（2026-08-15 加）
//
// 管不了的：情节因果、伏笔有没有回收、有没有提前泄露。那些仍然要人看。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUTLINE_DIR = '02-大纲/章纲'
const PROSE_DIR = '03-正文'
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

/** 与 `src/lib/utils.ts` 的 countWords 取同一段区间。\u9fa5 是 Unicode 3.0 的旧上界，
 *  两边不一致的话，同一段文字阅读器报的字数和这里报的汉字数会对不上 */
const HAN = /[\u4e00-\u9fff]/g

/** BOM 会粘在第一行开头，让 frontmatter 的 --- 与各处标题正则全部失配 */
const readText = async (path) => (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')

/** 末尾那根竖线是可选的，`| 甲 | 乙` 也是合法表格行，slice(1, -1) 会把「乙」砍掉 */
const splitRow = (line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

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
    if (!seenHeader) { seenHeader = true; continue }
    rows.push(cells)
  }
  return rows
}

/** 少写一列的行会让 r[1] 是 undefined，那是台账的错，不该让整个脚本崩在这里 */
const plain = (s) => (s ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim()

/**
 * 把一份章纲切成 [{num, title, body}]。
 *
 * **章体在下一个小节标题处截断**，不能只在下一个章标题处截断——否则单元之间那些
 * 带沾锈的小节头（「## 支线单元 3 · 补过的碗（111~120 章）… 沾锈：7.8% → 8.2%」）
 * 会被算进上一章的正文，下面那条「中间章不许出现沾锈数值」就会报一条不存在的问题。
 * 这与 `book-ledger.mjs` 的切法一致；两个脚本读同一批文件，边界不能各是各的。
 *
 * 实测当前有三章（110、230、412）会多吃到后面单元头里的沾锈值，三章恰好都是单元
 * 收束章、body 里带「收束」二字，所以旧切法零误报——那是巧合，不是设计。
 */
function splitChapters(text) {
  const lines = text.split('\n')
  const marks = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{2,4}\s*第\s*(\d+)\s*章\s*[｜|]\s*(.+?)\s*$/.exec(lines[i])
    if (m) marks.push({ num: Number(m[1]), title: m[2], line: i })
  }
  return marks.map((mk, i) => {
    const hardEnd = i + 1 < marks.length ? marks[i + 1].line : lines.length
    let end = hardEnd
    for (let j = mk.line + 1; j < hardEnd; j++) {
      const l = lines[j].trim()
      if (/^#{1,3}\s/.test(l) || l === '---') {
        end = j
        break
      }
    }
    return { ...mk, body: lines.slice(mk.line + 1, end).join('\n') }
  })
}

/**
 * 沾锈允许出现在哪几章。**判据是结构，不是措辞。**
 *
 * 原先这里是 `/收束|结算|单元末|卷末/.test(c.body)`——一个裸子串匹配，打在整章正文上。
 * 于是任何一句带这四个字的普通台词都能放行：第 433 章那句「一个**还没结算**」就这么把
 * 一个非结算章的 29% 送过了检查。**排否定形式治不好它**，排完「还没结算」还有「不必收束」
 * 「未到卷末」「离单元末还早」，下一个写手换个说法就又漏一个。
 *
 * 换成结构之后，判据来自单元头自己声明的两样东西，都是台账级写法、不是行文：
 *   一是标题里的章号区间——「## 支线单元 3 · 补过的碗（111~120 章）」，末章即收束章；
 *   二是那一行沾锈声明——「**沾锈**：22.2% → **25%**（结算在 434）」。
 *
 * 第二样不能省。卷五第 496~497 章是全书最后一次结算，却不在任何一个部分的末章上
 * （第五部分是 479~500），只认区间末章会把它们判成违例。
 *
 * 卷五的小节头写的是「第一部分」不是「单元」，所以这里不匹配「单元」二字，只认
 * 「（数字~数字 章）」这个形状。
 */
function settlementChapters(text, hi) {
  const ok = new Set([hi])
  const strays = []
  let unit = null
  let sawUnitHead = false
  // 声明只对本单元有效。不设这道界，任何人都能在任意单元头里声明任意一章，
  // 那等于把刚堵上的洞换个地方重开一个，而且这一次连措辞的痕迹都不留。
  const declare = (n) => {
    if (unit && (n < unit.lo || n > unit.hi)) {
      strays.push(`单元 ${unit.lo}~${unit.hi} 的沾锈声明点了第 ${n} 章，越出本单元`)
      return
    }
    ok.add(n)
  }
  for (const line of text.split('\n')) {
    const head = /^#{2,3}\s+.*?[（(]\s*(\d+)\s*[~～-]\s*(\d+)\s*章/.exec(line)
    if (head) {
      sawUnitHead = true
      unit = { lo: Number(head[1]), hi: Number(head[2]) }
      ok.add(unit.hi)
      continue
    }
    if (!/^\*\*沾锈\*\*/.test(line)) continue
    for (const m of line.matchAll(/结算在第?\s*(\d+)(?:\s*[~～-]\s*(\d+))?/g)) {
      const lo = Number(m[1])
      const to = m[2] ? Number(m[2]) : lo
      for (let n = lo; n <= to; n++) declare(n)
    }
    // 不进沾锈链、但本章确实要出数的例外，得由单元头点名。目前只有卷五第 486 章
    // 一处：那是炉头的 29.9%，该章自己写着「单独结算，不进任何一张总表」。
    // 放行它必须是一次具名登记，**不能靠在正文或不许泄露栏里撞见「单独结算」四个字**
    // ——那又退回子串匹配了，正是这次要拆掉的东西。
    for (const m of line.matchAll(/第\s*(\d+)\s*章单独结算/g)) declare(Number(m[1]))
  }
  return { ok, sawUnitHead, strays }
}

/**
 * 已写正文的章号 → 章名。读不到目录返回 null，比对整个跳过而不是报错——
 * 这个脚本单独跑时可能不在仓库根目录，那种情况下不该假装发现了问题。
 *
 * 章名取正文首行「# 第N章　章名」，取不到才退回文件名里的那一段。
 * 两者是否一致由 check-format.mjs 管，这里不重复查。
 */
async function readProseTitles() {
  let files
  try {
    files = await readdir(PROSE_DIR)
  } catch {
    return null
  }
  const titles = new Map()
  for (const f of files) {
    const m = /^第(\d{3})章-(.+)\.md$/.exec(f)
    if (!m) continue
    const first = (await readText(join(PROSE_DIR, f))).split('\n')[0]
    const head = /^#\s*第[^\s　]+章[\s　]+(.+?)\s*$/.exec(first)
    titles.set(Number(m[1]), head ? head[1].trim() : m[2])
  }
  return titles
}

/**
 * 章纲章名后面允许挂一个结构注记（`引子（单元收束）`），正文章名里不许有——
 * 那是排布用的记号，不是书名的一部分，跟着上架会砸在读者眼前。
 *
 * 只剥这一类，不剥所有尾括号：真章名将来若带括号，那才是一处该报的失配。
 */
const STRUCTURAL_NOTE = /（[^（）]*(?:单元收束|卷末|卷首)[^（）]*）\s*$/

const stripNote = (title) => title.replace(STRUCTURAL_NOTE, '').trim()

function checkVolume(name, text, lo, hi, banned, prose) {
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
  const { ok: settleAt, sawUnitHead, strays } = settlementChapters(text, hi)
  for (const s of strays) issues.push(`${name}：${s}`)
  // 解析不到任何单元头时，允许集退化成只剩卷末一章，下面会把本卷每一个带沾锈的章全报出来。
  // 那是刺眼的，但比静默放行强——这一条守的是沾锈红线，宁可吵也不能装作查过了。
  if (rusty.length > 0 && !sawUnitHead) {
    issues.push(`${name}：解析不到任何「（起~止 章）」形式的单元头，收束章判据失效，下面的沾锈报告不可信`)
  }
  for (const c of rusty) {
    if (!settleAt.has(c.num)) issues.push(`${name} 第 ${c.num} 章：中间章出现沾锈数值，沾锈只在单元收束章结算`)
  }

  // 禁用词
  for (const c of chapters) {
    for (const { word, reason } of banned) {
      if (c.body.includes(word) || c.title.includes(word)) {
        issues.push(`${name} 第 ${c.num} 章：禁用词「${word}」——${reason}`)
      }
    }
  }

  // 章名与正文对不对得上。**只查已写正文的章**——未写的章，章纲里的章名是工作
  // 标题，本来就允许与将来的成稿不同，拿它报错等于逼着人提前定名。
  if (prose) {
    for (const c of chapters) {
      const real = prose.get(c.num)
      if (real !== undefined && real !== stripNote(c.title)) {
        issues.push(`${name} 第 ${c.num} 章：章纲章名「${c.title}」与正文「${real}」对不上`)
      }
    }
  }

  return issues
}

async function main() {
  let banned = []
  try {
    const glossary = await readText(GLOSSARY)
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

  const prose = await readProseTitles()
  if (prose === null) console.error(`读不到目录：${PROSE_DIR}，跳过章名比对。`)

  const all = []
  let done = 0
  const stats = []
  const written = []

  for (const vol of VOLUMES) {
    if (!present.has(vol.file)) {
      const msg = `${vol.file}：还不存在（应覆盖 ${vol.lo}~${vol.hi}，共 ${vol.hi - vol.lo + 1} 章）`
      console.log(`  ! ${msg}`)
      all.push(msg)
      continue
    }
    const text = await readText(join(OUTLINE_DIR, vol.file))
    const issues = checkVolume(vol.file, text, vol.lo, vol.hi, banned, prose)
    if (prose) {
      for (const c of splitChapters(text)) {
        if (prose.has(c.num)) written.push({ num: c.num, title: prose.get(c.num) })
      }
    }
    stats.push({
      file: vol.file,
      span: `${vol.lo}~${vol.hi}`,
      chapters: splitChapters(text).length,
      expected: vol.hi - vol.lo + 1,
      han: (text.match(HAN) ?? []).length,
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

  // 章名重复。**跨卷查，但只查已写正文的章。**
  //
  // 跨卷是因为触发这条检查的那个 bug 本身就跨卷——第 23 章（卷一）与第 36 章（卷二）
  // 同名「全绿的报告」，只在卷内查根本抓不到它。让读者犯迷糊的是两章隔得近，不是它们
  // 归在哪一卷。
  //
  // 只查已写的章是因为未写章的章名是**功能性工作标题**，重复是正常的：全书现有 14 组
  // 重名，其中「收束」9 章、「第一次进去」7 章、「撞墙」6 章，都是排布用的占位名。
  // 把它们算成问题，这个检查上线第一天就得让全库退 1，然后被人关掉。
  if (written.length > 0) {
    const byTitle = new Map()
    for (const w of written) {
      if (!byTitle.has(w.title)) byTitle.set(w.title, [])
      byTitle.get(w.title).push(w.num)
    }
    for (const [title, nums] of byTitle) {
      if (nums.length > 1) {
        all.push(`已写正文里章名「${title}」重复：第 ${nums.sort((a, b) => a - b).join('、')} 章`)
        console.log(`\n  ! 已写正文里章名「${title}」重复：第 ${nums.join('、')} 章`)
      }
    }
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
