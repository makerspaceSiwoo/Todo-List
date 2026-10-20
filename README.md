# Daypiece

Astro + TypeScript로 만든 로그인 없는 개인용 일일 시간표입니다. Vercel Functions와 Upstash Redis를 이용하므로 직접 운영하는 서버 없이 여러 컴퓨터에서 같은 시간표를 공유합니다.

- [Production · main](https://todo-list-mauve-beta.vercel.app)
- [Preview · develop](https://todo-list-git-develop-seeyouspace0-5824s-projects.vercel.app)

두 환경의 데이터는 분리되어 있습니다. 개인 Vercel 프로젝트 `todo-list`와 무료 Upstash Redis `daypiece-shared`를 사용하며, Redis의 자동 유료 업그레이드는 비활성화되어 있습니다.

## 사용법

- 직장·학교 5개(`a`–`e`), 개인 5개(`가`–`마`)를 입력합니다. 서로 다른 파스텔 색상 10개가 고정 배정됩니다.
- 할 일 텍스트 또는 오른쪽 번호를 눌러 선택합니다. `기타`는 회색으로 배정됩니다.
- 직장·학교와 개인의 **이어하기** 버튼은 선택한 날짜의 바로 전날에 완료하지 않은 같은 분류의 작업만 가져옵니다. 오늘 작성한 내용과 중복은 유지하고 빈칸에 채우며, 가져온 작업은 미완료 상태로 수정할 수 있습니다. 빈칸이 부족하면 남은 개수를 안내합니다. 전날 기록이 없을 때 더 오래된 날짜는 조회하지 않으며, 전날의 시간표도 가져오지 않습니다.
- 시간표는 07:00–24:00, 17행입니다. 왼쪽은 매시간 00–30분, 오른쪽은 30–60분입니다.
- **짧게 클릭**: 1시간 전체를 칠합니다. 그 시간의 양쪽 모두 선택한 업무이면 지웁니다.
- **300ms 이상 홀드**: 누른 쪽 30분만 칠합니다. 같은 업무이면 그 칸만 지웁니다.
- **드래그**: 시작부터 현재 위치까지 시간 순서대로 30분 단위로 칠합니다. 시작 칸이 선택한 업무이면 해당 범위를 지웁니다. 다른 업무의 영역은 덮어씁니다. 되돌아 드래그하면 최종 범위만 남습니다.
- 체크박스로 완료하면 파란 체크와 취소선이 표시되고, 시간표의 해당 업무만 연회색이 됩니다. 체크를 해제하면 원래 색상으로 복구됩니다.
- 시간표 상단 잠금은 클릭·홀드·드래그·키보드 시간 편집을 차단합니다. 잠금은 해당 브라우저에 유지됩니다.
- 키보드: 번호 버튼으로 업무 선택, 시간 칸에서 `Enter`/`Space`로 30분 선택, `Shift+Enter`로 1시간 선택, 방향키로 이동합니다.
- 날짜별로 기록하며 오늘은 한국 시간(`Asia/Seoul`) 기준입니다. 열린 화면은 약 4초마다 공유 데이터를 확인합니다.

## 로컬 개발

Node.js 22.22.0 이상이 필요합니다. Vercel은 Node.js 22.x를 사용합니다.

```sh
npm ci
npm run dev
```

`http://127.0.0.1:4321`에서 확인합니다. Redis 환경 변수가 없으면 **개발 모드에서만** `.data/development/`에 파일로 저장합니다. 이 모드는 같은 개발 서버에 연결한 브라우저끼리 공유되며, 별도 컴퓨터의 독립 개발 서버와는 공유되지 않습니다. 배포 환경에서는 Redis 미설정 시 오류를 표시하며 임시 파일이나 브라우저 저장을 공유 저장으로 표시하지 않습니다.

## Vercel 배포

1. 개인 Vercel 계정에서 GitHub `makerspaceSiwoo/Todo-List`를 Import합니다. Framework Preset은 `Astro`, Node.js는 `22.x`입니다.
2. Project → Settings → Environments → Production의 **Branch Tracking을 `main`**으로 설정합니다. `develop`에 push하면 Preview 배포가 생성됩니다. 이 설정은 Vercel 프로젝트 설정이며 `vercel.json`에서 Production Branch를 지정하지 않습니다.
3. Project → Storage/Marketplace에서 **Upstash Redis**를 연결합니다. Production과 Preview에 다음 서버 전용 환경 변수를 연결합니다.

   | 변수 | 값 |
   | --- | --- |
   | `KV_REST_API_URL` | Marketplace가 자동 연결하는 Redis REST URL |
   | `KV_REST_API_TOKEN` | Marketplace가 자동 연결하는 읽기·쓰기 Redis REST token |

   Upstash 콘솔에서 직접 생성한 경우 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 이름도 지원합니다.

4. 환경 변수 설정 후 Preview와 Production을 재배포합니다. 환경 변수에 `PUBLIC_` 접두사를 붙이면 안 됩니다. Redis 키는 각각 `daypiece:preview:날짜`, `daypiece:production:날짜`로 자동 분리됩니다. 필요하면 환경별 `SCHEDULE_NAMESPACE`로 저장 공간을 명시할 수 있습니다.
5. `develop` Preview에서 확인한 뒤 PR을 `main`에 병합하면 Production에 자동 배포됩니다.

모든 접속자가 같은 데이터를 사용하는 **로그인 없는 공유 앱**입니다. 주소를 아는 사람은 누구나 읽고 수정할 수 있습니다. Vercel의 Preview Deployment Protection은 웹앱 로그인과 별개이므로, 다른 컴퓨터에서 로그인 없이 Preview까지 열려면 프로젝트의 Deployment Protection 설정을 조정해야 합니다.

## 저장과 동시 수정

`/api/day?date=YYYY-MM-DD`의 GET/PATCH API를 사용합니다. 클라이언트는 변경한 텍스트, 완료 상태 또는 시간 칸만 전송합니다. Redis Lua 스크립트가 해당 필드의 저장과 revision 갱신을 원자적으로 처리합니다. 서로 다른 필드의 동시 변경은 유지되고, 같은 필드는 서버에서 마지막에 처리된 값이 적용됩니다.

저장 대기 변경은 브라우저에 보관하고, 오류를 표시하며 재연결 시 다시 전송합니다. 공유 저장 완료 전 창을 닫으면 브라우저가 확인 메시지를 표시합니다. 클라이언트 시계 대신 서버의 증가하는 revision으로 오래된 응답의 역전을 막습니다. Preview와 Production은 별도 origin 및 Redis namespace를 사용합니다.

## 검증

```sh
npm run check
npm run build
npx playwright install chromium
npm test
```

브라우저 테스트는 별도 서버(4322)와 매 실행마다 독립된 `.data/test-*` 디렉터리를 사용합니다. 시간 선택·해제·덮어쓰기, 연속 드래그, 드래그 축소/취소, 완료/복구, 잠금, 두 브라우저의 공유 및 동시 수정, 실패 후 재시도, 날짜 분리, API 검증, 모바일 터치를 확인합니다.

Vercel 어댑터의 간접 의존성 `path-to-regexp`는 보안 수정 버전 6.3.0으로 고정했습니다. Node 버전과 의존성은 `.nvmrc` 및 `package-lock.json`에서 관리합니다.
