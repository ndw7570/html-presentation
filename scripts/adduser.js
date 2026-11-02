import readline from 'node:readline'
import * as users from '../lib/users.js'
import { USERS_FILE } from '../lib/paths.js'

await users.init()

console.log(`계정 파일: ${USERS_FILE}`)
const existing = users.list().map((u) => u.username)
console.log(`현재 계정 ${existing.length}개${existing.length ? ` — ${existing.join(', ')}` : ''}\n`)

// readline 은 하나만 만들고, 줄은 비동기 이터레이터로 꺼낸다.
// question() 콜백 방식은 입력이 파이프로 들어올 때 EOF 가 먼저 닿아 중간에 끊긴다.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const lines = rl[Symbol.asyncIterator]()

let muted = false
const write = rl._writeToOutput.bind(rl)
rl._writeToOutput = (text) => {
  if (!muted) write(text)
}

/** secret 이면 입력한 글자가 화면에 찍히지 않는다. */
async function ask(question, secret = false) {
  process.stdout.write(question)
  muted = secret
  const { value } = await lines.next()
  muted = false
  if (secret) process.stdout.write('\n')
  return (value ?? '').replace(/\r$/, '')
}

function die(message) {
  console.error(`\n${message}`)
  rl.close()
  process.exit(1)
}

const username = users.normalizeUsername(await ask('아이디: '))
const password = await ask('비밀번호 (8자 이상): ', true)
const again = await ask('비밀번호 확인: ', true)

if (password !== again) die('비밀번호가 서로 다릅니다.')

const problem = users.validate(username, password)
if (problem) die(problem)

if (!(await users.create(username, password))) {
  die(`"${username}" 은(는) 이미 있는 아이디입니다.`)
}

console.log(`\n계정 "${username}" 을(를) 만들었습니다. 이제 로그인할 수 있습니다.`)
rl.close()
