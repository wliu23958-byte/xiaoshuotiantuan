#!/usr/bin/env node
// 正文体检。两部分：
// 1) 装饰检查——番茄/起点的编辑器不解析 markdown，正文里留一个符号就砸在读者脸上
// 2) 结构检查——章节序号、标题格式、文件名与标题是否对得上
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FIX = process.argv.includes('--fix')
const dirArg = process.argv.find((a) => a.startsWith('--dir='))
const CONTENT_DIR = dirArg ? dirArg.slice('--dir='.length) : '03-正文'

/**
 * 场景分隔符（2026-08-15 起禁用）。
 *
 * 这一行以前是「把 --- 换成 ※　※　※」的目标，现在反过来了：**正文里不许有任何场景分隔符**，
 * 换场直接另起一段，靠文字自己交代。理由是它在阅读器里就是一行孤零零的符号，
 * 而这本书的段落之间本来就空一行，分隔符并不多给读者任何东西。
 *
 * 整行只有 ※ ＊ * 及其间隔的，一律算分隔符。
 */
const SCENE_BREAK_LINE = /^[\s\u3000]*[※＊*][\s\u3000※＊*]*$/
const IDEOGRAPHIC_SPACE = '\u3000'
const BOOK_FILE = '_book.md'

/** BOM 会粘在首行开头，让 frontmatter 的 --- 与「# 第N章」双双失配，报一堆假的结构问题 */
const readText = async (path) => (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')

const byName = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true })

/**
 * 内容目录是两层：顶层的 .md 属于「平铺作品」，一层子目录各自是一部作品。
 * 层数与 `src/lib/content.ts` 的加载器对齐，再深一层加载器就不认了，这里也不认。
 *
 * 早先这里只 readdir 一层，于是**凡是从应用里新建的作品全在检查之外**——
 * addNovel 一定会给它建一个子目录，而这个脚本一眼都不会看那里面。
 * 现在没出事只是因为《合缝》是平铺的。
 */
async function listChapters(root) {
  const out = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (entry.name.endsWith('.md') && entry.name !== BOOK_FILE) {
        out.push({ dir: '', file: entry.name, rel: entry.name })
      }
      continue
    }
    // 下划线开头的目录在这个仓库里表示「不是正常内容」（_加厚暂存 那种暂存区）
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    for (const sub of await readdir(join(root, entry.name), { withFileTypes: true })) {
      if (!sub.isFile() || !sub.name.endsWith('.md') || sub.name === BOOK_FILE) continue
      out.push({ dir: entry.name, file: sub.name, rel: `${entry.name}/${sub.name}` })
    }
  }
  return out.sort((a, b) => byName(a.dir, b.dir) || byName(a.file, b.file))
}

const DECORATION_RULES = [
  {
    label: '加粗',
    canFix: true,
    test: (line) => /\*\*[^*]+\*\*|__[^_]+__/.test(line),
    fix: (line) => line.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1'),
  },
  {
    // 以前这一条的 fix 是把 --- 换成 ※　※　※，现在是直接删掉整行。
    // 换成分隔符只是把一种符号换成另一种，读者看见的还是一行符号。
    label: '分隔线',
    canFix: true,
    test: (line) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line),
    fix: () => '',
  },
  {
    // 正文里不许有场景分隔符。换场另起一段，不给符号。
    label: '场景分隔符',
    canFix: true,
    test: (line) => line.trim() !== '' && SCENE_BREAK_LINE.test(line),
    fix: () => '',
  },
  {
    label: '引用块',
    canFix: true,
    test: (line) => /^\s*>/.test(line),
    fix: (line) => line.replace(/^\s*>\s?/, ''),
  },
  {
    label: '正文中的标题',
    canFix: false,
    test: (line, i) => i > 0 && /^#{1,6}\s/.test(line),
  },
  {
    label: '斜体',
    canFix: false,
    test: (line) => /(^|[^*])\*[^*\s][^*]*\*([^*]|$)/.test(line),
  },
  {
    label: '列表',
    canFix: false,
    test: (line) => /^\s*([-+*]\s+|\d+\.\s+)/.test(line),
  },
  { label: '反引号', canFix: false, test: (line) => line.includes('`') },
  {
    // 2026-08-16 加。全书 8470 处半角双引号已一次性转全角，这一条防的是往回退。
    // canFix: false —— --fix 会写回整个 03-正文/，而这一条的正确修法是逐章确认奇偶再转，
    // 不是逐行替换：一行里替错一个，左右引号就整段错位。
    label: '半角引号',
    canFix: false,
    test: (line) => /["']/.test(line),
  },
  {
    /**
     * 半角标点。2026-08-21 加。
     *
     * 上面那一条只查半角引号，**逗号、分号、冒号、叹号、问号一个都没查过**。
     * 而审校那边一直把它当成「机检盲区」在每轮手扫——扫的是一个机检本来就不查的东西，
     * 五个人各扫各的，没有一个人回头看过脚本到底有没有这一项。
     *
     * 上线前总编拿裸字符集 `[,;:!?]` 全书扫过一遍做基线：**命中 6 行，全部合法，全在卷一，
     * 全是电子钟读数**（001:35 的 00:17、004:98 的 14:41、008:4 的 01:52、010:107 的 19:22、
     * 013:93 的 14:03、015:86 的 16:47）。半角逗号、分号、叹号、问号全书零命中。
     *
     * **所以只给冒号开一个口子：两侧都是数字才放行。** 这一条不写成「冒号一律放行」，
     * 是因为那样会把「他说:」这种真正该报的漏掉；也不写成「时:分 才放行」，
     * 因为秒、比分、比例都是同一个形状，多加限定只会让规则自己长出例外。
     *
     * canFix: false —— 半角改全角要看上下文。逗号可能该是「，」也可能该是「、」，
     * 问号叹号在对白里和在旁白里的处置不一样，**没有一条能闭着眼睛替换的**。
     */
    label: '半角标点',
    canFix: false,
    test: (line) => /[,;!?]|(?<!\d):|:(?!\d)/.test(line),
  },
]

/** frontmatter 里的 --- 和字段不是正文，整段跳过 */
function frontmatterEnd(lines) {
  if (lines[0]?.trim() !== '---') return 0
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  return close === -1 ? 0 : close + 1
}

/** 文件名形如 第001章-断口.md */
function parseFileName(name) {
  const matched = /^第(\d+)章-(.+)\.md$/.exec(name)
  return matched ? { seq: Number(matched[1]), title: matched[2] } : null
}

/** 首行形如 # 第一章　断口（全角空格分隔） */
function parseHeading(line) {
  const matched = /^#\s+(\S+?章)([\s\u3000]+)(.+?)\s*$/.exec(line ?? '')
  return matched ? { chapter: matched[1], gap: matched[2], title: matched[3] } : null
}

/**
 * 段间空行。全书体例是段与段直接相接，通篇只有首行标题后那一个空行。
 *
 * 2026-08-18 加。185~190 六章是逐段空行写的（各 107~135 个空行），其余 194 章一律 2 个，
 * 而上面七条装饰规则一条都不报——**它不是 markdown 装饰，是排版不一致**，
 * 此前没有任何机检看这一层，是靠人翻文件翻出来的。
 *
 * **按文件报一行计数，不逐行报。** 一章一百多个空行，逐行报会把别的问题全冲掉，
 * 那等于用一个新检查把已有的几个检查废掉。
 */
function blankLineIssues(chapters, contents) {
  const issues = []
  for (const { rel } of chapters) {
    const lines = contents.get(rel).split('\n')
    const start = frontmatterEnd(lines)
    let extra = 0
    for (let i = start; i < lines.length; i++) {
      if (lines[i].trim() !== '') continue
      if (i === start + 1) continue // 标题后那一个，体例要求有
      if (i === lines.length - 1) continue // 文件末尾换行留下的那一个
      extra++
    }
    if (extra > 0) {
      issues.push(`${rel} 有 ${extra} 个多余的段间空行——全书体例是段与段不空行，只留标题后那一个`)
    }
  }
  return issues
}

/** 序号连续与重复是一部作品之内的事，两部作品各有一个第 1 章不是错，所以按目录分组查 */
function structureIssues(chapters, contents) {
  const issues = []
  const byDir = new Map()
  for (const c of chapters) {
    if (!byDir.has(c.dir)) byDir.set(c.dir, [])
    byDir.get(c.dir).push(c)
  }

  for (const [dir, group] of byDir) {
    const where = dir ? `${dir}/` : ''
    const seen = new Map()

    for (const c of group) {
      const parsed = parseFileName(c.file)
      if (!parsed) {
        issues.push(`${c.rel}：文件名不符合「第NNN章-标题.md」，序号要三位补零`)
        continue
      }
      if (seen.has(parsed.seq)) {
        issues.push(`${where}第 ${parsed.seq} 章序号重复：${seen.get(parsed.seq)} 与 ${c.file}`)
      }
      seen.set(parsed.seq, c.file)

      const lines = contents.get(c.rel).split('\n')
      const hasFrontmatter = frontmatterEnd(lines) > 0

      if (hasFrontmatter) {
        if (!lines.some((l) => /^标题\s*[:：]/.test(l))) {
          issues.push(`${c.rel}：有 frontmatter 但缺 标题 字段`)
        }
        continue
      }

      const heading = parseHeading(lines[0])
      if (!heading) {
        issues.push(`${c.rel}：首行不是「# 第N章　标题」，也没有 frontmatter`)
        continue
      }
      if (!heading.gap.includes(IDEOGRAPHIC_SPACE)) {
        issues.push(`${c.rel}：标题里「${heading.chapter}」和「${heading.title}」之间要用全角空格`)
      }
      if (heading.title !== parsed.title) {
        issues.push(`${c.rel}：文件名的「${parsed.title}」与标题的「${heading.title}」对不上`)
      }
    }

    const nums = [...seen.keys()].sort((a, b) => a - b)
    for (let i = 1; i < nums.length; i++) {
      const gap = nums[i] - nums[i - 1]
      if (gap > 1) {
        issues.push(`${where}第 ${nums[i - 1]} 章与第 ${nums[i]} 章之间断号，缺 ${gap - 1} 章`)
      }
    }
  }

  return issues
}

async function main() {
  let chapters
  try {
    chapters = await listChapters(CONTENT_DIR)
  } catch {
    console.error(`读不到目录：${CONTENT_DIR}`)
    console.error('请在仓库根目录运行，或用 --dir=路径 指定正文目录。')
    process.exit(2)
  }

  const contents = new Map()
  for (const c of chapters) {
    contents.set(c.rel, await readText(join(CONTENT_DIR, c.rel)))
  }

  let total = 0
  let fixedFiles = 0
  const tally = new Map()

  for (const { rel } of chapters) {
    const lines = contents.get(rel).split('\n')
    const start = frontmatterEnd(lines)
    const hits = []
    let changed = false

    for (let i = start; i < lines.length; i++) {
      for (const rule of DECORATION_RULES) {
        if (!rule.test(lines[i], i)) continue

        hits.push({ line: i + 1, label: rule.label, text: lines[i].trim(), fixable: rule.canFix })
        tally.set(rule.label, (tally.get(rule.label) ?? 0) + 1)
        total++

        if (FIX && rule.canFix) {
          lines[i] = rule.fix(lines[i])
          changed = true
        }
      }
    }

    if (hits.length > 0) {
      console.log(`\n${rel}`)
      for (const h of hits) {
        const mark = h.fixable ? ' ' : '!'
        const text = h.text.length > 60 ? `${h.text.slice(0, 60)}…` : h.text
        console.log(`  ${mark} 第 ${String(h.line).padStart(4)} 行  ${h.label}  ${text}`)
      }
    }

    if (changed) {
      const next = lines.join('\n')
      contents.set(rel, next)
      await writeFile(join(CONTENT_DIR, rel), next, 'utf8')
      fixedFiles++
    }
  }

  const structure = structureIssues(chapters, contents)
  const books = new Set(chapters.map((c) => c.dir)).size
  const scope = books > 1 ? `${books} 部作品共 ${chapters.length} 章` : `${chapters.length} 章`

  console.log('\n' + '─'.repeat(52))

  if (total === 0) {
    console.log('装饰检查：干净，正文里没有 markdown 符号。')
  } else {
    console.log('装饰检查：')
    for (const [label, count] of [...tally].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${label}：${count} 处`)
    }
    console.log(`  合计 ${total} 处，涉及 ${chapters.length} 个文件`)
  }

  if (structure.length === 0) {
    console.log(`结构检查：干净，${scope}序号连续、标题与文件名一致。`)
  } else {
    console.log('结构检查：')
    for (const issue of structure) console.log(`  ! ${issue}`)
  }

  const blanks = blankLineIssues(chapters, contents)
  if (blanks.length === 0) {
    console.log('段落检查：干净，段与段之间没有多余空行。')
  } else {
    console.log(`段落检查：${blanks.length} 章`)
    for (const issue of blanks) console.log(`  ! ${issue}`)
  }

  if (FIX) {
    console.log(`\n已修改 ${fixedFiles} 个文件。标 ! 的需要手工改，脚本不碰。`)
    console.log('请人工过一遍 diff，然后重跑一次不带 --fix 的检查确认干净。')
    return
  }

  if (total > 0 || structure.length > 0 || blanks.length > 0) {
    if (total > 0) {
      console.log('\n带 ! 的必须手工改。加粗、分隔线、引用块可以自动处理：')
      console.log('  node .cursor/skills/novel-chapter-format/scripts/check-format.mjs --fix')
    }
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
