/**
 * 발표 자료 안에 끼워 넣는 작은 코드.
 *
 * 올린 HTML 은 격리된 iframe 안에서 돈다. 거기서는 `localStorage` 를 건드리기만 해도
 * SecurityError 가 난다. AI 가 만든 자료는 체크 상태 따위를 `localStorage` 에 넣는 일이
 * 잦은데, 그 예외가 최상위에서 터지면 **그 아래 스크립트가 통째로 안 돈다.**
 * "체크박스가 안 눌려요" 로 나타나서 원인 찾기가 고약하다.
 *
 * 그래서 `localStorage` 를 우리 것으로 갈아 끼운다. 서버에 저장할 수 있으면 저장까지 하고,
 * 못 하면 적어도 죽지는 않게 한다. (격리된 문서에서도 defineProperty 로 덮어쓸 수 있다 — 실측)
 *
 * 쓸 수 없는 저장 수단(indexedDB·cookie)에 손대면 그 사실을 부모에게 알린다.
 * 그걸로 "이 자료는 저장이 안 됩니다" 경고를 띄운다.
 */

const MESSAGE = 'deck-storage'
const SAVE_DEBOUNCE_MS = 400

export const STORAGE_MESSAGE = MESSAGE

export function bridgeScript({ state = {}, canWrite = false } = {}) {
  const seed = JSON.stringify(state)

  return `<script>(function(){
  var MSG = ${JSON.stringify(MESSAGE)};
  var CAN_WRITE = ${canWrite ? 'true' : 'false'};
  var data = ${seed};
  var unsupported = [];

  function post(kind, body) {
    try { parent.postMessage(Object.assign({ __deck: MSG, kind: kind }, body), '*') } catch (e) {}
  }

  var timer = null;
  function save() {
    if (!CAN_WRITE) return;
    clearTimeout(timer);
    // 발표 자료가 루프 안에서 써 대는 경우가 있다. 묶어서 한 번만 보낸다.
    timer = setTimeout(function () { post('save', { state: data }) }, ${SAVE_DEBOUNCE_MS});
  }

  function flag(name) {
    if (unsupported.indexOf(name) !== -1) return;
    unsupported.push(name);
    post('unsupported', { api: name });
  }

  var api = {
    getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null },
    setItem: function (k, v) { data[String(k)] = String(v); save() },
    removeItem: function (k) { delete data[String(k)]; save() },
    clear: function () { data = {}; save() },
    key: function (i) { var ks = Object.keys(data); return i < ks.length ? ks[i] : null },
  };
  Object.defineProperty(api, 'length', { get: function () { return Object.keys(data).length } });

  // 자료들이 localStorage.foo = 1 처럼 직접 쓰기도 한다. Proxy 라야 그것까지 받는다.
  var shim = typeof Proxy === 'function' ? new Proxy(api, {
    get: function (t, p) {
      if (p in api) return api[p];
      return Object.prototype.hasOwnProperty.call(data, p) ? data[p] : undefined
    },
    set: function (t, p, v) { if (!(p in api)) { data[String(p)] = String(v); save() } return true },
    has: function (t, p) { return (p in api) || Object.prototype.hasOwnProperty.call(data, p) },
    deleteProperty: function (t, p) { delete data[String(p)]; save(); return true },
    ownKeys: function () { return Object.keys(data) },
    getOwnPropertyDescriptor: function (t, p) {
      return Object.prototype.hasOwnProperty.call(data, p)
        ? { value: data[p], enumerable: true, configurable: true } : undefined
    },
  }) : api;

  try { Object.defineProperty(window, 'localStorage', { value: shim, configurable: true }) } catch (e) {}
  // sessionStorage 는 한 번 보고 마는 값이다. 서버에 남기지 않고 메모리로만 흉내낸다.
  try {
    var s = {};
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null },
      setItem: function (k, v) { s[String(k)] = String(v) },
      removeItem: function (k) { delete s[String(k)] },
      clear: function () { s = {} },
      key: function (i) { var ks = Object.keys(s); return i < ks.length ? ks[i] : null },
      get length() { return Object.keys(s).length },
    } })
  } catch (e) {}

  // 우리가 대신해 줄 수 없는 것들. 손대면 기록해 두고 알린다.
  try {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true, get: function () { flag('indexedDB'); return undefined }
    })
  } catch (e) {}
  try {
    var cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: function () { flag('cookie'); return '' },
      set: function () { flag('cookie') },
    })
  } catch (e) {}

  post('ready', { keys: Object.keys(data).length, canWrite: CAN_WRITE });
})()</script>`
}
