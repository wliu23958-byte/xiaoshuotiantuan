import { Buffer } from 'node:buffer'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))
const CONTENT_ROOT = '03-正文'
const CONTENT_DIR = resolve(root, CONTENT_ROOT)

/** 目录名/文件名只允许出现在内容目录一层之内，挡掉 .. 与绝对路径 */
function safeSegment(value: unknown, { allowMd = false } = {}) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name === '.' || name === '..') return null
  if (/[\\/]/.test(name) || name.includes('\0')) return null
  if (allowMd && !name.endsWith('.md')) return null
  return name
}

/** 空 dir 表示内容根目录本身，对应"整个目录就是一部作品"的平铺写法 */
function resolveDir(value: unknown) {
  if (value === undefined || value === null || value === '') return CONTENT_DIR
  const name = safeSegment(value)
  return name ? join(CONTENT_DIR, name) : null
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLocalOrigin(origin: string) {
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

/** 键与 import.meta.glob 对齐，前端两条数据来源可以共用同一个解析函数 */
async function listContent() {
  const items: { path: string; text: string }[] = []
  let entries
  try {
    entries = await readdir(CONTENT_DIR, { withFileTypes: true })
  } catch {
    return items
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      items.push({
        path: `/${CONTENT_ROOT}/${entry.name}`,
        text: await readFile(join(CONTENT_DIR, entry.name), 'utf8'),
      })
      continue
    }
    if (!entry.isDirectory()) continue

    const files = await readdir(join(CONTENT_DIR, entry.name), { withFileTypes: true })
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue
      items.push({
        path: `/${CONTENT_ROOT}/${entry.name}/${file.name}`,
        text: await readFile(join(CONTENT_DIR, entry.name, file.name), 'utf8'),
      })
    }
  }
  return items
}

const BODY_LIMIT = 2_000_000

function readBody(req: Connect.IncomingMessage) {
  return new Promise<unknown>((done, fail) => {
    // 攒 Buffer 而不是 raw += chunk：后者按分片逐个解码，一个汉字正好被切在分片
    // 边界上就会解成乱码，而整章正文必然跨界。拼完再一次性解。
    const chunks: Buffer[] = []
    let size = 0
    let stopped = false

    req.on('data', (chunk: Buffer) => {
      if (stopped) return
      size += chunk.length
      if (size > BODY_LIMIT) {
        // 只 reject 是拦不住的，流还在继续往数组里灌。得把它按停并把已收的丢掉，
        // 否则超限之后内存照样跟着请求体一起涨。
        stopped = true
        chunks.length = 0
        req.pause()
        fail(new Error('请求体过大'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (stopped) return
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        fail(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', fail)
  })
}

/**
 * 让浏览器里的编辑动作直接落到 03-正文/ 目录，避免 localStorage 与文件成为两份事实。
 * 仅在 dev server 生效，生产构建是只读的。
 */
function contentWriter(): Plugin {
  return {
    name: 'xst-content-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__content', (req, res, next) => {
        const fail = (code: number, message: string) => {
          res.statusCode = code
          res.end(message)
        }

        // 开发时浏览器里的任意页面都能往 localhost 发跨源请求，副作用会在 CORS 拦下响应之前
        // 就已经落盘。所以要在入口挡住：非本机来源直接拒，POST 强制 application/json
        // ——跨源发这个 Content-Type 会触发预检，而预检过不去。
        const { origin } = req.headers
        if (origin && !isLocalOrigin(origin)) return fail(403, '拒绝跨源请求')

        if (req.method === 'GET' && req.url?.startsWith('/list')) {
          void listContent().then(
            (items) => {
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify(items))
            },
            (error: unknown) => fail(500, error instanceof Error ? error.message : '读取失败'),
          )
          return
        }

        if (req.method !== 'POST') return next()
        if (!req.headers['content-type']?.includes('application/json')) {
          return fail(415, '写入接口只接受 application/json')
        }

        void (async () => {
          try {
            const body = (await readBody(req)) as Record<string, unknown>
            const target = resolveDir(body.dir)
            if (!target) return fail(400, '目录名不合法')

            if (req.url?.startsWith('/write')) {
              const file = safeSegment(body.file, { allowMd: true })
              if (!file) return fail(400, '文件名不合法，必须以 .md 结尾')
              if (typeof body.text !== 'string') return fail(400, '缺少文件内容')
              await mkdir(target, { recursive: true })
              await writeFile(join(target, file), body.text, 'utf8')
            } else if (req.url?.startsWith('/remove')) {
              const file = body.file === undefined ? null : safeSegment(body.file, { allowMd: true })
              if (body.file !== undefined && !file) return fail(400, '文件名不合法')
              // 平铺作品没有自己的目录，删掉它等于清空整个内容根目录
              if (!file && target === CONTENT_DIR) return fail(400, '不能删除内容根目录')
              await rm(file ? join(target, file) : target, { recursive: true, force: true })
            } else {
              return next()
            }

            res.setHeader('Content-Type', 'application/json')
            res.end('{"ok":true}')
          } catch (error) {
            fail(500, error instanceof Error ? error.message : '写入失败')
          }
        })()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), contentWriter()],
  server: {
    // 编辑器自动保存会频繁改写内容目录，让它触发整页刷新会打断正在打字的人
    watch: { ignored: [`**/${CONTENT_ROOT}/**`] },
  },
})
