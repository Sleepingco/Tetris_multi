# Goal 11C — Production Docker Image

## 목적

재현 가능한 build artifact와 최소 권한 runtime을 사용하는 production container를 만든다.

## 선행조건

- Goal 11B의 main 반영
- production build/start와 health semantics 확정
- 필요한 runtime file, writable path와 secret 목록 작성

## 범위

- Node 24 기반 multi-stage build
- build dependency와 production runtime dependency 분리
- non-root user, 최소 filesystem 권한과 signal 처리
- client/server build artifact만 runtime stage에 복사
- health/readiness check
- `.dockerignore`, environment와 secret injection 경계
- 필요하면 PostgreSQL을 포함한 local production-like Compose

## 제외 범위

- secret을 image layer 또는 repository에 저장
- Kubernetes/다중 서버/Redis 도입
- container 내부에서 개발 server 실행

## 완료 기준과 검증

- clean Docker build가 고정된 lockfile로 성공한다.
- runtime image에 dev tool과 source secret이 없다.
- non-root로 server, 네 page, Socket.IO와 DB 연결이 동작한다.
- SIGTERM graceful shutdown과 health check가 동작한다.
- container 기반 PVP/PVE smoke와 rollback image 실행이 검증된다.

## Rollback과 Merge Gate

이전 image tag와 migration-compatible DB 상태로 복귀할 수 있어야 한다. image publish/deploy는 별도 사용자 승인 대상이다.
