import { marked } from 'marked'

// 맨 앞의 YAML 머리말. 발표 내용이 아니므로 떼어 낸다.
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

// 슬라이드 구분선: 빈 줄 뒤에 홀로 선 --- 만 센다.
// 앞 줄에 글자가 있으면 그건 구분선이 아니라 h2 밑줄(setext)이다.
const SLIDE_BREAK = /\r?\n\s*\r?\n---+[ \t]*(?=\r?\n)/

const H1 = /^#\s+(.+)$/m

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c])

const stripFrontmatter = (source) => source.replace(FRONTMATTER, '')

/** 첫 `# 제목` 을 글 제목 후보로 쓴다. */
export function extractMarkdownTitle(source) {
  return stripFrontmatter(source).match(H1)?.[1].trim() ?? ''
}

export function hasSlideBreaks(source) {
  return SLIDE_BREAK.test(stripFrontmatter(source))
}

const STYLE = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  font:16px/1.75 "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;
  color:#1b1d22;background:#fff;-webkit-text-size-adjust:100%;
}
h1,h2,h3{line-height:1.3;font-weight:700;letter-spacing:-.4px}
h1{font-size:2em;margin:0 0 .5em}
h2{font-size:1.5em;margin:1.6em 0 .5em}
h3{font-size:1.2em;margin:1.4em 0 .4em}
p,ul,ol,blockquote,table,pre{margin:0 0 1em}
ul,ol{padding-left:1.4em}
li{margin:.3em 0}
a{color:#3b6cf6}
code{background:#f1f3f7;border-radius:4px;padding:.1em .35em;font-size:.9em}
pre{background:#14161b;color:#e6e8ec;padding:16px 18px;border-radius:10px;overflow:auto}
pre code{background:none;padding:0;color:inherit}
blockquote{border-left:3px solid #dfe2e8;padding-left:14px;color:#666c78}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #dfe2e8;padding:8px 10px;text-align:left}
th{background:#f4f5f7}
img{max-width:100%}
hr{border:0;border-top:1px solid #dfe2e8;margin:2em 0}

/* 문서 모드 */
.doc{max-width:820px;margin:0 auto;padding:56px 28px 96px}

/* 슬라이드 모드 */
.deck{height:100%;overflow:hidden}
.slide{
  display:none;height:100%;padding:6vh 8vw;overflow:auto;
  flex-direction:column;justify-content:center;
}
.slide.on{display:flex}
.slide>*{max-width:1100px;width:100%;margin-left:auto;margin-right:auto}
.deck .slide{font-size:clamp(16px,2.1vh + .6vw,26px)}
.deck h1{font-size:2.4em}
.deck h2{font-size:1.8em;margin-top:0}
.pager{
  position:fixed;right:18px;bottom:14px;
  font-size:13px;color:#8b919c;user-select:none;
}
.pager b{color:#1b1d22}
`

const SLIDE_SCRIPT = `
const slides = [...document.querySelectorAll('.slide')]
const pager = document.getElementById('pager')
let at = 0

function show(next) {
  at = Math.max(0, Math.min(slides.length - 1, next))
  slides.forEach((s, i) => s.classList.toggle('on', i === at))
  pager.innerHTML = '<b>' + (at + 1) + '</b> / ' + slides.length
  location.hash = at + 1
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const forward = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']
  const back = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']
  if (forward.includes(e.key)) { e.preventDefault(); show(at + 1) }
  else if (back.includes(e.key)) { e.preventDefault(); show(at - 1) }
  else if (e.key === 'Home') { e.preventDefault(); show(0) }
  else if (e.key === 'End') { e.preventDefault(); show(slides.length - 1) }
})

// 화면 오른쪽 절반을 누르면 다음, 왼쪽이면 이전. 태블릿·터치 화면용.
document.addEventListener('click', (e) => {
  show(e.clientX > innerWidth / 2 ? at + 1 : at - 1)
})

show(Number(location.hash.slice(1)) - 1 || 0)
`

function page(title, body, script = '') {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>
`
}

/**
 * 마크다운을 그대로 보여줄 수 있는 한 장짜리 HTML 로 바꾼다.
 * 빈 줄 뒤에 `---` 가 있으면 슬라이드로, 없으면 스크롤 문서로 만든다.
 */
export function renderMarkdown(source, title = '') {
  const body = stripFrontmatter(source)
  const heading = title || extractMarkdownTitle(body) || '마크다운 발표'

  if (!SLIDE_BREAK.test(body)) {
    return page(heading, `<main class="doc">${marked.parse(body)}</main>`)
  }

  const slides = body
    .split(SLIDE_BREAK)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => `<section class="slide">${marked.parse(chunk)}</section>`)
    .join('\n')

  return page(
    heading,
    `<div class="deck">${slides}</div><div class="pager" id="pager"></div>`,
    SLIDE_SCRIPT,
  )
}
