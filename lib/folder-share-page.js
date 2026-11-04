const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** 제목·폴더 이름은 올린 사람이 정한 값이다. 그대로 끼워 넣으면 그 자리가 구멍이 된다. */
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c])

const KIND_LABEL = { html: 'HTML', md: 'MD', pdf: 'PDF', svg: 'SVG', png: 'PNG', drawio: 'draw.io' }

const date = (iso) => new Date(iso).toISOString().slice(0, 10).replace(/-/g, '.')

/**
 * 폴더 공유 주소로 들어온 사람이 보는 화면.
 * 왼쪽에 그 폴더 아래 전체 목록, 오른쪽에 고른 것. 올리거나 고칠 길은 없다.
 *
 * 목록은 **폴더별로 묶어** 보여 준다. 폴더를 나눈 데는 이유가 있고, 그 묶음과
 * 차례가 공유받는 쪽에도 뜻이 있다. 다만 접히는 트리로는 만들지 않는다 —
 * 처음 보는 사람에게 펴고 접게 시키면 그만큼 못 찾고, 좁은 화면에서 깊은
 * 들여쓰기는 읽히지 않는다. 경로를 소제목으로 눌러 담는다.
 *
 * @param folder 공유 중인 폴더
 * @param groups `{ path, posts }` 목록. path 는 공유 폴더를 기준으로 한 상대 경로.
 */
export function folderSharePage(folder, groups) {
  const token = encodeURIComponent(folder.shareToken)
  const entries = groups.flatMap(({ path, posts }) => posts.map((post) => ({ post, path })))

  const row = (post) => `<button class="row" data-id="${post.id}">
        <strong>${escapeHtml(post.title)}</strong>
        <span class="meta">${KIND_LABEL[post.kind] ?? post.kind} · ${date(post.updatedAt)}</span>
      </button>`

  const rows = groups
    .map(({ path, posts }) => {
      // 공유한 폴더 자신에 든 글은 머리글 없이 바로 올린다. 제 이름은 이미 위에 있다.
      const head = path ? `<p class="group-head">${escapeHtml(path)}</p>` : ''
      return `<section class="group">${head}${posts.map(row).join('\n')}</section>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(folder.name)}</title>
<link rel="stylesheet" href="/styles.css">
<script src="/deck-scroll.js" defer></script>
</head>
<body class="fshare-body">

<aside class="fshare-list">
  <header>
    <div class="fshare-head-text">
      <h1>${escapeHtml(folder.name)}</h1>
      <p>발표 ${entries.length}개 · 읽기 전용</p>
    </div>
    <button class="btn" id="exitBtn" title="이 링크를 잊고 처음 화면으로">나가기</button>
  </header>
  <nav id="rows">${rows || '<p class="list-empty">이 폴더에는 발표가 없습니다.</p>'}</nav>
</aside>

<main class="fshare-stage">
  <header class="share-bar">
    <button class="btn fshare-back" id="backBtn" style="display:none" title="목록으로">←</button>
    <div class="share-title">
      <h2 id="title">왼쪽에서 발표를 고르세요</h2>
      <p id="sub">읽기 전용</p>
    </div>
    <button class="btn icon" id="reloadBtn" aria-label="새로고침" title="서버에 저장된 최신 상태로 다시 불러옵니다" disabled>↻</button>
    <button class="btn primary" id="presentBtn" disabled>발표하기</button>
  </header>
  <div class="frame-wrap" id="frameWrap">
    <iframe id="frame" title="발표 내용" allow="fullscreen"></iframe>
    <div class="exit-hint" id="exitHint">Esc 를 누르면 발표를 끝냅니다</div>
  </div>
</main>

<script>
const TOKEN = ${JSON.stringify(folder.shareToken)}
const ENTRIES = ${JSON.stringify(
    entries.map(({ post, path }) => ({
      id: post.id,
      title: post.title,
      kind: post.kind,
      path,
      updatedAt: post.updatedAt,
    })),
  )}

const frame = document.getElementById('frame')
const wrap = document.getElementById('frameWrap')
const hint = document.getElementById('exitHint')
const presentBtn = document.getElementById('presentBtn')
const reloadBtn = document.getElementById('reloadBtn')
let current = null

/*
 * 앱으로 설치하면 주소창이 없어 새로 고칠 방법이 아예 없다.
 * 읽기 전용이라 여기서 누른 것은 저장되지 않으므로, 서버 값을 다시 받아 오는 길이 필요하다.
 */
reloadBtn.addEventListener('click', () => { if (current) open(current.id) })

// PDF·PNG 는 sandbox 를 걸면 브라우저 내장 뷰어가 뜨지 않는다. 나머지는 가둔다.
const OPEN_KINDS = new Set(['pdf', 'png'])
const SANDBOX = 'allow-scripts allow-popups allow-forms allow-modals allow-downloads'

function open(id) {
  const entry = ENTRIES.find((e) => e.id === id)
  if (!entry) return
  current = entry
  document.getElementById('title').textContent = entry.title
  document.getElementById('sub').textContent =
    (entry.path ? entry.path + ' · ' : '') + '읽기 전용'
  presentBtn.disabled = false
  reloadBtn.disabled = false

  for (const row of document.querySelectorAll('.row')) {
    row.classList.toggle('on', row.dataset.id === id)
  }
  if (OPEN_KINDS.has(entry.kind)) frame.removeAttribute('sandbox')
  else frame.setAttribute('sandbox', SANDBOX)

  frame.src = '/f/' + encodeURIComponent(TOKEN) + '/' + id + '/raw?t=' + Date.now()
  location.hash = id
  // 좁은 화면에서는 목록을 덮고 본문만 보여준다.
  document.body.classList.add('viewing')
}

document.getElementById('backBtn').addEventListener('click', () => {
  document.body.classList.remove('viewing')
})

function present() {
  if (!current) return
  wrap.requestFullscreen?.().then(() => {
    frame.focus()
    hint.classList.add('show')
    setTimeout(() => hint.classList.remove('show'), 2600)
  }, () => {})
}

document.getElementById('rows').addEventListener('click', (e) => {
  const row = e.target.closest('.row')
  if (row) open(row.dataset.id)
})
presentBtn.addEventListener('click', present)
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'f' || e.key === 'F') present()
})
window.addEventListener('hashchange', () => open(location.hash.slice(1)))

// 좁은 화면에서는 먼저 목록을 보여준다. 자동으로 열면 목록을 못 본 채 시작된다.
const narrow = window.matchMedia('(max-width: 720px)').matches
const first = location.hash.slice(1) || (narrow ? null : ENTRIES[0]?.id)
if (first) open(first)

// 기억해 둔 링크를 잊는다. 그래야 다음에 열 때 주소 넣는 화면이 나온다.
document.getElementById('exitBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget
  btn.disabled = true
  try {
    if (!(await fetch('/api/link-out', { method: 'POST' })).ok) throw new Error()
    location.href = '/'
  } catch {
    btn.disabled = false
    btn.textContent = '다시 눌러 주세요'
  }
})
</script>
</body>
</html>
`
}

/** 브라우저가 못 여는 형식(.drawio 등)에 띄우는 안내. */
export function noPreviewPage({ title, kind }) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
body{font:15px/1.7 system-ui,"Malgun Gothic",sans-serif;color:#1b1d22;background:#f4f5f7;
  display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px}
.card{background:#fff;border:1px solid #dfe2e8;border-radius:14px;padding:32px 36px;max-width:420px}
h1{font-size:17px;margin:0 0 8px}
p{margin:0;color:#666c78}
code{background:#f1f3f7;border-radius:4px;padding:.1em .35em}
</style></head>
<body><div class="card">
<h1>${escapeHtml(KIND_LABEL[kind] ?? kind)} 파일은 여기서 바로 볼 수 없습니다</h1>
<p>원본을 내려받아 <code>draw.io</code> 에서 여세요.<br>
그림을 이 화면에서 바로 보려면 draw.io 에서 <b>SVG 또는 PNG 로 내보내</b> 올리면 됩니다.</p>
</div></body></html>
`
}
