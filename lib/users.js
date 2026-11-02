import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { DATA_DIR, USERS_FILE } from './paths.js'

const scryptAsync = promisify(scrypt)

const KEY_LENGTH = 64
const MIN_PASSWORD = 8

let users = []

async function writeAtomic(file, content) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, content, { mode: 0o600 })
  await rename(tmp, file)
}

async function persist() {
  await writeAtomic(USERS_FILE, JSON.stringify({ users }, null, 2))
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = await scryptAsync(password, salt, KEY_LENGTH)
  return { salt, hash: derived.toString('hex') }
}

export async function init() {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    users = JSON.parse(await readFile(USERS_FILE, 'utf8')).users ?? []
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    users = []
  }
}

export const count = () => users.length
export const list = () => users.map((u) => ({ username: u.username, createdAt: u.createdAt }))

export function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function validate(username, password) {
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return '아이디는 영문 소문자·숫자·.-_ 로 3~32자여야 합니다.'
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`
  }
  return null
}

export async function create(username, password) {
  if (users.some((u) => u.username === username)) return false
  const { salt, hash } = await hashPassword(password)
  users.push({ username, salt, hash, createdAt: new Date().toISOString() })
  await persist()
  return true
}

export async function setPassword(username, password) {
  const user = users.find((u) => u.username === username)
  if (!user) return false
  Object.assign(user, await hashPassword(password, user.salt))
  await persist()
  return true
}

export async function remove(username) {
  const at = users.findIndex((u) => u.username === username)
  if (at === -1) return false
  users.splice(at, 1)
  await persist()
  return true
}

/**
 * 아이디가 없을 때도 같은 양의 일을 하고 돌아간다.
 * 틀린 아이디가 더 빨리 끝나면 응답 시간만으로 아이디 존재 여부가 샌다.
 */
export async function verify(username, password) {
  const user = users.find((u) => u.username === username)
  const salt = user?.salt ?? 'decoy'
  const expected = Buffer.from(user?.hash ?? '00'.repeat(KEY_LENGTH), 'hex')
  const derived = await scryptAsync(password ?? '', salt, KEY_LENGTH)
  const match = derived.length === expected.length && timingSafeEqual(derived, expected)
  return Boolean(user) && match
}
