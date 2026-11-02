const $ = (id) => document.getElementById(id)

const UNFILED = '미분류'
const COLLAPSED_KEY = 'collapsedFolders'
// 끌어 옮길 때 쓰는 표식. 파일 드롭과 섞이지 않게 전용 타입을 쓴다.
const POST_MIME = 'application/x-deck-post'
const FOLDER_MIME = 'application/x-deck-folder'

const el = {
  list: $('postList'),
  search: $('search'),
  toolbar: $('toolbar'),
  title: $('postTitle'),
  meta: $('postMeta'),
  folderSelect: $('folderSelect'),
  homeBtn: $('homeBtn'),
  frameWrap: $('frameWrap'),
  frame: $('frame'),
  exitHint: $('exitHint'),
  empty: $('empty'),
  dropOverlay: $('dropOverlay'),
  dropTarget: $('dropTarget'),
  toasts: $('toasts'),
  picker: $('filePicker'),
  morePop: $('morePop'),
  moreBtn: $('moreBtn'),
  folderPop: $('folderPop'),
  folderShareToggle: $('folderShareToggle'),
  accountPop: $('accountPop'),
  toggleShare: $('toggleShare'),
  whoami: $('whoami'),
}

const state = {
  folders: [],
  posts: [],
  currentId: null,
  // 새로 올리는 발표가 들어갈 폴더. null 이면 미분류.
  activeFolderId: null,
  collapsed: new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')),
  query: '',
  username: null,
  pickerMode: 'create',
  // 폴더 메뉴가 어느 폴더를 겨냥하고 있는지.
  menuFolderId: null,
}

/* ---------- 서버 통신 ---------- */

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // 세션이 끊기면 더 두드려 봐야 소용없다. 로그인 화면으로 보낸다.
    if (res.status === 401) {
      location.replace('/login')
      throw new Error('로그인이 필요합니다.')
    }
    throw new Error(data.error || `요청 실패 (${res.status})`)
  }
  return data
}

/* ---------- 알림 ---------- */

function toast(message, kind = '') {
  const node = document.createElement('div')
  node.className = `toast ${kind}`.trim()
  node.textContent = message
  el.toasts.append(node)
  setTimeout(() => node.remove(), 3200)
}

/* ---------- 조회 도우미 ---------- */

const currentPost = () => state.posts.find((p) => p.id === state.currentId)
const folderName = (id) => state.folders.find((f) => f.id === id)?.name ?? UNFILED
const postsIn = (folderId) => state.posts.filter((p) => (p.folderId ?? null) === folderId)
const childFolders = (parentId) => state.folders.filter((f) => (f.parentId ?? null) === parentId)

/** `제품 기획 / 2026` 처럼 위에서부터 이어 붙인 이름. 선택 상자·알림에 쓴다. */
function folderPath(id) {
  const names = []
  for (let at = id; at; ) {
    const folder = state.folders.find((f) => f.id === at)
    if (!folder) break
    names.unshift(folder.name)
    at = folder.parentId ?? null
  }
  return names.length ? names.join(' / ') : UNFILED
}

function formatDate(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

function rememberCollapsed() {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...state.collapsed]))
}

/* ---------- 사이드바 ---------- */

function postItem(post) {
  const item = document.createElement('button')
  item.className = `post-item${post.id === state.currentId ? ' active' : ''}`
  item.dataset.id = post.id
  item.draggable = true

  const title = document.createElement('strong')
  title.textContent = post.title
  const meta = document.createElement('span')
  const tag = post.kind === 'md' ? 'MD · ' : post.kind === 'pdf' ? 'PDF · ' : ''
  meta.textContent = `${tag}${formatDate(post.updatedAt)}`

  item.append(title, meta)
  return item
}

function folderGroup(folderId, name, depth = 0) {
  const posts = postsIn(folderId)
  // folderId 가 null 이면 미분류 칸이다. 최상위 폴더도 parentId 가 null 이라,
  // 그냥 자식을 찾으면 맨 위 폴더들이 미분류 안에 한 번 더 들어간다.
  const children = folderId === null ? [] : childFolders(folderId)
  const collapsed = state.collapsed.has(String(folderId))

  const group = document.createElement('section')
  group.className = `folder${state.activeFolderId === folderId ? ' active' : ''}`
  group.dataset.folderId = folderId ?? ''
  // 들여쓰기는 CSS 가 계산한다. 단 수만 넘긴다.
  // head 가 아니라 section 에 걸어야 body 안의 글까지 같이 상속받는다.
  group.style.setProperty('--depth', depth)

  const head = document.createElement('div')
  head.className = 'folder-head'
  if (folderId !== null) head.draggable = true

  const toggle = document.createElement('button')
  toggle.className = 'folder-toggle'
  toggle.dataset.folderId = folderId ?? ''
  const caret = document.createElement('span')
  caret.className = 'caret'
  // 접을 것이 없으면 화살표 자리만 비워 둔다. 있는 척하면 눌러 보게 된다.
  caret.textContent = posts.length || children.length ? (collapsed ? '▶' : '▼') : '·'
  toggle.append(caret)
  const label = document.createElement('strong')
  label.textContent = name
  const count = document.createElement('span')
  count.className = 'folder-count'
  count.textContent = children.length ? `${posts.length}+${children.length}` : posts.length
  count.title = `발표 ${posts.length}개${children.length ? ` · 하위 폴더 ${children.length}개` : ''}`
  toggle.append(label, count)
  head.append(toggle)

  // 미분류는 이름을 바꾸거나 지울 대상이 아니다.
  if (folderId !== null) {
    if (findFolder(folderId)?.shared) {
      const badge = document.createElement('span')
      badge.className = 'share-badge'
      badge.textContent = '공유'
      badge.title = '이 폴더와 하위 발표를 링크로 볼 수 있습니다'
      toggle.append(badge)
    }
    const more = document.createElement('button')
    more.className = 'folder-more'
    more.dataset.folderMore = folderId
    more.textContent = '···'
    more.title = '폴더 관리'
    head.append(more)
  }

  group.append(head)

  if (!collapsed) {
    const body = document.createElement('div')
    body.className = 'folder-body'
    // 하위 폴더를 먼저, 그 다음 이 폴더에 직접 든 발표.
    // 비었으면 아무것도 넣지 않는다 — 개수 배지가 이미 0 을 말하고, 트리에서는 소음이 된다.
    children.forEach((child) => body.append(folderGroup(child.id, child.name, depth + 1)))
    posts.forEach((p) => body.append(postItem(p)))
    group.append(body)
  }

  return group
}

function renderSearchResults(query) {
  const hits = state.posts.filter((p) => p.title.toLowerCase().includes(query))
  if (!hits.length) {
    const note = document.createElement('p')
    note.className = 'list-empty'
    note.textContent = '검색 결과가 없습니다.'
    el.list.append(note)
    return
  }
  for (const post of hits) {
    const item = postItem(post)
    const where = document.createElement('span')
    where.className = 'hit-folder'
    where.textContent = folderPath(post.folderId ?? null)
    item.append(where)
    el.list.append(item)
  }
}

function renderList() {
  el.list.replaceChildren()

  const query = state.query.trim().toLowerCase()
  if (query) return renderSearchResults(query)

  if (!state.posts.length && !state.folders.length) {
    const note = document.createElement('p')
    note.className = 'list-empty'
    note.textContent = '아직 올린 발표가 없습니다.'
    el.list.append(note)
    return
  }

  childFolders(null).forEach((f) => el.list.append(folderGroup(f.id, f.name)))
  el.list.append(folderGroup(null, UNFILED))
}

/* ---------- 본문 ---------- */

const KIND_LABEL = {
  html: 'HTML',
  md: '마크다운',
  pdf: 'PDF',
  svg: 'SVG',
  png: 'PNG',
  drawio: 'draw.io',
}
const FRAME_SANDBOX = 'allow-scripts allow-popups allow-forms allow-modals allow-downloads'
// PDF·PNG 는 sandbox 를 걸면 브라우저 내장 뷰어가 아예 안 뜬다(PDF 는 실측).
// 둘 다 이 페이지의 JS 로 실행되지 않는 형식이라 가둘 이유도 없다.
const OPEN_KINDS = new Set(['pdf', 'png'])

function applySandbox(post) {
  if (OPEN_KINDS.has(post.kind)) el.frame.removeAttribute('sandbox')
  else el.frame.setAttribute('sandbox', FRAME_SANDBOX)
}

/** 트리 순서로 평평하게 편다. 선택 상자는 줄 순서로만 계층을 보여줄 수 있다. */
function flattenFolders(parentId = null, depth = 0, out = []) {
  for (const folder of childFolders(parentId)) {
    out.push({ ...folder, depth })
    flattenFolders(folder.id, depth + 1, out)
  }
  return out
}

function renderFolderSelect(post) {
  el.folderSelect.replaceChildren()

  const rows = [{ id: '', name: UNFILED, depth: 0 }, ...flattenFolders()]
  for (const { id, name, depth } of rows) {
    const option = document.createElement('option')
    option.value = id
    option.textContent = `${'  '.repeat(depth)}${depth ? '└ ' : ''}${name}`
    el.folderSelect.append(option)
  }
  el.folderSelect.value = post.folderId ?? ''
  el.folderSelect.title = folderPath(post.folderId ?? null)
}

function renderStage() {
  const post = currentPost()

  el.toolbar.hidden = !post
  el.frameWrap.hidden = !post
  el.empty.hidden = Boolean(post)

  if (!post) {
    el.frame.removeAttribute('src')
    return
  }

  el.title.textContent = post.title
  el.meta.textContent =
    `${KIND_LABEL[post.kind] ?? 'HTML'} · ${formatDate(post.createdAt)} 등록 · ` +
    `${Math.max(1, Math.round(post.bytes / 1024))} KB` +
    (post.shared ? '' : ' · 공유 꺼짐')
  el.toggleShare.textContent = post.shared ? '공유 끄기' : '공유 켜기'
  renderFolderSelect(post)
  applySandbox(post)
  // 같은 글을 다시 고르면 처음부터 다시 보여준다. 발표 중 되돌릴 때 필요하다.
  el.frame.src = `/p/${post.id}?t=${Date.now()}`
}

function select(id) {
  state.currentId = id
  const post = currentPost()
  if (post) state.activeFolderId = post.folderId ?? null
  location.hash = id ? `#/${id}` : ''
  renderList()
  renderStage()
}

async function refresh() {
  const { folders, posts } = await api('GET', '/api/posts')
  state.folders = folders
  state.posts = posts
  if (state.currentId && !posts.some((p) => p.id === state.currentId)) state.currentId = null
  if (state.activeFolderId && !folders.some((f) => f.id === state.activeFolderId)) {
    state.activeFolderId = null
  }
  renderList()
  renderStage()
}

/* ---------- 업로드 ---------- */

const UPLOADABLE = /\.(x?html?|md|markdown|mdown|pdf|svg|png|drawio|drawio\.xml)$/i
const isUploadable = (file) => UPLOADABLE.test(file.name)
const isBinary = (file) => /\.(pdf|png)$/i.test(file.name)

const ONLY = 'HTML · 마크다운 · PDF · SVG · PNG · draw.io 만 올릴 수 있습니다.'

/** PDF·PNG 는 글자가 아니다. base64 로 바꿔 JSON 에 실어 보낸다. */
async function readPayload(file) {
  if (!isBinary(file)) return file.text()
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  // 한 번에 넘기면 인자 수 한도에 걸린다. 조각내어 이어 붙인다.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}

async function uploadFiles(files) {
  const targets = [...files].filter(isUploadable)
  if (!targets.length) return toast(ONLY, 'error')

  let last = null
  for (const file of targets) {
    try {
      // 파일 안에 <title>/<h1> 이 없을 때 서버가 파일 이름을 제목으로 쓴다.
      const { post } = await api('POST', '/api/posts', {
        html: await readPayload(file),
        filename: file.name,
        folderId: state.activeFolderId,
      })
      last = post
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 'error')
    }
  }

  await refresh()
  if (last) {
    select(last.id)
    toast(`"${last.title}" → ${folderName(last.folderId ?? null)}`)
  }
}

async function replaceCurrent(file) {
  if (!isUploadable(file)) return toast(ONLY, 'error')
  try {
    await api('PATCH', `/api/posts/${state.currentId}`, {
      html: await readPayload(file),
      filename: file.name,
    })
    await refresh()
    toast('새 버전으로 바꿨습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

function openPicker(mode) {
  state.pickerMode = mode
  el.picker.multiple = mode === 'create'
  el.picker.value = ''
  el.picker.click()
}

/* ---------- 폴더 동작 ---------- */

async function createFolder(parentId = null) {
  const where = parentId ? `"${folderPath(parentId)}" 아래에 만들 폴더 이름` : '새 폴더 이름'
  const name = window.prompt(where)
  if (name === null || !name.trim()) return
  try {
    const { folder } = await api('POST', '/api/folders', { name, parentId })
    state.activeFolderId = folder.id
    // 새로 만든 폴더가 접혀 있으면 어디 생겼는지 안 보인다.
    if (parentId) state.collapsed.delete(String(parentId))
    rememberCollapsed()
    await refresh()
    toast(`"${folderPath(folder.id)}" 폴더를 만들었습니다.`)
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function renameFolder(id) {
  const name = window.prompt('새 폴더 이름', folderName(id))
  if (name === null || !name.trim()) return
  try {
    await api('PATCH', `/api/folders/${id}`, { name })
    await refresh()
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function deleteFolder(id) {
  const posts = postsIn(id).length
  const children = childFolders(id).length
  const parent = state.folders.find((f) => f.id === id)?.parentId ?? null
  const moved = []
  if (posts) moved.push(`발표 ${posts}개`)
  if (children) moved.push(`하위 폴더 ${children}개`)

  const warning = moved.length
    ? `"${folderPath(id)}" 폴더를 지웁니다.\n\n안에 있는 ${moved.join('와 ')}는 ` +
      `"${folderPath(parent)}" (으)로 옮겨지고 지워지지 않습니다.`
    : `"${folderPath(id)}" 폴더를 지웁니다.`
  if (!window.confirm(warning)) return

  try {
    await api('DELETE', `/api/folders/${id}`)
    await refresh()
    toast('폴더를 지웠습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

const folderShareUrl = (folder) => `${location.origin}/f/${folder.shareToken}`
const findFolder = (id) => state.folders.find((f) => f.id === id)

function copyFolderShareLink(id) {
  const folder = findFolder(id)
  if (!folder) return
  if (!folder.shared) {
    return toast('이 폴더는 공유가 꺼져 있습니다. ··· 에서 켜세요.', 'error')
  }
  const count = postsInSubtree(id).length
  copyText(folderShareUrl(folder), `폴더 공유 링크 복사 — 발표 ${count}개가 열립니다.`)
}

async function toggleFolderShare(id) {
  const folder = findFolder(id)
  if (!folder) return
  const count = postsInSubtree(id).length

  if (!folder.shared) {
    const ok = window.confirm(
      `"${folderPath(id)}" 폴더를 공유합니다.\n\n` +
        `이 폴더와 하위 폴더에 있는 발표 ${count}개를 링크만 있으면 누구나 볼 수 있게 됩니다.\n` +
        `앞으로 이 폴더에 올리는 발표도 자동으로 포함됩니다.`,
    )
    if (!ok) return
  }

  try {
    const { folder: next } = await api('PATCH', `/api/folders/${id}`, { shared: !folder.shared })
    await refresh()
    if (next.shared) copyText(folderShareUrl(next), '폴더 공유를 켜고 링크를 복사했습니다.')
    else toast('폴더 공유를 껐습니다. 기존 주소가 막힙니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function rotateFolderShare(id) {
  if (!window.confirm('새 폴더 공유 주소를 발급합니다. 이미 보낸 주소는 더 이상 열리지 않습니다.')) {
    return
  }
  try {
    const { folder } = await api('POST', `/api/folders/${id}/share-token`)
    await refresh()
    if (folder.shared) copyText(folderShareUrl(folder), '새 폴더 공유 링크를 복사했습니다.')
    else toast('새 주소를 발급했습니다. 공유는 꺼져 있습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

/** 그 폴더와 하위 폴더에 든 글 전부. 공유 범위를 사람에게 보여줄 때 쓴다. */
function postsInSubtree(id) {
  const ids = [id]
  for (let at = 0; at < ids.length; at += 1) {
    childFolders(ids[at]).forEach((f) => ids.push(f.id))
  }
  return state.posts.filter((p) => ids.includes(p.folderId ?? null))
}

async function moveFolder(id, parentId) {
  if (id === parentId) return
  try {
    await api('PATCH', `/api/folders/${id}`, { parentId })
    if (parentId) state.collapsed.delete(String(parentId))
    rememberCollapsed()
    await refresh()
    toast(`"${folderPath(id)}" (으)로 옮겼습니다.`)
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function movePost(postId, folderId) {
  const post = state.posts.find((p) => p.id === postId)
  if (!post || (post.folderId ?? null) === folderId) return
  try {
    await api('PATCH', `/api/posts/${postId}`, { folderId })
    await refresh()
    toast(`"${post.title}" → ${folderName(folderId)}`)
  } catch (err) {
    toast(err.message, 'error')
  }
}

/* ---------- 글 동작 ---------- */

function copyText(url, message) {
  const done = () => toast(message)

  // 사내 서버가 http 면 clipboard API 가 막힌다. 그때는 예전 방식으로 떨어진다.
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(done, fallbackCopy)
  } else {
    fallbackCopy()
  }

  function fallbackCopy() {
    const box = document.createElement('textarea')
    box.value = url
    box.style.position = 'fixed'
    box.style.opacity = '0'
    document.body.append(box)
    box.select()
    const ok = document.execCommand('copy')
    box.remove()
    ok ? done() : window.prompt('아래 주소를 복사하세요', url)
  }
}

const shareUrl = (post) => `${location.origin}/s/${post.shareToken}`

function copyShareLink() {
  const post = currentPost()
  if (!post) return
  if (!post.shared) {
    return toast('공유가 꺼져 있습니다. ··· 에서 공유를 켜세요.', 'error')
  }
  copyText(shareUrl(post), '공유 링크를 복사했습니다. 로그인 없이 열립니다.')
}

async function toggleShare() {
  const post = currentPost()
  try {
    const { post: next } = await api('PATCH', `/api/posts/${post.id}`, { shared: !post.shared })
    await refresh()
    toast(next.shared ? '공유를 켰습니다.' : '공유를 껐습니다. 기존 주소가 막힙니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function rotateShare() {
  const post = currentPost()
  if (!window.confirm('새 공유 주소를 발급합니다. 이미 보낸 주소는 더 이상 열리지 않습니다.')) return
  try {
    const { post: next } = await api('POST', `/api/posts/${post.id}/share-token`)
    await refresh()
    copyText(shareUrl(next), '새 공유 링크를 복사했습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function renamePost() {
  const post = currentPost()
  const next = window.prompt('새 제목', post.title)
  if (next === null || next.trim() === post.title) return
  try {
    await api('PATCH', `/api/posts/${post.id}`, { title: next })
    await refresh()
    toast('제목을 바꿨습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function deletePost() {
  const post = currentPost()
  if (!window.confirm(`"${post.title}" 을(를) 삭제합니다. 되돌릴 수 없습니다.`)) return
  try {
    await api('DELETE', `/api/posts/${post.id}`)
    state.currentId = null
    location.hash = ''
    await refresh()
    toast('삭제했습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

function present() {
  if (!state.currentId) return
  el.frameWrap.requestFullscreen?.().then(() => {
    el.frame.focus()
    el.exitHint.classList.add('show')
    setTimeout(() => el.exitHint.classList.remove('show'), 2600)
  }, () => toast('전체화면을 열 수 없습니다.', 'error'))
}

/* ---------- 메뉴 ---------- */

function closeMenus() {
  el.morePop.hidden = true
  el.moreBtn.setAttribute('aria-expanded', 'false')
  el.folderPop.hidden = true
  el.accountPop.hidden = true
}

/* ---------- 계정 ---------- */

async function addUser() {
  const username = window.prompt('새 계정 아이디 (영문 소문자·숫자·.-_ 3~32자)')
  if (!username?.trim()) return
  const password = window.prompt(`"${username.trim()}" 의 비밀번호 (8자 이상)`)
  if (!password) return
  try {
    await api('POST', '/api/users', { username, password })
    toast(`계정 "${username.trim()}" 을(를) 만들었습니다.`)
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function changePassword() {
  const current = window.prompt('현재 비밀번호')
  if (!current) return
  const next = window.prompt('새 비밀번호 (8자 이상)')
  if (!next) return
  try {
    await api('POST', '/api/password', { current, next })
    toast('비밀번호를 바꿨습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function listUsers() {
  try {
    const { users } = await api('GET', '/api/users')
    window.alert(`계정 ${users.length}개\n\n${users.map((u) => `· ${u.username}`).join('\n')}`)
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function logout() {
  await api('POST', '/api/logout').catch(() => {})
  location.replace('/login')
}

/* ---------- 사이드바 이벤트 ---------- */

el.list.addEventListener('click', (e) => {
  const more = e.target.closest('[data-folder-more]')
  if (more) {
    e.stopPropagation()
    state.menuFolderId = more.dataset.folderMore
    el.folderShareToggle.textContent = findFolder(state.menuFolderId)?.shared
      ? '폴더 공유 끄기'
      : '폴더 공유 켜기'
    const box = more.getBoundingClientRect()
    el.folderPop.style.left = `${box.left}px`
    el.folderPop.style.top = `${box.bottom + 4}px`
    el.folderPop.hidden = false
    return
  }

  const toggle = e.target.closest('.folder-toggle')
  if (toggle) {
    const raw = toggle.dataset.folderId
    const id = raw || null
    const key = String(id)
    state.collapsed.has(key) ? state.collapsed.delete(key) : state.collapsed.add(key)
    rememberCollapsed()
    state.activeFolderId = id
    renderList()
    return
  }

  const item = e.target.closest('.post-item')
  if (item) select(item.dataset.id)
})

el.folderPop.addEventListener('click', (e) => {
  const action = e.target.dataset.action
  if (!action) return
  if (action === 'folder-rename') renameFolder(state.menuFolderId)
  if (action === 'folder-sub') createFolder(state.menuFolderId)
  if (action === 'folder-top') moveFolder(state.menuFolderId, null)
  if (action === 'folder-share-copy') copyFolderShareLink(state.menuFolderId)
  if (action === 'folder-share-toggle') toggleFolderShare(state.menuFolderId)
  if (action === 'folder-share-rotate') rotateFolderShare(state.menuFolderId)
  if (action === 'folder-delete') deleteFolder(state.menuFolderId)
})

// 글은 폴더로, 폴더는 다른 폴더 안으로 끌어 옮긴다.
// 선택 상자보다 빠르고, 폴더 이동은 아예 다른 길이 없다.
el.list.addEventListener('dragstart', (e) => {
  const item = e.target.closest('.post-item')
  if (item) {
    e.dataTransfer.setData(POST_MIME, item.dataset.id)
    e.dataTransfer.effectAllowed = 'move'
    return
  }
  const head = e.target.closest('.folder-head')
  const id = head?.closest('.folder')?.dataset.folderId
  if (!id) return
  e.dataTransfer.setData(FOLDER_MIME, id)
  e.dataTransfer.effectAllowed = 'move'
})

el.list.addEventListener('dragover', (e) => {
  const head = e.target.closest('.folder-head')
  if (!head) return
  const types = [...e.dataTransfer.types]
  if (!types.includes(POST_MIME) && !types.includes(FOLDER_MIME)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  head.classList.add('drag-over')
})

el.list.addEventListener('dragleave', (e) => {
  e.target.closest('.folder-head')?.classList.remove('drag-over')
})

el.list.addEventListener('drop', (e) => {
  const head = e.target.closest('.folder-head')
  if (!head) return
  const postId = e.dataTransfer.getData(POST_MIME)
  const folderId = e.dataTransfer.getData(FOLDER_MIME)
  if (!postId && !folderId) return

  e.preventDefault()
  e.stopPropagation()
  head.classList.remove('drag-over')

  const target = head.closest('.folder').dataset.folderId || null
  // 자기 자신이나 자손 안으로 넣는 것은 서버가 400 으로 막는다. 여기서는 그 응답을 보여만 준다.
  if (postId) movePost(postId, target)
  else moveFolder(folderId, target)
})

/* ---------- 나머지 이벤트 ---------- */

el.search.addEventListener('input', () => {
  state.query = el.search.value
  renderList()
})

el.folderSelect.addEventListener('change', () => {
  movePost(state.currentId, el.folderSelect.value || null)
})

// 홈 — 보던 발표를 닫고 파일 올리는 화면으로 돌아온다.
$('homeBtn').addEventListener('click', () => {
  el.search.value = ''
  state.query = ''
  select(null)
})

$('newBtn').addEventListener('click', () => openPicker('create'))
$('newFolderBtn').addEventListener('click', createFolder)
$('emptyBtn').addEventListener('click', () => openPicker('create'))
$('presentBtn').addEventListener('click', present)
$('shareBtn').addEventListener('click', copyShareLink)
$('openBtn').addEventListener('click', () => window.open(`/p/${state.currentId}`, '_blank'))
$('logoutBtn').addEventListener('click', logout)

$('accountBtn').addEventListener('click', (e) => {
  e.stopPropagation()
  const open = el.accountPop.hidden
  closeMenus()
  if (!open) return
  const box = e.currentTarget.getBoundingClientRect()
  el.accountPop.style.left = `${box.left}px`
  el.accountPop.style.top = `${box.top - 110}px`
  el.accountPop.hidden = false
})

el.accountPop.addEventListener('click', (e) => {
  const action = e.target.dataset.action
  if (action === 'add-user') addUser()
  if (action === 'change-password') changePassword()
  if (action === 'list-users') listUsers()
})

el.picker.addEventListener('change', () => {
  const files = el.picker.files
  if (!files.length) return
  state.pickerMode === 'replace' ? replaceCurrent(files[0]) : uploadFiles(files)
})

el.moreBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  const open = el.morePop.hidden
  closeMenus()
  el.morePop.hidden = !open
  el.moreBtn.setAttribute('aria-expanded', String(open))
})

document.addEventListener('click', closeMenus)

el.morePop.addEventListener('click', (e) => {
  const action = e.target.dataset.action
  if (!action) return
  if (action === 'rename') renamePost()
  if (action === 'replace') openPicker('replace')
  if (action === 'download') window.open(`/download/${state.currentId}`, '_blank')
  if (action === 'toggle-share') toggleShare()
  if (action === 'rotate-share') rotateShare()
  if (action === 'delete') deletePost()
})

/*
 * 드래그 상태는 dragenter/dragleave 짝으로는 못 센다 — iframe 위를 지나면
 * leave 만 오고 enter 가 안 와서 오버레이가 화면에 박혀 버린다.
 * 끄는 동안 dragover 가 계속 온다는 성질만 믿고, 끊기면 끝난 것으로 본다.
 */
const DRAG_IDLE_MS = 700
let dragTimer = null

function showDropZone() {
  el.dropTarget.textContent = `${folderName(state.activeFolderId)} 폴더로`
  el.dropOverlay.hidden = false
  // 끄지 않으면 발표 iframe 이 드롭을 먼저 먹고 그 파일로 넘어가 버린다.
  el.frame.style.pointerEvents = 'none'
  clearTimeout(dragTimer)
  dragTimer = setTimeout(hideDropZone, DRAG_IDLE_MS)
}

function hideDropZone() {
  clearTimeout(dragTimer)
  el.dropOverlay.hidden = true
  el.frame.style.pointerEvents = ''
}

window.addEventListener('dragover', (e) => {
  if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  showDropZone()
})

window.addEventListener('drop', (e) => {
  e.preventDefault()
  hideDropZone()
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files)
})

window.addEventListener('dragend', hideDropZone)
window.addEventListener('blur', hideDropZone)

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)
  if (e.metaKey || e.ctrlKey || e.altKey) return

  if (e.key === '/' && !typing) {
    e.preventDefault()
    el.search.focus()
    el.search.select()
  }
  if (e.key === 'Escape') {
    hideDropZone()
    closeMenus()
    if (typing) document.activeElement.blur()
  }
  if (typing) return
  if (e.key === 'n' || e.key === 'N') openPicker('create')
  if (e.key === 'f' || e.key === 'F') present()
})

window.addEventListener('hashchange', () => {
  const id = location.hash.replace(/^#\/?/, '')
  if (id !== state.currentId) select(id || null)
})

/* ---------- 시작 ---------- */

async function start() {
  try {
    const { username } = await api('GET', '/api/me')
    if (!username) return location.replace('/login')
    state.username = username
    el.whoami.textContent = username
    await refresh()
    const id = location.hash.replace(/^#\/?/, '')
    if (id && state.posts.some((p) => p.id === id)) select(id)
  } catch (err) {
    toast(err.message, 'error')
  }
}

start()
