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
`
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
      설명: '발표 자료가 localStorage 에 넣는 값은 서버에 남는다. 직접 읽고 쓸 수도 있다.',
      읽기: `GET ${origin}/api/state/<글id>`,
      쓰기: `PUT ${origin}/api/state/<글id>  body: { "state": { "키": "값" } }`,
      한도: `${maxStateKB}KB`,
    },
    한도: {
      파일: maxUpload,
      발표자노트: '20,000자',
      상태: `${maxStateKB}KB`,
    },
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
