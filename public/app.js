const $ = (id) => document.getElementById(id)

const UNFILED = '미분류'
const COLLAPSED_KEY = 'collapsedFolders'
// 글을 폴더로 끌어 옮길 때 쓰는 표식. 파일 드롭과 섞이지 않게 전용 타입을 쓴다.
const POST_MIME = 'application/x-deck-post'

const el = {
  list: $('postList'),
  search: $('search'),
  toolbar: $('toolbar'),
  title: $('postTitle'),
  meta: $('postMeta'),
  folderSelect: $('folderSelect'),
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
}

const state = {
  folders: [],
  posts: [],
  currentId: null,
  // 새로 올리는 발표가 들어갈 폴더. null 이면 미분류.
  activeFolderId: null,
  collapsed: new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')),
  query: '',
  writeProtected: false,
  pickerMode: 'create',
  // 폴더 메뉴가 어느 폴더를 겨냥하고 있는지.
  menuFolderId: null,
}

/* ---------- 서버 통신 ---------- */

function token() {
  let value = sessionStorage.getItem('adminToken')
  if (!value) {
    value = window.prompt('쓰기 암호를 입력하세요') || ''
    if (value) sessionStorage.setItem('adminToken', value)
  }
  return value
}

async function api(method, url, body) {
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (state.writeProtected && method !== 'GET') headers['x-admin-token'] = token()

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) sessionStorage.removeItem('adminToken')
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
  meta.textContent = formatDate(post.updatedAt)

  item.append(title, meta)
  return item
}

function folderGroup(folderId, name) {
  const posts = postsIn(folderId)
  const collapsed = state.collapsed.has(String(folderId))

  const group = document.createElement('section')
  group.className = `folder${state.activeFolderId === folderId ? ' active' : ''}`
  group.dataset.folderId = folderId ?? ''

  const head = document.createElement('div')
  head.className = 'folder-head'

  const toggle = document.createElement('button')
  toggle.className = 'folder-toggle'
  toggle.dataset.folderId = folderId ?? ''
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.textContent = collapsed ? '▶' : '▼'
  toggle.append(caret)
  const label = document.createElement('strong')
  label.textContent = name
  const count = document.createElement('span')
  count.className = 'folder-count'
  count.textContent = posts.length
  toggle.append(label, count)
  head.append(toggle)

  // 미분류는 이름을 바꾸거나 지울 대상이 아니다.
  if (folderId !== null) {
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
    if (posts.length) {
      posts.forEach((p) => body.append(postItem(p)))
    } else {
      const note = document.createElement('p')
      note.className = 'list-empty'
      note.textContent = '비어 있음'
      body.append(note)
    }
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
    where.textContent = folderName(post.folderId ?? null)
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

  state.folders.forEach((f) => el.list.append(folderGroup(f.id, f.name)))
  el.list.append(folderGroup(null, UNFILED))
}

/* ---------- 본문 ---------- */

function renderFolderSelect(post) {
  el.folderSelect.replaceChildren()
  for (const { id, name } of [{ id: '', name: UNFILED }, ...state.folders]) {
    const option = document.createElement('option')
    option.value = id
    option.textContent = name
    el.folderSelect.append(option)
  }
  el.folderSelect.value = post.folderId ?? ''
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
  el.meta.textContent = `${formatDate(post.createdAt)} 등록 · ${Math.max(1, Math.round(post.bytes / 1024))} KB`
  renderFolderSelect(post)
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

const isHtmlFile = (file) => /\.x?html?$/i.test(file.name) || file.type === 'text/html'

async function uploadFiles(files) {
  const targets = [...files].filter(isHtmlFile)
  if (!targets.length) return toast('HTML 파일만 올릴 수 있습니다.', 'error')

  let last = null
  for (const file of targets) {
    try {
      // 파일 안에 <title>/<h1> 이 없을 때 서버가 파일 이름을 제목으로 쓴다.
      const { post } = await api('POST', '/api/posts', {
        html: await file.text(),
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
  if (!isHtmlFile(file)) return toast('HTML 파일만 올릴 수 있습니다.', 'error')
  try {
    await api('PATCH', `/api/posts/${state.currentId}`, { html: await file.text() })
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

async function createFolder() {
  const name = window.prompt('새 폴더 이름')
  if (name === null || !name.trim()) return
  try {
    const { folder } = await api('POST', '/api/folders', { name })
    state.activeFolderId = folder.id
    await refresh()
    toast(`"${folder.name}" 폴더를 만들었습니다.`)
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
  const count = postsIn(id).length
  const warning = count
    ? `"${folderName(id)}" 폴더를 지웁니다. 안에 있는 발표 ${count}개는 미분류로 옮겨지고 지워지지 않습니다.`
    : `"${folderName(id)}" 폴더를 지웁니다.`
  if (!window.confirm(warning)) return
  try {
    await api('DELETE', `/api/folders/${id}`)
    await refresh()
    toast('폴더를 지웠습니다.')
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

function copyLink() {
  const url = `${location.origin}/#/${state.currentId}`
  const done = () => toast('링크를 복사했습니다.')

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
}

/* ---------- 사이드바 이벤트 ---------- */

el.list.addEventListener('click', (e) => {
  const more = e.target.closest('[data-folder-more]')
  if (more) {
    e.stopPropagation()
    state.menuFolderId = more.dataset.folderMore
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
  if (action === 'folder-delete') deleteFolder(state.menuFolderId)
})

// 글을 끌어 폴더에 떨어뜨려 옮긴다. 여러 개를 정리할 때 선택 상자보다 빠르다.
el.list.addEventListener('dragstart', (e) => {
  const item = e.target.closest('.post-item')
  if (!item) return
  e.dataTransfer.setData(POST_MIME, item.dataset.id)
  e.dataTransfer.effectAllowed = 'move'
})

el.list.addEventListener('dragover', (e) => {
  const head = e.target.closest('.folder-head')
  if (!head || ![...e.dataTransfer.types].includes(POST_MIME)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  head.classList.add('drag-over')
})

el.list.addEventListener('dragleave', (e) => {
  e.target.closest('.folder-head')?.classList.remove('drag-over')
})

el.list.addEventListener('drop', (e) => {
  const head = e.target.closest('.folder-head')
  const postId = e.dataTransfer.getData(POST_MIME)
  if (!head || !postId) return
  e.preventDefault()
  e.stopPropagation()
  head.classList.remove('drag-over')
  movePost(postId, head.closest('.folder').dataset.folderId || null)
})

/* ---------- 나머지 이벤트 ---------- */

el.search.addEventListener('input', () => {
  state.query = el.search.value
  renderList()
})

el.folderSelect.addEventListener('change', () => {
  movePost(state.currentId, el.folderSelect.value || null)
})

$('newBtn').addEventListener('click', () => openPicker('create'))
$('newFolderBtn').addEventListener('click', createFolder)
$('emptyBtn').addEventListener('click', () => openPicker('create'))
$('presentBtn').addEventListener('click', present)
$('copyBtn').addEventListener('click', copyLink)
$('openBtn').addEventListener('click', () => window.open(`/p/${state.currentId}`, '_blank'))

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
    const config = await api('GET', '/api/config')
    state.writeProtected = config.writeProtected
    await refresh()
    const id = location.hash.replace(/^#\/?/, '')
    if (id && state.posts.some((p) => p.id === id)) select(id)
  } catch (err) {
    toast(err.message, 'error')
  }
}

start()
