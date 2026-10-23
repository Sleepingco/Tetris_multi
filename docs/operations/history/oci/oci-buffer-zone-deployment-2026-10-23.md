# 버퍼 존 5단계 OCI 배포 기록

상태: **배포 준비 중**. 사용자 요청으로 2026-10-23 시작했다. 실제 전환 완료와 구분한다.

## 배포 전 확인

- 대상: 기존 `https://tetra-arena.duckdns.org`, OCI `primary-vnic`, 사용자 `ubuntu`.
- 기존 app: `tetris-app:842b744`, app/PostgreSQL healthy, 공개 HTTPS 200.
- 운영 DB 기대 버전: 2. 새 빌드와 2단계 rollback은 3을 요구한다.
- 디스크 사용률 21%, available RAM 457 MiB. VM은 amd64이고 로컬 Mac은 arm64다.
- 기존 SSH known_hosts의 운영 IP 지문을 검증한 직접 SSH 경로를 사용한다. 키 원문·env·사용자 payload는 기록하지 않는다.

## 실행 순서

1. 현재 소스의 production release 검사를 40행 PVP/PVE와 명시적 V4 fallback에 맞춘다. frozen model checksum은 별도로 확인한다.
2. 필수 verify와 source-less release 검사를 통과한 코드를 commit으로 고정하고 기존 main CI의 네 job을 확인한다.
3. 정확한 commit의 `git archive`를 전송하고 양쪽 SHA-256을 확인한다. 운영 source directory는 덮어쓰지 않고 별도 build directory에서 후보 이미지를 만든다.
4. 로컬의 stage2 rollback archive를 별도로 전송한다. SHA-256 `6be7d05a859f2e8c49602e4111c19ec1fc488601780463836fe3c129e82fac8d`와 manifest를 확인하고, 보존된 dist로 amd64 non-root 이미지를 만든다. 기존 20행 gameplay·migration 3 reader를 유지한다.
5. 기존 app의 연결이 남아 있으면 교체를 중단한다. 연결이 없는 것을 확인한 후 Caddy의 임시 maintenance 응답으로 새 유입을 막는다. 원본 Caddyfile은 보존한다. Caddy는 config reload 시 기존 WebSocket을 기본 종료하므로 접속자가 있는 상태에서 reload하지 않는다.
6. PostgreSQL custom-format backup과 dump 목록, 임시 DB restore의 row/hash를 확인한다. 운영 row·volume은 삭제하지 않는다.
7. 새 image로 migration을 두 번 실행한다. 003 적용과 두 번째 no-op, 기존 row/hash 보존을 확인한다. 호환 rollback 이미지를 실제 migration 3 DB에 연결해 기동 가능 여부를 확인한다.
8. env의 app tag만 atomic하게 바꾸고 app만 교체한다. Caddy/PostgreSQL container와 volume은 재생성하지 않는다. 실패하면 migration 3 호환 rollback을 사용하고 DB를 내리지 않는다.
9. app health와 같은 image의 server/client를 확인하고 maintenance를 해제한다. 공개 HTTPS·싱글·PVP·PVE와 새 v3 start/placement/over, 명시적 V4 fallback·저장 실패 지표를 확인한다.

기존 자동 workflow는 active/candidate의 DB 기대 버전이 다르면 migration 전에 중단하도록 보강한다. 이번 2→3 전환에 기존 migration 2 image를 자동 rollback 대상으로 사용하지 않는다. 전환 후 같은 migration 3 빌드끼리의 자동 배포는 기존 경로를 사용할 수 있다.

## 실행 결과

아직 전환하지 않았다. release commit·CI·이미지·backup·DB 검증·공개 smoke 결과는 실행 후 추가한다.

## 남는 경계

- 사람 배치 로그의 기존 10초당 10건 한도와 best-effort 저장을 유지한다. 행동 모방용 완전한 궤적 수집을 보장하지 않는다.
- 이번 배포로 기존 모델을 재학습하거나 v3를 기존 20행 학습 데이터에 섞지 않는다.
- 실기기·장시간 운영 부하·off-VM 재해 복구는 별도다. 새 규칙과 구버전 탭은 호환되지 않으므로 페이지를 새로고침한다.

관련: [계획 §16](../../../gameplay/top-out-buffer-zone-plan.md#16-5단계-운영-배포-진행-2026-10-23), [운영 runbook](../../deployment/postgres-production-runbook.md).
