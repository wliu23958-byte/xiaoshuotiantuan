#!/usr/bin/env node
// 全书重复数字。同一个数被用了几次、各在哪里、分别是什么量纲。
//
// 为什么要有这个：这本书里「同一个数反复出现」是个真实存在的东西——十七秒、十七毫米、
// 十七件、十七格；十九度、十九岁、十九天、十九条、十九年。它到底是有意的母题还是撞车，
// 得先看清全貌才谈得上。可这笔账此前一直靠**备注手数**：名词表写着「十七已有两处」，
// 卷五审校写着「第 404 章那个十九年是全书第三个十九」，两处都数少了——名词表只数了它自己
// 登记过的，卷五那份没扫正文。人工记不住这种账，机器可以。
//
// 这个脚本**不做判断**，只把账摊开。同数复用是不是毛病，由总编定；定了之后再用 --max
// 把结论钉成一条会失败的检查。默认永远退 0。
//
// 用法：
//   node repeated-numbers.mjs                     扫 03-正文/，列出配了 2 种以上量纲的数
//   node repeated-numbers.mjs --from=1            连一、二、三一起看（默认从十起，见下）
//   node repeated-numbers.mjs --min=3             只列配了 3 种以上量纲的
//   node repeated-numbers.mjs --outline           改扫 02-大纲/章纲/
//   node repeated-numbers.mjs --all               正文与章纲一起扫
//   node repeated-numbers.mjs --value=十七        只看某一个数，列出每一处原句
//   node repeated-numbers.mjs --max=5             有数超过 5 种量纲就退 1（留给以后接 CI）
//
// **为什么默认从十起数**：汉语里「一件」「三道」「两只」的一二三是不定冠词，不是数量。
// 第一版没滤，「一」报出 24 种量纲 495 处，把真正要看的十七、十九全埋了。
// 读者会觉得「这个数怎么又出现了」的，是有辨识度的数；一二三没有辨识度。
// 想看全的传 --from=1。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CONTENT_DIR = '03-正文'
const OUTLINE_DIR = '02-大纲/章纲'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}

const MIN_KINDS = Number(opt('min', 2))
const MIN_VALUE = Number(opt('from', 10))
const MAX_KINDS = opt('max', null) === null ? null : Number(opt('max', null))
const ONLY_VALUE = opt('value', null)

/** BOM 会粘在第一行开头，让标题正则失配 */
const readText = async (path) => (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')

// ── 中文数字 ──────────────────────────────────────────

const CN_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNIT = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
const CN_CHARS = '〇零一二两三四五六七八九十百千万'

/**
 * 「十七」→ 17，「两千三百一十六」→ 2316，「二十七点三」→ 27.3。
 * 坑一：「十」单独打头时前面没有数字，要按 1 算（十七 = 1×10 + 7），否则全书所有十几都归零。
 * 坑二：中文小数也用「点」（通高二十七点三、直径十四点二公分），小数部分要**逐字读**——
 *       「点三五」是 .35 不是 .35 的那个三十五。
 */
function cnToNum(s) {
  if (s.includes('点')) {
    const [head, tail, ...extra] = s.split('点')
    if (extra.length || !tail) return null
    const int = cnToNum(head)
    if (int === null) return null
    let frac = ''
    for (const ch of tail) {
      if (!(ch in CN_DIGIT)) return null
      frac += CN_DIGIT[ch]
    }
    return Number(`${int}.${frac}`)
  }
  let total = 0
  let section = 0
  let num = 0
  let seen = false
  for (const ch of s) {
    if (ch in CN_DIGIT) {
      num = CN_DIGIT[ch]
      seen = true
    } else if (ch in CN_UNIT) {
      const u = CN_UNIT[ch]
      if (u === 10000) {
        section = (section + num) * u
        total += section
        section = 0
      } else {
        section += (num || 1) * u
      }
      num = 0
      seen = true
    } else {
      return null
    }
  }
  return seen ? total + section + num : null
}

// ── 量纲 ──────────────────────────────────────────────
//
// 只认后面真的跟了量词的数。「第三行」「七家」这种也是数，但它们不构成读者会串的那种碰撞，
// 反倒会把输出淹掉。宁可漏，不可吵。

const UNITS = [
  // 时间
  ['秒', '秒'], ['分钟', '分钟'], ['个钟头', '钟头'], ['钟头', '钟头'], ['小时', '小时'],
  ['天', '天'], ['个月', '个月'], ['年', '年'], ['岁', '岁'],
  // 长度与重量
  ['毫米', '毫米'], ['厘米', '厘米'], ['公分', '公分'], ['公里', '公里'], ['米', '米'],
  ['克', '克'], ['斤', '斤'], ['两', '两'], ['钱', '钱'],
  // 角度与倍率
  ['度', '度'], ['倍', '倍'],
  // 计件
  ['件', '件'], ['本', '本'], ['页', '页'], ['张', '张'], ['条', '条'], ['支', '支'],
  ['遍', '遍'], ['次', '次'], ['格', '格'], ['处', '处'], ['层', '层'], ['排', '排'],
  ['圈', '圈'], ['只', '只'], ['道', '道'], ['块', '块'], ['个人', '个人'],
]
// 长量词排前面，否则「分钟」会被「分」吃掉、「公分」会被「分」吃掉
UNITS.sort((a, b) => b[0].length - a[0].length)
const UNIT_ALT = UNITS.map(([raw]) => raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

const NUM_CN = new RegExp(`([${CN_CHARS}]+(?:点[${CN_CHARS}]+)?)\\s*(${UNIT_ALT})`, 'g')

/**
 * 「两」既是数字（两千、两次）又是量词（二两、一斤四两），而数字段是贪婪的：
 * 「二两三钱」会被整个吞成「二两三」＋「钱」，cnToNum 取到最后一个字，读出来是 3 钱——
 * 二两凭空没了。偏偏支线 2 那个单元就叫「二两三钱」，最该数准的短语恰好是唯一读错的。
 *
 * 只有「<数>两<数><量词>」这一种形状会错：「一斤四两」本来就对（斤不在数字字符集里，
 * 数字段跨不过去），「三十两银子」也对（后面跟的不是数字，主扫描会回溯成三十＋两）。
 * 所以只把这一种先切出来单独记账，其余原样交给主扫描。
 */
const LIANG_AS_UNIT = new RegExp(`([${CN_CHARS.replace('两', '')}]+)两(?=[${CN_CHARS}])`, 'g')
const NUM_AR = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALT})`, 'g')
const PERCENT = /(\d+(?:\.\d+)?)\s*%/g

/**
 * 日期与时刻要先挖掉，不然「三月十九日」「四点十七分」会把十七、十九的计数灌爆。
 * 挖的办法是替换成等长的空格——**必须等长**，否则后面所有 match.index 全错位。
 *
 * 两个踩过的坑：
 * 一、年份只能是**四个纯数字**（二〇一九年、一九五三年），不许带十百千。第一版写成
 *     `[中文数字]{2,4}年`，把「四十一年」（老猫的工龄）和「三千年」一起当成年份挖了，
 *     而那两个恰恰是全书最该数的时长。
 * 二、时刻那条不能认光杆的「一点」——这本书里「一点一点地带」「软一点」满地都是。
 *     所以钟点只在两种情况下才算：后面真的跟了分钟，或者前面真的跟了时段词。
 *     光杆的「十点钟」不认也没关系，「点」本来就不在量纲表里，它不会污染计数，
 *     只是第三节那张备查表会少几行。
 *
 * 三、中文小数也用「点」。「通高二十七点三」「直径十四点二公分」不是钟点，是尺寸。
 *     所以钟点后面还要挡一道量纲前瞻——后面跟着公分、毫米这类词的，一律不是时间。
 *     这一条是 --value=十七 那个视图翻出来的：二十七点三被当成「二十七点三分」吃掉了。
 *
 * 真正**必须**挖的其实只有四位年份一条——「年」是量纲，不挖的话二〇一九年会被当成
 * 2019 年这个时长。其余几条是为了第三节看着干净，不影响第一节的账。
 */
const NOT_A_CLOCK = `(?!\\s*(?:${UNIT_ALT}))`

/**
 * 光靠量纲前瞻救不了「通高二十七点三，口径九点六」——后面跟的是逗号，不是量词。
 * 所以钟点还要过一道**合法性**检查：钟头超过二十四的，那就不是钟点，是小数。
 */
const looksLikeClock = (m) => {
  const hour = cnToNum(m.replace(/^(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|半夜)/, '').split('点')[0])
  return hour !== null && hour <= 24
}

const DATE_TIME = [
  { re: /[〇零一二三四五六七八九]{4}年(?:[〇零一二三四五六七八九十]+月)?(?:[〇零一二三四五六七八九十]+日)?/g },
  { re: /(?:19|20)\d{2}\s*年(?:\s*\d+\s*月)?(?:\s*\d+\s*日)?/g },
  { re: new RegExp(`[${CN_CHARS}]+月[${CN_CHARS}]+日`, 'g') },
  { re: new RegExp(`[〇零一二三四五六七八九十]{1,3}点[〇零一二三四五六七八九十]{1,3}分?(?![〇零一二三四五六七八九十点])${NOT_A_CLOCK}`, 'g'), check: looksLikeClock },
  { re: new RegExp(`(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|半夜)[〇零一二三四五六七八九十]{1,3}点(?:半|钟)?(?![〇零一二三四五六七八九十点分])${NOT_A_CLOCK}`, 'g'), check: looksLikeClock },
  { re: /\d{1,2}:\d{2}/g },
]

function maskDateTime(line) {
  let out = line
  const found = []
  for (const { re, check } of DATE_TIME) {
    out = out.replace(re, (m) => {
      if (check && !check(m)) return m
      found.push(m)
      return ' '.repeat(m.length)
    })
  }
  return { masked: out, found }
}

// ── 扫描 ──────────────────────────────────────────────

/** 「第007章-矫形.md」→ 7；章纲那边靠正文里的 `### 第 N 章` 标题 */
const chapterOfFile = (file) => {
  const m = /第\s*0*(\d+)\s*章/.exec(file)
  return m ? Number(m[1]) : null
}

/**
 * 收两层：顶层的 .md，加一层子目录里的 .md。应用新建的作品一定落在子目录里，
 * 只 readdir 一层的话它们一个字都扫不到。
 *
 * **下划线开头的目录跳过。** 这个仓库里下划线开头就表示「不是正常内容」——
 * `02-大纲/章纲/_加厚暂存/` 装的是还没并进主章纲的加厚稿，收进来会把卷五整段重复计一遍。
 */
async function collectFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (entry.name.endsWith('.md') && entry.name !== '_book.md') out.push(entry.name)
      continue
    }
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    for (const sub of await readdir(join(dir, entry.name), { withFileTypes: true })) {
      if (!sub.isFile() || !sub.name.endsWith('.md') || sub.name === '_book.md') continue
      out.push(`${entry.name}/${sub.name}`)
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
}

/** value -> unit -> [{ chapter, text }] */
const hits = new Map()
const dateHits = []
let scannedFiles = 0
let scannedChapters = 0
let ambientSkipped = 0

function record(value, unit, chapter, text) {
  if (!hits.has(value)) hits.set(value, new Map())
  const byUnit = hits.get(value)
  if (!byUnit.has(unit)) byUnit.set(unit, [])
  byUnit.get(unit).push({ chapter, text })
}

/**
 * 环境常数不算复用。这是 2026-08-15 总编在名词表「重复数字」表里的裁定：
 * 「地下二层恒温十九度、地下三层十七度是**同一个事实反复出现**，不是同一个数被反复使用。」
 * 不滤掉它，十九那一行会被十几处恒温撑起来，看着像重灾区，其实全是同一句环境描写。
 */
const AMBIENT = /(?:恒温|室温|温度|湿度)\s*$/
const isAmbient = (text, index) => AMBIENT.test(text.slice(Math.max(0, index - 4), index))

function scanLine(line, chapter) {
  const { masked, found } = maskDateTime(line)
  for (const f of found) dateHits.push({ chapter, raw: f })

  // 当量词用的「两」先切走，见 LIANG_AS_UNIT 上面那段。切不出数就原样留给主扫描
  const body = masked.replace(LIANG_AS_UNIT, (m, head) => {
    const n = cnToNum(head)
    if (n === null || n === 0) return m
    record(n, '两', chapter, line.trim())
    return ' '.repeat(m.length)
  })

  for (const m of body.matchAll(NUM_CN)) {
    const n = cnToNum(m[1])
    if (n === null || n === 0) continue
    if (isAmbient(body, m.index)) { ambientSkipped++; continue }
    record(n, UNITS.find(([raw]) => raw === m[2])[1], chapter, line.trim())
  }
  for (const m of body.matchAll(NUM_AR)) {
    if (isAmbient(body, m.index)) { ambientSkipped++; continue }
    record(Number(m[1]), UNITS.find(([raw]) => raw === m[2])[1], chapter, line.trim())
  }
  for (const m of body.matchAll(PERCENT)) {
    record(Number(m[1]), '%', chapter, line.trim())
  }
}

async function scanDir(dir, splitByHeading) {
  for (const file of await collectFiles(dir)) {
    scannedFiles++
    const text = await readText(join(dir, file))
    let chapter = chapterOfFile(file)
    if (chapter !== null) scannedChapters++
    for (const line of text.split('\n')) {
      if (splitByHeading) {
        const m = /^#{2,4}\s*第\s*(\d+)\s*章/.exec(line.trim())
        if (m) {
          chapter = Number(m[1])
          scannedChapters++
        }
      }
      scanLine(line, chapter)
    }
  }
}

// ── 输出 ──────────────────────────────────────────────

/** 报给写字的人看，中文比阿拉伯顺眼；「三千年」写成 3000 年会读断 */
const CN = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']
function numToCn(n) {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n)
  if (n < 10) return CN[n]
  if (n < 100) {
    const t = Math.floor(n / 10)
    const o = n % 10
    return `${t === 1 ? '' : CN[t]}十${o ? CN[o] : ''}`
  }
  const parts = []
  const th = Math.floor(n / 1000)
  const hu = Math.floor((n % 1000) / 100)
  const rest = n % 100
  if (th) parts.push(`${CN[th]}千`)
  if (hu) parts.push(`${CN[hu]}百`)
  else if (th && rest) parts.push('零')
  if (rest) parts.push(rest < 10 ? `零${CN[rest]}` : numToCn(rest))
  return parts.join('')
}

const label = (n) => (Number.isInteger(n) && n <= 9999 ? `${numToCn(n)}（${n}）` : String(n))
const chapterList = (list) => {
  const nums = [...new Set(list.map((h) => h.chapter).filter((c) => c !== null))].sort((a, b) => a - b)
  if (!nums.length) return '—'
  const shown = nums.slice(0, 8).map((c) => `第 ${c} 章`).join('、')
  return nums.length > 8 ? `${shown} 等 ${nums.length} 章` : shown
}

async function main() {
  const scanOutline = flag('outline') || flag('all')
  const scanContent = !flag('outline') || flag('all')

  const where = []
  if (scanContent) {
    await scanDir(CONTENT_DIR, false)
    where.push(CONTENT_DIR)
  }
  if (scanOutline) {
    await scanDir(OUTLINE_DIR, true)
    where.push(OUTLINE_DIR)
  }

  console.log('\n全书重复数字')
  console.log('='.repeat(76))
  console.log(`扫描范围：${where.join('、')}　共 ${scannedFiles} 个文件、${scannedChapters} 章`)
  console.log('判定：同一个数值配上两种以上不同的量纲，算一次「同数复用」。')
  console.log('日期与时刻已挖掉不计——它们与测量值撞车的观感弱得多，单列在最后。')
  console.log(`环境常数（恒温十九度这类）已按名词表「重复数字」表的裁定滤掉，本轮滤了 ${ambientSkipped} 处。`)

  // ── 只看一个数 ──
  if (ONLY_VALUE !== null) {
    const target = /^\d+(\.\d+)?$/.test(ONLY_VALUE) ? Number(ONLY_VALUE) : cnToNum(ONLY_VALUE)
    console.log(`\n只看 ${ONLY_VALUE}（${target}）`)
    console.log('-'.repeat(76))
    const byUnit = hits.get(target)
    if (!byUnit) {
      console.log('  正文里没有这个数配任何量词。')
    } else {
      for (const [unit, list] of [...byUnit].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`\n  【${unit}】${list.length} 处`)
        for (const h of list) {
          const t = h.text.length > 58 ? `${h.text.slice(0, 58)}…` : h.text
          console.log(`    第 ${String(h.chapter ?? '?').padStart(3)} 章  ${t}`)
        }
      }
    }
    const dts = dateHits.filter((d) => new RegExp(`${ONLY_VALUE}`).test(d.raw))
    if (dts.length) {
      console.log(`\n  【日期与时刻，不计入】${dts.length} 处`)
      for (const d of [...new Set(dts.map((d) => `第 ${d.chapter} 章  ${d.raw}`))]) console.log(`    ${d}`)
    }
    console.log('')
    return
  }

  // ── 同数复用总表 ──
  const rows = [...hits.entries()]
    .map(([value, byUnit]) => ({
      value,
      kinds: byUnit.size,
      total: [...byUnit.values()].reduce((s, l) => s + l.length, 0),
      byUnit,
    }))
    .filter((r) => r.kinds >= MIN_KINDS && r.value >= MIN_VALUE)
    .sort((a, b) => b.kinds - a.kinds || b.total - a.total || a.value - b.value)

  console.log(`\n一、同数复用（${MIN_VALUE} 以上、量纲 ${MIN_KINDS} 种以上，按种数排）`)
  console.log('-'.repeat(76))
  if (MIN_VALUE > 1) {
    console.log(`  小于 ${MIN_VALUE} 的数不列：汉语里「一件」「三道」的一二三是不定冠词不是数量，`)
    console.log('  列出来只会把有辨识度的数埋掉。要看全的传 --from=1。')
  }
  if (!rows.length) {
    console.log('\n  一个都没有。')
  }
  for (const r of rows) {
    console.log(`\n  ${label(r.value)}　${r.kinds} 种量纲，共 ${r.total} 处`)
    for (const [unit, list] of [...r.byUnit].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`      ${`${unit}`.padEnd(6)}${String(list.length).padStart(2)} 处　${chapterList(list)}`)
    }
  }

  // ── 用得最多的数 ──
  const busiest = [...hits.entries()]
    .map(([value, byUnit]) => ({ value, total: [...byUnit.values()].reduce((s, l) => s + l.length, 0) }))
    .filter((b) => b.value >= MIN_VALUE)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  console.log(`\n\n二、出现次数最多的十个数（${MIN_VALUE} 以上，不分量纲）`)
  console.log('-'.repeat(76))
  for (const b of busiest) console.log(`  ${label(b.value).padEnd(14)}${String(b.total).padStart(3)} 处`)

  // ── 日期时刻 ──
  const dtByRaw = new Map()
  for (const d of dateHits) {
    if (!dtByRaw.has(d.raw)) dtByRaw.set(d.raw, new Set())
    dtByRaw.get(d.raw).add(d.chapter)
  }
  const dtRows = [...dtByRaw.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 12)
  console.log('\n\n三、日期与时刻（挖掉了，只列出来备查）')
  console.log('-'.repeat(76))
  for (const [raw, chs] of dtRows) {
    const nums = [...chs].filter((c) => c !== null).sort((a, b) => a - b)
    console.log(`  ${raw.padEnd(20)}${String(nums.length).padStart(2)} 章　${nums.slice(0, 8).map((c) => `第 ${c} 章`).join('、')}`)
  }

  console.log('\n' + '='.repeat(76))
  if (MAX_KINDS === null) {
    console.log('这个脚本只摊账，不下判断——同数复用是不是母题，由总编定。')
    console.log('定了以后用 --max=N 把结论钉成一条会失败的检查。')
    console.log('想看某一个数的每一处原句：--value=十七')
  } else {
    const over = rows.filter((r) => r.kinds > MAX_KINDS)
    if (over.length === 0) {
      console.log(`重复数字：干净。没有数超过 ${MAX_KINDS} 种量纲。`)
    } else {
      console.log(`重复数字：${over.length} 个数超过了 ${MAX_KINDS} 种量纲的上限：`)
      for (const r of over) console.log(`  ! ${label(r.value)} 用了 ${r.kinds} 种量纲`)
      process.exitCode = 1
    }
  }
  console.log('')
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
