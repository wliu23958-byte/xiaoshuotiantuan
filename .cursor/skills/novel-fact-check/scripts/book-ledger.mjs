#!/usr/bin/env node
// 全书总账。四张表一次算清：沾锈链、入器次数、谜团存量、入器台账的落点缺格。
//
// 为什么要有这个：前三个脚本各管一段——check-format 管排版、check-facts 管正文事实、
// check-outline 管章纲合不合格。可「全书这条血条接不接得上」「谜团是不是都有解答章」
// 这类跨卷的账，没有一个脚本管，而它们恰恰是长篇最容易崩的地方。
//
// 沾锈与谜团是解析出来的，硬。入器次数是**启发式统计**，只能当线索用，见输出里的说明。
import { readFile, readdir } from 'node:fs/promises'

const OUTLINE_DIR = '02-大纲/章纲'
const MYSTERY = '02-大纲/谜团台账.md'
const TIMELINE = '01-设定/时间线台账.md'
const CONTENT_DIR = '03-正文'
const CAP = 30 // 沾锈上限，过了就成器

/**
 * 设计内的两次血条回退。除这两处之外的任何一次下降都是硬伤。
 * 原先这一节只印一句话说「有几处回退是设计内的」，读的人得自己拿眼睛核——
 * 真出现一次计划外的回退，长得跟这两处一模一样，不会有人发现。
 */
const PLANNED_DROPS = [
  { from: 456, to: 458, why: '放妘出来，退掉一个人的账' },
  { from: 496, to: 497, why: '结局，锈褪至 0' },
]

const VOLS = [
  { cn: '一', file: '第一卷章纲.md', lo: 1, hi: 30, open: 0, close: 3.0 },
  { cn: '二', file: '第二卷章纲.md', lo: 31, hi: 150, open: 3.0, close: 9.4 },
  { cn: '三', file: '第三卷章纲.md', lo: 151, hi: 270, open: 9.4, close: 15.8 },
  { cn: '四', file: '第四卷章纲.md', lo: 271, hi: 390, open: 15.8, close: 22.2 },
  { cn: '五', file: '第五卷章纲.md', lo: 391, hi: 500, open: 22.2, close: 0 },
]

/**
 * 切章。**章体必须在下一个小节标题处截断**，不能只在下一个章标题处截断——
 * 否则单元之间那些带沾锈的小节头（「## 支线单元 17 … 沾锈：20.6% → 21.0%」）
 * 会被算进上一章的正文，凭空造出回退。这个坑第一版踩过。
 */
function splitChapters(text) {
  const lines = text.split('\n')
  const marks = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{2,4}\s*第\s*(\d+)\s*章/.exec(lines[i].trim())
    if (m) marks.push({ num: Number(m[1]), line: i })
  }
  return marks.map((mk, i) => {
    const hardEnd = i + 1 < marks.length ? marks[i + 1].line : lines.length
    let end = hardEnd
    for (let j = mk.line + 1; j < hardEnd; j++) {
      const l = lines[j].trim()
      if (/^#{1,3}\s/.test(l) || l === '---') { end = j; break }
    }
    return { num: mk.num, body: lines.slice(mk.line, end).join('\n') }
  })
}

/**
 * 抓一章里的沾锈结算点。两种写法：
 *   绝对值——带「沾锈」二字的行，取最后一个百分数（A% → B% 要取 B）
 *   增减量——回退那一章写的是「那块锈**退了 0.4%**」，只给了退多少、没给退到多少，
 *            句里还没有「沾锈」二字，于是全书唯一一次血条回退整个从链上漏掉了。
 * 判据卡得很死（同时要有「结算」「回退」、且只有一个百分数、且没有 A%→B% 对），
 * 否则讲规则的段落里那些 29%、+2% 会被一起卷进来，凭空造出一堆假结算点。
 */
function rustOf(body) {
  const hits = []
  for (const line of body.split('\n')) {
    const nums = [...line.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]))
    if (!nums.length) continue
    if (/沾锈/.test(line)) {
      hits.push({ line: line.trim(), value: nums[nums.length - 1], all: nums })
      continue
    }
    // 抓「退了 X%」这个说法本身，不要去数这一行有几个百分数——同一句里还会写
    // 「每放出一位退 0.3~0.5%」这类档位说明，按个数判会被它带偏
    if (/结算/.test(line) && /回退/.test(line)) {
      const retreat = /退了\s*\**\s*(\d+(?:\.\d+)?)\s*%/.exec(line)
      if (retreat) hits.push({ line: line.trim(), delta: -Number(retreat[1]), all: nums })
    }
  }
  return hits
}

/** 把一卷的结算点摊成绝对值序列。增减量型的点按前一个绝对值推算，并标记出来 */
function settlementsOf(text, open) {
  let running = open
  const out = []
  for (const c of splitChapters(text)) {
    for (const h of rustOf(c.body)) {
      const value = h.delta === undefined ? h.value : Number((running + h.delta).toFixed(1))
      running = value
      out.push({ num: c.num, value, derived: h.delta !== undefined })
    }
  }
  return out
}

/** 启发式：这一章像不像发生了一次入器 */
function looksLikeEntry(body) {
  const scene = /^\*\*场景\*\*(.*)$/m.exec(body)?.[1] ?? ''
  if (/入器/.test(scene)) return true
  // 场景没写，但正文里明说断口在他手里合上
  if (/断口在他手里(咬合|合上)/.test(body)) return true
  return false
}

/** BOM 会粘在第一行开头，让各处标题正则全部失配 */
const readText = async (path) => (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')

/** 末尾那根竖线是可选的，`| 甲 | 乙` 也是合法表格行，slice(1, -1) 会把「乙」砍掉 */
const splitRow = (line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

function tableRows(md, heading) {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^#{2,4}\\s+${heading}`).test(l))
  if (start === -1) return []
  const rows = []
  let seen = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (/^#{2,4}\s/.test(line)) break
    if (!line.startsWith('|')) continue
    if (/^\|[\s|:-]+$/.test(line)) continue
    const cells = splitRow(line)
    if (!seen) { seen = true; continue }
    rows.push(cells)
  }
  return rows
}

/** 少写一列的行会让 cells[4] 是 undefined，那是台账的错，不该让整个脚本崩在这里 */
const plain = (s) => (s ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim()

/** 正文写到第几章了。落点欠账只对已经写到的章节较真，后面的只算待办 */
async function draftFrontier() {
  let files
  try { files = await readdir(CONTENT_DIR) } catch { return 0 }
  let max = 0
  for (const f of files) {
    const m = /^第(\d+)章-/.exec(f)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/**
 * 解析时间线台账里的入器台账，只取「### 卷X · …」那几节的表。
 * 同一节里还有分卷合计、与结算点对账、与启发式的差几张列头完全不同的表，
 * 一起收进来就全乱了，所以按小节标题筛。
 */
function entryLedgerRows(md) {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => /^##\s+入器台账/.test(l))
  if (start === -1) return null
  const rows = []
  let inVolume = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (/^##\s/.test(line)) break
    if (/^###\s/.test(line)) {
      inVolume = /^###\s*卷[一二三四五]\s*[·・]/.test(line)
      continue
    }
    if (!inVolume || !line.startsWith('|')) continue
    if (/^\|[\s|:-]+$/.test(line)) continue
    const cells = splitRow(line)
    if (cells.length < 7 || plain(cells[0]) === '序') continue
    rows.push({ seq: plain(cells[0]), chapter: plain(cells[1]), landing: plain(cells.at(-1)) })
  }
  return rows
}

/**
 * 落点还没定的行。「同上」跟着上一行走；破折号在这张表里是「不适用」的写法
 * （序 55~57 的「借用的身体」列也这么用），不是没填，别把它算成欠账。
 */
function landingGaps(rows) {
  const out = []
  let prevResolved = true
  for (const r of rows) {
    const unresolved = r.landing === '' || /^(待定|未定)/.test(r.landing)
    const resolved = r.landing === '同上' ? prevResolved : !unresolved
    prevResolved = resolved
    if (!resolved) out.push(r)
  }
  return out
}

async function main() {
  let present
  try { present = new Set(await readdir(OUTLINE_DIR)) } catch { present = new Set() }

  console.log('\n全书总账')
  console.log('='.repeat(76))

  // ── 一、沾锈链 ──────────────────────────────────
  console.log('\n一、沾锈链')
  console.log('-'.repeat(76))
  console.log('  卷   开卷    收卷   章纲里的结算点                      判定')

  const issues = []
  let prevClose = null
  for (const v of VOLS) {
    if (!present.has(v.file)) { console.log(`  ${v.cn}   ${v.file} 不存在`); continue }
    const text = await readText(`${OUTLINE_DIR}/${v.file}`)
    const marks = settlementsOf(text, v.open)
    const last = marks.length ? marks[marks.length - 1].value : null
    const desc = marks.map((m) => `${m.num}:${m.value}%${m.derived ? '*' : ''}`).join(' ')
    const ok = last !== null && Math.abs(last - v.close) < 0.001
    if (prevClose !== null && Math.abs(prevClose - v.open) > 0.001) {
      issues.push(`卷${v.cn} 开卷 ${v.open}% 与上一卷收卷 ${prevClose}% 接不上`)
    }
    if (!ok) issues.push(`卷${v.cn} 章纲最后一个结算值 ${last}% 与细纲收卷值 ${v.close}% 对不上`)
    console.log(`  ${v.cn}  ${String(v.open).padStart(5)}%  ${String(v.close).padStart(5)}%   ${desc.padEnd(34)}${ok ? '对得上' : '★ 对不上'}`)
    prevClose = v.close
  }

  // 单调性：把所有结算点按章号排，检查回退
  const all = []
  for (const v of VOLS) {
    if (!present.has(v.file)) continue
    const text = await readText(`${OUTLINE_DIR}/${v.file}`)
    all.push(...settlementsOf(text, v.open))
  }
  all.sort((a, b) => a.num - b.num)
  const drops = []
  for (let i = 1; i < all.length; i++) {
    if (all[i].value >= all[i - 1].value) continue
    const from = all[i - 1]
    const to = all[i]
    const planned = PLANNED_DROPS.find((p) => p.from === from.num && p.to === to.num)
    drops.push({ from, to, planned })
    if (!planned) {
      issues.push(`第 ${from.num} 章 ${from.value}% 回退到第 ${to.num} 章 ${to.value}%，不在计划内的回退`)
    }
  }
  if (all.length === 0) {
    // Math.max() 对空数组给 -Infinity，余量那一行会打印成 Infinity，像是脚本自己疯了
    console.log('\n  一个沾锈结算点都没解析到，峰值与单调性这一节跳过。')
    issues.push('章纲里没有任何沾锈结算点，沾锈链核对不了')
  } else {
    const peak = Math.max(...all.map((a) => a.value))
    const derived = all.filter((a) => a.derived).length
    console.log(`\n  峰值 ${peak}%，上限 ${CAP}%，余量 ${(CAP - peak).toFixed(1)} 个百分点。`)
    console.log(`  结算点共 ${all.length} 个${derived ? `，其中 ${derived} 个标 * 的是按增减量推算的（章纲只写了退多少，没写退到多少）` : ''}。`)
    console.log(`  回退 ${drops.length} 处：`)
    for (const d of drops) {
      const tail = d.planned ? d.planned.why : '★ 计划外，这是硬伤'
      console.log(`    第 ${d.from.num} 章 ${d.from.value}% → 第 ${d.to.num} 章 ${d.to.value}%   ${tail}`)
    }
    for (const p of PLANNED_DROPS) {
      if (drops.some((d) => d.planned === p)) continue
      console.log(`    ★ 计划内的 ${p.from}→${p.to}（${p.why}）没在链上出现`)
      issues.push(`计划内的回退 ${p.from}→${p.to} 没能从章纲里解析出来`)
    }
  }

  // ── 二、入器次数（启发式） ────────────────────────
  console.log('\n\n二、入器次数（**启发式统计，只能当线索**）')
  console.log('-'.repeat(76))
  console.log('  判定依据：章纲的「场景」字段里出现「入器」，或正文写了「断口在他手里合上／咬合」。')
  console.log('  漏判与误判都可能有，务必人工复核。\n')
  console.log('  卷      章段        疑似入器章')
  let total = 0
  for (const v of VOLS) {
    if (!present.has(v.file)) continue
    const text = await readText(`${OUTLINE_DIR}/${v.file}`)
    const hit = splitChapters(text).filter((c) => looksLikeEntry(c.body)).map((c) => c.num)
    total += hit.length
    const shown = hit.length > 14 ? `${hit.slice(0, 14).join(', ')} …共 ${hit.length}` : hit.join(', ') || '—'
    console.log(`  ${v.cn}  ${`${v.lo}~${v.hi}`.padStart(9)}  ${String(hit.length).padStart(3)} 章   ${shown}`)
  }
  console.log(`\n  合计疑似 ${total} 次。`)

  // ── 三、谜团存量 ────────────────────────────────
  console.log('\n\n三、谜团存量')
  console.log('-'.repeat(76))
  let md = null
  try { md = await readText(MYSTERY) } catch { /* 记成欠账，不能就这么走人 */ }

  const openItems = []
  if (md === null) {
    // 这里原先直接 return，于是台账还没建起来的仓库跑完退码是 0。
    // 静默通过比报错危险得多：调用方会以为总账已经核过了。
    console.log(`  读不到谜团台账 ${MYSTERY}，这一节没核对。`)
    openItems.push(`读不到谜团台账 ${MYSTERY}，谜团存量没核对`)
  } else {
    const groups = ['A 组 · 主线与身份', 'B 组 · 沈鹤年', 'C 组 · 规则', 'D 组 · 工具箱盖', 'E 组 · 姜宁', 'F 组 · 周维', 'G 组 · 名单']
    const rows = []
    for (const g of groups) for (const r of tableRows(md, g)) rows.push(r)

    console.log('\n  编号  解答章                     状态')
    for (const cells of rows) {
      const id = plain(cells[0])
      const answer = plain(cells[4])
      // 只认「NNN~NNN」区间与独立的两位以上数字；「支线 9」「与 D1 合并」里那些小数字不算章号
      const spans = [...answer.matchAll(/(\d{1,3})\s*[~～-]\s*(\d{1,3})/g)].map((m) => [Number(m[1]), Number(m[2])])
      const singles = [...answer.matchAll(/(?<![\d~～-])(\d{2,3})(?![\d~～-])/g)].map((m) => Number(m[1]))
      const nums = [...spans.flat(), ...singles].filter((n) => n >= 1 && n <= 500)
      const settled = nums.length > 0
      if (!settled) openItems.push(`${id}：解答栏「${answer}」只给了卷次，没有章号——按台账自己的规则三，这是欠账`)
      const flag = settled ? `落在 ${Math.min(...nums)}${Math.max(...nums) !== Math.min(...nums) ? `~${Math.max(...nums)}` : ''}` : '★ 只有卷次'
      console.log(`  ${id.padEnd(5)} ${answer.slice(0, 26).padEnd(28)}${flag}`)
    }
    console.log(`\n  共 ${rows.length} 条谜团。`)
  }

  // ── 四、入器台账的落点缺格 ──────────────────────
  console.log('\n\n四、入器台账 · 落点缺格')
  console.log('-'.repeat(76))
  let timeline = null
  try { timeline = await readText(TIMELINE) } catch { /* 下面按缺文件处理 */ }
  const entries = timeline === null ? null : entryLedgerRows(timeline)
  if (entries === null) {
    console.log(`  ${TIMELINE} 里没有「入器台账」这一节，跳过。`)
  } else {
    const frontier = await draftFrontier()
    const gaps = landingGaps(entries)
    // 还没写到的章节留着空格是正常的，写到了还空着才是欠账——这样它自己会挑时候叫
    const due = gaps.filter((g) => /^\d+$/.test(g.chapter) && Number(g.chapter) <= frontier)
    const later = gaps.filter((g) => !due.includes(g))
    console.log(`  台账 ${entries.length} 行，正文写到第 ${frontier} 章。`)
    if (gaps.length === 0) {
      console.log('  落点全部填好了。')
    } else {
      const where = (g) => (/^\d+$/.test(g.chapter) ? `第 ${g.chapter} 章` : g.chapter)
      console.log(`  落点还空着 ${gaps.length} 处，其中 ${due.length} 处正文已经写到：`)
      for (const g of due) console.log(`    ★ 序 ${g.seq}（${where(g)}）${g.landing || '空'}`)
      for (const g of later) console.log(`      序 ${g.seq}（${where(g)}）${g.landing || '空'}`)
      for (const g of due) {
        issues.push(`入器台账序 ${g.seq}（第 ${g.chapter} 章）落点还没定，可正文已经写到第 ${frontier} 章`)
      }
    }
  }

  // ── 结论 ───────────────────────────────────────
  console.log('\n' + '='.repeat(76))
  const problems = [...issues, ...openItems]
  if (problems.length === 0) {
    console.log('总账：闭合。沾锈链五卷首尾相接，谜团全部有指定解答章。')
  } else {
    console.log(`总账：${problems.length} 处需要看：`)
    for (const p of problems) console.log(`  ! ${p}`)
    process.exitCode = 1
  }
  console.log('\n提醒：入器次数那一节是启发式的，不计入上面的判定。')
}

main().catch((e) => { console.error(e); process.exit(2) })
