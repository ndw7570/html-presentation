/**
 * 폴더째 올린 자료("묶음")의 경로를 검사한다.
 *
 * 경로는 **올린 사람의 브라우저가 준 문자열**이다. 그대로 join 하면 `../` 하나로
 * data/ 바깥이 열린다. 그래서 받기 전에 여기서 한 번 거른다. 통과한 것만 디스크에 닿는다.
 */

// 발표 자료가 실제로 쓰는 것만. 모르는 확장자는 받지 않는다 —
// 받아서 우리 주소로 되돌려 주는 순간 그게 공격면이 된다.
const ALLOWED = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'csv', 'md', 'xml', 'drawio',
  'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf',
  'mp4', 'webm', 'mp3', 'wav', 'ogg',
  'pdf',
])

// 문서로 열릴 수 있는 것들. 격리 헤더를 반드시 함께 보내야 한다.
const DOCUMENT_EXTS = new Set(['html', 'htm', 'svg', 'xml'])

export const MAX_FILES = 600
export const MAX_DEPTH = 10
const MAX_PATH_LEN = 300
const MAX_SEGMENT_LEN = 120

// 윈도우에서 이 이름으로는 파일을 못 만든다. 서버가 윈도우일 수도 있다.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

export const extensionOf = (name) => (name.match(/\.([^./\\]+)$/)?.[1] ?? '').toLowerCase()
export const isDocument = (name) => DOCUMENT_EXTS.has(extensionOf(name))
export const isHtml = (name) => /\.x?html?$/i.test(name)
export const isAllowed = (name) => ALLOWED.has(extensionOf(name))

export const allowedExtensions = () => [...ALLOWED]

/**
 * 받아도 되는 경로면 정리된 경로를, 아니면 이유를 돌려준다.
 * 통과한 경로는 `a/b/c.png` 꼴이다 — 앞뒤 슬래시도 없고 `.`·`..` 도 없다.
 */
export function safePath(raw) {
  if (typeof raw !== 'string' || !raw) return { error: '경로가 비었습니다.' }
  if (raw.includes('\0')) return { error: '경로에 못 쓰는 글자가 있습니다.' }
  if (raw.length > MAX_PATH_LEN) return { error: '경로가 너무 깁니다.' }

  // 윈도우에서 만든 폴더는 역슬래시로 올라온다. 드라이브 문자는 통째로 거절한다.
  const normalized = raw.replace(/\\/g, '/')
  if (/^[a-z]:/i.test(normalized) || normalized.startsWith('/')) {
    return { error: '절대 경로는 받지 않습니다.' }
  }

  const parts = normalized.split('/').filter((p) => p !== '')
  if (!parts.length) return { error: '경로가 비었습니다.' }
  if (parts.length > MAX_DEPTH) return { error: '폴더가 너무 깊습니다.' }

  for (const part of parts) {
    if (part === '.' || part === '..') return { error: '경로에 .. 는 쓸 수 없습니다.' }
    if (part.length > MAX_SEGMENT_LEN) return { error: '이름이 너무 깁니다.' }
    if (RESERVED.test(part)) return { error: `"${part}" 는 쓸 수 없는 이름입니다.` }
    // 끝이 점이나 공백인 이름은 윈도우에서 조용히 다른 파일이 된다.
    if (/[\s.]$/.test(part)) return { error: `"${part}" 는 쓸 수 없는 이름입니다.` }
    // 제어문자·윈도우 금지문자.
    if (/[<>:"|?*\u0000-\u001f]/.test(part)) return { error: `"${part}" 에 못 쓰는 글자가 있습니다.` }
  }

  const clean = parts.join('/')
  if (!isAllowed(clean)) {
    return { error: `받지 않는 확장자입니다: ${clean}` }
  }
  return { path: clean }
}
