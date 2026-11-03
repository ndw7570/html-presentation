/*
 * 설치형 앱으로 띄우기 위한 최소한의 워커다. **아무것도 캐시하지 않는다.**
 *
 * 캐시를 넣는 순간 "고쳤는데 옛 화면이 나온다"가 시작된다. 발표 자료는 수시로
 * 바뀌고 서버도 docker 로 갈아 끼우는 곳이라, 그 함정이 얻는 것(오프라인)보다 비싸다.
 *
 * 오프라인이 정말 필요해지면 저장 브리지(localStorage → 서버)의 쓰기 큐부터
 * 만들어야 한다. 캐시는 그 다음이다.
 */

// 새 워커가 옛 워커를 기다리지 않고 바로 자리를 넘겨받는다.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// 브라우저가 "설치 가능"으로 치려면 fetch 처리기가 있어야 한다.
// respondWith 를 부르지 않으므로 요청은 평소대로 네트워크로 나간다.
self.addEventListener('fetch', () => {})
