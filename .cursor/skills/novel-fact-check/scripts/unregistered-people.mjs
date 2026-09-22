#!/usr/bin/env node
// 人名漏网体检。check-facts.mjs 的 checkShenNames 只验沈姓，抓不到别人。
//
// 为什么要单独有这一个：名词表「人物」一节开头写着「正文里出现的人名必须在这张表里」，
// 可机检只认沈姓，于是有姓、有台词、甚至签了字的人也能长期躺在表外。
// 已经这么漏过三次——何同志（41~60 章）、小徐（61~70 章）、乔副馆长（37~39 章），
// 三次都是靠人肉查重时顺手撞见的。第四次不该再靠运气。
//
// 它不进 `npm run check`，退出码恒为 0：这是一份报告，不是一道门禁。
// 判「像不像人名」没法做到零误报，拿它去拦提交只会教人学会忽略它。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CONTENT_DIR = '03-正文'
const GLOSSARY = '01-设定/名词表.md'

const readText = async (path) => (await readFile(path, 'utf8')).replace(/^\uFEFF/, '')

/** 与 check-facts.mjs 的 tableUnder 同源，改一处会两处都要改，别只改一边 */
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
    if (!seenHeader) {
      seenHeader = true
      continue
    }
    rows.push(cells)
  }
  return rows
}

const plain = (s) => (s ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim()

/**
 * 百家姓取常用的一批。**宁可少收，不可多收**——
 * 漏一个姓只是这一轮没报，多收一个（比如「和」「有」）会把每一章都刷成误报，
 * 那样这份报告就没人看了，等于没有。
 */
const SURNAMES = [
  '赵','钱','孙','李','周','吴','郑','王','冯','陈','褚','卫','蒋','沈','韩','杨',
  '朱','秦','尤','许','何','吕','施','张','孔','曹','严','华','金','魏','陶','姜',
  '戚','谢','邹','喻','柏','窦','章','苏','潘','葛','奚','范','彭','郎','鲁','韦',
  '昌','马','苗','凤','花','方','俞','任','袁','柳','酆','鲍','史','唐','费','廉',
  '岑','薛','雷','贺','倪','汤','滕','殷','罗','毕','郝','邬','安','常','乐','于',
  '傅','皮','齐','康','伍','余','元','卜','顾','孟','平','黄','和','穆','萧','尹',
  '姚','邵','湛','汪','祁','毛','禹','狄','米','贝','明','臧','计','伏','成','戴',
  '谈','宋','茅','庞','熊','纪','舒','屈','项','祝','董','梁','杜','阮','蓝','闵',
  '席','季','麻','强','贾','路','娄','危','江','童','颜','郭','梅','盛','林','刁',
  '钟','徐','邱','骆','高','夏','蔡','田','樊','胡','凌','霍','虞','万','支','柯',
  '管','卢','莫','房','裘','缪','干','解','应','宗','丁','宣','贲','邓','郁','单',
  '杭','洪','包','诸','左','石','崔','吉','钮','龚','程','嵇','邢','滑','裴','陆',
  '荣','翁','荀','羊','于','惠','甄','曲','封','芮','羿','储','靳','汲','邴','糜',
  '松','井','段','富','巫','乌','焦','巴','弓','牧','隗','山','谷','车','侯','宓',
  '蓬','全','郗','班','仰','秋','仲','伊','宫','宁','仇','栾','暴','甘','钭','厉',
  '戎','祖','武','符','刘','景','詹','束','龙','叶','幸','司','韶','郜','黎','蓟',
  '薄','印','宿','白','怀','蒲','邰','从','鄂','索','咸','籍','赖','卓','蔺','屠',
  '蒙','池','乔','阴','鬱','胥','能','苍','双','闻','莘','党','翟','谭','贡','劳',
  '逄','姬','申','扶','堵','冉','宰','郦','雍','却','璩','桑','桂','濮','牛','寿',
  '通','边','扈','燕','冀','郏','浦','尚','农','温','别','庄','晏','柴','瞿','阎',
  '充','慕','连','茹','习','宦','艾','鱼','容','向','古','易','慎','戈','廖','庾',
  '终','暨','居','衡','步','都','耿','满','弘','匡','国','文','寇','广','禄','阙',
  '东','欧','殳','沃','利','蔚','越','夔','隆','师','巩','厍','聂','晁','勾','敖',
  '融','冷','訾','辛','阚','那','简','饶','空','曾','毋','沙','乜','养','鞠','须',
  '丰','巢','关','蒯','相','查','后','荆','红','游','竺','权','逯','盖','益','桓','公',
]

/**
 * 职务后缀。长的排前面，匹配时先试长的——
 * 否则「乔副馆长」会被「馆长」切成「副馆长」，把姓丢掉。
 */
const TITLES = [
  '副馆长','副主任','副支队长','副所长','副院长','副处长','副部长','副科长','副队长',
  '保管员','工程师','研究员','老先生','老太太','支队长','技术员','管理员','馆长',
  '主任','所长','院长','处长','部长','科长','队长','局长','厂长','校长','师傅',
  '同志','教授','博士','医生','大夫','警官','干事','老师','工人','技工','律师',
  '经理','老板','阿姨','大爷','大娘','先生','女士','小姐','师父','师兄','师姐',
]

/** 「小X」「老X」这类称呼里，X 是姓 */
const PREFIXES = ['小', '老']

async function listChapters(root) {
  const out = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (entry.name.endsWith('.md') && entry.name !== '_book.md') out.push(entry.name)
      continue
    }
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    for (const sub of await readdir(join(root, entry.name), { withFileTypes: true })) {
      if (!sub.isFile() || !sub.name.endsWith('.md') || sub.name === '_book.md') continue
      out.push(`${entry.name}/${sub.name}`)
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
}

const chapterNo = (file) => {
  const m = /第(\d+)章/.exec(file)
  return m ? Number(m[1]) : 0
}

async function main() {
  const glossary = await readText(GLOSSARY)
  const people = tableUnder(glossary, '人物').map((r) => plain(r[0]))
  const known = new Set(people)
  // 「未命名，正文以职务指代（…）」那几行登的不是称呼本身，正文里叫的是职务。
  // 把括号里的职务也收进来，免得把它们报成漏网。
  // 「小周（刑警）」这类带限定的行同理，正文里叫的是「小周」。
  for (const name of people) {
    for (const m of name.matchAll(/（([^）]+)）/g)) known.add(m[1])
    const bare = name.replace(/（[^）]*）/g, '').trim()
    if (bare) known.add(bare)
  }

  /**
   * 别称表。**没有这一段，这份报告就没有用**——
   * 「小沈」「周主任」这些每次都会被报出来，十来条常驻噪音会让人学会跳过整份报告，
   * 于是真正的新漏网夹在里面也没人看见。清单在名词表里，不在这个文件里。
   */
  const aliasRows = tableUnder(glossary, '上表这些人的别称')
  for (const row of aliasRows) {
    for (const alias of plain(row[0]).split('/')) {
      const name = alias.trim()
      if (name) known.add(name)
    }
  }

  const surnames = new Set(SURNAMES)
  const files = await listChapters(CONTENT_DIR)

  // 称呼 → { count, files:Set }
  const found = new Map()
  const record = (name, file) => {
    if (!found.has(name)) found.set(name, { count: 0, files: new Set() })
    const hit = found.get(name)
    hit.count++
    hit.files.add(file)
  }

  for (const file of files) {
    const text = await readText(join(CONTENT_DIR, file))

    for (const title of TITLES) {
      // 前一个字是姓，且姓的前面不能再是汉字（挡掉「保管部主任」这类纯职务）
      const re = new RegExp(`([\\u4e00-\\u9fff])${title}`, 'g')
      for (const m of text.matchAll(re)) {
        const surname = m[1]
        if (!surnames.has(surname)) continue
        const before = m.index > 0 ? text[m.index - 1] : ''
        if (/[\u4e00-\u9fff]/.test(before)) continue
        record(surname + title, file)
      }
    }

    for (const prefix of PREFIXES) {
      const re = new RegExp(`${prefix}([\\u4e00-\\u9fff])`, 'g')
      for (const m of text.matchAll(re)) {
        const surname = m[1]
        if (!surnames.has(surname)) continue
        const before = m.index > 0 ? text[m.index - 1] : ''
        const after = text[m.index + 2] ?? ''
        // 「老猫的」可以，「老李头」「小心」不行——后面再跟汉字多半是别的词
        if (/[\u4e00-\u9fff]/.test(before)) continue
        if (/[\u4e00-\u9fff]/.test(after)) continue
        record(prefix + surname, file)
      }
    }
  }

  const missing = [...found.entries()]
    .filter(([name]) => !known.has(name))
    .sort((a, b) => b[1].count - a[1].count)

  console.log('\n人名漏网体检')
  console.log('='.repeat(76))
  console.log(`扫描范围：${CONTENT_DIR}　共 ${files.length} 章。对照名词表「人物」表 ${people.length} 人。`)
  console.log('判定：正文里出现「姓+职务」或「小/老+姓」，而这个称呼不在人物表里。')
  console.log('**这是报告不是门禁，退出码恒为 0。** 误报一定有，逐条看，别照单全改。')

  if (missing.length === 0) {
    console.log('\n干净：没有查到表外的称呼。')
    return
  }

  console.log(`\n表外称呼 ${missing.length} 个\n`)
  console.log('  次数  称呼          出现章')
  console.log('  ' + '-'.repeat(72))
  for (const [name, hit] of missing) {
    const chapters = [...hit.files]
      .map(chapterNo)
      .filter(Boolean)
      .sort((a, b) => a - b)
    const shown = chapters.length > 8
      ? `${chapters.slice(0, 8).join('、')} 等 ${chapters.length} 章`
      : chapters.join('、')
    console.log(`  ${String(hit.count).padStart(4)}  ${name.padEnd(12)}  ${shown}`)
  }

  console.log('\n' + '─'.repeat(76))
  console.log('次数多、跨章多的排在前面——那种最可能是真漏网，一次性的多半是路人或误报。')
  console.log('确认是人物就去 01-设定/名词表.md 人物表加一行，体例照吴保管员、聂主任那几行。')
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
