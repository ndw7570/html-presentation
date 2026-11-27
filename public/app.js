const $ = (id) => document.getElementById(id)

const UNFILED = '미분류'
const COLLAPSED_KEY = 'collapsedFolders'
const NOTES_OPEN_KEY = 'notesOpen'
// 왼쪽 메뉴를 접어 뒀는지. 새로 고쳐도 그대로 둔다.
const NAV_HIDDEN_KEY = 'navHidden'
// 어느 보기를 보고 있었는지. 새로 고쳐도 그대로 둔다.
const VIEW_KEY = 'listView'
const NOTES_SAVE_MS = 800
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
  app: document.querySelector('.app'),
  notes: $('notes'),
  notesBox: $('notesBox'),
  notesRead: $('notesRead'),
  notesState: $('notesState'),
  notesBtn: $('notesBtn'),
  storageNotice: $('storageNotice'),
  viewTabs: $('viewTabs'),
  collapseAllBtn: $('collapseAllBtn'),
  navHideBtn: $('navHideBtn'),
  navShowBtn: $('navShowBtn'),
  trashCount: $('trashCount'),
  trashBar: $('trashBar'),
  deleteItem: $('deleteItem'),
  resetBtn: $('resetBtn'),
  frameWrap: $('frameWrap'),
  frame: $('frame'),
  exitHint: $('exitHint'),
  empty: $('empty'),
  dropOverlay: $('dropOverlay'),
  dropTarget: $('dropTarget'),
  toasts: $('toasts'),
  picker: $('filePicker'),
  folderPicker: $('folderPicker'),
  entryDialog: $('entryDialog'),
  entryList: $('entryList'),
  entrySub: $('entrySub'),
  morePop: $('morePop'),
  moreBtn: $('moreBtn'),
  folderPop: $('folderPop'),
  folderShareToggle: $('folderShareToggle'),
  folderShareFrom: $('folderShareFrom'),
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
  notesOpen: localStorage.getItem(NOTES_OPEN_KEY) === '1',
  navHidden: localStorage.getItem(NAV_HIDDEN_KEY) === '1',
  query: '',
  username: null,
  pickerMode: 'create',
  // 무엇을 볼지: live(지운 것 빼고) · all(다) · trash(지운 것만)
  view: localStorage.getItem(VIEW_KEY) || 'live',
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
/**
 * 그 폴더 자신이나 조상 중 하나가 휴지통에 있나.
 * 폴더를 지우면 안에 든 것이 통째로 숨으므로 한 단계만 보면 안 된다.
 */
function folderGone(id) {
  for (let at = id, hops = 0; at && hops <= 8; hops += 1) {
    const folder = state.folders.find((f) => f.id === at)
    if (!folder) break
    if (folder.deletedAt) return true
    at = folder.parentId ?? null
  }
  return false
}

/** 안 보여야 하는 글인가. 제가 지워졌거나, 든 폴더가 지워졌거나. */
const postGone = (post) => Boolean(post.deletedAt) || folderGone(post.folderId ?? null)

/** 지금 보기에 걸리는 글인가. 세 화면이 모두 이 한 줄을 지나간다. */
const inView = (post) =>
  state.view === 'all' ? true : state.view === 'trash' ? postGone(post) : !postGone(post)

/** 트리에 그릴 폴더. 휴지통 탭은 평평하게 따로 그리므로 여기 안 온다. */
const foldersToDraw = (parentId) =>
  childFolders(parentId).filter((f) => state.view === 'all' || !folderGone(f.id))

const postsIn = (folderId) =>
  state.posts.filter((p) => (p.folderId ?? null) === folderId && inView(p))
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

/**
 * 접힌 폴더는 id 문자열로 기억한다. 미분류 칸은 id 가 없어 'null' 이 그 자리다
 * (폴더 토글이 String(null) 로 넣는 값과 같아야 둘이 같은 칸을 가리킨다).
 */
function setAllCollapsed(collapsed) {
  state.collapsed = collapsed
    ? new Set([...state.folders.map((f) => String(f.id)), 'null'])
    : new Set()
  rememberCollapsed()
  renderList()
}

/**
 * 버튼 하나로 접고 편다. 둘을 나란히 두면 늘 하나는 할 일이 없는 버튼이 된다 -
 * 하나라도 접혀 있으면 "펴기"가, 다 펴져 있으면 "접기"가 다음에 할 일이다.
 */
function syncCollapseAll() {
  const anyCollapsed = state.collapsed.size > 0
  el.collapseAllBtn.textContent = anyCollapsed ? '⊞' : '⊟'
  el.collapseAllBtn.title = anyCollapsed ? '폴더 모두 펼치기' : '폴더 모두 접기'
  el.collapseAllBtn.setAttribute('aria-label', el.collapseAllBtn.title)
}

/* ---------- 왼쪽 메뉴 접기 ---------- */

function applyNav() {
  el.app.classList.toggle('nav-hidden', state.navHidden)
  // 두 버튼은 한 번에 하나만 보이지만, 읽어 주는 상태는 둘 다 맞춰 둔다.
  for (const btn of [el.navHideBtn, el.navShowBtn]) {
    btn.setAttribute('aria-expanded', String(!state.navHidden))
  }
}

function toggleNav(hidden = !state.navHidden) {
  state.navHidden = hidden
  localStorage.setItem(NAV_HIDDEN_KEY, hidden ? '1' : '0')
  applyNav()
  // 접었다 펴면 자료 폭이 바뀐다. 자료 쪽에서 크기를 다시 재야 할 수 있다.
  dispatchEvent(new Event('resize'))
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

  // 전체 보기에서는 산 것과 지운 것이 섞인다. 한눈에 갈라져야 한다.
  if (postGone(post)) {
    item.classList.add('gone')
    const gone = document.createElement('span')
    gone.className = 'gone-tag'
    gone.textContent = '삭제됨'
    title.append(gone)
  }
  return item
}

function folderGroup(folderId, name, depth = 0) {
  const posts = postsIn(folderId)
  // folderId 가 null 이면 미분류 칸이다. 최상위 폴더도 parentId 가 null 이라,
  // 그냥 자식을 찾으면 맨 위 폴더들이 미분류 안에 한 번 더 들어간다.
  const children = folderId === null ? [] : foldersToDraw(folderId)
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
    const owner = sharingFolder(folderId)
    if (owner) {
      const mine = owner.id === folderId
      const badge = document.createElement('span')
      badge.className = `share-badge${mine ? '' : ' inherited'}`
      badge.textContent = mine ? '공유' : '공유↑'
      badge.title = mine
        ? '이 폴더와 하위 전체를 링크로 볼 수 있습니다'
        : `상위 "${folderPath(owner.id)}" 를 통해 공유되고 있습니다`
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

/**
 * 휴지통. 폴더째 보여 줄 이유가 없다 - 빈 폴더만 잔뜩 나온다.
 *
 * **맨 바깥에서 지워진 것만** 올린다. 폴더를 지우면 그 안의 글 수십 개가 같이 숨는데,
 * 그걸 전부 늘어놓으면 정작 되살릴 대상인 폴더가 묻힌다.
 */
function renderTrash() {
  const folders = state.folders.filter((f) => f.deletedAt && !folderGone(f.parentId ?? null))
  const posts = state.posts.filter((p) => p.deletedAt && !folderGone(p.folderId ?? null))

  if (!folders.length && !posts.length) {
    const note = document.createElement('p')
    note.className = 'list-empty'
    note.textContent = '휴지통이 비었습니다.'
    el.list.append(note)
    return
  }

  for (const folder of folders) el.list.append(trashFolderRow(folder))
  renderFlat(posts, '')
}

function trashFolderRow(folder) {
  const row = document.createElement('div')
  row.className = 'trash-row'

  const name = document.createElement('strong')
  name.textContent = `📁 ${folder.name}`
  const where = document.createElement('span')
  const inside = postsInSubtree(folder.id).length
  where.textContent = `${folderPath(folder.parentId ?? null)} · 발표 ${inside}개 포함`

  const back = document.createElement('button')
  back.className = 'btn'
  back.textContent = '되살리기'
  back.onclick = () => restoreFolder(folder.id)

  const kill = document.createElement('button')
  kill.className = 'btn danger'
  kill.textContent = '완전 삭제'
  kill.onclick = () => purgeFolder(folder.id)

  const text = document.createElement('div')
  text.className = 'trash-row-text'
  text.append(name, where)

  // 사이드바가 272px 이라 한 줄에 다 넣으면 글자마다 줄바꿈된다.
  const acts = document.createElement('div')
  acts.className = 'trash-row-acts'
  acts.append(back, kill)

  row.append(text, acts)
  return row
}

/** 폴더 없이 한 줄씩. 검색 결과와 휴지통이 같이 쓴다. */
function renderFlat(posts, emptyText) {
  // emptyText 가 빈 문자열이면 이미 다른 줄이 있다는 뜻이다. 아무 말도 안 한다.
  if (!posts.length) {
    if (!emptyText) return
    const note = document.createElement('p')
    note.className = 'list-empty'
    note.textContent = emptyText
    el.list.append(note)
    return
  }
  for (const post of posts) {
    const item = postItem(post)
    const where = document.createElement('span')
    where.className = 'hit-folder'
    where.textContent = folderPath(post.folderId ?? null)
    item.append(where)
    el.list.append(item)
  }
}

function renderSearchResults(query) {
  renderFlat(
    state.posts.filter((p) => inView(p) && p.title.toLowerCase().includes(query)),
    '검색 결과가 없습니다.',
  )
}

/** 켜진 탭과 휴지통 개수를 지금 상태에 맞춘다. 목록을 그릴 때마다 같이 맞춘다. */
function syncViewTabs() {
  // 같은 줄에 탭이 아닌 버튼(접기 토글)이 섞여 있다. data-view 가 탭의 표식이다.
  for (const tab of el.viewTabs.querySelectorAll('button[data-view]')) {
    tab.classList.toggle('on', tab.dataset.view === state.view)
  }
  // 폴더 하나와 그 안의 글 수십 개를 따로 세면 숫자가 겁을 준다. 바깥에서 지운 것만 센다.
  const gone =
    state.folders.filter((f) => f.deletedAt && !folderGone(f.parentId ?? null)).length +
    state.posts.filter((p) => p.deletedAt && !folderGone(p.folderId ?? null)).length
  el.trashCount.hidden = !gone
  el.trashCount.textContent = gone
}

function renderList() {
  syncViewTabs()
  el.list.replaceChildren()

  const query = state.query.trim().toLowerCase()
  // 검색 결과와 휴지통은 폴더 트리가 아니다. 접을 것이 없는데 버튼만 있으면 눌러 보게 된다.
  el.collapseAllBtn.hidden = Boolean(query) || state.view === 'trash'
  syncCollapseAll()
  if (query) return renderSearchResults(query)

  if (state.view === 'trash') return renderTrash()

  if (!state.posts.length && !state.folders.length) {
    const note = document.createElement('p')
    note.className = 'list-empty'
    note.textContent = '아직 올린 발표가 없습니다.'
    el.list.append(note)
    return
  }

  foldersToDraw(null).forEach((f) => el.list.append(folderGroup(f.id, f.name)))
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
  // 분류용 "폴더" 와 가르려고 파일 여러 개짜리 자료는 "묶음" 이라 부른다.
  bundle: '묶음',
}
// to-escape-sandbox 가 빠지면 바깥 링크로 연 새 탭까지 불투명 출처가 되어 흰 화면이 된다.
const FRAME_SANDBOX =
  'allow-scripts allow-popups allow-popups-to-escape-sandbox' +
  ' allow-forms allow-modals allow-downloads'
// PDF·PNG 는 sandbox 를 걸면 브라우저 내장 뷰어가 아예 안 뜬다(PDF 는 실측).
// 둘 다 이 페이지의 JS 로 실행되지 않는 형식이라 가둘 이유도 없다.
const OPEN_KINDS = new Set(['pdf', 'png'])

function applySandbox(post) {
  if (OPEN_KINDS.has(post.kind)) el.frame.removeAttribute('sandbox')
  else el.frame.setAttribute('sandbox', FRAME_SANDBOX)
}

/** 트리 순서로 평평하게 편다. 선택 상자는 줄 순서로만 계층을 보여줄 수 있다. */
function flattenFolders(parentId = null, depth = 0, out = []) {
  // 휴지통에 있는 폴더로 글을 옮길 수는 없다. 보기와 무관하게 늘 뺀다.
  for (const folder of childFolders(parentId).filter((f) => !f.deletedAt)) {
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

/* ---------- 발표 자료가 저장하는 상태 ---------- */

const STORAGE_MESSAGE = 'deck-storage'
const STATE_SAVE_MS = 600

let stateTimer = null

function showStorageNotice(post) {
  const findings = post?.storage ?? []
  const warns = findings.filter((f) => f.level === 'warn')
  el.storageNotice.hidden = !warns.length
  if (!warns.length) return
  el.storageNotice.textContent =
    `저장이 안 되는 기능이 있습니다 — ${warns.map((w) => w.message).join(' ')}`
}

/**
 * 자료 안에 끼워 넣은 코드가 보내는 메시지를 받는다.
 * 보낸 쪽이 지금 보고 있는 그 iframe 인지 반드시 확인한다 — 아무 창이나 보낼 수 있다.
 */
window.addEventListener('message', async (e) => {
  const msg = e.data
  if (!msg || msg.__deck !== STORAGE_MESSAGE) return
  if (e.source !== el.frame.contentWindow) return

  const id = state.currentId
  if (!id) return

  if (msg.kind === 'unsupported') {
    toast(`이 자료는 ${msg.api} 를 씁니다. 그 부분은 저장되지 않습니다.`, 'error')
    return
  }

  // 자료가 뜰 때 저장된 값이 몇 개인지 알려 준다. 있을 때만 되돌리기를 보여 준다.
  if (msg.kind === 'ready') {
    el.resetBtn.hidden = !msg.keys
    return
  }

  if (msg.kind !== 'save') return
  clearTimeout(stateTimer)
  stateTimer = setTimeout(async () => {
    try {
      const { bytes } = await api('PUT', `/api/state/${id}`, { state: msg.state })
      el.notesState.textContent = `자료 상태 저장됨 (${Math.max(1, Math.round(bytes / 1024))}KB)`
      // 방금 저장했으니 되돌릴 것이 생겼다.
      el.resetBtn.hidden = false
    } catch (err) {
      toast(`자료 상태를 저장하지 못했습니다 — ${err.message}`, 'error')
    }
  }, STATE_SAVE_MS)
})

/* ---------- 발표자 노트 ---------- */

let notesTimer = null

function renderNotes(post) {
  el.notes.hidden = !post || !state.notesOpen
  el.notesBtn.setAttribute('aria-pressed', String(state.notesOpen))
  el.notesBtn.classList.toggle('on', state.notesOpen)
  if (!post) return

  const text = post.notes ?? ''
  // 타이핑 중에 서버 응답이 돌아와 커서가 튀는 일을 막는다.
  if (el.notesBox.value !== text && document.activeElement !== el.notesBox) {
    el.notesBox.value = text
  }
  el.notesRead.textContent = text || '적어 둔 메모가 없습니다.'
  el.notesState.textContent = ''
}

function queueNotesSave() {
  const id = state.currentId
  if (!id) return
  el.notesState.textContent = '입력 중…'
  clearTimeout(notesTimer)
  notesTimer = setTimeout(async () => {
    const text = el.notesBox.value
    try {
      await api('PATCH', `/api/posts/${id}`, { notes: text })
      const post = state.posts.find((p) => p.id === id)
      if (post) post.notes = text
      el.notesState.textContent = '저장됨'
    } catch (err) {
      el.notesState.textContent = '저장 실패'
      toast(err.message, 'error')
    }
  }, NOTES_SAVE_MS)
}

function toggleNotes() {
  state.notesOpen = !state.notesOpen
  localStorage.setItem(NOTES_OPEN_KEY, state.notesOpen ? '1' : '0')
  renderNotes(currentPost())
  if (state.notesOpen && !isNarrow()) el.notesBox.focus()
}

/* ---------- 본문 ---------- */

const isNarrow = () => window.matchMedia('(max-width: 720px)').matches

function renderStage() {
  const post = currentPost()

  el.toolbar.hidden = !post
  el.frameWrap.hidden = !post
  el.empty.hidden = Boolean(post)
  // 좁은 화면에서는 목록과 본문을 한 번에 하나만 보여준다.
  el.app.classList.toggle('viewing', Boolean(post))
  renderNotes(post)

  if (!post) {
    el.frame.removeAttribute('src')
    return
  }

  el.title.textContent = post.title
  el.meta.textContent =
    `${KIND_LABEL[post.kind] ?? 'HTML'} · ${formatDate(post.createdAt)} 등록 · ` +
    (post.files ? `파일 ${post.files}개 · ` : '') +
    `${Math.max(1, Math.round(post.bytes / 1024))} KB` +
    (post.shared ? '' : ' · 공유 꺼짐')
  // 묶음은 파일이 여럿이라 zip 으로 나간다. 단추 글씨로 그걸 미리 알려 준다.
  document.querySelector('[data-action="download"]').textContent =
    post.kind === 'bundle' ? 'zip 으로 내려받기' : '원본 내려받기'
  el.toggleShare.textContent = post.shared ? '공유 끄기' : '공유 켜기'
  renderFolderSelect(post)
  applySandbox(post)
  showStorageNotice(post)
  el.trashBar.hidden = !post.deletedAt
  // 이미 휴지통에 있는 것을 또 "휴지통으로" 보낼 수는 없다.
  el.deleteItem.hidden = Boolean(post.deletedAt)
  // 자료가 뜨면서 저장된 게 있다고 알려 주면 그때 다시 켠다.
  el.resetBtn.hidden = true
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

/* ---------- 묶음(폴더째) 업로드 ---------- */

// 서버의 lib/bundle.js 와 같은 목록. 여기서 거르는 건 친절이고, 진짜 판정은 서버가 한다.
const BUNDLE_OK = /\.(html?|css|m?js|json|txt|csv|md|xml|drawio|jpe?g|png|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|mp4|webm|mp3|wav|ogg|pdf)$/i
const MAX_BUNDLE_FILES = 600
const MAX_BUNDLE_BYTES = 40 * 1024 * 1024

/** 떨군 항목을 훑어 { path, file } 목록으로 편다. 폴더면 안까지 들어간다. */
async function walkEntry(entry, prefix = '') {
  if (entry.isFile) {
    const file = await new Promise((ok, no) => entry.file(ok, no))
    return [{ path: prefix + entry.name, file }]
  }
  if (!entry.isDirectory) return []

  const reader = entry.createReader()
  const children = []
  // readEntries 는 한 번에 다 주지 않는다. 빈 배열이 올 때까지 계속 불러야 한다.
  for (;;) {
    const batch = await new Promise((ok, no) => reader.readEntries(ok, no))
    if (!batch.length) break
    children.push(...batch)
  }
  const out = []
  for (const child of children) out.push(...(await walkEntry(child, prefix + entry.name + '/')))
  return out
}

/** <input webkitdirectory> 가 준 파일들. webkitRelativePath 에 폴더 경로가 들어 있다. */
const fromDirectoryInput = (files) =>
  [...files].map((file) => ({ path: file.webkitRelativePath || file.name, file }))

/**
 * 맨 앞의 공통 폴더 이름을 떼어 낸다.
 * "2026-11-23-legacy-review/img/a.png" 를 그대로 두면 주소가 한 단 깊어진다.
 */
function stripCommonRoot(items) {
  const first = items[0].path.split('/')[0]
  if (items.length < 2 && !items[0].path.includes('/')) return items
  if (!items.every((it) => it.path.startsWith(first + '/'))) return items
  return items.map((it) => ({ ...it, path: it.path.slice(first.length + 1) }))
}

const isHtmlPath = (p) => /\.x?html?$/i.test(p)

/** 첫 화면 후보. 맨 위층의 HTML 만 보여 준다 - 하위 폴더 것까지 늘어놓으면 고르기 어렵다. */
function entryCandidates(items) {
  const top = items.filter((it) => isHtmlPath(it.path) && !it.path.includes('/'))
  return (top.length ? top : items.filter((it) => isHtmlPath(it.path)))
    .map((it) => it.path)
    .sort()
}

/** 후보가 둘 이상이면 물어본다. 고르지 않으면 null. */
function askEntry(candidates, items) {
  const index = candidates.find((p) => /^index\.x?html?$/i.test(p))
  if (candidates.length === 1) return Promise.resolve(candidates[0])

  // index.html 이 있으면 그게 관례다. 없으면 가장 큰 파일이 보통 본문이다.
  const biggest = [...candidates].sort(
    (a, b) => (items.find((i) => i.path === b)?.file.size ?? 0) -
      (items.find((i) => i.path === a)?.file.size ?? 0),
  )[0]
  const preset = index ?? biggest

  el.entryList.textContent = ''
  for (const path of candidates) {
    const row = document.createElement('label')
    row.className = 'entry-row'
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'entry'
    radio.value = path
    radio.checked = path === preset
    const size = items.find((i) => i.path === path)?.file.size ?? 0
    const name = document.createElement('span')
    name.textContent = path
    const kb = document.createElement('small')
    kb.textContent = `${Math.max(1, Math.round(size / 1024))} KB`
    row.append(radio, name, kb)
    el.entryList.append(row)
  }
  const total = items.reduce((sum, it) => sum + it.file.size, 0)
  el.entrySub.textContent =
    `파일 ${items.length}개 · ${Math.round(total / 1024 / 1024 * 10) / 10} MB`

  return new Promise((resolve) => {
    el.entryDialog.addEventListener('close', function once() {
      el.entryDialog.removeEventListener('close', once)
      if (el.entryDialog.returnValue !== 'ok') return resolve(null)
      resolve(el.entryList.querySelector('input:checked')?.value ?? null)
    })
    el.entryDialog.showModal()
  })
}

async function toBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}

async function uploadBundle(rawItems) {
  const items = stripCommonRoot(rawItems.filter((it) => BUNDLE_OK.test(it.path)))
  const dropped = rawItems.length - items.length

  if (!items.length) return toast('올릴 수 있는 파일이 폴더에 없습니다.', 'error')
  if (items.length > MAX_BUNDLE_FILES) {
    return toast(`파일이 너무 많습니다. (${items.length}개 · 한도 ${MAX_BUNDLE_FILES}개)`, 'error')
  }
  const total = items.reduce((sum, it) => sum + it.file.size, 0)
  if (total > MAX_BUNDLE_BYTES) {
    return toast(`너무 큽니다. (${Math.round(total / 1024 / 1024)} MB · 한도 40 MB)`, 'error')
  }

  const candidates = entryCandidates(items)
  if (!candidates.length) return toast('폴더 안에 HTML 이 없습니다.', 'error')

  const entry = await askEntry(candidates, items)
  if (!entry) return

  toast(`${items.length}개 읽는 중…`)
  try {
    const files = []
    for (const it of items) files.push({ path: it.path, content: await toBase64(it.file) })
    const { post } = await api('POST', '/api/posts/bundle', {
      entry,
      files,
      folderId: state.activeFolderId,
    })
    await refresh()
    select(post.id)
    toast(
      `"${post.title}" 올렸습니다. 파일 ${items.length}개` +
        (dropped ? ` (받지 않는 ${dropped}개는 뺐습니다)` : ''),
    )
  } catch (err) {
    toast(err.message, 'error')
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

async function createFolder(rawParentId = null) {
  // id 가 아닌 것(클릭 이벤트 등)이 들어오면 맨 위로 친다. 한 번 당한 자리다.
  const parentId = typeof rawParentId === 'string' && rawParentId ? rawParentId : null
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
  const inside = postsInSubtree(id).length
  const warning =
    `"${folderPath(id)}" 폴더를 휴지통으로 보냅니다.\n\n` +
    (inside ? `안에 있는 발표 ${inside}개도 같이 숨습니다. ` : '') +
    '되살리면 지금 모양 그대로 돌아옵니다.'
  if (!window.confirm(warning)) return

  try {
    await api('DELETE', `/api/folders/${id}`)
    await refresh()
    toast('폴더를 휴지통으로 보냈습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

const folderShareUrl = (folder) => `${location.origin}/f/${folder.shareToken}`
const findFolder = (id) => state.folders.find((f) => f.id === id)

/**
 * 이 폴더를 실제로 열어 주고 있는 폴더. 자기 자신일 수도, 위쪽 조상일 수도 있다.
 *
 * 폴더를 공유하면 그 아래가 통째로 열린다(서버가 subtree 로 판단한다).
 * 그런데 하위 폴더의 `shared` 는 false 로 남아서, 화면만 보면 안 열린 것처럼 보인다.
 * 그 거짓말을 막으려고 조상을 거슬러 올라가 찾는다.
 */
function sharingFolder(id) {
  for (let at = id; at; ) {
    const folder = findFolder(at)
    if (!folder) return null
    if (folder.shared) return folder
    at = folder.parentId ?? null
  }
  return null
}

function copyFolderShareLink(id) {
  // 자기가 꺼져 있어도 위에서 열어 주고 있으면 그 링크를 준다.
  // "꺼져 있습니다" 만 띄우면, 실제로는 열려 있는데 길을 못 찾는다.
  const owner = sharingFolder(id)
  if (!owner) {
    return toast('이 폴더는 공유가 꺼져 있습니다. ··· 에서 켜세요.', 'error')
  }
  const count = postsInSubtree(owner.id).length
  const where =
    owner.id === id
      ? `발표 ${count}개가 열립니다.`
      : `상위 "${folderPath(owner.id)}" 의 링크입니다 — 그 폴더 전체(발표 ${count}개)가 열립니다.`
  copyText(folderShareUrl(owner), `폴더 공유 링크 복사 — ${where}`)
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

/**
 * 끌어 온 것을 target 옆에 끼워 넣는다.
 *
 * 다른 자리로 건너온 경우(다른 폴더의 글, 다른 상위 폴더의 폴더)에는 **먼저 옮기고** 나서
 * 차례를 매긴다. 안 그러면 그 자리에 없는 것의 순서를 보내게 된다.
 */
async function insertBeside(dragId, kind, plan) {
  const targetId = plan.el.closest('.folder')?.dataset.folderId || null
  const isFolder = kind === 'folder'

  // 끼워 넣을 자리의 주인. 글이면 그 글이 든 폴더, 폴더면 그 폴더의 상위.
  const anchorId = plan.el.classList.contains('post-item')
    ? plan.el.dataset.id
    : (targetId ?? null)
  const anchor = isFolder
    ? state.folders.find((f) => f.id === anchorId)
    : state.posts.find((p) => p.id === anchorId)
  // 조용히 끝내면 "끌었는데 아무 일도 안 난다" 가 된다. 한 번 그렇게 당했다.
  if (!anchor) return toast('여기에는 놓을 수 없습니다.', 'error')

  const container = isFolder ? (anchor.parentId ?? null) : (anchor.folderId ?? null)
  const current = isFolder
    ? state.folders.find((f) => f.id === dragId)
    : state.posts.find((p) => p.id === dragId)
  if (!current) return
  if (isFolder && dragId === anchorId) return

  const home = isFolder ? (current.parentId ?? null) : (current.folderId ?? null)

  try {
    if (home !== container) {
      if (isFolder) await api('PATCH', `/api/folders/${dragId}`, { parentId: container })
      else await api('PATCH', `/api/posts/${dragId}`, { folderId: container })
      await refresh()
    }

    const siblings = (isFolder ? childFolders(container) : postsIn(container))
      .map((x) => x.id)
      .filter((id) => id !== dragId)
    const at = siblings.indexOf(anchorId)
    siblings.splice(at === -1 ? siblings.length : at + (plan.after ? 1 : 0), 0, dragId)

    await api('POST', '/api/reorder', { kind, ids: siblings })
    await refresh()
  } catch (err) {
    toast(err.message, 'error')
  }
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
  if (!window.confirm(
    `"${post.title}" 을(를) 휴지통으로 보냅니다.\n공유 주소는 바로 안 열리게 됩니다.`,
  )) return
  try {
    await api('DELETE', `/api/posts/${post.id}`)
    // 닫지 않는다. 방금 지운 것을 눈앞에 두어야 되살리기가 보인다.
    await refresh()
    toast('휴지통으로 보냈습니다. 되살릴 수 있습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function restoreFolder(id) {
  try {
    await api('POST', `/api/folders/${id}/restore`)
    await refresh()
    toast('폴더를 되살렸습니다. 안에 있던 것도 같이 돌아왔습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function purgeFolder(id) {
  const folder = state.folders.find((f) => f.id === id)
  const inside = postsInSubtree(id).length
  if (!window.confirm(
    `"${folder?.name ?? ''}" 폴더와 그 아래 **전부**를 완전히 지웁니다.\n` +
      (inside ? `발표 ${inside}개의 원본 파일까지 사라집니다.\n` : '') +
      '되돌릴 수 없습니다.',
  )) return
  try {
    await api('DELETE', `/api/folders/${id}/purge`)
    await refresh()
    toast('완전히 지웠습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function restorePost() {
  const post = currentPost()
  if (!post) return
  try {
    await api('POST', `/api/posts/${post.id}/restore`)
    await refresh()
    toast('되살렸습니다. 쓰던 공유 주소도 다시 열립니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function purgePost() {
  const post = currentPost()
  if (!post) return
  if (!window.confirm(
    `"${post.title}" 을(를) **완전히** 지웁니다.\n원본 파일과 저장된 상태까지 사라지고, 되돌릴 수 없습니다.`,
  )) return
  try {
    await api('DELETE', `/api/posts/${post.id}/purge`)
    state.currentId = null
    location.hash = ''
    await refresh()
    toast('완전히 지웠습니다.')
  } catch (err) {
    toast(err.message, 'error')
  }
}

/**
 * 자료가 저장해 둔 것을 모두 지운다.
 * 저장 자리가 자료당 하나라 **보는 사람 모두에게** 되돌아간다. 그래서 그렇게 묻는다.
 */
async function resetState() {
  const post = currentPost()
  if (!post) return
  if (!window.confirm(
    `"${post.title}" 에 저장된 것을 모두 지우고 맨 처음 상태로 되돌립니다.\n` +
      '이 발표를 보는 모든 사람에게 적용됩니다. 되돌릴 수 없습니다.',
  )) return
  try {
    await api('DELETE', `/api/state/${post.id}`)
    el.resetBtn.hidden = true
    // 상태는 그릴 때 코드에 박히므로, 다시 불러와야 처음 모습이 된다.
    el.frame.src = `/p/${post.id}?t=${Date.now()}`
    toast('처음 상태로 되돌렸습니다.')
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
    const folder = findFolder(state.menuFolderId)
    const owner = sharingFolder(state.menuFolderId)
    el.folderShareToggle.textContent = folder?.shared ? '폴더 공유 끄기' : '폴더 공유 켜기'
    // 위에서 열어 주고 있으면 그 사실을 적는다. 안 적으면 "꺼짐" 으로 읽힌다.
    el.folderShareFrom.hidden = !owner || owner.id === state.menuFolderId
    if (!el.folderShareFrom.hidden) {
      el.folderShareFrom.textContent = `↑ "${folderPath(owner.id)}" 를 통해 공유 중`
    }
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

/*
 * 끌어 놓을 때 두 가지를 해야 한다 — 폴더 **안으로** 넣기와 **사이에** 끼우기.
 * 같은 화면에서 구분하려고 자리로 가른다:
 *   폴더 이름 한가운데(위아래 30% 를 뺀 자리) → 그 폴더 안으로
 *   그 밖의 모든 가장자리 → 그 자리에 끼워 넣기(순서 변경)
 * 글 항목에는 안에 넣을 것이 없으니 언제나 순서 변경이다.
 */
const EDGE = 0.3

function dropPlan(e) {
  const types = [...e.dataTransfer.types]
  const dragging = types.includes(POST_MIME) ? 'post' : types.includes(FOLDER_MIME) ? 'folder' : null
  if (!dragging) return null

  const item = e.target.closest('.post-item')
  if (item) {
    // 폴더를 글 위에 놓는 건 뜻이 모호하다. 받지 않는다.
    if (dragging === 'folder') return null
    const box = item.getBoundingClientRect()
    return { dragging, mode: 'insert', el: item, after: e.clientY > box.top + box.height / 2 }
  }

  const head = e.target.closest('.folder-head')
  if (!head) return null
  const isUnfiled = !head.closest('.folder').dataset.folderId

  // 글은 폴더 이름 **어디에 놓든** 그 폴더로 옮긴다. 미분류도 마찬가지다.
  // 글은 폴더 안에 사는 것이라 폴더 머리글과 차례를 다툴 일이 없다.
  if (dragging === 'post') return { dragging, mode: 'into', el: head }

  // 폴더끼리는 가른다 — 한가운데는 안으로, 가장자리는 차례 바꾸기.
  // 미분류는 폴더가 아니라서 둘 다 해당이 없다.
  if (isUnfiled) return null
  const box = head.getBoundingClientRect()
  const ratio = (e.clientY - box.top) / box.height
  if (ratio > EDGE && ratio < 1 - EDGE) return { dragging, mode: 'into', el: head }
  return { dragging, mode: 'insert', el: head, after: ratio >= 0.5 }
}

function clearDropMarks() {
  for (const node of el.list.querySelectorAll('.drag-over, .insert-before, .insert-after')) {
    node.classList.remove('drag-over', 'insert-before', 'insert-after')
  }
}

el.list.addEventListener('dragover', (e) => {
  const plan = dropPlan(e)
  if (!plan) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  clearDropMarks()
  if (plan.mode === 'into') plan.el.classList.add('drag-over')
  else plan.el.classList.add(plan.after ? 'insert-after' : 'insert-before')
})

el.list.addEventListener('dragleave', (e) => {
  if (!el.list.contains(e.relatedTarget)) clearDropMarks()
})

el.list.addEventListener('drop', (e) => {
  const plan = dropPlan(e)
  if (!plan) return
  e.preventDefault()
  e.stopPropagation()
  clearDropMarks()

  const postId = e.dataTransfer.getData(POST_MIME)
  const folderId = e.dataTransfer.getData(FOLDER_MIME)

  if (plan.mode === 'into') {
    const target = plan.el.closest('.folder').dataset.folderId || null
    // 자기 자신이나 자손 안으로 넣는 것은 서버가 400 으로 막는다. 여기서는 응답을 보여만 준다.
    if (postId) movePost(postId, target)
    else moveFolder(folderId, target)
    return
  }
  insertBeside(postId || folderId, postId ? 'post' : 'folder', plan)
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

$('backBtn').addEventListener('click', () => select(null))
el.notesBtn.addEventListener('click', toggleNotes)
el.notesBox.addEventListener('input', queueNotesSave)

$('newBtn').addEventListener('click', () => openPicker('create'))
// 함수를 그대로 넘기면 클릭 이벤트가 첫 인자(parentId) 자리로 들어간다.
$('newFolderBtn').addEventListener('click', () => createFolder(null))
$('emptyBtn').addEventListener('click', () => openPicker('create'))
$('presentBtn').addEventListener('click', present)
$('shareBtn').addEventListener('click', copyShareLink)
$('openBtn').addEventListener('click', () => window.open(`/p/${state.currentId}`, '_blank'))
el.resetBtn.addEventListener('click', resetState)
$('restoreBtn').addEventListener('click', restorePost)
$('purgeBtn').addEventListener('click', purgePost)

el.viewTabs.addEventListener('click', (e) => {
  const view = e.target.closest('button')?.dataset.view
  if (!view || view === state.view) return
  state.view = view
  localStorage.setItem(VIEW_KEY, view)
  renderList()
})
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

el.collapseAllBtn.addEventListener('click', () => setAllCollapsed(state.collapsed.size === 0))
el.navHideBtn.addEventListener('click', () => toggleNav(true))
el.navShowBtn.addEventListener('click', () => toggleNav(false))

$('emptyFolderBtn').addEventListener('click', () => {
  el.folderPicker.value = ''
  el.folderPicker.click()
})

el.folderPicker.addEventListener('change', () => {
  if (el.folderPicker.files.length) uploadBundle(fromDirectoryInput(el.folderPicker.files))
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

window.addEventListener('drop', async (e) => {
  e.preventDefault()
  hideDropZone()

  // 폴더를 떨구면 dataTransfer.files 에는 쓸 것이 안 들어온다. items 로 들어가야 안이 보인다.
  const entries = [...(e.dataTransfer.items ?? [])]
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean)

  if (entries.some((entry) => entry.isDirectory)) {
    const items = []
    for (const entry of entries) items.push(...(await walkEntry(entry)))
    return uploadBundle(items)
  }
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files)
})

window.addEventListener('dragend', hideDropZone)
window.addEventListener('blur', hideDropZone)

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)
  if (e.metaKey || e.ctrlKey || e.altKey) return
  // 메모를 쓰는 중에 F 가 발표를 띄우면 안 된다. typing 검사가 그걸 막는다.

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
  if (e.key === 'b' || e.key === 'B') toggleNav()
})

window.addEventListener('hashchange', () => {
  const id = location.hash.replace(/^#\/?/, '')
  if (id !== state.currentId) select(id || null)
})

/* ---------- 시작 ---------- */

async function start() {
  // 서버를 기다리기 전에 걸어 둔다. 접어 둔 사람에게 메뉴가 한 번 번쩍이면 안 된다.
  applyNav()
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
