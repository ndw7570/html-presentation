/**
 * `GET /api` 가 돌려주는 사용 설명.
 *
 * 사람이 README 를 읽고 알려 주는 대신, **AI 가 주소 하나만 치면 쓰는 법을 알게** 한다.
 * 그래서 설명이 길면 안 된다 — 읽고 바로 따라 할 수 있는 만큼만 담는다.
 *
 * 토큰 없이 부르면 모양만, 토큰이 있으면 **지금 있는 폴더 목록까지** 준다.
 * 폴더 이름은 데이터라 아무에게나 보여 주지 않는다.
 */
/**
 * AI 에게 "이렇게 만들어라" 하고 주는 규칙.
 *
 * 전부 **실제로 막혔던 것**만 적는다. 추측으로 늘리면 AI 가 쓸데없이 몸을 사린다.
 * - 격리된 iframe 이라 브라우저 저장이 막힌다(실측). localStorage 만 우리가 대신해 준다
 * - 사내망에 인터넷이 없을 수 있어 CDN 이 안 올 수 있다
 * - 받아서 file:// 로 열면 규칙이 더 빡빡해 CDN·fetch 가 통째로 막힌다
 */
export function authoringText() {
  return `발표 자료 HTML 을 만들 때 지킬 것.

파일 하나로 끝낸다
  · 옆 파일을 참조하지 않는다. <img src="./img/a.png"> 같은 것은 안 뜬다
  · 이미지는 인라인 SVG 나 base64(data:) 로 파일 안에 넣는다
  · 문자 인코딩은 UTF-8

인터넷 없이도 보이게 만든다
  · 웹폰트를 불러오지 않는다. Google Fonts 금지
    대신: font-family: system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif
  · 차트·아이콘은 되도록 인라인 SVG 나 순수 CSS 로 그린다
  · CDN 라이브러리를 꼭 써야 하면, **안 올라와도 화면이 깨지지 않게** 한다
    (예: typeof Chart === 'undefined' 이면 표로 대체)

저장은 localStorage 만 쓴다
  · 체크 상태·입력값 등은 localStorage 에 넣으면 서버에 저장되고 다시 열어도 남는다
  · 넣지 않으면 **아무 데도 안 남는다.** 체크박스를 두기만 하면 새로 고칠 때 전부 풀린다
  · 그릴 때 localStorage 를 **먼저 읽어 화면에 반영**한다. 안 하면 저장은 되는데
    다시 열었을 때 빈 화면이 된다
  · sessionStorage · indexedDB · document.cookie 는 동작하지 않는다. 쓰지 않는다
  · 서비스 워커를 등록하지 않는다

저장한 값은 **모든 사람·모든 PC 가 같이 본다**
  · 내 브라우저에만 남는 값이 아니다. 자료 하나에 저장 자리가 하나뿐이다
  · 그러니 "내가 보던 쪽 번호", "내 테마" 같은 **개인용 값은 넣지 않는다.**
    넣으면 남의 화면까지 따라 움직인다
  · 여럿이 같이 채우는 것(체크리스트·점검표·집계)에 쓰라고 있는 자리다
  · 키 이름은 자료 안에서 겹치지 않게 짓는다 (예: item1, q3-done)
  · 공유 링크로 보는 사람은 **읽기 전용**이라 저장되지 않는다. 저장이 실패해도 화면은
    그대로 돌아가므로 따로 처리하지 않아도 된다
  · 전부 지우는 "처음 상태로" 버튼은 게시판 위쪽에 이미 있다. 자료 안에 만들지 않는다

격리 안에서 도는 것을 전제한다
  · window.parent 나 window.top 의 내용을 건드리지 않는다
  · 바깥 창을 열려면 <a target="_blank" rel="noopener"> 를 쓴다
  · 전체화면은 게시판의 "발표하기" 버튼이 해 준다. 직접 요청하지 않아도 된다

왜 이렇게까지 하나
  이 자료는 게시판 안의 격리된 틀에서 열린다. 또 받아서 파일로 직접 열면
  브라우저 보안 규칙이 더 엄해져 CDN 과 fetch 가 통째로 막힌다.
  바깥에 기대지 않는 파일일수록 어디서 열어도 똑같이 보인다.
`
}

/**
 * 토큰 발급 화면에서 통째로 복사해 AI 에게 붙여 넣는 문구.
 *
 * `/api` 응답은 사람이 읽기엔 길다. 여기엔 **올리는 데 필요한 것만** 담는다 —
 * 주소, 토큰, 본문 모양, 지금 있는 폴더. 더 알고 싶으면 /api 를 보라고만 적는다.
 */
export function briefText({ origin, token, folders = [], expiresAt = null }) {
  const tree = folders.length
    ? folders.map((f) => `  ${f.path}`).join('\n')
    : '  (아직 없음 — folderPath 를 주면 만들어집니다)'

  const expiry = expiresAt
    ? `\n이 토큰은 ${expiresAt.slice(0, 10)} 까지만 씁니다.`
    : ''

  return `아래 발표 게시판에 자료를 올려 줘.
${expiry}

올리는 법
  POST ${origin}/api/posts
  헤더: Authorization: Bearer ${token}
        Content-Type: application/json
  본문:
  {
    "html": "<파일 내용 전체>",
    "filename": "이름.html",
    "folderPath": "폴더/하위폴더"
  }

규칙
  · filename 의 확장자로 종류가 정해진다: .html .md .pdf .svg .png .drawio
  · .pdf 와 .png 는 html 자리에 base64 문자열을 넣는다
  · folderPath 는 없는 폴더를 만들어 준다. 생략하면 "미분류"
  · 제목은 안 줘도 된다 — <title> 이나 첫 제목에서 가져간다
  · 응답의 shareToken 으로 ${origin}/s/<shareToken> 이 공유 주소가 된다
  · 더 자세한 설명: GET ${origin}/api (같은 토큰)

지금 있는 폴더
${tree}

────────────────────────────────────────

${authoringText()}`
}

export function apiGuide({ origin, folders = null, maxUpload, maxStateKB, folderDepth }) {
  const guide = {
    name: '발표 게시판 API',
    사용법: [
      '1) 사이트에 로그인해 `계정 → API 토큰 발급` 으로 토큰을 받는다.',
      '2) 모든 요청에 `Authorization: Bearer <토큰>` 헤더를 붙인다.',
      '3) 아래 `올리기` 대로 POST 하면 끝. 폴더는 `folderPath` 로 이름을 주면 없을 때 만들어 준다.',
    ],
    올리기: {
      method: 'POST',
      url: `${origin}/api/posts`,
      body: {
        html: '파일 내용 전체. PDF·PNG 는 base64 문자열.',
        filename: '확장자로 종류를 가린다: .html .md .pdf .svg .png .drawio',
        folderPath: '"제품 기획/2026 Q1" 처럼 / 로 구분. 없는 폴더는 만들어 준다. 생략하면 미분류.',
        title: '(선택) 안 주면 <title> → 첫 제목 → 파일 이름 순으로 정한다.',
      },
      응답: '{ "post": { "id", "title", "kind", "folderId", "shareToken", "storage": [...] } }',
      공유주소: `${origin}/s/<shareToken>  — 로그인 없이 열리는 읽기 전용 주소`,
    },
    폴더: {
      만들기: {
        method: 'POST',
        url: `${origin}/api/folders`,
        body: { name: '폴더 이름', parentId: '(선택) 상위 폴더 id. 없으면 맨 위' },
      },
      목록: `GET ${origin}/api/posts — folders 와 posts 를 함께 준다`,
      최대깊이: folderDepth,
      참고: '보통은 폴더를 따로 만들 필요가 없다. 올릴 때 folderPath 를 주면 알아서 만든다.',
    },
    자료가_저장한_상태: {
      설명:
        '발표 자료가 localStorage 에 넣는 값은 서버에 남는다. 직접 읽고 쓸 수도 있다. ' +
        '자료 하나에 저장 자리가 하나뿐이라 그 자료를 여는 모든 사람이 같은 값을 본다.',
      초기화: `DELETE ${origin}/api/state/<글id>  — 저장된 것을 모두 지워 맨 처음 상태로`,
      읽기: `GET ${origin}/api/state/<글id>`,
      쓰기: `PUT ${origin}/api/state/<글id>  body: { "state": { "키": "값" } }`,
      한도: `${maxStateKB}KB`,
    },
    한도: {
      파일: maxUpload,
      발표자노트: '20,000자',
      상태: `${maxStateKB}KB`,
    },
    자료를_만들_때: `GET ${origin}/api/authoring — 지켜야 할 것을 글로 돌려준다. 토큰 없이 읽힌다.`,
    예시: [
      `curl -X POST ${origin}/api/posts \\`,
      `  -H "Authorization: Bearer <토큰>" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"html":"<h1>안녕</h1>","filename":"hello.html","folderPath":"제품 기획/2026 Q1"}'`,
    ].join('\n'),
  }

  if (folders) {
    guide.지금_있는_폴더 = folders.length
      ? folders.map(({ id, path }) => ({ id, path }))
      : '아직 없음. folderPath 를 주면 만들어진다.'
  } else {
    guide.지금_있는_폴더 = '토큰을 주면 여기에 목록이 나옵니다.'
  }

  return guide
}
