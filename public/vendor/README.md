# 외부에서 가져온 파일

여기 있는 것은 우리가 쓴 코드가 아니다. 고치지 않는다.

## drawio-viewer.min.js

- 출처: https://github.com/jgraph/drawio
- 버전: **v24.7.17**
- 라이선스: JGraph License 2.0 (Apache 2.0 기반)
- 크기: 약 2.1MB

`.drawio` 원본을 화면에서 그리는 데 쓴다.

**왜 저장소에 넣었나.** CDN 을 쓰면 인터넷 없는 사내망에서 빈 화면이 된다.
서버에서 이미지로 변환하는 방법은 Electron 이 필요해 이 컨테이너에 들어가지 않는다.

**바깥을 보지 못하게 막아 두었다.** 이 뷰어는 스타일·도형·스텐실·수식을
`viewer.diagrams.net` 에서 받아오는 것이 기본값이다. 사내 다이어그램을 열 때마다
외부로 요청이 나가게 되므로, `lib/drawio-page.js` 가 로드 전에 로컬 경로로 덮어쓴다.
**그 대가로 기본 도형 밖의 스텐실(AWS·Cisco 아이콘 등)은 그려지지 않는다.**
그런 그림은 draw.io 에서 SVG/PNG 로 내보내 올리는 편이 낫다.

### 갱신하는 법

```bash
VER=v24.7.17   # 올리려는 태그로 바꾼다
curl -L -o public/vendor/drawio-viewer.min.js \
  "https://cdn.jsdelivr.net/gh/jgraph/drawio@${VER}/src/main/webapp/js/viewer.min.js"
```

갱신한 뒤에는 **`.drawio` 를 하나 올려서 실제로 그려지는지 눈으로 확인한다.**
위 버전 표기도 같이 고친다.
