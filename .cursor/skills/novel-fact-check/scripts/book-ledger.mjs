#!/usr/bin/env node
// 全书总账。三张表一次算清：沾锈链、入器次数、谜团存量。
//
// 为什么要有这个：前三个脚本各管一段——check-format 管排版、check-facts 管正文事实、
// check-outline 管章纲合不合格。可「全书这条血条接不接得上」「谜团是不是都有解答章」
// 这类跨卷的账，没有一个脚本管，而它们恰恰是长篇最容易崩的地方。
//
// 沾锈与谜团是解析出来的，硬。入器次数是**启发式统计**，只能当线索用，见输出里的说明。
import { readFile, readdir } from 'node:fs/promises'

const OUTLINE_DIR = '02-大纲/章纲'
const MYSTERY = '02-大纲/谜团台账.md'
const CAP = 30 // 沾锈上限，过了就成器

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

/** 抓「沾锈」那一行上的百分数，取最后一个（A% → B% 的写法要取 B） */
function rustOf(body) {
  const hits = []
  for (const line of body.split('\n')) {
    if (!/沾锈/.test(line)) continue
    const nums = [...line.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]))
    if (nums.length) hits.push({ line: line.trim(), value: nums[nums.length - 1], all: nums })
  }
  return hits
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
    const marks = []
    for (const c of splitChapters(text)) {
      for (const h of rustOf(c.body)) marks.push({ num: c.num, value: h.value, all: h.all })
    }
    const last = marks.length ? marks[marks.length - 1].value : null
    const desc = marks.map((m) => `${m.num}:${m.value}%`).join(' ')
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
    for (const c of splitChapters(text)) {
      for (const h of rustOf(c.body)) all.push({ num: c.num, value: h.value })
    }
  }
  all.sort((a, b) => a.num - b.num)
  const drops = []
  for (let i = 1; i < all.length; i++) {
    if (all[i].value < all[i - 1].value) drops.push(`第 ${all[i - 1].num} 章 ${all[i - 1].value}% → 第 ${all[i].num} 章 ${all[i].value}%`)
  }
  if (all.length === 0) {
    // Math.max() 对空数组给 -Infinity，余量那一行会打印成 Infinity，像是脚本自己疯了
    console.log('\n  一个沾锈结算点都没解析到，峰值与单调性这一节跳过。')
    issues.push('章纲里没有任何沾锈结算点，沾锈链核对不了')
  } else {
    const peak = Math.max(...all.map((a) => a.value))
    console.log(`\n  峰值 ${peak}%，上限 ${CAP}%，余量 ${(CAP - peak).toFixed(1)} 个百分点。`)
    console.log(`  结算点共 ${all.length} 个。回退 ${drops.length} 处：`)
    for (const d of drops) console.log(`    ${d}`)
    console.log('  说明：卷五结局褪至 0 是设计内的，第四部分那次 −0.4% 也是（全书第一次血条回退）。')
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
