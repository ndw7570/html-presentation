import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { POSTS_DIR, INDEX_FILE } from './paths.js'

const ID_PATTERN = /^[0-9a-f]{10}$/
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

// 원본을 올린 그대로 두기 위해 종류마다 확장자를 다르게 쓴다.
const EXTENSIONS = { html: 'html', md: 'md', pdf: 'pdf' }

// PDF 는 바이너리다. utf8 로 읽으면 깨진 채로 나간다.
const BINARY_KINDS = new Set(['pdf'])

const newShareToken = () => randomBytes(16).toString('base64url')

let index = null

// 쓰기 요청이 겹치면 index.json 이 통째로 덮여 한쪽이 사라진다.
// 모든 변경을 이 체인 하나에 줄 세워 직렬화한다.
let writeChain = Promise.resolve()

function serialize(task) {
  const run = writeChain.then(task, task)
  writeChain = run.catch(() => {})
  return run
}

async function writeAtomic(file, content) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, file)
}

async function persist() {
  await writeAtomic(INDEX_FILE, JSON.stringify(index, null, 2))
}

export function postPath(id, kind = 'html') {
  return path.join(POSTS_DIR, `${id}.${EXTENSIONS[kind] ?? 'html'}`)
}

export const fileExtension = (kind) => EXTENSIONS[kind] ?? 'html'

export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

export function isValidShareToken(token) {
  return typeof token === 'string' && SHARE_TOKEN_PATTERN.test(token)
}

/** 예전 index.json 을 읽어도 그대로 열리게 맞춰 둔다. 빠진 칸만 채운다. */
function migrate(loaded) {
  return {
    folders: Array.isArray(loaded.folders) ? loaded.folders : [],
    posts: (loaded.posts ?? []).map((p) => ({
      folderId: null,
      shared: true,
      shareToken: newShareToken(),
      // 종류가 생기기 전에 올린 글은 전부 HTML 이었다.
      kind: 'html',
      ...p,
    })),
  }
}

export async function init() {
  await mkdir(POSTS_DIR, { recursive: true })
  try {
    index = migrate(JSON.parse(await readFile(INDEX_FILE, 'utf8')))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    index = { folders: [], posts: [] }
  }
  await persist()
}

function newId() {
  let id
  do {
    id = randomBytes(5).toString('hex')
  } while (
    index.posts.some((p) => p.id === id) ||
    index.folders.some((f) => f.id === id)
  )
  return id
}

/* ---------- 폴더 ---------- */

export function listFolders() {
  return index.folders.map((f) => ({ ...f }))
}

export function getFolder(id) {
  const folder = index.folders.find((f) => f.id === id)
  return folder ? { ...folder } : null
}

export function createFolder(name) {
  return serialize(async () => {
    const folder = { id: newId(), name, createdAt: new Date().toISOString() }
    index.folders.push(folder)
    await persist()
    return { ...folder }
  })
}

export function renameFolder(id, name) {
  return serialize(async () => {
    const folder = index.folders.find((f) => f.id === id)
    if (!folder) return null
    folder.name = name
    await persist()
    return { ...folder }
  })
}

/** 폴더만 없앤다. 안에 있던 글은 미분류로 내려오고 사라지지 않는다. */
export function removeFolder(id) {
  return serialize(async () => {
    const at = index.folders.findIndex((f) => f.id === id)
    if (at === -1) return false
    index.folders.splice(at, 1)
    for (const post of index.posts) {
      if (post.folderId === id) post.folderId = null
    }
    await persist()
    return true
  })
}

/* ---------- 글 ---------- */

export function list() {
  return index.posts.map((p) => ({ ...p }))
}

export function get(id) {
  const post = index.posts.find((p) => p.id === id)
  return post ? { ...post } : null
}

/** 공유 주소로 들어온 요청용. 공유를 꺼 둔 글은 없는 것으로 친다. */
export function getShared(token) {
  const post = index.posts.find((p) => p.shareToken === token && p.shared)
  return post ? { ...post } : null
}

export const isBinaryKind = (kind) => BINARY_KINDS.has(kind)

/** 올린 원본 그대로. 텍스트면 문자열, PDF 면 Buffer 가 나온다. */
export function readSource(id, kind = 'html') {
  const file = postPath(id, kind)
  return isBinaryKind(kind) ? readFile(file) : readFile(file, 'utf8')
}

export function create({ title, source, kind = 'html', folderId = null }) {
  return serialize(async () => {
    const now = new Date().toISOString()
    const post = {
      id: newId(),
      title,
      kind,
      folderId,
      shared: true,
      shareToken: newShareToken(),
      createdAt: now,
      updatedAt: now,
      bytes: Buffer.byteLength(source),
    }
    await writeAtomic(postPath(post.id, kind), source)
    // 최신 글이 위로 오도록 앞에 넣는다. 목록 정렬을 매번 하지 않기 위함.
    index.posts.unshift(post)
    await persist()
    return { ...post }
  })
}

export function update(id, { title, source, kind, folderId, shared }) {
  return serialize(async () => {
    const post = index.posts.find((p) => p.id === id)
    if (!post) return null
    if (source !== undefined) {
      const nextKind = kind ?? post.kind
      // 종류가 바뀌면 확장자도 바뀐다. 옛 파일을 안 지우면 고아로 남는다.
      if (nextKind !== post.kind) await rm(postPath(id, post.kind), { force: true })
      await writeAtomic(postPath(id, nextKind), source)
      post.kind = nextKind
      post.bytes = Buffer.byteLength(source)
    }
    if (title !== undefined) post.title = title
    if (folderId !== undefined) post.folderId = folderId
    if (shared !== undefined) post.shared = shared
    post.updatedAt = new Date().toISOString()
    await persist()
    return { ...post }
  })
}

/** 이미 뿌린 공유 주소를 죽이고 새 주소를 낸다. */
export function rotateShareToken(id) {
  return serialize(async () => {
    const post = index.posts.find((p) => p.id === id)
    if (!post) return null
    post.shareToken = newShareToken()
    post.updatedAt = new Date().toISOString()
    await persist()
    return { ...post }
  })
}

export function remove(id) {
  return serialize(async () => {
    const at = index.posts.findIndex((p) => p.id === id)
    if (at === -1) return false
    const [post] = index.posts.splice(at, 1)
    await persist()
    await rm(postPath(id, post.kind), { force: true })
    return true
  })
}
