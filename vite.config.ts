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

function readBody(req: Connect.IncomingMessage) {
  return new Promise<unknown>((done, fail) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 2_000_000) fail(new Error('请求体过大'))
    })
    req.on('end', () => {
      try {
        done(JSON.parse(raw || '{}'))
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
