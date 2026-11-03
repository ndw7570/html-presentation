/**
 * 올린 자료가 어떤 저장 수단을 쓰는지 훑는다.
 *
 * 격리 때문에 브라우저 저장은 전부 막혀 있고, 우리는 `localStorage` 만 대신해 준다.
 * 나머지를 쓰는 자료는 **조용히 반만 돌게 된다.** 올릴 때 바로 알려 주려고 본다.
 *
 * 정규식으로 보는 것이라 완벽하지 않다 — 문자열 안의 단어도 잡고, 동적으로 만든
 * 이름은 놓친다. "확실한 진단"이 아니라 "한 번 보라는 신호"로 쓴다.
 */

const RULES = [
  {
    api: 'localStorage',
    pattern: /\blocalStorage\b/,
    level: 'ok',
    message: '저장됩니다. 이 자료가 localStorage 에 넣는 값은 서버에 남습니다.',
  },
  {
    api: 'sessionStorage',
    pattern: /\bsessionStorage\b/,
    level: 'warn',
    message: 'sessionStorage 는 남지 않습니다. 새로 고치면 사라집니다.',
  },
  {
    api: 'indexedDB',
    pattern: /\bindexedDB\b/i,
    level: 'warn',
    message: 'indexedDB 는 쓸 수 없습니다. 그 부분은 동작하지 않습니다.',
  },
  {
    api: 'cookie',
    pattern: /\bdocument\s*\.\s*cookie\b/,
    level: 'warn',
    message: '쿠키는 쓸 수 없습니다. 그 부분은 동작하지 않습니다.',
  },
  {
    api: 'caches',
    pattern: /\bcaches\s*\.\s*open\b/,
    level: 'warn',
    message: 'Cache Storage 는 쓸 수 없습니다.',
  },
  {
    api: 'serviceWorker',
    pattern: /serviceWorker\s*\.\s*register/,
    level: 'warn',
    message: '서비스 워커는 등록되지 않습니다.',
  },
]

/** HTML·마크다운 원본을 받아 발견한 것들을 돌려준다. */
export function scanStorageUse(source) {
  if (typeof source !== 'string') return []
  return RULES.filter((rule) => rule.pattern.test(source)).map(({ api, level, message }) => ({
    api,
    level,
    message,
  }))
}

export const hasWarning = (findings) => findings.some((f) => f.level === 'warn')
