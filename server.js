import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as store from './lib/store.js'
import { extractTitle, normalizeLabel, ensureCharset } from './lib/html.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT) || 4300
const HOST = process.env.HOST || '0.0.0.0'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const MAX_UPLOAD = process.env.MAX_UPLOAD || '50mb'

// 업로드된 HTML 은 남이 쓴 코드다. 직접 주소로 열렸을 때도 이 사이트의
// 쿠키·localStorage 에 닿지 못하도록 응답 자체를 불투명 출처로 묶는다.
const RAW_SANDBOX = 'sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads'

/** 파일 이름에서 확장자를 떼어 제목 후보로 쓴다. */
function baseName(filename) {
  return typeof filename === 'string' ? filename.replace(/\.[^.]+$/, '') : ''
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: MAX_UPLOAD }))

function requireToken(req, res, next) {
  if (!ADMIN_TOKEN) return next()
  if (req.get('x-admin-token') === ADMIN_TOKEN) return next()
  res.status(401).json({ error: '쓰기 권한이 필요합니다.' })
}

function withPost(req, res) {
  const { id } = req.params
  if (!store.isValidId(id)) {
    res.status(400).json({ error: '잘못된 주소입니다.' })
    return null
  }
  const post = store.get(id)
  if (!post) {
    res.status(404).json({ error: '없는 글입니다.' })
    return null
  }
  return post
}

/**
 * 글이 가리키는 폴더가 실제로 있는지 본다.
 * 반환값: 유효하면 폴더 id(또는 미분류를 뜻하는 null), 잘못됐으면 undefined.
 */
function resolveFolderId(value) {
  if (value === null || value === undefined || value === '') return null
  return store.isValidId(value) && store.getFolder(value) ? value : undefined
}

app.get('/api/config', (req, res) => {
  res.json({ writeProtected: Boolean(ADMIN_TOKEN) })
})

app.get('/api/posts', (req, res) => {
  res.json({ folders: store.listFolders(), posts: store.list() })
})

/* ---------- 폴더 ---------- */

app.post('/api/folders', requireToken, async (req, res, next) => {
  try {
    const folder = await store.createFolder(normalizeLabel(req.body?.name, '새 폴더'))
    res.status(201).json({ folder })
  } catch (err) {
    next(err)
  }
})

app.patch('/api/folders/:id', requireToken, async (req, res, next) => {
  try {
    const folder = await store.renameFolder(
      req.params.id,
      normalizeLabel(req.body?.name, '새 폴더'),
    )
    if (!folder) return res.status(404).json({ error: '없는 폴더입니다.' })
    res.json({ folder })
  } catch (err) {
    next(err)
  }
})

app.delete('/api/folders/:id', requireToken, async (req, res, next) => {
  try {
    if (!(await store.removeFolder(req.params.id))) {
      return res.status(404).json({ error: '없는 폴더입니다.' })
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

app.post('/api/posts', requireToken, async (req, res, next) => {
  try {
    const { title, html, filename, folderId } = req.body ?? {}
    if (typeof html !== 'string' || !html.trim()) {
      return res.status(400).json({ error: 'HTML 내용이 비어 있습니다.' })
    }
    const folder = resolveFolderId(folderId)
    if (folder === undefined) return res.status(400).json({ error: '없는 폴더입니다.' })

    const body = ensureCharset(html)
    const post = await store.create({
      title: normalizeLabel(title || extractTitle(body) || baseName(filename), '제목 없는 발표'),
      html: body,
      folderId: folder,
    })
    res.status(201).json({ post })
  } catch (err) {
    next(err)
  }
})

app.patch('/api/posts/:id', requireToken, async (req, res, next) => {
  try {
    if (!withPost(req, res)) return
    const { title, html, folderId } = req.body ?? {}
    const patch = {}
    if (typeof title === 'string') patch.title = normalizeLabel(title, '제목 없는 발표')
    if (typeof html === 'string') {
      if (!html.trim()) return res.status(400).json({ error: 'HTML 내용이 비어 있습니다.' })
      patch.html = ensureCharset(html)
    }
    if (folderId !== undefined) {
      const folder = resolveFolderId(folderId)
      if (folder === undefined) return res.status(400).json({ error: '없는 폴더입니다.' })
      patch.folderId = folder
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: '바꿀 내용이 없습니다.' })
    }
    res.json({ post: await store.update(req.params.id, patch) })
  } catch (err) {
    next(err)
  }
})

app.delete('/api/posts/:id', requireToken, async (req, res, next) => {
  try {
    if (!withPost(req, res)) return
    await store.remove(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// 발표 원본. iframe 이 읽는 주소이자 그대로 공유할 수 있는 주소다.
app.get('/p/:id', async (req, res, next) => {
  try {
    if (!withPost(req, res)) return
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': RAW_SANDBOX,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    })
    res.send(await store.readHtml(req.params.id))
  } catch (err) {
    next(err)
  }
})

// 원본 파일 그대로 내려받기. 발표 자료를 다시 꺼내 쓸 때 쓴다.
app.get('/download/:id', async (req, res, next) => {
  try {
    const post = withPost(req, res)
    if (!post) return
    res.set('Content-Disposition', `attachment; filename="${post.id}.html"`)
    res.type('html').send(await store.readHtml(req.params.id))
  } catch (err) {
    next(err)
  }
})

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }))

app.use((err, req, res, next) => {
  console.error(err)
  const tooLarge = err.type === 'entity.too.large'
  res
    .status(tooLarge ? 413 : 500)
    .json({ error: tooLarge ? `파일이 너무 큽니다. (한도 ${MAX_UPLOAD})` : '서버 오류' })
})

await store.init()
app.listen(PORT, HOST, () => {
  console.log(`발표 게시판 실행 중 — http://localhost:${PORT}`)
  if (ADMIN_TOKEN) console.log('쓰기 보호 켜짐 (ADMIN_TOKEN)')
})
