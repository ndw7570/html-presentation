import path from 'node:path'

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve('data')

export const POSTS_DIR = path.join(DATA_DIR, 'posts')
// 발표 자료가 스스로 저장한 상태(체크 표시, 지도 핀 …). 글마다 한 파일.
export const STATE_DIR = path.join(DATA_DIR, 'state')
export const INDEX_FILE = path.join(DATA_DIR, 'index.json')
export const USERS_FILE = path.join(DATA_DIR, 'users.json')
export const SECRET_FILE = path.join(DATA_DIR, 'session-secret')
