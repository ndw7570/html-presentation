/*
 * 모바일에서 긴 자료를 읽을 때 쓰는 "맨 위 / 맨 아래" 단추.
 *
 * 자료는 불투명 출처 iframe 안이라 **부모가 직접 스크롤할 수 없다.**
 * 그래서 자료에 끼워 넣은 브리지(lib/bridge.js)에게 시키고, 브리지가 대신 스크롤한다.
 *
 * 그래서 안 뜨는 자리가 있다. 그게 맞다 —
 *  · PDF·PNG·SVG 는 브리지가 안 들어간다 (브라우저 뷰어가 제 스크롤을 가진다)
 *  · 슬라이드형 자료는 스크롤이 없다. 눌러도 할 일이 없으니 띄우지 않는다
 *
 * 게시판·글 공유·폴더 공유 세 화면이 모두 iframe 을 #frame 으로 쓴다. 그래서 한 벌이면 된다.
 *
 * IIFE 로 감싼다. 공유 화면의 인라인 스크립트도 최상위에 `frame` 을 선언하는데,
 * 일반 스크립트끼리는 최상위 const 를 공유해서 그대로 두면 이름이 부딪힌다.
 */
;(function () {
  const MESSAGE = 'deck-storage'
  const deck = document.getElementById('frame')
  if (!deck) return

  const send = (body) => deck.contentWindow?.postMessage({ __deck: MESSAGE, ...body }, '*')

  const button = (label, to, title) => {
    const node = document.createElement('button')
    node.type = 'button'
    node.className = 'btn icon'
    node.textContent = label
    node.title = title
    node.setAttribute('aria-label', title)
    node.addEventListener('click', () => send({ kind: 'scroll', to }))
    return node
  }

  const box = document.createElement('div')
  box.className = 'deck-scroll'
  box.hidden = true
  box.append(button('↑', 'top', '맨 위로'), button('↓', 'bottom', '맨 아래로'))
  // frame-wrap 밖에 둔다. 전체화면은 frame-wrap 에만 걸리므로 발표 중에는 안 딸려 간다.
  document.body.append(box)

  window.addEventListener('message', (e) => {
    if (e.source !== deck.contentWindow) return
    const msg = e.data
    if (!msg || msg.__deck !== MESSAGE || msg.kind !== 'scrollable') return
    box.hidden = !msg.yes
  })

  deck.addEventListener('load', () => {
    box.hidden = true
    // 늦게 자라는 자료(폰트·이미지)가 있다. 두 번 물어본다.
    setTimeout(() => send({ kind: 'measure' }), 300)
    setTimeout(() => send({ kind: 'measure' }), 1500)
  })
})()
