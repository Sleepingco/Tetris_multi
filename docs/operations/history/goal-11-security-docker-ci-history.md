# Goal 11 보안·Docker·CI/CD 학습 기록

- 작성일: 2026-07-23
- 대상: Goal 11A~11D
- 목적: 구현 결과만 나열하지 않고, 각 작업이 왜 필요했고 서로 어떻게 연결되는지 나중에 다시 공부할 수 있게 정리한다.

## 1. 먼저 결론

Goal 11은 새로운 게임 기능을 만든 작업이 아니다. 이미 동작하는 애플리케이션을
**운영 환경에 더 안전하게 가져가기 위한 단계**다.

```text
11A  브라우저가 허용된 코드와 자원만 실행하도록 제한
 ↓
11B  설치되는 외부 패키지의 알려진 취약점과 공급망 위험 정리
 ↓
11C  어디서 실행해도 비슷한 production 환경을 만드는 Docker image 작성
 ↓
11D  위 검증을 GitHub가 매 변경마다 자동 실행하도록 CI 구성
```

현재 상태는 다음과 같다.

| Goal | 상태 | 한 줄 결과 |
| --- | --- | --- |
| 11A | `main` 반영 완료 | CSP와 HTTP 보안 header 적용 |
| 11B | `main` 반영 완료 | 취약한 전이 dependency를 호환 가능한 patch로 갱신 |
| 11C | `main` 반영 완료 | production Docker image와 안전한 종료 경계 구현 |
| 11D | `main` 반영·browser 재확인 중 | PR clean run은 통과했지만 첫 main push에서 기존 PVE timing test 1건이 간헐 실패 |

중요한 구분은 다음과 같다.

- **Docker 작업은 배포가 아니다.** 배포할 수 있는 실행 상자를 만든 것이다.
- **CI 작업도 배포가 아니다.** 변경이 안전한지 자동 검사하는 절차를 만든 것이다.
- **CD는 아직 구현하지 않았다.** registry push, 실제 서버 교체, 공개 도메인과 TLS 설정은 범위 밖이다.

## 2. 전체 흐름을 한 장으로 보기

```text
`main` push 또는 `main` 대상 PR 생성·갱신
              │
              ▼
       GitHub Actions CI
       ├─ Fast gate
       │  └─ typecheck → build → artifact → Node test → release test
       ├─ Browser gate
       │  └─ Chromium → Single/PVP/PVE/reconnect 회귀
       └─ Docker gate
          └─ image build → container → health/security/shutdown smoke
              │
              ▼
       모두 통과하면 "병합해도 되는 후보"
              │
              ├─ 현재: 사람이 병합 여부 결정
              │
              └─ 미래 CD: registry와 실제 서버에 배포
```

CI가 성공했다는 것은 “검사한 범위에서 병합 가능한 상태”라는 뜻이다. 실제 서비스가
자동으로 공개되거나 서버가 교체됐다는 뜻은 아니다.

## 3. 자주 헷갈리는 용어

| 용어 | 쉬운 뜻 | 이 프로젝트에서의 역할 |
| --- | --- | --- |
| Dockerfile | image를 만드는 조리법 | Node, dependency, `dist`를 어떤 순서로 담을지 정의 |
| Docker image | 실행 전의 읽기 전용 포장본 | `tetris-multi` production 실행 파일 묶음 |
| Container | image를 실제로 실행한 프로세스 | Express·Socket.IO server 실행 |
| Docker Desktop | Mac에서 Linux container를 실행해 주는 로컬 엔진과 UI | 로컬 image build/run에 사용 |
| Volume | container를 지워도 남길 별도 저장 공간 | JSONL 로그를 `/app/data/logs`에 보존 |
| Health check | server가 요청을 받을 수 있는지 반복 확인 | `/`가 성공 응답인지 검사 |
| SIGTERM | “안전하게 종료를 시작하라”는 운영체제 신호 | timer와 Socket.IO를 정리하고 종료 |
| Workflow | 자동 검사 전체 절차 | `main`의 `.github/workflows/ci.yml` |
| Job | workflow 안의 독립 검사 묶음 | `fast`, `browser`, `docker` |
| Runner | job을 실제 실행하는 임시 컴퓨터 | GitHub의 `ubuntu-24.04` |
| CI | 변경을 자동 build/test하는 과정 | Goal 11D의 현재 범위 |
| CD | 통과한 결과를 실제 환경에 배포하는 과정 | 아직 구현하지 않음 |

### Docker Desktop과 Docker job은 같은 것이 아니다

```text
Docker Desktop
└─ 내 Mac에서 Docker 명령을 수행하는 엔진

GitHub Actions의 docker job
└─ GitHub의 임시 Ubuntu 컴퓨터에서 Docker 명령을 자동 수행하는 검사 절차
```

Docker Desktop으로 `docker build`와 `docker run`을 실행하면 Docker 동작은 로컬에서
검증할 수 있다. 하지만 PR event, GitHub 권한, cache, GitHub의 Ubuntu/amd64 환경은
Docker Desktop만으로 검증할 수 없다.

## 4. Goal 11A — CSP와 HTTP 보안 header

### 왜 했는가

브라우저는 HTML에 포함된 script, style, image, network 연결을 실행한다. XSS 같은
문제로 예상하지 못한 script가 들어오면 session 정보 탈취나 임의 요청으로 이어질 수
있다. CSP(Content Security Policy)는 브라우저에 “이 출처와 이 코드만 허용한다”는
규칙을 전달한다.

### 무엇이 바뀌었는가

핵심 구현은 [`src/server/httpSecurity.ts`](../../../src/server/httpSecurity.ts)에 있다.

- `default-src 'none'`에서 시작해 실제 사용하는 자원만 허용했다.
- script와 style은 same-origin과 검토된 inline hash만 허용했다.
- inline event handler와 임의 style attribute는 차단했다.
- image는 same-origin과 UI에 필요한 `data:`만 허용했다.
- sound는 same-origin만 허용했다.
- Socket.IO 연결은 same-origin 또는 검증된 `CSP_CONNECT_ORIGINS`만 허용했다.
- frame 삽입, object, worker와 외부 origin의 base URL 지정을 차단했다.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`를 추가했다.
- Express가 기본 노출하는 `x-powered-by` header를 제거했다.

정책은 처음부터 무작정 강제하지 않고 다음 순서로 검증했다.

```text
report-only
└─ 브라우저가 violation event·console을 발생시키지만 실행은 막지 않음
   └─ 위반 원인을 수정
      └─ enforce
         └─ 실제로 정책 위반을 차단
```

별도 CSP report collector는 만들지 않았다. 이번 관찰은 Playwright가 browser의
violation event와 console을 수집하는 방식으로 수행했다.

report-only 검사에서 Zod의 eval probe가 발견됐다. schema나 protocol을 바꾸지 않고
`z.config({ jitless: true })`로 동적 코드 생성만 끄면서 CSP를 유지했다.

정적 HTML에 남아 있던 inline style attribute 하나는 CSS로 이동했다. React가 runtime에
적용하는 style과 기존 DOM style 변경은 실제 CSP 위반이 없었으므로 불필요하게
재작성하지 않았다.

### 왜 hash를 사용했는가

기존 theme pre-paint script는 첫 화면이 깜빡이지 않도록 HTML 안에서 매우 일찍
실행된다. 이 script 전체를 무조건 허용하는 `unsafe-inline` 대신 내용의 SHA-256 hash를
CSP에 기록했다.

```text
inline 코드 내용이 같음   → hash 일치 → 실행 허용
inline 코드가 바뀜         → hash 불일치 → 실행 차단 및 test 실패
```

따라서 누군가 inline script를 추가하거나 기존 내용을 바꾸면 정책과 artifact test를
함께 검토해야 한다.

### 오류 응답도 왜 검사했는가

보안 header가 정상적인 `200` 응답에만 붙고 `404`나 `500`에서 사라지면 정책이
일관되지 않다. Express의 4인자 오류 middleware에서도 기존 status를 보존하면서 선택된
CSP mode 하나만 다시 적용하고, 실제 error 원문은 사용자에게 반환하지 않도록 했다.

`/pages`의 자동 directory redirect도 비활성화했다. 없는 경로는 명확하게 `404`가 되며,
Range 요청의 `416` 같은 비정상 응답에도 header가 유지되는지 검사한다.

### 주요 파일과 커밋

| 커밋 | 의미 |
| --- | --- |
| `98e89ab` | CSP와 HTTP 보안 header 구현 |
| `9a33e90` | header, inline hash, report-only/enforce와 browser 검증 추가 |
| `774925f` | Goal 11A 실행 기록 |
| `5a2bb22` | `/pages`, 4xx/5xx 오류 middleware와 exact 정책 검증 보강 |

자세한 실행 증거는 [Goal 11A 실행 기록](../../archive/migration/runs/goal-11a-2026-07-22.md)에
있다.

### 남은 한계

- 외부 TLS termination과 reverse proxy를 거친 실제 공개 hostname은 검증하지 않았다.
- WebKit과 Firefox는 검증하지 않았다.
- HSTS는 HTTPS 배포 환경과 함께 결정해야 하므로 이번 Node 애플리케이션 범위에 넣지 않았다.

## 5. Goal 11B — Dependency hardening

### 왜 했는가

애플리케이션 코드를 안전하게 작성해도 설치되는 외부 package에 알려진 취약점이 있을
수 있다. 직접 설치하지 않은 **전이 dependency**도 실제 production tree에 포함된다.

이번에는 다음 경로에서 advisory가 발견됐다.

```text
프로젝트
└─ express 5.2.1
   └─ body-parser 2.2.2
```

`body-parser@2.2.2`에는 invalid 또는 `NaN` limit 처리와 관련된 low severity
advisory가 있었다. 현재 애플리케이션은 body parser middleware를 사용하지 않아 해당
경로의 도달 가능성은 낮았지만, Express의 기존 semver 범위 안에서 호환되는 patch가
있었기 때문에 최소 lockfile 갱신을 선택했다.

### 무엇이 바뀌었는가

| package | 이전 | 이후 |
| --- | --- | --- |
| `body-parser` | `2.2.2` | `2.3.0` |
| `type-is` | `2.0.1` | `2.1.0` |
| 중첩 `content-type` | 없음 | `2.0.0` 두 entry |

변경 명령은 다음 의도와 같다.

```bash
npm update body-parser --package-lock-only --ignore-scripts
```

- `package.json`에 불필요한 direct dependency를 추가하지 않았다.
- Express major version을 바꾸지 않았다.
- production code를 고치지 않았다.
- registry URL과 integrity hash를 확인했다.
- `hasInstallScript` 대상 inventory가 optional macOS `fsevents` 두 개뿐인지 확인했다.
- `--ignore-scripts`로 해당 install script도 실제로 실행하지 않았다.
- production/full `npm audit`가 알려진 취약점 0건인지 다시 확인했다.
- 기존 Node와 Python ML parity도 다시 실행했다.

### 왜 무조건 최신 major로 올리지 않았는가

보안 숫자를 0으로 만드는 것보다 실제 실행 경로와 호환성을 함께 보는 것이 중요하다.
major upgrade는 API 변화와 새로운 회귀를 만들 수 있다. 이번에는 기존 Express 범위가
허용하는 patched transitive dependency만 올리는 것이 가장 작은 안전한 변경이었다.

### 주요 커밋

| 커밋 | 의미 |
| --- | --- |
| `3fe121e` | `package-lock.json`의 patched transitive dependency 갱신 |
| `a18801c` | Goal 11B 판단과 검증 기록 |

자세한 실행 증거는 [Goal 11B 실행 기록](../../archive/migration/runs/goal-11b-2026-07-22.md)에
있다.

### 남은 한계

`environment-ml.yml`은 top-level Python package를 고정하지만 모든 transitive build를
완전히 잠그는 lockfile은 아니다. 이번 Goal은 실제 clean Conda 환경의 parity로 현재
재현성을 확인했으며, 별도 Python lock 도구는 추가하지 않았다.

## 6. Goal 11C — Production Docker image

### 왜 했는가

로컬에서는 개발 도구와 source가 모두 존재한다. production server가 이 환경에
우연히 의존하면 다른 컴퓨터에서 실행되지 않거나, 필요 없는 source·test·secret이
배포물에 포함될 수 있다.

Docker image는 실행에 필요한 Node, production dependency와 build artifact를 하나의
재현 가능한 묶음으로 만든다.

### 세 단계 image 구조

[`Dockerfile`](../../../Dockerfile)은 Node `24.18.0-bookworm-slim`의 정확한 digest를 사용하고
세 stage로 나뉜다.

```text
build stage
├─ dev dependency 설치
├─ TypeScript·Vite build
└─ dist/client + dist/server 생성

production-deps stage
└─ npm ci --omit=dev --ignore-scripts

runtime stage
├─ production node_modules만 복사
├─ dist만 복사
├─ node 사용자로 전환
└─ node dist/server/app.js 실행
```

build 도구는 결과를 만드는 데만 사용되고 최종 runtime stage에는 들어가지 않는다.
`.dockerignore`는 source와 build에 필요한 최소 파일만 context에 포함하고 test, E2E,
문서, Python/Conda 자료, 로컬 data, `.env`, key와 log를 제외한다.

### 최소 권한 실행

- 최종 process는 root가 아니라 built-in `node` 사용자(UID/GID 1000)로 실행한다.
- container 실행 시 `--read-only`를 사용해 root filesystem 쓰기를 막는다.
- JSONL이 필요한 `/app/data/logs`만 named volume으로 쓸 수 있게 연다.
- secret과 origin 설정은 image 안에 굽지 않고 실행 시 environment로 전달한다.
- production image에는 first-party TypeScript source, test, Vite, Playwright와 `.env`를 넣지 않는다.

`--read-only`는 Dockerfile 자체가 아니라 `docker run` 또는 배포 설정에서 적용되는
runtime 권한이라는 점이 중요하다.

### Health check

새로운 관리용 endpoint를 만들지 않고 Node의 내장 `fetch()`로 기존 `/` 응답을
확인한다.

```text
container 시작
└─ health: starting
   ├─ / 성공 → healthy
   └─ 반복 실패 → unhealthy
```

token, room, match 같은 내부 정보를 health response에 노출하지 않는다.

### SIGTERM과 timer 정리

`docker stop`은 process를 즉시 강제 종료하기 전에 SIGTERM을 보낸다. server가 이
신호를 무시하면 다음 문제가 생길 수 있다.

- Socket 연결이 갑자기 끊긴다.
- JSONL append가 끝나기 전에 process가 종료될 수 있다.
- interval과 timeout이 남아 process가 종료되지 않을 수 있다.
- 종료 중 room state를 다시 변경하는 callback이 실행될 수 있다.

Goal 11C에서는 다음 흐름을 만들었다.

```text
SIGTERM
└─ shutdown() 최초 한 번만 실행
   ├─ session cleanup interval 중지
   ├─ disconnect grace timeout 전부 중지
   ├─ 모든 room authoritative ticker 중지
   ├─ Socket.IO와 HTTP server close 대기
   └─ 정상 완료: exit 0
       8초 초과/오류: exit 1
```

여기서 timer는 단순한 화면 타이머가 아니다.

- **session cleanup interval**: 만료 session을 주기적으로 정리한다.
- **disconnect grace timeout**: 잠깐 끊긴 사용자가 돌아올 시간을 기다린다.
- **room ticker**: server-authoritative gravity와 snapshot 진행을 담당한다.

종료 함수는 idempotent하게 만들어 중복 호출되어도 정리를 한 번만 수행한다.
[`src/server/init.ts`](../../../src/server/init.ts)는 종료를 시작하고,
[`src/server/sockets/index.ts`](../../../src/server/sockets/index.ts)는 Socket 관련 timer를,
[`src/server/services/authoritativeTickerService.ts`](../../../src/server/services/authoritativeTickerService.ts)는
room ticker 전체를 정리한다.

현재 shutdown은 진행 중인 JSONL write를 별도로 추적해 drain 완료까지 기다리는 계약은
아니다. 검증한 범위는 종료 전에 이미 기록된 484줄이 container 재시작 뒤에도 같은
hash로 보존되고 새 lifecycle log만 append된다는 것이다. 비정상 종료 중인 단일 write의
원자성까지 보장한다고 해석하면 안 된다.

### production Socket.IO 보정

browser의 same-origin Socket.IO polling 중에는 `Origin`이 없는 요청이 있을 수 있다.
모든 no-Origin 요청을 허용하면 보안 경계가 약해진다. 따라서 production에서는
다음 두 조건을 함께 만족하는 browser 요청만 same-origin으로 인정했다.

- `Sec-Fetch-Site: same-origin`
- 요청 `Host`가 `SOCKET_ALLOWED_ORIGINS`에서 만든 allowlist와 일치

명시적 cross-origin 요청은 계속 exact Origin allowlist로 검증한다.

### Docker 검증에서 확인한 것

- image build와 clean dependency install
- non-root UID/GID 1000
- read-only root와 JSONL volume만 writable
- `starting → healthy`
- root, 네 page, hashed JS와 Socket.IO client HTTP 200
- CSP와 보안 header 유지
- first-party TypeScript source와 source map HTTP 404
- JSONL volume 재시작 후 기존 내용 보존과 append
- container PVP/PVE 6/6
- SIGTERM 약 0.16초, exit code 0
- linux/arm64 image 약 88 MB

### 주요 커밋

| 커밋 | 의미 |
| --- | --- |
| `9554bbc` | multi-stage Dockerfile과 `.dockerignore` |
| `1c09fec` | SIGTERM, timer disposer와 production Socket origin 보정 |
| `d13abfb` | container lifecycle와 Socket 보안 회귀 test |
| `bc121c0` | Goal 11C 실행 기록 |
| `6d09a28` | 별도 사운드 수정이 들어간 최신 main과 Goal branch 동기화 |
| `84f8659` | 최신 main 동기화 후 Goal 11C 실행 기록 갱신 |

자세한 실행 증거는 [Goal 11C 실행 기록](../../archive/migration/runs/goal-11c-2026-07-22.md)에
있다.

### 남은 한계

- 실제 실행은 Docker Desktop의 linux/arm64에서 검증했다. linux/amd64 실행은 아직이다.
- image를 registry에 publish하거나 실제 host에 배포하지 않았다.
- TLS, reverse proxy, 실제 hostname과 장시간 부하는 검증하지 않았다.
- 첫 production image라 과거 production digest로 실제 downgrade하는 rollback은 검증하지 못했다.

## 7. Goal 11D — GitHub Actions CI

### 왜 했는가

로컬에서 test를 잘 실행해도 사람은 명령을 빼먹거나 다른 Node 버전에서 작업할 수
있다. CI는 PR과 main 변경마다 같은 검사를 깨끗한 임시 컴퓨터에서 다시 실행하기
위한 Goal 11D의 구현 경로다. workflow는 PR #1의 hosted 검증을 거쳐 `main`에 반영됐다.

```text
사람의 기억에 의존
"이번에는 E2E도 실행했나?"
          ↓
저장소 규칙에 의존
"필수 job이 모두 통과했는가?"
```

### Workflow 실행 조건

`.github/workflows/ci.yml`은 다음 event를 대상으로 한다.

- `main` 대상 pull request
- `main` push
- 수동 `workflow_dispatch`

같은 workflow와 같은 GitHub `ref`에서 새 실행이 시작되면 이전 실행을 취소해 불필요한
중복 비용을 줄인다. PR ref와 일반 branch ref는 서로 다를 수 있다.
전체 권한은 `contents: read`뿐이며 repository 쓰기, registry, deployment 권한은 없다.

### Job 1: Fast gate

Fast gate는 가장 먼저 실행되고 나머지 두 job의 선행조건이 된다.

```text
committed diff 공백 검사
→ .nvmrc의 Node 24.18.0 확인
→ 실제 npm 버전 출력
→ npm ci --ignore-scripts
→ bash scripts/verify.sh
→ npm run test:release
```

`scripts/verify.sh`는 typecheck, clean client/server build, artifact와 Node test를 묶은
canonical fast gate다. `test:release`는 source와 devDependency 없이 production
artifact만으로 HTTP/PVP/PVE/V4 경계가 실행되는지 별도로 확인한다.

clean checkout에서는 단순 `git diff --check`가 검사할 working-tree diff가 없다.
그래서 review 수정에서 event에 맞는 committed 범위를 검사하도록 보강했다.

| event | 검사 범위 |
| --- | --- |
| Pull request | base/head의 merge-base부터 PR head까지 |
| main push | `github.event.before`부터 현재 SHA까지 |
| 수동 dispatch | 현재 HEAD commit |

GitHub에서 받은 SHA는 environment로만 shell에 전달하며 PR 제목이나 branch 이름 같은
공격자가 조작할 문자열을 shell command에 직접 삽입하지 않는다.

### Job 2: Browser gate

Fast gate가 통과한 뒤 별도의 clean checkout에서 다음을 수행한다.

```text
Node와 dependency 준비
→ Chromium과 Linux system dependency 설치
→ Vite-dev lifecycle E2E
→ production 전체 Playwright E2E
```

Single/PVP/PVE, reconnect, React lifecycle, sound/theme와 Canvas가 실제 브라우저에서
동작하는지 확인한다. 기존 Playwright `webServer`가 server 시작과 종료를 소유하므로
workflow에 별도 background server 관리 코드를 만들지 않았다.

`needs: fast`는 실행 순서와 실패 시 중단 관계만 만든다. `fast`, `browser`, `docker`는
서로 다른 임시 runner에서 실행되므로 `node_modules`, `dist`, image와 volume을 자동으로
공유하지 않는다. 그래서 browser job도 자신의 clean install을 수행한다.

### Job 3: Docker gate

Fast gate가 통과한 뒤 GitHub runner에서 production image를 새로 만들고 container를
검사한다.

```text
image build
→ 고유 container와 JSONL volume 생성
→ read-only/non-root 실행
→ bounded health 대기
→ HTTP와 security header 검사
→ 실제 hashed JS module 200 검사
→ TSX와 first-party source map 404 검사
→ docker stop
→ container exit code 0 검사
→ container와 volume 정리
```

root HTML이 `200`이어도 그 HTML이 가리키는 hashed JavaScript가 빠졌을 수 있다.
그래서 review 수정에서 HTML로부터 `module_path`를 읽은 뒤 **실제 module HTTP 200**을
확인하고, 같은 module의 `.map`은 `404`인지 검사하도록 했다. filename은 build마다
hash가 바뀌므로 hard-code하지 않는다.

Docker job은 browser job과 같은 PVP/PVE를 다시 실행하지 않는다. Docker job은 image,
권한, health, HTTP와 종료 경계를 맡고 gameplay는 browser job이 맡는다.

### Test token을 로그에서 보호한 이유

Playwright assertion에 session token 원문을 actual/expected 값으로 넘기면 실패 메시지나
trace에 token이 출력될 수 있다. 비교 의미는 유지하면서 matcher에는 boolean만
전달하도록 바꿨다.

```text
변경 전: expect(actualToken).not.toBe(previousToken)
변경 후: expect(actualToken === previousToken).toBe(false)
```

검사는 같지만 실패 로그에는 token 원문 대신 `true` 또는 `false`만 남는다.

Playwright trace와 report는 DOM, network와 runtime 값을 포함할 수 있다. 별도 redaction
정책을 만들기 전까지 CI는 실패 artifact를 업로드하지 않고 workflow log만 사용한다.

### 공급망과 권한 제한

- 공식 `actions/checkout`과 `actions/setup-node`만 사용한다.
- mutable tag가 아니라 검토한 full commit SHA로 action을 고정한다.
- checkout credential을 작업 tree에 남기지 않는다.
- workflow 권한은 `contents: read` 하나뿐이다.
- 장기 secret, registry login과 deployment command가 없다.
- npm cache key는 `package-lock.json`에 연결한다.
- cache가 없어도 매번 `npm ci --ignore-scripts`로 재현 가능하다.
- `node_modules`와 Playwright browser binary는 cache하지 않는다.

비슷하게 들리는 저장물도 역할이 다르다.

| 저장물 | 의미 | 현재 처리 |
| --- | --- | --- |
| production artifact | build 결과인 `dist/client`, `dist/server` | fast/release와 Docker image에서 검증 |
| GitHub workflow artifact | run이 끝난 뒤 내려받도록 보관하는 report·trace | token 위험 때문에 업로드하지 않음 |
| npm cache | package 다운로드를 빠르게 하는 복사본 | lockfile 기반, `npm ci`를 대신하지 않음 |
| Docker volume | 실행 중 JSONL을 저장하는 filesystem | CI에서는 임시 생성 후 정리, production에서는 별도 보존 필요 |

### 주요 커밋

| 커밋 | 의미 |
| --- | --- |
| `5f4f154` | E2E token 비교를 실패 로그에 안전하게 변경 |
| `6409d78` | `fast`, `browser`, `docker` CI workflow 추가 |
| `a9b6de7` | Goal 11D 로컬 구현 기록 |
| `477b631` | 실제 module 200과 event별 committed diff 검사를 보강 |
| `7281b27` | GitHub-hosted PR 검증 결과와 남은 미검증 범위 기록 |
| `d6112e1` | PR #1을 원격 `main`에 병합한 merge commit |

### 현재 정확한 상태

Goal 11D는 로컬에서 다음 검증을 통과했다.

- workflow YAML parse와 금지 권한/action/artifact 검사
- 관련 token E2E 19/19
- Node tests 594 pass, 기존 조건부 1 skip
- source-less release 1/1
- Vite-dev 10 pass, production-only 2 skip
- production Playwright 37/37
- Docker local simulation의 health, module 200, map 404와 exit 0
- `git diff --check`

첫 로컬 Docker simulation에서는 zsh의 특수 배열 변수인 소문자 `path`를 loop 변수로
사용해 shell의 `PATH`가 사라졌다. cleanup도 `docker` 명령을 찾지 못해 container와 port가
남았다. 해당 Goal용 자원만 제거하고 Bash로 다시 실행해 통과했다. 실제 workflow는
`shell: bash`를 명시하므로 같은 zsh 변수 충돌을 피한다. 이 실패는 Docker 문제가 아니라
**같은 script라도 shell 문법과 예약 변수가 다를 수 있다**는 사례다.

GitHub-hosted 검증도 실제로 실행했다.

- Draft PR [#1](https://github.com/Sleepingco/Tetris_multi/pull/1)의 최초 run과 최종
  `7281b27` run에서 `Fast gate`, `Chromium PVP and PVE`,
  `Production container smoke`가 모두 통과했다.
- npm cache는 최초 miss 뒤 저장됐고 후속 browser job에서 hit를 확인했다.
- PR event의 실제 merge-base 범위와 표시되는 세 job 이름을 확인했다.
- PR #1은 merge commit `d6112e1`로 원격 `main`에 반영됐다.

병합 직후 main push run에서는 Fast와 Docker job이 통과했지만 Browser job이 36/37로
실패했다. 실패한 항목은 Goal 11D가 수정하지 않은 기존 PVE T-Spin test이며,
`softDropActivePieceToRow()`가 같은 `pieceIndex`의 row 증가만 기다리는 동안 server
gravity와 soft drop lock이 경합하면 새 조각으로 넘어가 조건을 만족하지 못할 수 있다.
병합 commit과 통과한 PR HEAD의 tree hash는 같으므로 현재 증거는 merge 내용 회귀보다
기존 timing flake를 가리킨다. 다만 main CI는 아직 green이라고 기록하지 않는다.

남은 미검증 범위는 수동 dispatch의 현재 HEAD 검사, 의도적 실패를 주입한 job routing,
branch protection required check 설정이다. timing failure는 timeout이나 retry 증가로
숨기지 않고 별도 bugfix에서 결정론적으로 고정해야 한다.

## 8. CI와 CD의 경계

Goal 11D workflow는 GitHub-hosted PR clean run을 거쳐 `main`에 반영됐다. 자동 배포는
없으며 첫 main push의 browser timing failure를 해결해 green 상태를 복구해야 한다.

| 항목 | 현재 |
| --- | --- |
| PR마다 build/test | `main`에 구현됨. PR #1 hosted clean run 통과 |
| main push build/test | Fast·Docker 통과, 기존 PVE timing test 1건으로 Browser 36/37 |
| Docker image 로컬 build/test | 구현됨 |
| image registry push | 없음 |
| production server credential | 없음 |
| 공개 도메인과 TLS | 없음 |
| reverse proxy | 없음 |
| 서버에 새 image 배포 | 없음 |
| blue-green/rolling 전환 | 없음 |
| 자동 rollback | 없음 |
| branch protection required check 연결 | 별도 승인 전 미설정 |

나중에 CD를 추가한다면 최소한 다음 결정을 먼저 해야 한다.

1. 어디에 배포할지 선택한다.
2. image registry와 immutable digest 정책을 정한다.
3. secret 저장 위치와 최소 권한을 정한다.
4. TLS와 reverse proxy에서 실제 Origin·Host가 어떻게 전달되는지 검증한다.
5. JSONL volume의 backup과 단일 instance 한계를 결정한다.
6. 새 container health가 정상일 때만 traffic을 넘기고, 실패하면 이전 digest로 돌아간다.

현재 포트폴리오 범위에서는 main browser timing failure를 먼저 고정하고, 실제 CD는
배포 대상이 정해진 뒤 별도 Goal로 만드는 편이 안전하다.

## 9. 직접 다시 실행하며 공부하기

### 9.1 Fast gate

```bash
nvm use
npm ci --ignore-scripts
bash scripts/verify.sh
npm run test:release
```

관찰할 것:

- `.nvmrc`와 실제 Node가 같은가?
- clean build가 이전 `dist`에 의존하지 않는가?
- source-less release가 production dependency만으로 시작되는가?

### 9.2 Browser gate

```bash
npm run test:e2e:vite-dev
npm run test:e2e
```

관찰할 것:

- Playwright가 server를 직접 시작하고 종료하는가?
- 두 browser context가 Host와 Guest를 분리하는가?
- reconnect 후 server-authoritative 상태로 다시 수렴하는가?

### 9.3 Docker image와 container

Docker Desktop을 실행한 뒤 다음처럼 확인할 수 있다.

아래 block은 매번 고유한 이름을 만들고 성공·실패와 관계없이 자신이 만든 container,
volume과 image만 정리한다. 기존 Docker 자원 이름으로 바꾸지 않는다.

```bash
(
  set -eu

  study_id="$(date +%Y%m%d%H%M%S)-$$"
  image_tag="tetris-multi:study-${study_id}"
  container_name="tetris-study-${study_id}"
  volume_name="tetris-study-logs-${study_id}"
  host_port="$(node -e 'const net=require("node:net");const server=net.createServer();server.listen(0,"127.0.0.1",()=>{console.log(server.address().port);server.close();});')"

  cleanup() {
    docker rm -f "$container_name" >/dev/null 2>&1 || true
    docker volume rm "$volume_name" >/dev/null 2>&1 || true
    docker image rm "$image_tag" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT HUP INT TERM

  docker build --pull --tag "$image_tag" .
  docker volume create "$volume_name" >/dev/null
  docker run -d \
    --read-only \
    --name "$container_name" \
    -p "127.0.0.1:${host_port}:5500" \
    --mount "type=volume,src=$volume_name,dst=/app/data/logs" \
    -e "SOCKET_ALLOWED_ORIGINS=http://127.0.0.1:${host_port}" \
    -e "CSP_CONNECT_ORIGINS=ws://127.0.0.1:${host_port}" \
    -e GAME_EVENTS_LOG_PATH=/app/data/logs/game-events.jsonl \
    "$image_tag" >/dev/null

  container_health="starting"
  for attempt in $(seq 1 40); do
    if [ "$(docker inspect --format '{{.State.Running}}' "$container_name")" != "true" ]; then
      docker logs "$container_name"
      exit 1
    fi
    container_health="$(docker inspect --format '{{.State.Health.Status}}' "$container_name")"
    [ "$container_health" = "healthy" ] && break
    [ "$container_health" = "unhealthy" ] && docker logs "$container_name" && exit 1
    sleep 2
  done
  [ "$container_health" = "healthy" ] || { docker logs "$container_name"; exit 1; }

  [ "$(docker inspect --format '{{.Config.User}}' "$container_name")" = "node" ]
  [ "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container_name")" = "true" ]
  docker exec "$container_name" sh -lc 'test -w /app/data/logs && test ! -w /app/dist'
  curl --fail --silent --show-error --head "http://127.0.0.1:${host_port}/"

  docker stop --time 20 "$container_name" >/dev/null
  [ "$(docker inspect --format '{{.State.ExitCode}}' "$container_name")" = "0" ]
)
```

관찰할 것:

- `starting`이 `healthy`로 바뀌는가?
- process user가 `node`인가?
- `/app/dist`는 쓸 수 없고 `/app/data/logs`만 쓸 수 있는가?
- `docker stop` 뒤 exit code가 `0`인가?

### 9.4 GitHub Actions

새 PR 생성이나 workflow 재실행은 외부 상태 변경이므로 사용자 승인을 받은 뒤에만 한다.
현재는 Actions 탭에서 PR #1과 main push run의 다음 의존 관계와 결과 차이를 비교할 수
있다.

```text
Fast gate
├─ 성공 → Chromium PVP and PVE
└─ 성공 → Production container smoke
```

세 job이 통과해도 자동 배포되지 않는다. merge 여부도 사람이 결정한다.

## 10. 실패했을 때 어디를 볼까

| 증상 | 먼저 볼 곳 | 의미 |
| --- | --- | --- |
| Fast gate 실패 | 실패한 typecheck/build/Node test step | source 또는 artifact 계약 회귀 |
| Browser gate 실패 | Playwright의 첫 실패 test와 server log | 실제 사용자 흐름 또는 lifecycle 회귀 |
| Docker build 실패 | Docker build stage | lockfile, build 또는 context 문제 |
| health가 `unhealthy` | `docker logs <container>` | server 시작 또는 `/` 응답 실패 |
| root는 200인데 화면이 비어 있음 | HTML의 hashed module URL | client artifact 누락 가능성 |
| first-party hashed module의 `.map`이 200 | Docker smoke의 map 검사 | production artifact 노출 회귀. Socket.IO third-party map 200은 승인된 예외 |
| `docker stop` 후 exit 1 | shutdown log와 disposer test | timer·Socket 종료 실패 또는 8초 초과 |
| Vite의 Socket proxy `ECONNREFUSED` | `npm run dev:server` 실행 여부 | Docker/CI 문제가 아니라 backend가 꺼진 개발 환경 문제 |

## 11. 되돌리기와 안전장치

Goal별 변경을 커밋으로 나눠 둔 이유는 문제가 생겼을 때 관련 변경만 역순으로
되돌리기 위해서다.

- 11A는 CSP mode를 먼저 `report-only`로 완화해 원인을 관찰할 수 있다.
- 11B는 dependency 문서 커밋 뒤 lockfile 커밋을 revert할 수 있다.
- 11C의 Docker 코드 자체는 관련 문서를 먼저 정리한 뒤 `d13abfb` → `1c09fec` →
  `9554bbc` 순서로 revert한다. 현재 graph에는 초기 문서 `bc121c0`과 동기화 후 문서
  `84f8659`가 모두 있으므로 원하는 rollback 범위에 맞춰 각각 처리한다.
- `6d09a28`은 Docker 코드 커밋이 아니라 사운드 수정이 있던 최신 main을 합친 sync merge다.
  sync 자체만 되돌릴 때는 실행 기록대로 `84f8659` 뒤 `6d09a28`을 mainline 1 기준으로
  revert하며, Docker 코드 rollback에 무작정 포함하지 않는다.
- 11D branch 변경만 되돌릴 때는 `7281b27` → `477b631` → `a9b6de7` → `6409d78` →
  `5f4f154` 순서로 revert한다. 원격 main의 merge 전체를 되돌리는 작업은 별도 승인을
  받고 merge commit `d6112e1`을 mainline 1 기준으로 처리한다.
- image 배포가 시작된 이후에는 mutable tag가 아니라 이전 registry digest를 보존해야 한다.

CI 실패를 숨기기 위해 retry 수를 무작정 늘리거나 CSP에 `unsafe-inline`을 추가하거나
container를 root로 실행하는 방식은 해결책이 아니다.

## 12. 공부할 때 스스로 답해 볼 질문

1. Dockerfile의 build stage와 runtime stage를 왜 분리했는가?
2. `USER node`와 `docker run --read-only`는 각각 무엇을 막는가?
3. JSONL은 왜 image 안이 아니라 volume에 저장하는가?
4. health check와 “process가 실행 중”은 어떤 차이가 있는가?
5. SIGTERM에서 session interval, disconnect timer와 room ticker를 왜 모두 멈춰야 하는가?
6. root HTML 200만으로 client 배포 성공을 증명할 수 없는 이유는 무엇인가?
7. 실패 artifact를 업로드하지 않은 이유는 무엇인가?
8. action을 tag가 아니라 full SHA로 고정한 이유는 무엇인가?
9. CI 통과와 production 배포는 왜 같은 말이 아닌가?
10. 실제 CD를 추가하려면 지금 없는 어떤 운영 정보가 필요한가?

## 13. 관련 문서와 코드

- [Goal 11A 범위](../../archive/migration/goals/11a-csp-headers.md)
- [Goal 11B 범위](../../archive/migration/goals/11b-dependency-hardening.md)
- [Goal 11C 범위](../../archive/migration/goals/11c-production-docker.md)
- [Goal 11D 범위](../../archive/migration/goals/11d-ci.md)
- [Goal 11A 실행 기록](../../archive/migration/runs/goal-11a-2026-07-22.md)
- [Goal 11B 실행 기록](../../archive/migration/runs/goal-11b-2026-07-22.md)
- [Goal 11C 실행 기록](../../archive/migration/runs/goal-11c-2026-07-22.md)
- [Goal 11D 실행 기록](../../archive/migration/runs/goal-11d-2026-07-23.md)
- [`Dockerfile`](../../../Dockerfile)
- [`.dockerignore`](../../../.dockerignore)
- [`src/server/httpSecurity.ts`](../../../src/server/httpSecurity.ts)
- [`src/server/init.ts`](../../../src/server/init.ts)
- [`src/server/socketSecurity.ts`](../../../src/server/socketSecurity.ts)
- [`src/server/sockets/index.ts`](../../../src/server/sockets/index.ts)
- [`src/server/services/authoritativeTickerService.ts`](../../../src/server/services/authoritativeTickerService.ts)

Goal 11D의 `.github/workflows/ci.yml`과 실행 기록은 PR #1을 통해 원격 `main`에
반영됐다. 첫 main push에서 확인한 기존 PVE timing failure는 별도 bugfix와 green run
증거가 남을 때까지 해결 완료로 표시하지 않는다.
