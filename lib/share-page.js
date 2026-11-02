const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** 제목은 올린 사람이 정한 값이다. 그대로 끼워 넣으면 그 자리가 구멍이 된다. */
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c])

/**
 * 공유 주소로 들어온 사람이 보는 화면.
 * 발표를 보고 전체화면으로 띄우는 것 외에는 아무것도 할 수 없다.
 */
export function sharePage({ title, shareToken, updatedAt }) {
  const safeTitle = escapeHtml(title)
  const date = new Date(updatedAt).toISOString().slice(0, 10).replace(/-/g, '.')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${safeTitle}</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body class="share-body">
<header class="share-bar">
  <div class="share-title">
    <h1>${safeTitle}</h1>
    <p>${date} · 읽기 전용</p>
  </div>
  <button class="btn primary" id="presentBtn">발표하기</button>
</header>

<div class="frame-wrap" id="frameWrap">
  <iframe
    id="frame"
    title="${safeTitle}"
    src="/s/${encodeURIComponent(shareToken)}/raw"
    allow="fullscreen"
    sandbox="allow-scripts allow-popups allow-forms allow-modals allow-downloads"
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
</script>
</body>
</html>
`
}
