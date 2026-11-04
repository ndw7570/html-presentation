const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** 제목은 올린 사람이 정한 값이다. 그대로 끼워 넣으면 그 자리가 구멍이 된다. */
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c])

/**
 * 공유 주소로 들어온 사람이 보는 화면.
 * 발표를 보고 전체화면으로 띄우는 것 외에는 아무것도 할 수 없다.
 */
// 받는 칸을 하나씩 적는다. 글 객체를 통째로 넘기면 나중에 추가되는 칸
// (발표자 노트 같은 것)이 공유 화면으로 조용히 새어 나간다.
export function sharePage({ title, shareToken, updatedAt, kind }) {
  const safeTitle = escapeHtml(title)
  const date = new Date(updatedAt).toISOString().slice(0, 10).replace(/-/g, '.')
  // PDF 는 sandbox 를 걸면 브라우저 내장 뷰어가 뜨지 않는다(실측).
  const sandbox =
    kind === 'pdf'
      ? ''
      : 'sandbox="allow-scripts allow-popups allow-forms allow-modals allow-downloads"'

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${safeTitle}</title>
<link rel="stylesheet" href="/styles.css">
<script src="/deck-scroll.js" defer></script>
</head>
<body class="share-body">
<header class="share-bar">
  <div class="share-title">
    <h1>${safeTitle}</h1>
    <p>${date} · 읽기 전용</p>
  </div>
  <button class="btn icon" id="reloadBtn" aria-label="새로고침" title="서버에 저장된 최신 상태로 다시 불러옵니다">↻</button>
  <button class="btn" id="exitBtn" title="이 링크를 잊고 처음 화면으로">나가기</button>
  <button class="btn primary" id="presentBtn">발표하기</button>
</header>

<div class="frame-wrap" id="frameWrap">
  <iframe
    id="frame"
    title="${safeTitle}"
    src="/s/${encodeURIComponent(shareToken)}/raw"
    allow="fullscreen"
    ${sandbox}
  ></iframe>
  <div class="exit-hint" id="exitHint">Esc 를 누르면 발표를 끝냅니다</div>
</div>

<script>
const wrap = document.getElementById('frameWrap')
const frame = document.getElementById('frame')
const hint = document.getElementById('exitHint')

function present() {
  wrap.requestFullscreen?.().then(() => {
    frame.focus()
    hint.classList.add('show')
    setTimeout(() => hint.classList.remove('show'), 2600)
  }, () => {})
}

document.getElementById('presentBtn').addEventListener('click', present)
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'f' || e.key === 'F') present()
})
frame.addEventListener('load', () => frame.focus())

/*
 * 앱으로 설치하면 주소창이 없어 새로 고칠 방법이 아예 없다.
 * 읽기 전용이라 여기서 누른 것은 저장되지 않으므로, 서버 값을 다시 받아 오는 길이 필요하다.
 */
document.getElementById('reloadBtn').addEventListener('click', () => {
  frame.src = frame.src.split('?')[0] + '?t=' + Date.now()
})

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
