import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { DATA_DIR, SECRET_FILE } from './paths.js'

const COOKIE_NAME = 'deck_sid'
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14

let secret = null

/**
 * 서명 열쇠는 재시작해도 같아야 한다. 매번 새로 만들면 켤 때마다 전원이 로그아웃된다.
 * 환경변수로 주면 그걸 쓰고, 없으면 한 번 만들어 데이터 폴더에 둔다.
 */
export async function init() {
  if (process.env.SESSION_SECRET) {
    secret = process.env.SESSION_SECRET
    return
  }
  await mkdir(DATA_DIR, { recursive: true })
  try {
    secret = (await readFile(SECRET_FILE, 'utf8')).trim()
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    secret = randomBytes(32).toString('hex')
    await writeFile(SECRET_FILE, secret, { mode: 0o600 })
  }
}

const b64 = (buf) => Buffer.from(buf).toString('base64url')

function sign(payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at === -1) continue
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim())
  }
  return out
}

export function issue(res, username, secureCookie) {
  const payload = b64(JSON.stringify({ u: username, exp: Date.now() + MAX_AGE_MS }))
  const value = `${payload}.${sign(payload)}`
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`]
  if (secureCookie) flags.push('Secure')
  res.append('Set-Cookie', `${COOKIE_NAME}=${value}; ${flags.join('; ')}`)
}

export function clear(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
}

/** 쿠키가 유효하면 아이디를, 아니면 null 을 준다. */
export function read(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (!raw) return null

  const at = raw.lastIndexOf('.')
  if (at === -1) return null
  const payload = raw.slice(0, at)
  const given = Buffer.from(raw.slice(at + 1))
  const wanted = Buffer.from(sign(payload))
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null

  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return exp > Date.now() ? u : null
  } catch {
    return null
  }
}
