/**
 * 아주 작은 ZIP 쓰기.
 *
 * node 에 zip 을 만드는 기능은 없다. 있는 것은 `zlib` 의 raw deflate 뿐이고,
 * ZIP 은 그 조각에 머리말과 목차를 붙인 형식이다. 묶음을 내려받게 하려고 그 부분만 쓴다.
 *
 * 쓰지 않는 것: 암호, 분할, ZIP64. 한 묶음은 600개·40MB 로 묶여 있어 ZIP64 가 필요한
 * 4GB·65535개에 닿지 않는다. 닿으면 터지는 대신 거절한다.
 */
import { deflateRawSync } from 'node:zlib'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

// UTF-8 이름이라고 알려 주는 자리(11번 비트). 없으면 한글 이름이 깨져 풀린다.
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

const MAX_ENTRIES = 0xffff
const MAX_BYTES = 0xffffffff

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** ZIP 은 1980년 기준 2초 단위 DOS 시각을 쓴다. */
function dosTime(date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/**
 * @param files `[{ path: 'img/a.png', bytes: Buffer }]`
 * @returns 통째로 만들어진 zip Buffer
 */
export function makeZip(files, when = new Date()) {
  if (files.length > MAX_ENTRIES) throw new Error('파일이 너무 많아 zip 으로 묶을 수 없습니다.')
  const { time, date } = dosTime(when)

  const parts = []
  const central = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8')
    const raw = file.bytes
    const packed = deflateRawSync(raw)
    // jpg·png 는 이미 눌려 있어 다시 누르면 오히려 커진다. 그럴 땐 그냥 담는다.
    const useDeflate = packed.length < raw.length
    const body = useDeflate ? packed : raw
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE
    const crc = crc32(raw)

    if (raw.length > MAX_BYTES || body.length > MAX_BYTES) {
      throw new Error('파일이 너무 커 zip 으로 묶을 수 없습니다.')
    }

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, name, body)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(CENTRAL_SIG, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(FLAG_UTF8, 8)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt16LE(time, 12)
    entry.writeUInt16LE(date, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)

    offset += local.length + name.length + body.length
    if (offset > MAX_BYTES) throw new Error('묶음이 너무 커 zip 으로 묶을 수 없습니다.')
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD_SIG, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...parts, directory, end])
}
