/*
 * 공유 주소로 들어온 사람이 **껐다 켜도 그 자리로 돌아오게** 하는 쿠키다.
 * 로그인 쿠키와 쓰임이 같고, 나가는 길(링크 나가기)도 로그아웃과 같다.
 *
 * 서명하지 않는다. 위조해 봐야 "내가 이미 아는 코드"를 쿠키에 넣는 것뿐이고,
 * 그 코드가 진짜 열리는지는 읽을 때마다 저장소에 다시 물어본다.
 * 그래서 이 쿠키가 주는 권한은 링크 자체가 주는 것보다 한 톨도 많지 않다.
 */
const COOKIE_NAME = 'deck_link'
const MAX_AGE_SEC = 60 * 60 * 24 * 30

const SHAPE = /^([sf]):([A-Za-z0-9_-]{22})$/

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim())
  }
  return out
}

/** @param kind 's' 는 발표 하나, 'f' 는 폴더. */
export function remember(res, kind, token, secureCookie) {
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${MAX_AGE_SEC}`]
  if (secureCookie) flags.push('Secure')
  res.append('Set-Cookie', `${COOKIE_NAME}=${kind}:${token}; ${flags.join('; ')}`)
}

export function forget(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
}

/** 모양이 맞으면 `{ kind, token }`, 아니면 null. 진짜 열리는지는 부르는 쪽이 본다. */
export function read(req) {
  const hit = parseCookies(req.headers.cookie)[COOKIE_NAME]?.match(SHAPE)
  return hit ? { kind: hit[1], token: hit[2] } : null
}
