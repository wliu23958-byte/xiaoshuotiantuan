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

function structureIssues(files, contents) {
  const issues = []
  const seen = new Map()

  for (const file of files) {
    const parsed = parseFileName(file)
    if (!parsed) {
      issues.push(`${file}：文件名不符合「第NNN章-标题.md」，序号要三位补零`)
      continue
    }
    if (seen.has(parsed.seq)) {
      issues.push(`第 ${parsed.seq} 章序号重复：${seen.get(parsed.seq)} 与 ${file}`)
    }
    seen.set(parsed.seq, file)

    const lines = contents.get(file).split('\n')
    const hasFrontmatter = frontmatterEnd(lines) > 0

    if (hasFrontmatter) {
      if (!lines.some((l) => /^标题\s*[:：]/.test(l))) {
        issues.push(`${file}：有 frontmatter 但缺 标题 字段`)
      }
      continue
    }

    const heading = parseHeading(lines[0])
    if (!heading) {
      issues.push(`${file}：首行不是「# 第N章　标题」，也没有 frontmatter`)
      continue
    }
    if (!heading.gap.includes(IDEOGRAPHIC_SPACE)) {
      issues.push(`${file}：标题里「${heading.chapter}」和「${heading.title}」之间要用全角空格`)
    }
    if (heading.title !== parsed.title) {
      issues.push(`${file}：文件名的「${parsed.title}」与标题的「${heading.title}」对不上`)
    }
  }

  const nums = [...seen.keys()].sort((a, b) => a - b)
  for (let i = 1; i < nums.length; i++) {
    const gap = nums[i] - nums[i - 1]
    if (gap > 1) {
      issues.push(`第 ${nums[i - 1]} 章与第 ${nums[i]} 章之间断号，缺 ${gap - 1} 章`)
    }
  }

  return issues
}

async function main() {
  let files
  try {
    files = (await readdir(CONTENT_DIR)).filter((f) => f.endsWith('.md') && f !== '_book.md')
  } catch {
    console.error(`读不到目录：${CONTENT_DIR}`)
    console.error('请在仓库根目录运行，或用 --dir=路径 指定正文目录。')
    process.exit(2)
  }

  files.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))

  const contents = new Map()
  for (const file of files) {
    contents.set(file, await readFile(join(CONTENT_DIR, file), 'utf8'))
  }

  let total = 0
  let fixedFiles = 0
  const tally = new Map()

  for (const file of files) {
    const lines = contents.get(file).split('\n')
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
      console.log(`\n${file}`)
      for (const h of hits) {
        const mark = h.fixable ? ' ' : '!'
        const text = h.text.length > 60 ? `${h.text.slice(0, 60)}…` : h.text
        console.log(`  ${mark} 第 ${String(h.line).padStart(4)} 行  ${h.label}  ${text}`)
      }
    }

    if (changed) {
      const next = lines.join('\n')
      contents.set(file, next)
      await writeFile(join(CONTENT_DIR, file), next, 'utf8')
      fixedFiles++
    }
  }

  const structure = structureIssues(files, contents)

  console.log('\n' + '─'.repeat(52))

  if (total === 0) {
    console.log('装饰检查：干净，正文里没有 markdown 符号。')
  } else {
    console.log('装饰检查：')
    for (const [label, count] of [...tally].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${label}：${count} 处`)
    }
    console.log(`  合计 ${total} 处，涉及 ${files.length} 个文件`)
  }

  if (structure.length === 0) {
    console.log(`结构检查：干净，${files.length} 章序号连续、标题与文件名一致。`)
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
