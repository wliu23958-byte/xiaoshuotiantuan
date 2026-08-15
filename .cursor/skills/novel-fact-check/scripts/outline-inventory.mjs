#!/usr/bin/env node
// 章纲家底盘点。check-outline.mjs 管「合不合格」，这个只管「有没有、有多少、缺在哪」。
//
// 为什么单独写一个：逐章内容现在散在两个地方——
//   新位置 02-大纲/章纲/第N卷章纲.md   check-outline.mjs 只认这里
//   旧位置 02-大纲/第N卷细纲.md        卷一那 30 条逐章条目就埋在这里，脚本看不见
// 只跑 check-outline.mjs 会以为卷一什么都没有。本脚本两边都盘，给一张合并后的家底表。
import { readFile, readdir } from 'node:fs/promises'

const NEW_DIR = '02-大纲/章纲'
const OLD_DIR = '02-大纲'

const VOLUMES = [
  { vol: '一', lo: 1, hi: 30 },
  { vol: '二', lo: 31, hi: 150 },
  { vol: '三', lo: 151, hi: 270 },
  { vol: '四', lo: 271, hi: 390 },
  { vol: '五', lo: 391, hi: 500 },
]

const REQUIRED = ['场景', '出场', '信息增量', '不许泄露', '章末钩子']

/** 区间与 `src/lib/utils.ts` 的 countWords 一致。\u9fa5 是 Unicode 3.0 的旧上界，
 *  两边不一致的话，阅读器报的字数和这里报的汉字数会对不上 */
const han = (s) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length

/**
 * 一个「逐章条目」= 行首用 ## / ### / **加粗** 起头、后面紧跟「第 N 章」的行。
 * 正文里顺口提到的「第 218 章前后」不算，它既不在行首也不带标记。
 *
 * 「第 N 章」后面还必须收口——跟「｜标题」、跟「**」收粗体、或者直接到行尾。
 * 光靠行首标记挡不住加粗写的整句话：第二卷章纲那句
 * 「**第 34 章那条姜宁的禁令已经补进去了**，不占这张表。」
 * 就被当成了第 121 条，让卷二凭空多出一章、还多报一条五字段全缺。
 */
function entries(text) {
  const lines = text.split('\n')
  const marks = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:#{2,4}\s*|\*\*)第\s*(\d+)\s*章\s*(?:[｜|：:]|\*\*|$)/.exec(lines[i].trim())
    if (m) marks.push({ num: Number(m[1]), line: i })
  }
  return marks.map((mk, i) => ({
    num: mk.num,
    body: lines.slice(mk.line, i + 1 < marks.length ? marks[i + 1].line : lines.length).join('\n'),
  }))
}

function ranges(nums) {
  if (nums.length === 0) return '—'
  const out = []
  let a = nums[0]
  let b = nums[0]
  for (const n of nums.slice(1)) {
    if (n === b + 1) { b = n; continue }
    out.push(a === b ? `${a}` : `${a}~${b}`)
    a = b = n
  }
  out.push(a === b ? `${a}` : `${a}~${b}`)
  return out.join(', ')
}

async function scan(path, lo, hi) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }
  const list = entries(text).filter((e) => e.num >= lo && e.num <= hi)
  const nums = [...new Set(list.map((e) => e.num))].sort((a, b) => a - b)
  const fieldHave = Object.fromEntries(REQUIRED.map((f) => [f, 0]))
  for (const e of list) {
    for (const f of REQUIRED) if (new RegExp(`\\*\\*${f}\\*\\*`).test(e.body)) fieldHave[f]++
  }
  const bodies = list.map((e) => han(e.body))
  return {
    count: list.length,
    nums,
    fieldHave,
    entryHan: bodies.reduce((a, b) => a + b, 0),
    avg: bodies.length ? Math.round(bodies.reduce((a, b) => a + b, 0) / bodies.length) : 0,
    fileHan: han(text),
  }
}

async function main() {
  let dir
  try {
    dir = await readdir(NEW_DIR)
  } catch {
    dir = null
  }

  const rows = []
  for (const v of VOLUMES) {
    const cn = ['一', '二', '三', '四', '五'][VOLUMES.indexOf(v)]
    rows.push({
      ...v,
      expected: v.hi - v.lo + 1,
      neo: await scan(`${NEW_DIR}/第${cn}卷章纲.md`, v.lo, v.hi),
      old: await scan(`${OLD_DIR}/第${cn}卷细纲.md`, v.lo, v.hi),
    })
  }

  console.log('\n章纲家底（真实盘点，快照）')
  console.log('='.repeat(74))
  console.log(`\n02-大纲/章纲/ ：${dir === null ? '目录不存在' : dir.length === 0 ? '存在，空的' : dir.join('、')}`)
  console.log('这是 check-outline.mjs 唯一认的位置。旧位置里的逐章条目它一条都看不见。\n')

  console.log('一、两个位置分别有多少')
  console.log('-'.repeat(74))
  console.log('  卷      章段     新位置 章纲     旧位置 细纲     应有')
  for (const r of rows) {
    const n = r.neo ? `${r.neo.count} 条` : '无文件'
    const o = r.old ? `${r.old.count} 条` : '无文件'
    console.log(`  ${r.vol}  ${`${r.lo}~${r.hi}`.padStart(9)}${n.padStart(14)}${o.padStart(16)}${String(r.expected).padStart(9)}`)
  }

  console.log('\n\n二、合并后的真实覆盖')
  console.log('-'.repeat(74))
  console.log('  卷      章段      已有   应有    来源            缺')
  let have = 0
  let need = 0
  for (const r of rows) {
    const useNeo = (r.neo?.count ?? 0) >= (r.old?.count ?? 0)
    const src = useNeo ? r.neo : r.old
    const label = (src?.count ?? 0) === 0 ? '—' : useNeo ? '章纲（新）' : '细纲（旧）'
    const c = src?.count ?? 0
    have += c
    need += r.expected
    console.log(
      `  ${r.vol}  ${`${r.lo}~${r.hi}`.padStart(9)}${String(c).padStart(8)}${String(r.expected).padStart(7)}    ${label.padEnd(14, '　')}${String(r.expected - c).padStart(5)}`,
    )
  }
  console.log('-'.repeat(74))
  console.log(`  合计${String(have).padStart(20)}${String(need).padStart(7)}${''.padEnd(18)}${String(need - have).padStart(5)}`)
  console.log(`\n  覆盖率 ${(have / need * 100).toFixed(1)}%。`)

  console.log('\n\n三、缺哪些章')
  console.log('-'.repeat(74))
  for (const r of rows) {
    const useNeo = (r.neo?.count ?? 0) >= (r.old?.count ?? 0)
    const src = useNeo ? r.neo : r.old
    const seen = new Set(src?.nums ?? [])
    const missing = []
    for (let n = r.lo; n <= r.hi; n++) if (!seen.has(n)) missing.push(n)
    console.log(`\n  卷${r.vol}（${r.lo}~${r.hi}）`)
    console.log(`    已有：${ranges(src?.nums ?? [])}`)
    console.log(`    缺 ${missing.length} 章：${missing.length === r.expected ? '全缺' : ranges(missing)}`)
  }

  console.log('\n\n四、字段缺口（分母是该卷已有的条目数）')
  console.log('-'.repeat(74))
  console.log(`\n  卷   来源        条目   ${REQUIRED.map((f) => f.padEnd(8, '　')).join('')}`)
  for (const r of rows) {
    const useNeo = (r.neo?.count ?? 0) >= (r.old?.count ?? 0)
    const src = useNeo ? r.neo : r.old
    if (!src || src.count === 0) continue
    const label = useNeo ? '章纲（新）' : '细纲（旧）'
    const cells = REQUIRED.map((f) => `${src.fieldHave[f]}/${src.count}`.padEnd(10))
    console.log(`  ${r.vol}   ${label.padEnd(10, '　')}${String(src.count).padStart(4)}   ${cells.join('')}`)
  }
  console.log('\n  读法：13/30 表示 30 条里有 13 条写了这个字段。五个字段是 check-outline.mjs 的硬要求。')

  console.log('\n\n五、体量')
  console.log('-'.repeat(74))
  console.log('  卷   来源        条目汉字   均/条')
  let sumHan = 0
  let sumCount = 0
  for (const r of rows) {
    const useNeo = (r.neo?.count ?? 0) >= (r.old?.count ?? 0)
    const src = useNeo ? r.neo : r.old
    if (!src || src.count === 0) continue
    sumHan += src.entryHan
    sumCount += src.count
    const label = useNeo ? '章纲（新）' : '细纲（旧）'
    console.log(`  ${r.vol}   ${label.padEnd(10, '　')}${String(src.entryHan).padStart(8)}${String(src.avg).padStart(8)}`)
  }
  const avg = sumCount ? Math.round(sumHan / sumCount) : 0
  console.log(`\n  现有 ${sumCount} 条共 ${sumHan} 汉字，均 ${avg} 字/条。`)
  console.log(`  按这个均长，补齐剩下 ${need - have} 章约需 ${((need - have) * avg / 10000).toFixed(1)} 万汉字。`)
  console.log('\n' + '='.repeat(74))
}

main().catch((e) => { console.error(e); process.exit(2) })
