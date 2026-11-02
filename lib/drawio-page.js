const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c])

/**
 * .drawio 원본(mxfile XML)을 그려서 보여주는 한 장짜리 HTML.
 *
 * 뷰어는 저장소에 같이 넣어 둔다(`public/vendor/`). CDN 을 쓰면 인터넷 없는
 * 사내망에서 빈 화면이 되기 때문이다.
 *
 * 뷰어가 들고 있는 기본 경로는 전부 `viewer.diagrams.net` 을 가리킨다.
 * 사내 다이어그램을 열 때마다 외부로 요청이 나가는 셈이라, 로드 전에 로컬 경로로
 * 덮어쓴다. 대신 **기본 도형 밖의 스텐실(AWS·Cisco 아이콘 등)은 그려지지 않는다.**
 * 그 그림들은 draw.io 에서 SVG/PNG 로 내보내 올리는 편이 낫다.
 */
export function drawioPage({ title, xml }) {
  const config = {
    highlight: '#3b6cf6',
    nav: true,
    resize: true,
    toolbar: 'zoom layers',
    'toolbar-nohide': true,
    xml,
  }

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html,body{margin:0;height:100%;background:#fff}
  .mxgraph{width:100%;height:100%}
  #fallback{
    display:none;font:15px/1.7 system-ui,"Malgun Gothic",sans-serif;color:#666c78;
    text-align:center;padding:48px 24px}
  #fallback.show{display:block}
</style>
</head>
<body>
<script>
// 뷰어가 바깥을 보지 못하게 로드 전에 덮어쓴다.
window.PROXY_URL = '/vendor/drawio/proxy'
window.STYLE_PATH = '/vendor/drawio/styles'
window.SHAPES_PATH = '/vendor/drawio/shapes'
window.STENCIL_PATH = '/vendor/drawio/stencils'
window.DRAW_MATH_URL = '/vendor/drawio/math'
window.GRAPH_IMAGE_PATH = '/vendor/drawio/img'
</script>

<div class="mxgraph" data-mxgraph="${escapeHtml(JSON.stringify(config))}"></div>
<p id="fallback">그림을 그리지 못했습니다. 원본을 내려받아 draw.io 에서 열어 보세요.</p>

<script src="/vendor/drawio-viewer.min.js"></script>
<script>
// 뷰어가 아무것도 못 그린 경우에만 안내를 띄운다. 빈 화면으로 두면 고장처럼 보인다.
setTimeout(() => {
  const drawn = document.querySelector('.mxgraph svg, .mxgraph canvas')
  if (!drawn) document.getElementById('fallback').classList.add('show')
}, 1500)
</script>
</body>
</html>
`
}
