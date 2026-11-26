import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { POSTS_DIR, INDEX_FILE, STATE_DIR } from './paths.js'

const ID_PATTERN = /^[0-9a-f]{10}$/
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

// 원본을 올린 그대로 두기 위해 종류마다 확장자를 다르게 쓴다.
const EXTENSIONS = {
  html: 'html',
  md: 'md',
  pdf: 'pdf',
  svg: 'svg',
  png: 'png',
  drawio: 'drawio',
}

// utf8 로 읽으면 깨지는 것들.
const BINARY_KINDS = new Set(['pdf', 'png'])

const newShareToken = () => randomBytes(16).toString('base64url')

let index = null
let loadedAt = -1

// 쓰기 요청이 겹치면 index.json 이 통째로 덮여 한쪽이 사라진다.
// 모든 변경을 이 체인 하나에 줄 세워 직렬화한다.
let writeChain = Promise.resolve()

/**
 * 고치기 전에 파일을 먼저 맞춰 본다.
 * 메모리에 든 옛 내용을 그대로 덮으면 다른 프로세스가 그 사이에 한 일이 통째로 사라진다.
 */
function serialize(task) {
  const guarded = async () => {
    await sync()
    return task()
  }
  const run = writeChain.then(guarded, guarded)
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
  loadedAt = (await stat(INDEX_FILE)).mtimeMs
}

/**
 * 묶음(폴더째 올린 자료)은 파일 하나가 아니라 폴더다.
 * 확장자 없는 `data/posts/<id>/` 라서 `<id>.html` 과 이름이 겹치지 않는다.
 */
export const bundleDir = (id) => path.join(POSTS_DIR, id)

export function postPath(id, kind = 'html') {
  if (kind === 'bundle') return bundleDir(id)
  return path.join(POSTS_DIR, `${id}.${EXTENSIONS[kind] ?? 'html'}`)
}

/**
 * 묶음 안의 파일 하나. `rel` 은 반드시 lib/bundle.js 의 safePath 를 통과한 것이어야 한다.
 * 여기서 한 번 더 막는 것은 호출하는 쪽이 빠뜨렸을 때를 위한 것이다.
 */
export function bundleFile(id, rel) {
  const root = bundleDir(id)
  const full = path.resolve(root, rel)
  if (full !== root && !full.startsWith(root + path.sep)) return null
  return full
}

/**
 * 묶음 안의 모든 파일. 내려받기(zip)용이다.
 * 통째로 메모리에 올리지만 묶음 한도가 40MB 라 괜찮다.
 */
export async function readBundleFiles(id) {
  const out = []
  const walk = async (dir, prefix) => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) await walk(full, `${prefix}${item.name}/`)
      // isFile 이라 심볼릭 링크는 걸러진다. 우리가 만들 일은 없지만 따라가지 않는 편이 낫다.
      else if (item.isFile()) out.push({ path: prefix + item.name, bytes: await readFile(full) })
    }
  }
  await walk(bundleDir(id), '')
  return out
}

/** 묶음의 진입 파일(첫 화면)을 읽는다. */
export function readBundleEntry(id, entry) {
  const file = bundleFile(id, entry)
  if (!file) throw new Error('잘못된 진입 파일 경로입니다.')
  return readFile(file, 'utf8')
}

export const fileExtension = (kind) => EXTENSIONS[kind] ?? 'html'

export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

export function isValidShareToken(token) {
  return typeof token === 'string' && SHARE_TOKEN_PATTERN.test(token)
}

// 사이드바가 272px 이다. 한 단 들여쓸 때마다 이름 자리가 줄어서 5단이 실질 한계다.
export const MAX_FOLDER_DEPTH = 5

/** 예전 index.json 을 읽어도 그대로 열리게 맞춰 둔다. 빠진 칸만 채운다. */
function migrate(loaded) {
  return {
    folders: (loaded.folders ?? []).map((f, at) => ({
      parentId: null,
      // 순서가 없던 시절의 데이터는 지금 보이는 차례를 그대로 굳힌다.
      order: at,
      // 폴더 공유는 하위 전체가 열리므로 기본은 꺼짐이다. 글(기본 켜짐)과 다르다.
      shared: false,
      // 휴지통. null 이면 살아 있다.
      deletedAt: null,
      shareToken: newShareToken(),
      ...f,
    })),
    posts: (loaded.posts ?? []).map((p, at) => ({
      folderId: null,
      order: at,
      shared: true,
      shareToken: newShareToken(),
      // 종류가 생기기 전에 올린 글은 전부 HTML 이었다.
      kind: 'html',
      // 묶음의 첫 화면. 파일 하나짜리 글에는 없다.
      entry: null,
      // 발표자 노트. 올린 사람만 본다 — 공유 주소로는 절대 나가지 않는다.
      notes: '',
      // 이 자료가 어떤 저장 수단을 쓰는지 훑어 둔 결과.
      storage: [],
      // 휴지통. null 이면 살아 있다. 날짜가 있으면 지워진 것으로 친다.
      deletedAt: null,
      ...p,
    })),
  }
}

// 상태가 index.json 에 들어가면 목록 한 번 읽는 데 그걸 다 끌고 온다. 파일을 따로 쓴다.
export const MAX_STATE_BYTES = 256 * 1024

const statePath = (id) => path.join(STATE_DIR, `${id}.json`)

/** 발표 자료가 저장해 둔 상태. 없거나 깨졌으면 빈 객체. */
export async function readState(id) {
  try {
    const parsed = JSON.parse(await readFile(statePath(id), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function writeState(id, state) {
  return serialize(async () => {
    await writeAtomic(statePath(id), JSON.stringify(state))
  })
}

export function removeState(id) {
  return serialize(() => rm(statePath(id), { force: true }))
}

export async function init() {
  await mkdir(POSTS_DIR, { recursive: true })
  await mkdir(STATE_DIR, { recursive: true })
  try {
    index = migrate(JSON.parse(await readFile(INDEX_FILE, 'utf8')))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    index = { folders: [], posts: [] }
  }
  await persist()
}

/**
 * 목록은 다른 프로세스(두 번째 컨테이너, 손으로 돌린 스크립트)도 고칠 수 있다.
 * 켤 때 읽은 것만 믿으면 그쪽에서 올린 글이 영영 안 보이고, 쓸 때 덮어 버린다.
 * 파일이 **바뀌었을 때만** 다시 읽는다 — 안 바뀌었으면 stat 한 번으로 끝난다.
 *
 * 쓰기는 rename 으로 갈아 끼우므로 반쯤 쓰인 파일을 읽을 일은 없다.
 * 깨진 JSON 이면 여기서 터뜨린다 — 조용히 빈 목록으로 떨어지면 그 다음 쓰기가 원본을 날린다.
 */
export async function sync() {
  let mtime
  try {
    mtime = (await stat(INDEX_FILE)).mtimeMs
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    // 누가 파일을 지웠다. 메모리에 든 것을 들고 있다가 다음 쓰기에 되살린다.
    return
  }
  if (mtime === loadedAt) return
  index = migrate(JSON.parse(await readFile(INDEX_FILE, 'utf8')))
  loadedAt = mtime
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

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0)

export function listFolders() {
  return index.folders.map((f) => ({ ...f })).sort(byOrder)
}

export function getFolder(id) {
  const folder = index.folders.find((f) => f.id === id)
  return folder ? { ...folder } : null
}

const parentOf = (id) => index.folders.find((f) => f.id === id)?.parentId ?? null

/** 맨 위 폴더가 0. 데이터가 깨져 고리가 생겨도 멈추도록 횟수를 묶어 둔다. */
export function folderDepth(id) {
  let depth = 0
  for (let at = id; at && depth <= MAX_FOLDER_DEPTH + 1; at = parentOf(at)) depth += 1
  return depth - 1
}

/**
 * 그 폴더 자신이나 **조상 중 하나**가 휴지통에 있나.
 * 폴더를 지우면 안에 든 것이 통째로 숨으므로, 한 단계만 보면 안 된다.
 */
export function folderGone(id) {
  for (let at = id, hops = 0; at && hops <= MAX_FOLDER_DEPTH + 1; at = parentOf(at), hops += 1) {
    if (index.folders.find((f) => f.id === at)?.deletedAt) return true
  }
  return false
}

/** 지금 안 보여야 하는 글인가. 제가 지워졌거나, 든 폴더가 지워졌거나. */
export const postGone = (post) => Boolean(post.deletedAt) || folderGone(post.folderId)

/** candidate 가 ancestor 자신이거나 그 자손인가. 폴더를 제 안으로 넣는 걸 막는 데 쓴다. */
export function isSelfOrDescendant(candidate, ancestor) {
  let at = candidate
  for (let hops = 0; at && hops <= MAX_FOLDER_DEPTH + 1; at = parentOf(at), hops += 1) {
    if (at === ancestor) return true
  }
  return false
}

/** 그 폴더 아래 가장 깊은 자손까지의 단 수. 옮길 때 한도를 넘는지 보는 데 쓴다. */
export function subtreeHeight(id) {
  const children = index.folders.filter((f) => f.parentId === id)
  return children.length ? 1 + Math.max(...children.map((c) => subtreeHeight(c.id))) : 0
}

export function createFolder(name, parentId = null) {
  return serialize(async () => {
    const folder = {
      id: newId(),
      name,
      parentId,
      shared: false,
      shareToken: newShareToken(),
      deletedAt: null,
      createdAt: new Date().toISOString(),
      order: Math.max(0, ...index.folders.map((f) => f.order ?? 0)) + 1,
    }
    index.folders.push(folder)
    await persist()
    return { ...folder }
  })
}

export function updateFolder(id, { name, parentId, shared }) {
  return serialize(async () => {
    const folder = index.folders.find((f) => f.id === id)
    if (!folder) return null
    if (name !== undefined) folder.name = name
    if (parentId !== undefined) folder.parentId = parentId
    if (shared !== undefined) folder.shared = shared
    await persist()
    return { ...folder }
  })
}

export function rotateFolderShareToken(id) {
  return serialize(async () => {
    const folder = index.folders.find((f) => f.id === id)
    if (!folder) return null
    folder.shareToken = newShareToken()
    await persist()
    return { ...folder }
  })
}

/** 공유 주소로 들어온 요청용. 공유를 꺼 둔 폴더는 없는 것으로 친다. */
export function getSharedFolder(token) {
  const folder = index.folders.find((f) => f.shareToken === token && f.shared)
  // 지운 폴더의 주소도 같이 죽는다. 조상이 지워진 경우까지 본다.
  return folder && !folderGone(folder.id) ? { ...folder } : null
}

/** 그 폴더와 모든 자손 폴더의 id. 폴더 공유가 어디까지 미치는지를 정한다. */
export function subtreeFolderIds(id) {
  const ids = [id]
  for (let at = 0; at < ids.length; at += 1) {
    for (const folder of index.folders) {
      if (folder.parentId === ids[at]) ids.push(folder.id)
    }
  }
  return ids
}

/**
 * 폴더 아래(자손 폴더 포함) 모든 글.
 * 글 각자의 `shared` 와는 무관하다 — 폴더를 공유했다는 건 그 안을 통째로 연다는 뜻이다.
 *
 * 개수를 세는 용도다. **차례가 필요하면 `orderedSubtree` 를 써야 한다** —
 * `order` 는 같은 폴더 안에서만 뜻이 있는 번호라, 폴더를 넘어 정렬하면 섞인다.
 */
export function postsInSubtree(id) {
  const ids = new Set(subtreeFolderIds(id))
  return index.posts.filter((p) => ids.has(p.folderId) && !postGone(p)).map((p) => ({ ...p }))
}

/**
 * 폴더 아래를 **보이는 차례 그대로** 폴더별로 묶어 준다.
 *
 * 위에서 아래로: 그 폴더에 직접 든 글 먼저, 그 다음 하위 폴더를 차례대로.
 * 글이 하나도 없는 폴더는 건너뛴다 — 공유받는 사람에게 빈 제목은 소음이다.
 */
export function orderedSubtree(rootId) {
  const groups = []
  const walk = (id) => {
    const posts = index.posts
      .filter((p) => p.folderId === id && !p.deletedAt)
      .map((p) => ({ ...p }))
      .sort(byOrder)
    if (posts.length) groups.push({ folderId: id, posts })
    index.folders
      .filter((f) => f.parentId === id && !f.deletedAt)
      .sort(byOrder)
      .forEach((child) => walk(child.id))
  }
  walk(rootId)
  return groups
}

/**
 * 폴더를 휴지통으로. **안에 든 것이 통째로 같이 숨는다.**
 *
 * 안의 글을 한 단 위로 올리지 않는 이유는, 되살릴 때 묶어 둔 모양 그대로
 * 돌아와야 하기 때문이다. 어디에 뭐가 있었는지를 따로 적어 둘 필요도 없어진다.
 */
export function softRemoveFolder(id) {
  return serialize(async () => {
    const folder = index.folders.find((f) => f.id === id)
    if (!folder || folder.deletedAt) return null
    folder.deletedAt = new Date().toISOString()
    await persist()
    return { ...folder }
  })
}

/** 폴더를 꺼낸다. 안에 있던 것도 같이 돌아온다 — 따로 지워 둔 글만 빼고. */
export function restoreFolder(id) {
  return serialize(async () => {
    const folder = index.folders.find((f) => f.id === id)
    if (!folder || !folder.deletedAt) return null
    folder.deletedAt = null
    await persist()
    return { ...folder }
  })
}

/** 폴더 하나를 지웠을 때 같이 사라지는 것들. 확인 문구에 개수를 적는 데 쓴다. */
export function folderContents(id) {
  const ids = new Set(subtreeFolderIds(id))
  return {
    folders: index.folders.filter((f) => f.id !== id && ids.has(f.id)).length,
    posts: index.posts.filter((p) => ids.has(p.folderId)).length,
  }
}

/**
 * 폴더와 **그 아래 전부**를 진짜로 지운다. 되돌릴 수 없다.
 * 하위 폴더도, 안에 있던 글의 원본 파일과 저장된 상태까지 없앤다.
 */
export function purgeFolder(id) {
  return serialize(async () => {
    if (!index.folders.some((f) => f.id === id)) return false
    const ids = new Set(subtreeFolderIds(id))

    const doomed = index.posts.filter((p) => ids.has(p.folderId))
    index.posts = index.posts.filter((p) => !ids.has(p.folderId))
    index.folders = index.folders.filter((f) => !ids.has(f.id))
    await persist()

    for (const post of doomed) {
      await rm(postPath(post.id, post.kind), { recursive: true, force: true })
      await rm(statePath(post.id), { force: true })
    }
    return true
  })
}

/* ---------- 글 ---------- */

export function list() {
  return index.posts.map((p) => ({ ...p })).sort(byOrder)
}

export function get(id) {
  const post = index.posts.find((p) => p.id === id)
  return post ? { ...post } : null
}

/** 공유 주소로 들어온 요청용. 공유를 꺼 둔 글은 없는 것으로 친다. */
export function getShared(token) {
  // 지운 것은 공유 주소도 같이 죽어야 한다. 안 그러면 "지웠는데 아직 열린다" 가 된다.
  const post = index.posts.find((p) => p.shareToken === token && p.shared && !postGone(p))
  return post ? { ...post } : null
}

export const isBinaryKind = (kind) => BINARY_KINDS.has(kind)

/** 올린 원본 그대로. 텍스트면 문자열, PDF 면 Buffer 가 나온다. */
export function readSource(id, kind = 'html') {
  const file = postPath(id, kind)
  return isBinaryKind(kind) ? readFile(file) : readFile(file, 'utf8')
}

export function create({ title, source, kind = 'html', folderId = null, storage = [] }) {
  return serialize(async () => {
    const now = new Date().toISOString()
    const post = {
      id: newId(),
      title,
      kind,
      folderId,
      notes: '',
      storage,
      deletedAt: null,
      shared: true,
      shareToken: newShareToken(),
      createdAt: now,
      updatedAt: now,
      bytes: Buffer.byteLength(source),
      // 새 글은 맨 위로. 정렬은 폴더 안에서만 하므로 전역 최솟값보다 작기만 하면 된다.
      order: Math.min(0, ...index.posts.map((p) => p.order ?? 0)) - 1,
    }
    await writeAtomic(postPath(post.id, kind), source)
    index.posts.unshift(post)
    await persist()
    return { ...post }
  })
}

/**
 * 폴더째 올린 자료를 저장한다.
 *
 * 임시 폴더에 다 쓴 뒤 한 번에 제자리로 옮긴다. 94개를 쓰다가 중간에 끊기면
 * **반쪽짜리 자료가 목록에 올라가** 열자마자 깨진 화면이 나오기 때문이다.
 *
 * @param files `[{ path: 'img/a.png', bytes: Buffer }]`. path 는 safePath 를 통과한 것.
 */
export function createBundle({ title, entry, files, folderId = null, storage = [] }) {
  return serialize(async () => {
    const now = new Date().toISOString()
    const id = newId()
    const dir = bundleDir(id)
    const tmp = `${dir}.${randomBytes(4).toString('hex')}.tmp`

    try {
      for (const file of files) {
        const target = path.join(tmp, file.path)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, file.bytes)
      }
      await rename(tmp, dir)
    } catch (err) {
      await rm(tmp, { recursive: true, force: true })
      throw err
    }

    const post = {
      id,
      title,
      kind: 'bundle',
      entry,
      folderId,
      notes: '',
      storage,
      deletedAt: null,
      shared: true,
      shareToken: newShareToken(),
      createdAt: now,
      updatedAt: now,
      bytes: files.reduce((sum, f) => sum + f.bytes.length, 0),
      files: files.length,
      order: Math.min(0, ...index.posts.map((p) => p.order ?? 0)) - 1,
    }
    index.posts.unshift(post)
    await persist()
    return { ...post }
  })
}

export function update(id, { title, source, kind, folderId, shared, notes, storage }) {
  return serialize(async () => {
    const post = index.posts.find((p) => p.id === id)
    if (!post) return null
    if (source !== undefined) {
      const nextKind = kind ?? post.kind
      // 종류가 바뀌면 확장자도 바뀐다. 옛 파일을 안 지우면 고아로 남는다.
      // 묶음이었다면 지울 것이 파일이 아니라 폴더다.
      if (nextKind !== post.kind) {
        await rm(postPath(id, post.kind), { recursive: true, force: true })
      }
      await writeAtomic(postPath(id, nextKind), source)
      post.kind = nextKind
      post.entry = null
      delete post.files
      post.bytes = Buffer.byteLength(source)
    }
    if (storage !== undefined) post.storage = storage
    if (title !== undefined) post.title = title
    if (folderId !== undefined) post.folderId = folderId
    if (shared !== undefined) post.shared = shared
    // 노트만 고친 것은 "내용이 바뀐" 게 아니다. 목록의 날짜를 흔들지 않는다.
    if (notes !== undefined) post.notes = notes
    if (title !== undefined || source !== undefined || folderId !== undefined || shared !== undefined) {
      post.updatedAt = new Date().toISOString()
    }
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

/**
 * 한 자리(같은 폴더 안, 또는 같은 상위 폴더 밑)에 있는 것들의 차례를 다시 매긴다.
 * 받은 순서 그대로 0,1,2… 를 준다. 그 자리에 없는 id 는 무시한다.
 *
 * 정렬은 **같은 자리 안에서만** 하므로 다른 자리와 번호가 겹쳐도 문제가 없다.
 */
export function reorder(kind, ids) {
  return serialize(async () => {
    const rows = kind === 'folder' ? index.folders : index.posts
    let moved = 0
    ids.forEach((id, at) => {
      const row = rows.find((r) => r.id === id)
      if (!row) return
      row.order = at
      moved += 1
    })
    await persist()
    return moved
  })
}

/**
 * 휴지통으로 보낸다. 파일은 그대로 두고 표시만 한다.
 * 공유 주소는 이 순간부터 안 열린다 - `getShared` 가 지워진 것을 안 준다.
 */
export function softRemove(id) {
  return serialize(async () => {
    const post = index.posts.find((p) => p.id === id)
    if (!post || post.deletedAt) return null
    post.deletedAt = new Date().toISOString()
    await persist()
    return { ...post }
  })
}

/** 휴지통에서 꺼낸다. 쓰던 공유 주소가 그대로 다시 살아난다. */
export function restore(id) {
  return serialize(async () => {
    const post = index.posts.find((p) => p.id === id)
    if (!post || !post.deletedAt) return null
    post.deletedAt = null
    await persist()
    return { ...post }
  })
}

/** 진짜로 지운다. 원본과 저장된 상태까지 없앤다. 되돌릴 수 없다. */
export function purge(id) {
  return serialize(async () => {
    const at = index.posts.findIndex((p) => p.id === id)
    if (at === -1) return false
    const [post] = index.posts.splice(at, 1)
    await persist()
    await rm(postPath(id, post.kind), { recursive: true, force: true })
    await rm(statePath(id), { force: true })
    return true
  })
}
