import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve('data')
const POSTS_DIR = path.join(DATA_DIR, 'posts')
const INDEX_FILE = path.join(DATA_DIR, 'index.json')

const ID_PATTERN = /^[0-9a-f]{10}$/

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

export function postPath(id) {
  return path.join(POSTS_DIR, `${id}.html`)
}

export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

/** 폴더가 생기기 전에 쓰던 index.json 을 읽어도 그대로 열리게 맞춰 둔다. */
function migrate(loaded) {
  return {
    folders: Array.isArray(loaded.folders) ? loaded.folders : [],
    posts: (loaded.posts ?? []).map((p) => ({ folderId: null, ...p })),
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

export function readHtml(id) {
  return readFile(postPath(id), 'utf8')
}

export function create({ title, html, folderId = null }) {
  return serialize(async () => {
    const now = new Date().toISOString()
    const post = {
      id: newId(),
      title,
      folderId,
      createdAt: now,
      updatedAt: now,
      bytes: Buffer.byteLength(html),
    }
    await writeAtomic(postPath(post.id), html)
    // 최신 글이 위로 오도록 앞에 넣는다. 목록 정렬을 매번 하지 않기 위함.
    index.posts.unshift(post)
    await persist()
    return { ...post }
  })
}

export function update(id, { title, html, folderId }) {
  return serialize(async () => {
    const post = index.posts.find((p) => p.id === id)
    if (!post) return null
    if (html !== undefined) {
      await writeAtomic(postPath(id), html)
      post.bytes = Buffer.byteLength(html)
    }
    if (title !== undefined) post.title = title
    if (folderId !== undefined) post.folderId = folderId
    post.updatedAt = new Date().toISOString()
    await persist()
    return { ...post }
  })
}

export function remove(id) {
  return serialize(async () => {
    const at = index.posts.findIndex((p) => p.id === id)
    if (at === -1) return false
    index.posts.splice(at, 1)
    await persist()
    await rm(postPath(id), { force: true })
    return true
  })
}
