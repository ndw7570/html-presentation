/*
 * 홈 화면에 설치할 수 있게 워커를 등록한다. 워커가 하는 일은 없다 — sw.js 주석 참고.
 *
 * http 로 열면 navigator.serviceWorker 자체가 없다. 사내망에서 그럴 수 있으므로
 * 없으면 그냥 넘어간다 — 게시판은 워커 없이도 똑같이 동작한다.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('앱 설치 기능을 켜지 못했습니다:', err.message)
    })
  })
}
