#!/usr/bin/env node
// 正文体检。两部分：
// 1) 装饰检查——番茄/起点的编辑器不解析 markdown，正文里留一个符号就砸在读者脸上
// 2) 结构检查——章节序号、标题格式、文件名与标题是否对得上
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FIX = process.argv.includes('--fix')
const dirArg = process.argv.find((a) => a.startsWith('--dir='))
const CONTENT_DIR = dirArg ? dirArg.slice('--dir='.length) : '03-正文'

const SCENE_BREAK = '※　※　※'
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
    label: '分隔线',
    canFix: true,
    test: (line) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line),
    fix: () => SCENE_BREAK,
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

  if (FIX) {
    console.log(`\n已修改 ${fixedFiles} 个文件。标 ! 的需要手工改，脚本不碰。`)
    console.log('请人工过一遍 diff，然后重跑一次不带 --fix 的检查确认干净。')
    return
  }

  if (total > 0 || structure.length > 0) {
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
