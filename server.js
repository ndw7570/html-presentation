import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as store from './lib/store.js'
import * as users from './lib/users.js'
import * as session from './lib/session.js'
import { extractTitle, normalizeLabel, ensureCharset } from './lib/html.js'
import { renderMarkdown, extractMarkdownTitle } from './lib/markdown.js'
import { sharePage } from './lib/share-page.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'public')

const PORT = Number(process.env.PORT) || 4300
const HOST = process.env.HOST || '0.0.0.0'
const MAX_UPLOAD = process.env.MAX_UPLOAD || '50mb'
// HTTPS 뒤에 둘 때 켠다. 켜면 세션 쿠키가 평문 연결로 나가지 않는다.
const SECURE_COOKIE = process.env.SECURE_COOKIE === '1'

// 업로드된 HTML 은 남이 쓴 코드다. 직접 주소로 열렸을 때도 이 사이트의
// 쿠키·localStorage 에 닿지 못하도록 응답 자체를 불투명 출처로 묶는다.
const RAW_SANDBOX = 'sandbox allow-scripts allow-popups allow-forms allow-modals allow-downloads'

/** 파일 이름에서 확장자를 떼어 제목 후보로 쓴다. */
function baseName(filename) {
  return typeof filename === 'string' ? filename.replace(/\.[^.]+$/, '') : ''
}

/** 파일 이름으로 종류를 가린다. 내용 검사는 업로드 쪽에서 따로 한다. */
function kindOf(filename) {
  const name = filename ?? ''
  if (/\.(md|markdown|mdown)$/i.test(name)) return 'md'
  if (/\.pdf$/i.test(name)) return 'pdf'
  return 'html'
}

const PDF_MAGIC = '%PDF-'

/**
 * 올라온 내용을 저장할 형태로 다듬고, 못 받을 것이면 이유를 돌려준다.
 * PDF 는 base64 로 올라오고, 본문 첫 바이트가 진짜 PDF 인지 반드시 확인한다 —
 * PDF 는 격리 없이 서빙되므로, 이름만 .pdf 인 HTML 이 통과하면 거기가 구멍이 된다.
 */
function prepareUpload(content, filename) {
  const kind = kindOf(filename)

  if (kind === 'pdf') {
    const bytes = Buffer.from(content, 'base64')
    if (!bytes.length) return { error: '파일이 비어 있습니다.' }
    if (bytes.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
      return { error: 'PDF 파일이 아닙니다. 확장자만 .pdf 인 파일은 받지 않습니다.' }
    }
    return { kind, source: bytes, title: '' }
  }

  if (!content.trim()) return { error: '내용이 비어 있습니다.' }

  if (kind === 'md') return { kind, source: content, title: extractMarkdownTitle(content) }

  const html = ensureCharset(content)
  return { kind, source: html, title: extractTitle(html) }
}

/**
 * 올린 원본을 브라우저에 보낼 형태로 바꾼다.
 * 변환은 올릴 때가 아니라 보여줄 때 한다 — 렌더러를 고치면 이미 올린 글에도 바로 먹는다.
 */
async function renderPost(post) {
  const source = await store.readSource(post.id, post.kind)
  if (post.kind === 'pdf') return { body: source, type: 'application/pdf', sandbox: false }
  const html = post.kind === 'md' ? renderMarkdown(source, post.title) : source
  return { body: html, type: 'text/html; charset=utf-8', sandbox: true }
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: MAX_UPLOAD }))

/* ---------- 인증 ---------- */

function requireLogin(req, res, next) {
  const username = session.read(req)
  if (!username) return res.status(401).json({ error: '로그인이 필요합니다.' })
  req.username = username
  next()
}

// 헬스체크용. 로그인 없이 열려야 컨테이너가 살았는지 볼 수 있다.
app.get('/api/health', async (req, res) => {
  res.json({ ok: true, accounts: await users.count() })
})

app.get('/api/me', (req, res) => {
  res.json({ username: session.read(req) })
})

app.post('/api/login', async (req, res, next) => {
  try {
    const username = users.normalizeUsername(req.body?.username)
    const password = req.body?.password
    if (!(await users.verify(username, password))) {
      // 아이디가 틀렸는지 비밀번호가 틀렸는지 알려주지 않는다.
      return res.status(401).json({ error: '아이디 또는 비밀번호가 맞지 않습니다.' })
    }
    session.issue(res, username, SECURE_COOKIE)
    res.json({ username })
  } catch (err) {
    next(err)
  }
})

app.post('/api/logout', (req, res) => {
  session.clear(res)
  res.json({ ok: true })
})

app.get('/api/users', requireLogin, async (req, res) => {
  res.json({ users: await users.list() })
})

app.post('/api/users', requireLogin, async (req, res, next) => {
  try {
    const username = users.normalizeUsername(req.body?.username)
    const password = req.body?.password
    const problem = users.validate(username, password)
    if (problem) return res.status(400).json({ error: problem })
    if (!(await users.create(username, password))) {
      return res.status(409).json({ error: '이미 있는 아이디입니다.' })
    }
    res.status(201).json({ ok: true })
  } catch (err) {
    next(err)
  }
})

app.post('/api/password', requireLogin, async (req, res, next) => {
  try {
    const { current, next: nextPassword } = req.body ?? {}
    if (!(await users.verify(req.username, current))) {
      return res.status(401).json({ error: '현재 비밀번호가 맞지 않습니다.' })
    }
    const problem = users.validate(req.username, nextPassword)
    if (problem) return res.status(400).json({ error: problem })
    await users.setPassword(req.username, nextPassword)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

app.delete('/api/users/:username', requireLogin, async (req, res, next) => {
  try {
    const target = users.normalizeUsername(req.params.username)
    if (target === req.username) {
      return res.status(400).json({ error: '자기 계정은 지울 수 없습니다.' })
    }
    if ((await users.count()) <= 1) {
      return res.status(400).json({ error: '마지막 계정은 지울 수 없습니다.' })
    }
    if (!(await users.remove(target))) {
      return res.status(404).json({ error: '없는 계정입니다.' })
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/* ---------- 공통 ---------- */

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

/**
 * PDF 에는 sandbox 를 걸지 않는다 — 걸면 브라우저 내장 뷰어가 아예 안 뜬다(실측).
 * 대신 PDF 는 우리 페이지의 JS 로 실행되지 않고, nosniff 로 HTML 로 둔갑하는 길도 막는다.
 * 그 둘을 묶어 주는 게 업로드 때의 매직바이트 검사다.
 */
function sendDeck(res, { body, type, sandbox }) {
  res.set({
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
    // 공유 주소가 검색엔진에 잡히면 "링크를 아는 사람만"이 깨진다.
    'X-Robots-Tag': 'noindex, nofollow',
    ...(sandbox ? { 'Content-Security-Policy': RAW_SANDBOX } : {}),
  })
  res.send(body)
}

/* ---------- 공유 (로그인 없이 열린다. 읽기 전용) ---------- */

/** 공유 주소가 가리키는 글. 없거나 공유가 꺼져 있으면 null 을 주고 404 를 보낸다. */
function withSharedPost(req, res) {
  const { token } = req.params
  const post = store.isValidShareToken(token) ? store.getShared(token) : null
  if (!post) {
    res.status(404).type('html').send(
      '<meta charset="utf-8"><p style="font:16px system-ui;padding:40px">' +
        '없는 주소이거나 공유가 꺼진 발표입니다.</p>',
    )
    return null
  }
  return post
}

app.get('/s/:token', (req, res) => {
  const post = withSharedPost(req, res)
  if (!post) return
  res.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow' })
  res.type('html').send(sharePage(post))
})

app.get('/s/:token/raw', async (req, res, next) => {
  try {
    const post = withSharedPost(req, res)
    if (!post) return
    sendDeck(res, await renderPost(post))
  } catch (err) {
    next(err)
  }
})

/* ---------- 글·폴더 (로그인 필요) ---------- */

app.get('/api/posts', requireLogin, (req, res) => {
  res.json({ folders: store.listFolders(), posts: store.list() })
})

app.post('/api/folders', requireLogin, async (req, res, next) => {
  try {
    const folder = await store.createFolder(normalizeLabel(req.body?.name, '새 폴더'))
    res.status(201).json({ folder })
  } catch (err) {
    next(err)
  }
})

app.patch('/api/folders/:id', requireLogin, async (req, res, next) => {
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

app.delete('/api/folders/:id', requireLogin, async (req, res, next) => {
  try {
    if (!(await store.removeFolder(req.params.id))) {
      return res.status(404).json({ error: '없는 폴더입니다.' })
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

app.post('/api/posts', requireLogin, async (req, res, next) => {
  try {
    const { title, html, filename, folderId } = req.body ?? {}
    const folder = resolveFolderId(folderId)
    if (folder === undefined) return res.status(400).json({ error: '없는 폴더입니다.' })

    const prepared = prepareUpload(html, filename)
    if (prepared.error) return res.status(400).json({ error: prepared.error })

    const post = await store.create({
      title: normalizeLabel(title || prepared.title || baseName(filename), '제목 없는 발표'),
      source: prepared.source,
      kind: prepared.kind,
      folderId: folder,
    })
    res.status(201).json({ post })
  } catch (err) {
    next(err)
  }
})

app.patch('/api/posts/:id', requireLogin, async (req, res, next) => {
  try {
    if (!withPost(req, res)) return
    const { title, html, filename, folderId, shared } = req.body ?? {}
    const patch = {}
    if (typeof title === 'string') patch.title = normalizeLabel(title, '제목 없는 발표')
    if (typeof html === 'string') {
      const prepared = prepareUpload(html, filename)
      if (prepared.error) return res.status(400).json({ error: prepared.error })
      patch.kind = prepared.kind
      patch.source = prepared.source
    }
    if (folderId !== undefined) {
      const folder = resolveFolderId(folderId)
      if (folder === undefined) return res.status(400).json({ error: '없는 폴더입니다.' })
      patch.folderId = folder
    }
    if (typeof shared === 'boolean') patch.shared = shared
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: '바꿀 내용이 없습니다.' })
    }
    res.json({ post: await store.update(req.params.id, patch) })
  } catch (err) {
    next(err)
  }
})

app.post('/api/posts/:id/share-token', requireLogin, async (req, res, next) => {
  try {
    if (!withPost(req, res)) return
    res.json({ post: await store.rotateShareToken(req.params.id) })
  } catch (err) {
    next(err)
  }
})

app.delete('/api/posts/:id', requireLogin, async (req, res, next) => {
  try {
    if (!withPost(req, res)) return
    await store.remove(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// 편집 화면의 iframe 이 읽는 주소. 공유용이 아니라 로그인한 사람만 본다.
app.get('/p/:id', requireLogin, async (req, res, next) => {
  try {
    const post = withPost(req, res)
    if (!post) return
    sendDeck(res, await renderPost(post))
  } catch (err) {
    next(err)
  }
})

app.get('/download/:id', requireLogin, async (req, res, next) => {
  try {
    const post = withPost(req, res)
    if (!post) return
    // 내려받을 때는 변환물이 아니라 올린 원본을 준다.
    const ext = store.fileExtension(post.kind)
    res.set('Content-Disposition', `attachment; filename="${post.id}.${ext}"`)
    res.type(ext).send(await store.readSource(post.id, post.kind))
  } catch (err) {
    next(err)
  }
})

/* ---------- 화면 ---------- */

app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')))

// 로그인 전에는 게시판 화면 자체를 내려 주지 않는다.
// '/' 만 막으면 /index.html 로 그대로 받아 갈 수 있어 둘 다 건다.
app.get(['/', '/index.html'], (req, res, next) => {
  if (!session.read(req)) return res.redirect('/login')
  next()
})

app.use(express.static(PUBLIC_DIR, { index: 'index.html' }))

app.use((err, req, res, next) => {
  console.error(err)
  const tooLarge = err.type === 'entity.too.large'
  res
    .status(tooLarge ? 413 : 500)
    .json({ error: tooLarge ? `파일이 너무 큽니다. (한도 ${MAX_UPLOAD})` : '서버 오류' })
})

/* ---------- 시작 ---------- */

/** 계정이 하나도 없으면 아무도 들어올 수 없다. 환경변수로 첫 계정을 만든다. */
async function bootstrapFirstUser() {
  if ((await users.count()) > 0) return
  const username = users.normalizeUsername(process.env.ADMIN_USER)
  const password = process.env.ADMIN_PASSWORD
  if (!username || !password) {
    console.warn('\n  계정이 하나도 없어 아무도 로그인할 수 없습니다.')
    console.warn('  다른 창에서 아래를 치면 계정을 만듭니다 (서버는 켜 둔 채로):\n')
    console.warn('      npm run adduser\n')
    return
  }
  const problem = users.validate(username, password)
  if (problem) return console.warn(`첫 계정을 만들지 못했습니다 — ${problem}`)
  await users.create(username, password)
  console.log(`첫 계정을 만들었습니다: ${username}`)
}

await session.init()
await store.init()
await users.init()
await bootstrapFirstUser()

const accounts = await users.count()

app.listen(PORT, HOST, () => {
  console.log(`발표 게시판 실행 중 — http://localhost:${PORT}`)
  console.log(`계정 ${accounts}개 · 공유 주소는 /s/<token> 으로 로그인 없이 열립니다.`)
  if (!SECURE_COOKIE) console.log('HTTPS 뒤에 둘 때는 SECURE_COOKIE=1 을 켜세요.')
})
