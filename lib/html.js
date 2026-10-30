const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i
const H1_TAG = /<h1[^>]*>([\s\S]*?)<\/h1>/i
const ANY_TAG = /<[^>]*>/g

const MAX_TITLE_LENGTH = 120

function clean(raw) {
  return raw
    .replace(ANY_TAG, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
}

/** 업로드한 HTML 에서 제목 후보를 뽑는다. <title> 우선, 없으면 첫 <h1>. */
export function extractTitle(html) {
  for (const pattern of [TITLE_TAG, H1_TAG]) {
    const match = html.match(pattern)
    if (!match) continue
    const text = clean(match[1])
    if (text) return text
  }
  return ''
}

/** 사람이 입력한 표시용 문자열(글 제목·폴더 이름)을 한 줄로 다듬는다. */
export function normalizeLabel(value, fallback) {
  const text = typeof value === 'string' ? clean(value) : ''
  return text || fallback
}

/**
 * 발표 HTML 이 통째로 브라우저에 전달되므로, 문자셋을 선언하지 않은 파일은
 * 한글이 깨진다. AI 가 만든 파일에 빠져 있는 경우가 잦아 여기서 보강한다.
 */
export function ensureCharset(html) {
  if (/<meta[^>]+charset/i.test(html)) return html
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (head) => `${head}\n<meta charset="utf-8">`)
  }
  return `<meta charset="utf-8">\n${html}`
}
