# Goal 1 — Vite and TypeScript Foundation

## 목적

기존 Vanilla JS gameplay와 Express/Socket.IO runtime을 보존하면서 Vite multi-page build와 점진적 TypeScript 공존 기반을 추가한다.

## 왜 지금 필요한가

React, typed Socket contract와 server TypeScript 전환을 안전하게 진행하려면 먼저 client build, module resolution, runtime start와 검증 경계를 고정해야 한다.

## 선행조건

- Goal 0 변경이 main에 병합돼 있다.
- merge/squash 방식에 맞게 Goal 0을 main에 반영한 commit을 식별하고 `git merge-base --is-ancestor <goal-0-main-commit> main`이 성공한다.
- 최신 main에서 새 `codex/migrate-vite-typescript-foundation-v2` 브랜치를 사용한다.
- worktree와 baseline test가 clean/green이다.

## 범위

- Node 24 LTS를 `.nvmrc`, `engines`와 검증 환경에 고정한다.
- Node 24와 호환되는 Vite/TypeScript 정확한 버전을 조사하고 lockfile에 기록한다.
- `src/client` 기반 Vite multi-page build를 구성한다.
- index, lobby, single, multiplayer 네 HTML entry를 보존한다.
- source development server와 production build/runtime start를 분리한다.
- Express가 production에서는 명시적으로 생성된 client output을 제공하게 한다.
- client/server/test TypeScript 설정 경계를 만들고 `allowJs`로 공존한다.
- 의존성이 낮은 client leaf 한 개 정도만 `.ts`로 변환해 설정을 검증한다.
- `/`의 싱글·멀티 링크를 실제 click navigation으로 검증한다.
- `scripts/verify.sh`에 typecheck, build와 unit test를 포함한다.
- 실행 문서와 regression checklist를 실제 명령에 맞게 갱신한다.

## 제외 범위

- React와 React Router
- server 전체 TypeScript 변환 또는 `dist/server`
- root `"type": "module"`
- Socket contract/Zod와 session 보안 변경
- Redux, Zustand, Tailwind
- PostgreSQL과 Docker
- gameplay 규칙 변경

## 허용되는 기능·프로토콜 변화

없음. build URL과 실행 명령은 바뀔 수 있지만 브라우저에서 관찰되는 gameplay와 Socket event 의미는 유지한다.

## 예상 영향 파일

- `package.json`, `package-lock.json`, `.nvmrc`
- `vite.config.*`
- `tsconfig*.json`
- `scripts/verify.sh`
- `src/server/init.js`
- `src/client/pages/*.html`
- 선택한 leaf module
- build/navigation E2E와 실행 문서

## 완료 기준

- Node 24 환경에서 clean install, typecheck, build, unit, Playwright가 통과한다.
- production output에 네 페이지와 필요한 asset이 존재한다.
- `/`에서 실제 click으로 single/lobby에 진입한다.
- 이동, 회전, soft drop, hard drop을 각각 관찰 가능한 결과로 검증한다.
- Socket.IO client와 PVP/PVE authoritative 흐름이 유지된다.
- production `start`가 Vite devDependency의 실행 시점 설치를 암묵적으로 요구하지 않는다.
- server/test의 기존 JS가 strict 검사된 것처럼 문서에 과장하지 않는다.

## 자동 검증

```bash
node --version
npm ci
bash scripts/verify.sh
npm run test:e2e
```

dev server proxy와 production HTTP smoke를 필수로 검증한다. build environment에서 client 산출물을 만든 뒤 devDependencies가 없는 runtime 조건에서 server를 기동해 `/`, 네 page, asset과 Socket.IO client를 확인한다.

## 수동 검증

- `/` → single
- `/` → lobby → create/join
- 두 browser context의 PVP 시작과 입력
- PVE AI 시작과 종료
- sound, CSS, theme와 Canvas asset 확인

## 보안·데이터 검토

- source map과 dev server가 production에 노출되지 않는지 확인한다.
- 새로운 환경변수나 secret을 client bundle에 포함하지 않는다.
- log schema와 dataset 입력을 변경하지 않는다.

## Rollback

Vite/TypeScript foundation commit을 revert하면 기존 source client와 `npm start` 경로로 복귀할 수 있어야 한다. build output은 source of truth로 사용하지 않는다.

## Merge Gate

검증 결과를 보고하고 멈춘다. 사용자 승인 전에는 push, main merge, Goal 2 session 보안과 React 작업을 시작하지 않는다.
