# 버퍼 존 5단계 OCI 배포 기록

상태: **운영 배포 완료**. 사용자 요청으로 2026-10-23 수행했다. 현재 app은 `tetris-app:bbf26b7`, DB migration은 3이다.

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
5. PostgreSQL custom-format backup과 dump 목록, 임시 DB restore의 row/hash를 확인한다. 운영 원본이 backup 시점과 같은지 대조하고, 검증용 clone만 정리한다.
6. 기존 app의 연결이 남아 있으면 교체를 중단한다. 연결이 세 번 모두 0인 상태에서 Caddy의 임시 maintenance 응답으로 새 유입을 막고 DB가 backup 기준선과 같은지 다시 확인한다. 원본 Caddyfile은 보존한다. [Caddy 공식 문서](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming)에 따라 config reload가 기존 WebSocket을 기본 종료함을 확인했으므로 접속자가 있는 상태에서 reload하지 않는다.
7. 새 image로 migration을 두 번 실행한다. 003 적용과 두 번째 no-op, 기존 row/hash 보존을 확인한다. 호환 rollback 이미지를 실제 migration 3 DB에 연결해 기동 가능 여부를 확인한다.
8. env의 app tag만 atomic하게 바꾸고 app만 교체한다. Caddy/PostgreSQL container와 volume은 재생성하지 않는다. 실패하면 migration 3 호환 rollback을 사용하고 DB를 내리지 않는다.
9. app health와 같은 image의 server/client를 확인하고 maintenance를 해제한다. 공개 HTTPS·싱글·PVP·PVE와 새 v3 start/placement/over, 명시적 V4 fallback·저장 실패 지표를 확인한다.

기존 자동 workflow는 active/candidate의 DB 기대 버전이 다르면 migration 전에 중단하도록 보강했다. 커밋한 실제 shell 블록을 기존 2/후보 3 조합으로 실행해 `SCHEMA_TRANSITION_REQUIRES_MANUAL_CUTOVER`·exit 1과 migration 2 불변을 확인했다. 이번 2→3 전환에 기존 migration 2 image를 자동 rollback 대상으로 사용하지 않았다. 전환 후 같은 migration 3 빌드끼리의 자동 배포는 기존 경로를 사용할 수 있다.

## 실행 결과

검증과 배포 provenance:

- release commit: `bbf26b72554907017765338c331416f32debc80a`. 이전 main `842b744`에서 T-Spin 변경 commit과 이번 버퍼 존 변경을 fast-forward로 반영했다.
- source archive: `tetris-bbf26b7.tar.gz`, 6,743,408 bytes, SHA-256 `9b9f8e408109696daba1cd678835b9f20f49ff708ab38b960f48262d2206b823`.
- 로컬 필수 verify: 769 pass·기존 조건부 1 skip·0 fail. source-less release 1/1, workflow YAML·shell 구문 통과.
- 정확한 main commit의 [CI #39930149609](https://github.com/Sleepingco/Tetris_multi/actions/runs/39930149609): Fast·브라우저·컨테이너·PostgreSQL 네 job 모두 success.
- 운영 기준선: 기존 이벤트 143,404건. `event_id:event_sha256:ingested_at`을 event_id 순서로 결합한 MD5는 `b78fad7f3a0b09ec545003dcc27c7873`이다. raw payload는 기록하지 않는다.
- backup: `/srv/tetris/backups/tetris-buffer-bbf26b7-20261023T091556Z.dump`, 42,327,177 bytes, mode 400·owner ubuntu, SHA-256 `17e41ceb87e9adcb4363a498a7f870842de339c3624ea68c133e0b91e0ec3eaf`. 임시 DB 복원과 운영 원본 모두 143,404건·동일 해시를 확인했다. 복원 clone은 정리했고 운영 row·volume을 삭제하지 않았다.
- 운영 Caddyfile에는 저장소에 없는 기존 Umami 통계 프록시 두 경로가 있다. source와 다름을 발견해 최초 준비를 중단한 뒤 기존 파일을 보존했다. 원본 SHA-256은 `8d19f3a9b5eb54591fca8b1c32db3a38ebd8f12bdec3f1ec934cafecb3ccbfc8`이다. maintenance는 이 파일을 바탕으로 app 응답만 임시 변경하며 원본을 덮어쓰지 않는다.

| 항목 | 결과 |
| --- | --- |
| 새 image | `tetris-app:bbf26b7`, ID `sha256:af97c6684e90717ec3476ad4bf79cb9454eb2409c4500d86452c1f8225f5bb45`, amd64·USER node. revision/artifact label 일치 |
| 호환 rollback | `tetris-app:6be7d05`, ID `sha256:f6dd0f2bf979580df69bf036573a7e75c213c1ed83b879a2494719a6cb756a6e`, amd64·USER node. archive SHA에서 정한 tag이며 commit tag가 아님 |
| 실제 rollback 기동 확인 | 운영 migration 3 DB에서 20행 core·HTTP 200·healthy, 종료 exit 0/OOM false. 진입 트래픽을 rollback으로 전환한 것은 아님 |
| 점검 구간 | 09:26:22~09:27:45 UTC, 18:26:22~18:27:45 KST, 약 83초. 연결 0건을 세 번 확인하고 app 신규 진입에 503 응답 |
| migration | 1 applied/2 skipped → 재실행 0 applied/3 skipped. 기존 row/hash/ingested_at 보존 |
| 교체/health | 이전 app exit 0/OOM false, 새 app healthy·OOM false·restart 0. Caddy/PostgreSQL container와 volume 유지 |
| 공개 HTTP/HTTPS/통계 | HTTP 308, HTTPS 200, 기존 `/stats/script.js` 200. Caddyfile hash 불변 |
| 실제 브라우저 | 싱글 종료/재시작·300×720/가시 600px·1600px/390px 가로 넘침 없음. PVP/PVE 각 1경기 완료, 두 board 40×10, 관찰한 PVP host/PVE page error 0 |
| client 일치 | 공개 네 HTML과 각 진입 JS의 SHA-256이 검증한 local dist와 일치 |
| v3 DB cohort | start 2/placement 33/over 2, 총 37건. 기존 143,404건 포함 최종 143,441건 |
| 배치 대조 | 2경기/4명 예상 33·저장 33·누락/초과/중복 0. PVP human 11/11·0/0, PVE human 11/11·AI 11/11 |
| 사람 전송 대조 | 입력 간격 1.2초로 검증. commit/전송/성공 22/22/22·RATE_LIMITED 0 |
| 실제 종료/관찰 | PVP block_out, PVE lock_out. post_line_clear 21/post_garbage_spawn 11/lock_commit 1 |
| V4 provenance | 요청 placement_v4·실행 heuristic·RULESET_INCOMPATIBLE, over의 fallback count 12. 기존 가중치 보존 |
| 저장 경계 | write_failed 로그 0. 규칙/geometry 오류 0, 점검한 sessionToken/password/databaseUrl 필드 0. 동일 runtime credential·CA·200ms 설정의 임시 읽기 접속에서 TLS true. 테스트 clone/rollback probe container 정리 |
| 자원 | available RAM 434 MiB, swap 사용 200 MiB, disk 22%. 순간 관찰값이며 부하 benchmark가 아님 |

[공개 smoke 산출물](../../../gameplay/verification/top-out-buffer-zone-stage5-production-smoke-2026-10-23.json)은 board·credential 없이 집계와 hash만 보존한다. 운영 backup 원문은 Git·로컬 Mac에 복사하지 않았다.

## 장애 시 복구

운영 [runbook의 active image tag 갱신과 app만 교체](../../deployment/postgres-production-runbook.md#5-active-image-tag-갱신) 절차에서 **`new_tag=6be7d05`**를 사용한다. 먼저 image의 artifact label이 위 rollback archive SHA와 같은지 확인하고 접속 종료·유입 차단을 적용한다. server/client를 함께 20행 gameplay로 복구하며 migration 3과 v3 row·volume은 유지한다. 원본 Caddyfile을 다시 reload하고 HTTPS·DB write를 확인한다.

이전 `842b744` image도 보존했지만 migration 2를 요구하므로 이 DB의 직접 rollback 대상으로 사용하지 않는다. backup은 같은 VM의 보호된 파일이며 off-VM 복구를 보장하지 않는다.

## 남는 경계

- 사람 배치 로그의 기존 10초당 10건 한도와 best-effort 저장을 유지한다. 행동 모방용 완전한 궤적 수집을 보장하지 않는다.
- 이번 배포로 기존 모델을 재학습하거나 v3를 기존 20행 학습 데이터에 섞지 않는다.
- 실기기·장시간 운영 부하·off-VM 재해 복구는 별도다. 새 규칙과 구버전 탭은 호환되지 않으므로 페이지를 새로고침한다.
- package-lock은 변경하지 않았다. runtime dependency 설치가 보고한 기존 audit 4건(중간 1/높음 2/치명적 1)의 영향 분석·패키지 갱신은 이번 gameplay 배포 범위에서 수행하지 않았다.

관련: [계획 §16](../../../gameplay/top-out-buffer-zone-plan.md#16-5단계-운영-배포-완료-2026-10-23), [운영 runbook](../../deployment/postgres-production-runbook.md).
