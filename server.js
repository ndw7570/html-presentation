import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as store from './lib/store.js'
import * as users from './lib/users.js'
import * as session from './lib/session.js'
import * as linkCookie from './lib/link-cookie.js'
import { extractTitle, normalizeLabel, ensureCharset, injectHead } from './lib/html.js'
import { bridgeScript } from './lib/bridge.js'
import { scanStorageUse } from './lib/storage-scan.js'
import { renderMarkdown, extractMarkdownTitle } from './lib/markdown.js'
import { sharePage } from './lib/share-page.js'
import { folderSharePage, noPreviewPage } from './lib/folder-share-page.js'
import { drawioPage } from './lib/drawio-page.js'
import { apiGuide, briefText, authoringText } from './lib/api-guide.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'public')

const PORT = Number(process.env.PORT) || 4300
const HOST = process.env.HOST || '0.0.0.0'
const MAX_UPLOAD = process.env.MAX_UPLOAD || '50mb'
// 발표자 노트는 index.json 에 통째로 들어간다. 길이를 묶어야 목록 읽기가 느려지지 않는다.
const MAX_NOTES = 20000
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
  if (/\.svg$/i.test(name)) return 'svg'
  if (/\.png$/i.test(name)) return 'png'
  if (/\.drawio(\.xml)?$/i.test(name)) return 'drawio'
  return 'html'
}

// 뷰어 파일이 저장소에 있어야 .drawio 를 그릴 수 있다.
// 없으면(내려받기 전이거나 지운 경우) 빈 화면 대신 안내를 띄운다.
const DRAWIO_VIEWER = path.join(PUBLIC_DIR, 'vendor', 'drawio-viewer.min.js')
const hasDrawioViewer = existsSync(DRAWIO_VIEWER)

const PDF_MAGIC = '%PDF-'
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

const MAGIC = {
  pdf: (bytes) => bytes.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC,
  png: (bytes) => bytes.subarray(0, 4).equals(PNG_MAGIC),
}

/**
 * 올라온 내용을 저장할 형태로 다듬고, 못 받을 것이면 이유를 돌려준다.
 * PDF 는 base64 로 올라오고, 본문 첫 바이트가 진짜 PDF 인지 반드시 확인한다 —
 * PDF 는 격리 없이 서빙되므로, 이름만 .pdf 인 HTML 이 통과하면 거기가 구멍이 된다.
 */
function prepareUpload(content, filename) {
  const kind = kindOf(filename)

  if (MAGIC[kind]) {
    const bytes = Buffer.from(content, 'base64')
    if (!bytes.length) return { error: '파일이 비어 있습니다.' }
    if (!MAGIC[kind](bytes)) {
      return { error: `${kind.toUpperCase()} 파일이 아닙니다. 확장자만 바꾼 파일은 받지 않습니다.` }
    }
    return { kind, source: bytes, title: '' }
  }

  if (!content.trim()) return { error: '내용이 비어 있습니다.' }

  if (kind === 'md') {
    return { kind, source: content, title: extractMarkdownTitle(content), scan: scanStorageUse(content) }
  }
  if (kind === 'svg' || kind === 'drawio') return { kind, source: content, title: '', scan: [] }

  const html = ensureCharset(content)
  return { kind, source: html, title: extractTitle(html), scan: scanStorageUse(html) }
}

/**
 * 올린 원본을 브라우저에 보낼 형태로 바꾼다.
 * 변환은 올릴 때가 아니라 보여줄 때 한다 — 렌더러를 고치면 이미 올린 글에도 바로 먹는다.
 *
 * localStorage 는 동기 API 라 나중에 받아올 수 없다. 그래서 저장해 둔 상태를
 * **그릴 때 코드 안에 박아 넣는다.** 그래야 자료가 getItem 을 부르는 즉시 값이 나온다.
 *
 * @param canWrite 공유 주소로 들어온 사람은 false. 보기만 하고 저장은 못 한다.
 */
async function renderPost(post, { canWrite = false } = {}) {
  if (post.kind === 'drawio' && !hasDrawioViewer) {
    return { body: noPreviewPage(post), type: 'text/html; charset=utf-8', sandbox: true }
  }

  const source = await store.readSource(post.id, post.kind)
  const bridge = bridgeScript({ state: await store.readState(post.id), canWrite })

  if (post.kind === 'drawio') {
    const body = injectHead(drawioPage({ title: post.title, xml: source }), bridge)
    return { body, type: 'text/html; charset=utf-8', sandbox: true }
  }

  // PDF·PNG 는 격리를 걸면 브라우저 내장 뷰어가 안 뜨거나 의미가 없다.
  // 둘 다 이 페이지의 JS 로 실행되지 않는 형식이고, 업로드 때 매직바이트로 걸러 둔다.
  if (post.kind === 'pdf') return { body: source, type: 'application/pdf', sandbox: false }
  if (post.kind === 'png') return { body: source, type: 'image/png', sandbox: false }

  // SVG 는 스크립트를 품을 수 있다. HTML 과 똑같이 가둔다.
  // 다만 HTML 문서가 아니라 주입은 하지 않는다 — 저장할 상태가 있을 자료도 아니다.
  if (post.kind === 'svg') return { body: source, type: 'image/svg+xml', sandbox: true }

  const html = post.kind === 'md' ? renderMarkdown(source, post.title) : source
  return { body: injectHead(html, bridge), type: 'text/html; charset=utf-8', sandbox: true }
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: MAX_UPLOAD }))

// 요청 하나당 딱 한 번만 맞춘다. 중간에 또 읽으면 한 응답 안에서 목록이 달라진다.
app.use((req, res, next) => {
  store.sync().then(() => next(), next)
})

/* ---------- 인증 ---------- */

function requireLogin(req, res, next) {
  const username = session.read(req)
  if (!username) return res.status(401).json({ error: '로그인이 필요합니다.' })
  req.username = username
  next()
}

/**
 * 브라우저 세션 **또는** API 토큰을 받는다.
 * AI·스크립트가 사람 없이 올릴 수 있어야 해서 둘 다 연다.
 * 토큰은 쿠키가 아니라 헤더로 오므로 CSRF 걱정이 없다.
 */
async function requireLoginOrToken(req, res, next) {
  try {
    const fromSession = session.read(req)
    if (fromSession) {
      req.username = fromSession
      return next()
    }
    const header = req.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const owner = token ? await users.userForToken(token) : null
    if (!owner) return res.status(401).json({ error: '로그인 또는 API 토큰이 필요합니다.' })
    req.username = owner
    req.viaToken = true
    next()
  } catch (err) {
    next(err)
  }
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

// 기억해 둔 공유 주소를 잊는다. 로그아웃의 공유 주소 판이다.
app.post('/api/link-out', (req, res) => {
  linkCookie.forget(res)
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

/* ---------- API 사용 설명 ---------- */

/** 폴더를 "제품 기획 / 2026" 같은 전체 경로로 펴 준다. */
function folderPaths() {
  const name = (id) => store.getFolder(id)?.name ?? ''
  return store.listFolders().map((folder) => {
    const parts = []
    for (let at = folder.id; at; at = store.getFolder(at)?.parentId ?? null) parts.unshift(name(at))
    return { id: folder.id, path: parts.join(' / ') }
  })
}

/**
 * 토큰이 있으면 폴더 목록까지 준다. 없으면 모양만.
 * 폴더 이름은 데이터라 아무에게나 보여 주지 않는다.
 */
app.get('/api', async (req, res, next) => {
  try {
    const header = req.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const known = Boolean(session.read(req) || (token && (await users.userForToken(token))))
    res.json(
      apiGuide({
        origin: `${req.protocol}://${req.get('host')}`,
        folders: known ? folderPaths() : null,
        maxUpload: MAX_UPLOAD,
        maxStateKB: store.MAX_STATE_BYTES / 1024,
        folderDepth: store.MAX_FOLDER_DEPTH,
      }),
    )
  } catch (err) {
    next(err)
  }
})

/**
 * 자료를 만들 때 지킬 것. 토큰 없이도 읽힌다 —
 * 발표 자료를 만드는 쪽과 올리는 쪽이 다른 사람일 수 있다.
 */
app.get('/api/authoring', (req, res) => {
  res.type('text/plain; charset=utf-8').send(authoringText())
})

/* ---------- API 토큰 ---------- */

app.get('/api/tokens', requireLogin, async (req, res, next) => {
  try {
    res.json({ tokens: await users.listTokens(req.username) })
  } catch (err) {
    next(err)
  }
})

app.post('/api/tokens', requireLogin, async (req, res, next) => {
  try {
    const days = Number(req.body?.days) || 0
    const token = await users.createToken(req.username, normalizeLabel(req.body?.label, ''), days)
    if (!token) return res.status(404).json({ error: '없는 계정입니다.' })

    const issued = (await users.listTokens(req.username)).at(-1)
    // 평문은 지금 한 번만 나간다. 우리도 다시 꺼낼 수 없다.
    // 그래서 AI 에게 붙여 넣을 문구도 여기서 같이 만들어 보낸다.
    res.status(201).json({
      token,
      expiresAt: issued?.expiresAt ?? null,
      brief: briefText({
        origin: `${req.protocol}://${req.get('host')}`,
        token,
        folders: folderPaths(),
        expiresAt: issued?.expiresAt ?? null,
      }),
    })
  } catch (err) {
    next(err)
  }
})

app.delete('/api/tokens/:id', requireLogin, async (req, res, next) => {
  try {
    if (!(await users.removeToken(req.username, req.params.id))) {
      return res.status(404).json({ error: '없는 토큰입니다.' })
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
/**
 * "제품 기획/2026 Q1" 같은 경로를 폴더 id 로 바꾼다. 없는 단계는 만든다.
 *
 * AI 에게 "어느 폴더에 넣어라" 라고 말로 시킬 때 id 를 알 리가 없다.
 * 이름으로 지정할 수 있어야 그 지시가 그대로 먹는다.
 *
 * 반환값: `{ folderId }` 또는 `{ error }`.
 */
async function resolveFolderPath(raw) {
  const names = String(raw)
    .split('/')
    .map((part) => normalizeLabel(part, ''))
    .filter(Boolean)
  if (!names.length) return { folderId: null }
  if (names.length > store.MAX_FOLDER_DEPTH) {
    return { error: `폴더는 ${store.MAX_FOLDER_DEPTH}단까지만 만들 수 있습니다.` }
  }

  let parentId = null
  for (const name of names) {
    const found = store
      .listFolders()
      .find((f) => (f.parentId ?? null) === parentId && f.name === name)
    parentId = found ? found.id : (await store.createFolder(name, parentId)).id
  }
  return { folderId: parentId }
}

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
  linkCookie.remember(res, 's', post.shareToken, SECURE_COOKIE)
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

/* ---------- 폴더 공유 ---------- */

function notFound(res, message) {
  res.status(404).type('html').send(
    `<meta charset="utf-8"><p style="font:16px system-ui;padding:40px">${message}</p>`,
  )
  return null
}

function withSharedFolder(req, res) {
  const { token } = req.params
  const folder = store.isValidShareToken(token) ? store.getSharedFolder(token) : null
  return folder ?? notFound(res, '없는 주소이거나 공유가 꺼진 폴더입니다.')
}

/** 공유 폴더를 기준으로 한 상대 경로. 공유 폴더 자신은 빈 문자열이다. */
function relativePath(folderId, rootId) {
  const names = []
  for (let at = folderId; at && at !== rootId; ) {
    const folder = store.getFolder(at)
    if (!folder) break
    names.unshift(folder.name)
    at = folder.parentId
  }
  return names.join(' / ')
}

app.get('/f/:token', (req, res) => {
  const folder = withSharedFolder(req, res)
  if (!folder) return
  linkCookie.remember(res, 'f', folder.shareToken, SECURE_COOKIE)
  // 폴더별로 묶어서 넘긴다. 통째로 평평하게 펴면 폴더마다 따로 매긴 차례가 섞인다.
  const groups = store
    .orderedSubtree(folder.id)
    .map(({ folderId, posts }) => ({ path: relativePath(folderId, folder.id), posts }))
  res.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow' })
  res.type('html').send(folderSharePage(folder, groups))
})

/**
 * 공유 폴더 안의 글 하나. 글 각자의 `shared` 는 보지 않는다 —
 * 폴더를 공유했다는 건 그 안을 통째로 연다는 뜻이고, 그 범위는 여기서 확인한다.
 */
function withPostInSharedFolder(req, res) {
  const folder = withSharedFolder(req, res)
  if (!folder) return null
  const { postId } = req.params
  const post = store.isValidId(postId) ? store.get(postId) : null
  if (!post || !store.subtreeFolderIds(folder.id).includes(post.folderId)) {
    return notFound(res, '이 폴더에 없는 발표입니다.')
  }
  return post
}

app.get('/f/:token/:postId/raw', async (req, res, next) => {
  try {
    const post = withPostInSharedFolder(req, res)
    if (!post) return
    sendDeck(res, await renderPost(post))
  } catch (err) {
    next(err)
  }
})

app.get('/f/:token/:postId/download', async (req, res, next) => {
  try {
    const post = withPostInSharedFolder(req, res)
    if (!post) return
    const ext = store.fileExtension(post.kind)
    res.set('Content-Disposition', `attachment; filename="${post.id}.${ext}"`)
    res.type(ext).send(await store.readSource(post.id, post.kind))
  } catch (err) {
    next(err)
  }
})

/* ---------- 글·폴더 (로그인 필요) ---------- */

app.get('/api/posts', requireLoginOrToken, (req, res) => {
  res.json({ folders: store.listFolders(), posts: store.list() })
})

/* ---------- 발표 자료가 저장한 상태 ---------- */

app.get('/api/state/:id', requireLoginOrToken, async (req, res, next) => {
  try {
    if (!withPost(req, res)) return
    res.json({ state: await store.readState(req.params.id) })
  } catch (err) {
    next(err)
  }
})

app.put('/api/state/:id', requireLoginOrToken, async (req, res, next) => {
  try {
    if (!withPost(req, res)) return
    const { state } = req.body ?? {}
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return res.status(400).json({ error: '상태는 객체여야 합니다.' })
    }
    const size = Buffer.byteLength(JSON.stringify(state))
    if (size > store.MAX_STATE_BYTES) {
      return res.status(413).json({
        error: `상태가 너무 큽니다. (${Math.round(size / 1024)}KB / 한도 ${store.MAX_STATE_BYTES / 1024}KB)`,
      })
    }
    await store.writeState(req.params.id, state)
    res.json({ ok: true, bytes: size })
  } catch (err) {
    next(err)
  }
})

/**
 * 폴더를 어느 폴더 밑에 둘 수 있는지 본다. 클라이언트 말은 믿지 않는다.
 * 반환값: 쓸 수 있으면 `{ parentId }`, 아니면 `{ error }`.
 * moving 을 주면 그 폴더를 옮기는 경우로 보고 순환과 자손 깊이까지 함께 본다.
 */
function resolveParentId(value, moving = null) {
  if (value === null || value === undefined || value === '') return { parentId: null }
  if (!store.isValidId(value) || !store.getFolder(value)) {
    return { error: '없는 폴더입니다.' }
  }
  if (moving && store.isSelfOrDescendant(value, moving)) {
    return { error: '폴더를 자기 자신이나 그 하위 폴더 안으로 옮길 수 없습니다.' }
  }
  // 옮기면 자손들도 같이 내려간다. 가장 깊은 자손이 한도를 넘는지 본다.
  const depth = store.folderDepth(value) + 1 + (moving ? store.subtreeHeight(moving) : 0)
  if (depth >= store.MAX_FOLDER_DEPTH) {
    return { error: `폴더는 ${store.MAX_FOLDER_DEPTH}단까지만 만들 수 있습니다.` }
  }
  return { parentId: value }
}

app.post('/api/folders', requireLoginOrToken, async (req, res, next) => {
  try {
    const parent = resolveParentId(req.body?.parentId)
    if (parent.error) return res.status(400).json({ error: parent.error })

    const folder = await store.createFolder(
      normalizeLabel(req.body?.name, '새 폴더'),
      parent.parentId,
    )
    res.status(201).json({ folder })
  } catch (err) {
    next(err)
  }
})

app.patch('/api/folders/:id', requireLogin, async (req, res, next) => {
  try {
    const { id } = req.params
    if (!store.isValidId(id) || !store.getFolder(id)) {
      return res.status(404).json({ error: '없는 폴더입니다.' })
    }

    const patch = {}
    if (typeof req.body?.name === 'string') {
      patch.name = normalizeLabel(req.body.name, '새 폴더')
    }
    if ('parentId' in (req.body ?? {})) {
      const parent = resolveParentId(req.body.parentId, id)
      if (parent.error) return res.status(400).json({ error: parent.error })
      patch.parentId = parent.parentId
    }
    if (typeof req.body?.shared === 'boolean') patch.shared = req.body.shared
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: '바꿀 내용이 없습니다.' })
    }
    res.json({ folder: await store.updateFolder(id, patch) })
  } catch (err) {
    next(err)
  }
})

app.post('/api/folders/:id/share-token', requireLogin, async (req, res, next) => {
  try {
    const folder = await store.rotateFolderShareToken(req.params.id)
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

app.post('/api/posts', requireLoginOrToken, async (req, res, next) => {
  try {
    const { title, html, filename, folderId, folderPath } = req.body ?? {}

    // 이름으로 준 쪽이 우선이다. AI 는 보통 이쪽만 쓴다.
    let folder
    if (typeof folderPath === 'string') {
      const resolved = await resolveFolderPath(folderPath)
      if (resolved.error) return res.status(400).json({ error: resolved.error })
      folder = resolved.folderId
    } else {
      folder = resolveFolderId(folderId)
      if (folder === undefined) return res.status(400).json({ error: '없는 폴더입니다.' })
    }

    const prepared = prepareUpload(html, filename)
    if (prepared.error) return res.status(400).json({ error: prepared.error })

    const post = await store.create({
      title: normalizeLabel(title || prepared.title || baseName(filename), '제목 없는 발표'),
      source: prepared.source,
      kind: prepared.kind,
      storage: prepared.scan ?? [],
      folderId: folder,
    })
    res.status(201).json({ post })
  } catch (err) {
    next(err)
  }
})

app.patch('/api/posts/:id', requireLoginOrToken, async (req, res, next) => {
  try {
    if (!withPost(req, res)) return
    const { title, html, filename, folderId, shared, notes } = req.body ?? {}
    const patch = {}
    if (typeof title === 'string') patch.title = normalizeLabel(title, '제목 없는 발표')
    if (typeof notes === 'string') patch.notes = notes.slice(0, MAX_NOTES)
    if (typeof html === 'string') {
      const prepared = prepareUpload(html, filename)
      if (prepared.error) return res.status(400).json({ error: prepared.error })
      patch.kind = prepared.kind
      patch.source = prepared.source
      patch.storage = prepared.scan ?? []
    }
    if (typeof req.body?.folderPath === 'string') {
      const resolved = await resolveFolderPath(req.body.folderPath)
      if (resolved.error) return res.status(400).json({ error: resolved.error })
      patch.folderId = resolved.folderId
    } else if (folderId !== undefined) {
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

/**
 * 차례 바꾸기. 한 자리에 있는 것들의 id 를 보이는 순서대로 통째로 보낸다.
 * 한 칸씩 주고받으면 중간에 끼어든 변경과 어긋난다 — 목록 전체를 받는 편이 안전하다.
 */
app.post('/api/reorder', requireLoginOrToken, async (req, res, next) => {
  try {
    const { kind, ids } = req.body ?? {}
    if (kind !== 'post' && kind !== 'folder') {
      return res.status(400).json({ error: "kind 는 'post' 또는 'folder' 여야 합니다." })
    }
    if (!Array.isArray(ids) || ids.some((id) => !store.isValidId(id))) {
      return res.status(400).json({ error: 'ids 는 id 배열이어야 합니다.' })
    }
    res.json({ ok: true, moved: await store.reorder(kind, ids) })
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
    // 로그인해서 보는 자리에서만 자료가 상태를 저장할 수 있다.
    sendDeck(res, await renderPost(post, { canWrite: true }))
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

app.get(['/tokens', '/tokens.html'], (req, res) => {
  if (!session.read(req)) return res.redirect('/login')
  res.sendFile(path.join(PUBLIC_DIR, 'tokens.html'))
})

/*
 * 로그인 전에는 게시판 화면 자체를 내려 주지 않는다.
 * '/' 만 막으면 /index.html 로 그대로 받아 갈 수 있어 둘 다 건다.
 *
 * 로그인으로 보내지 않고 공유 주소를 여는 화면을 준다 — 이 주소를 받는 사람
 * 대부분은 계정이 없다. 로그인은 거기서 눌러서 간다.
 */
app.get(['/', '/index.html'], (req, res, next) => {
  if (session.read(req)) return next()

  // 링크로 들어왔던 사람은 껐다 켜도 그 자리로 돌아온다.
  // 공유가 꺼졌거나 지워졌으면 쿠키를 버린다 - 안 그러면 404 로만 돌게 된다.
  const link = linkCookie.read(req)
  if (link) {
    const alive =
      link.kind === 's' ? store.getShared(link.token) : store.getSharedFolder(link.token)
    if (alive) return res.redirect(`/${link.kind}/${link.token}`)
    linkCookie.forget(res)
  }

  res.sendFile(path.join(PUBLIC_DIR, 'home.html'))
})

app.use(
  express.static(PUBLIC_DIR, {
    index: 'index.html',
    setHeaders(res, filePath) {
      const name = path.basename(filePath)
      // .json 으로 나가면 크롬이 매니페스트로 안 읽어 설치가 안 뜬다.
      if (name === 'manifest.json') res.type('application/manifest+json')
      // 워커는 브라우저가 들고 있는 쪽을 먼저 믿는다. 고친 게 안 먹는 자리라 못박는다.
      if (name === 'sw.js') res.set('Cache-Control', 'no-cache')
    },
  }),
)

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
