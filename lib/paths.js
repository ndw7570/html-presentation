import path from 'node:path'

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve('data')

export const POSTS_DIR = path.join(DATA_DIR, 'posts')
export const INDEX_FILE = path.join(DATA_DIR, 'index.json')
export const USERS_FILE = path.join(DATA_DIR, 'users.json')
export const SECRET_FILE = path.join(DATA_DIR, 'session-secret')
