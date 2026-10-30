# 발표 게시판 (HTML Deck Board)

AI 가 만들어 준 단일 HTML 파일을 끌어다 놓으면 바로 목록에 올라가고, 그 자리에서 전체화면으로
발표할 수 있는 사내용 게시판. 파일을 주고받는 대신 **주소 하나를 공유**하는 것이 목적이다.

## 빠르게 돌려 보기

```bash
npm install
npm start          # http://localhost:4300
npm run dev        # 코드 고치면 자동 재시작 (node --watch)
```

브라우저를 열고 `.html` 파일을 **화면 아무 데나** 끌어다 놓으면 끝이다.

> Windows PowerShell 5.1 에서는 `npm install && npm start` 가 안 된다. `&&` 를 문 구분자로
> 치지 않는 버전이다. 두 줄로 나눠 치거나 `npm install; npm start` 로 친다.

## 쓰는 법

| 하려는 것 | 방법 |
|---|---|
| 발표 올리기 | 화면에 `.html` 드롭 (여러 개 동시 가능) 또는 `N` 키 |
| 주제 폴더 만들기 | 사이드바 `＋ 폴더` |
| 폴더에 넣기 | 툴바의 폴더 선택 상자를 바꾸거나, 목록에서 글을 폴더 이름 위로 끌어다 놓기 |
| 폴더 이름/삭제 | 폴더 이름 위에 마우스를 올리면 나오는 `···` |
| 발표하기 | `발표하기` 버튼 또는 `F` 키 → 전체화면. `Esc` 로 나감 |
| 남에게 보내기 | `링크 복사` → `http://서버/#/<id>`. 발표 화면만 보여주려면 `새 탭` 의 `/p/<id>` |
| 제목 바꾸기 | `···` → 제목 바꾸기 |
| 같은 글 내용만 교체 | `···` → 새 버전 올리기 (주소가 유지되므로 이미 보낸 링크가 안 깨진다) |
| 검색 | `/` 키 |

제목은 올린 파일의 `<title>` → 첫 `<h1>` → 파일 이름 순으로 자동으로 정해진다.

**폴더는 1단계 평면 구조다.** 폴더 안에 폴더는 없고, 글은 폴더 하나에만 속한다.
어디에도 안 넣은 글은 `미분류` 에 모인다. 새로 올리는 발표는 **마지막으로 누른 폴더**로
들어가고, 드롭할 때 오버레이에 어느 폴더인지 표시된다.

폴더를 지워도 **안에 있던 발표는 지워지지 않고** 미분류로 내려온다.

## 설정

모두 환경변수. 전부 선택이다.

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `PORT` | `4300` | 포트 |
| `HOST` | `0.0.0.0` | 바인딩 주소 |
| `DATA_DIR` | `./data` | 저장 위치 |
| `MAX_UPLOAD` | `50mb` | 파일 한 개 크기 한도 |
| `ADMIN_TOKEN` | 없음 | 설정하면 **올리기·수정·삭제에 암호**를 요구한다. 읽기는 항상 열려 있다 |

`ADMIN_TOKEN` 은 소스에 적지 말고 실행 환경(systemd `Environment=`, `.env` 파일 등)에만 둔다.

## 저장 구조

```
data/
  index.json        폴더 목록 + 글 목록 (사람이 읽고 고칠 수 있는 형식)
  posts/<id>.html   올린 원본 그대로
```

```jsonc
{
  "folders": [{ "id": "6d2f41231d", "name": "제품 기획", "createdAt": "..." }],
  "posts":   [{ "id": "4cffefbde3", "title": "2026 Q1 로드맵",
                "folderId": "6d2f41231d", "createdAt": "...", "bytes": 342 }]
}
```

`folderId` 가 `null` 이면 미분류다. 폴더가 없던 시절의 `index.json` 도 그대로 열린다 —
서버가 뜰 때 `folders: []` 와 `folderId: null` 을 채워 넣는다.

DB 가 없다. `data/` 폴더를 통째로 복사하면 다른 서버로 그대로 옮겨진다. 백업도 이 폴더만 뜨면 된다.

## 올릴 수 있는 HTML

**단일 파일 self-contained HTML** 이 대상이다. AI 가 만드는 발표 자료가 거의 다 이 형태다.

- 되는 것 — 인라인 CSS/JS, Tailwind·Chart.js 같은 CDN 참조, reveal.js 슬라이드, 인라인 SVG, base64 이미지
- 안 되는 것 — `<img src="./img/a.png">` 처럼 **옆에 있는 파일을 참조**하는 HTML (이미지가 안 뜬다).
  이런 자료는 이미지를 base64 로 박아 한 파일로 만든 뒤 올린다
- 문자셋 선언이 없는 파일은 서버가 `<meta charset="utf-8">` 를 넣어 준다. 파일 자체는 UTF-8 이어야 한다

## 격리 — 올린 HTML 은 이 사이트를 건드리지 못한다

올라온 HTML 은 남이 쓴 코드다. 두 겹으로 막아 둔다.

1. 본문은 `sandbox` iframe 안에서 돈다 (`allow-same-origin` 없음)
2. 원본 주소 `/p/<id>` 는 응답 헤더에 `Content-Security-Policy: sandbox …` 를 실어 보낸다.
   **주소로 직접 열어도** 불투명 출처가 되어 이 사이트의 쿠키·`localStorage` 에 닿지 못한다

부작용 하나: 발표 자료가 `localStorage` 에 상태를 저장하려 하면 예외가 난다. 발표용으로는 문제가 없다.

## 도커로 올리기 (권장)

```bash
cp .env.example .env     # 포트·쓰기 암호를 여기서 정한다
docker compose up -d --build
```

끝이다. `http://서버:4300` 으로 열린다.

| 명령 | 하는 일 |
|---|---|
| `docker compose logs -f` | 로그 보기 |
| `docker compose restart` | 재시작 |
| `docker compose up -d --build` | 코드를 고친 뒤 다시 말아 올리기 |
| `docker compose down` | 내리기 (**올린 발표는 안 지워진다**) |

올린 발표는 호스트의 `./data` 에 쌓인다. 컨테이너를 지우거나 이미지를 다시 말아도 남고,
**백업은 이 폴더만 뜨면 된다.**

주의할 것 둘.

- 컨테이너는 `node` 계정(uid 1000)으로 돈다. 리눅스 서버에서 `./data` 에 쓰기가 안 되면
  `sudo chown -R 1000:1000 ./data` 를 한 번 해 준다. Docker Desktop(Windows/macOS)은 그냥 된다
- `docker compose down -v` 는 쓰지 않는다. `-v` 는 볼륨을 지우는 옵션이다

## 사내 서버 배포 (도커 없이)

```ini
# /etc/systemd/system/deck.service
[Service]
WorkingDirectory=/srv/deck
Environment=PORT=4300
Environment=DATA_DIR=/srv/deck-data
Environment=ADMIN_TOKEN=<배포 환경에서 주입>
ExecStart=/usr/bin/node server.js
Restart=always
```

앞단에 nginx 를 두고 **HTTPS 로 받는 것을 권한다.** 평문 HTTP 에서는 브라우저가 클립보드 API 를
막기 때문에 `링크 복사` 가 옛 방식으로 떨어지고, 전체화면 동작도 브라우저에 따라 제한될 수 있다.

> 이 저장소의 서버 설정·배포 설정·스크립트는 **그대로 운영에 올리지 말고** 사내 보안 기준에 맞춰
> 검토·테스트한 뒤 적용한다. 특히 사외 노출 여부와 접근 제어는 반드시 직접 확인할 것.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/config` | 쓰기 보호 여부 |
| `GET` | `/api/posts` | 폴더 + 글 목록 |
| `POST` | `/api/posts` | 등록 `{html, title?, filename?, folderId?}` |
| `PATCH` | `/api/posts/:id` | 제목/내용/폴더 수정 `{title?, html?, folderId?}` |
| `DELETE` | `/api/posts/:id` | 삭제 |
| `POST` | `/api/folders` | 폴더 생성 `{name}` |
| `PATCH` | `/api/folders/:id` | 폴더 이름 변경 `{name}` |
| `DELETE` | `/api/folders/:id` | 폴더 삭제 (안의 글은 미분류로) |
| `GET` | `/p/:id` | 발표 원본 (iframe·공유용) |
| `GET` | `/download/:id` | 원본 내려받기 |

## 파일 구성

```
server.js            라우팅
lib/store.js         파일시스템 저장소 (쓰기 직렬화·원자적 교체)
lib/html.js          제목 추출, charset 보강
public/              화면 (빌드 없음, 바닐라 JS)
Dockerfile           node:22-alpine, 비루트(node) 실행, 헬스체크 포함
docker-compose.yml   포트·암호·볼륨
.env.example         .env 로 복사해서 쓴다
```
