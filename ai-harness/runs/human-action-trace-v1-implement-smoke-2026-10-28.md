# Human action trace v1 — implement-smoke

- 작업일: 2026-10-28
- 현재 상태: `cancelled_by_user_implementation_removed`
- 관찰한 branch/HEAD: `main` / `77af682e6f4914bba6a0534e628c9cd4a2bebac6`
- 기준: [수집 계약](../../docs/ai-ml/contracts/human-action-trace-v1.md)
- 권한: 기본 off 수집 runtime·저장 경계·합성 smoke 구현. 사용자 Docker 기동 후 격리된 실제 PostgreSQL 검증을 수행했다.
- 미실행: 실제 Human pilot·운영 수집/DB 접근·dataset 생성·학습·stage/commit/push/merge.

## 현재 결정 — 신규 수집 취소

2026-10-28 사용자가 기존 로그 활용과 다른 방향임을 명시해 신규 수집을 취소했다. Runtime·서버·Vite/session 변경을 철회하고 신규 schema/collector·테스트/fixture·pilot Notebook을 제거했다. 기존 데이터·Notebook 출력·동시 UI 변경은 보존했다. 아래 구현/검증은 **철회 전 이력**이며 현재 기능이나 다음 실행 지시가 아니다. 다음 방향은 [기존 로그 전용 계획](../../docs/ai-ml/strategy/ai-plan.md)이다.

후속 사용자 커밋 요청에서는 작업 폴더 실행 Notebook은 그대로 두고 Git index의 source만 출력/count와 B2/B3 Full 기본 설정을 정리했다. 격리 복사본의 `verify:ml` Node 35/35·Python 220/220과 필수 verify 793 pass·기존 1 skip을 통과했다. 아래 ML 실패 기록은 철회 전 사용자 실행본 상태의 이력이다. 신규 수집·학습·full 실험을 재개하지 않았다.

## 1. 변경 이유와 흐름

과거 로그는 입력 간격은 남지만 그 입력을 선택하기 전 공개 상태와 Hold 결과가 충분히 연결되지 않는다.
기존 placement v3 안에 optional `humanActionTrace.version=1`을 넣어 관측→시도→local 결과를 연결한다.
과거 데이터에 상태를 추정해 채우지 않으며 기존 timing 모델을 새 controller로 채택하지 않는다.

```text
기본 off / production build → 기존 경로
검증된 source manifest + Vite-dev opt-in
→ session ready → bounded placement trace
→ pre_action → local action outcome → post_action/Hold 관측
→ terminal outcome까지 한 번 봉인
→ 기존 placement 전송·인가·receipt
→ strict validation → projector → JSONL 또는 PostgreSQL 단일 sink
→ ACK ID/version 보존 확인
```

마지막 미완결 placement는 저장되지 않을 수 있다. 서버가 승인한 물리 keydown이나 사람의 생각을 기록했다는 주장은 하지 않는다.

## 2. 파일과 책임

| 파일 | 역할 |
| --- | --- |
| `src/client/game/ai/dataset/humanActionTrace.ts` (제거됨) | 엄격 schema·byte/count/time/ref·causal 검증, 기존 Zod 재사용 |
| `src/client/game/runtime/humanActionTrace.ts` (제거됨) | placement별 공개 관측·clock·한도·commit/seal 수명주기 |
| [tetris.ts](../../src/client/game/runtime/tetris.ts) | 실제 ready·입력 전후·Hold·garbage·terminal 연결 |
| [multiplayerGameSession.ts](../../src/client/game/entry/multiplayerGameSession.ts) | default off, rebase/visibility/단절, 기존 buffer 예산·ACK 실패/timeout |
| [tetrisMulti.tsx](../../src/client/pages/tetrisMulti.tsx), `src/client/vite-env.d.ts` (제거됨), [vite.config.mjs](../../vite.config.mjs) | dev-only 옵션 전달·실제 source manifest 검사, production off |
| [gameLogValidator.ts](../../src/server/validators/gameLogValidator.ts), [gameEventProjector.ts](../../src/server/services/gameEventProjector.ts), [canonicalGameEvent.ts](../../src/server/db/canonicalGameEvent.ts) | Human/v3만 허용·동일 검증 재사용·optional payload 보존 |
| `test/testHumanActionTrace.js`, `test/testHumanActionTraceBuild.js` (제거됨), [session 테스트](../../test/testMultiplayerGameSession.js) | 합성 clock·일반/terminal/Hold·자원·default off·ACK/실패 검증 |
| `test/fixtures/human-action-trace-v1.json` (제거됨), [실제 DB 테스트](../../test-integration/postgresSchemaRepository.js) | JSONL/JSONB 보존과 기존 멱등 저장 계약 |
| `scripts/ml/notebooks/human_action_trace_pilot.ipynb` (제거됨) | 합성 manifest assert·pandas/Matplotlib, 사용자 선택 시 source manifest만 게시 |

새 Python 파일·패키지·DB 테이블/migration·Socket event·전송 queue는 추가하지 않았다.
Schema는 client ESM/server compile 경계를 유지하는 기존 client dataset 모듈에 두고 서버에서 재사용한다.
한도는 trace 64KiB·64 actions·512 events·32 boards·120초다. Session은 active/봉인 대기와 미확인 trace를 256KiB/4개 예산 안에서 관리하고 ACK deadline은 5초다.

## 3. RED → GREEN 증거

1. 유효한 RED: runtime이 새 opt-in을 무시해 trace가 없었다. 기본 off는 통과하고 on 테스트가 실패했다. Mock localStorage 누락으로 실패한 첫 시도는 fixture 오류이며 RED 근거에서 제외했다.
2. Projector가 optional trace를 보존하지 않아 round-trip assertion이 실패했다. Validator/projector/canonical 변경 뒤 통과했다.
3. Collector의 commit이 없고 incomplete 종료가 최초 중단 시각 75ms 대신 나중 200ms로 늘어났다. Commit 시각·최초 중단 경계·한 번 봉인 계약으로 수정했다.
4. 첫 cold trace의 crypto 초기화 뒤 ready가 0ms보다 커져 검증이 실패했다. 원점 ready를 0으로 고정했다.
5. Complete trace의 고립된 pre_action을 validator가 허용하는 RED를 추가하고 인과 순서 검사를 강화했다. Hard-drop 뒤 새 조각 관측 혼입도 거부한다.
6. Backpressure 테스트의 4회 이후 server bag 고갈은 fixture 문제였다. 게임 규칙을 바꾸지 않고 테스트 queue만 충분히 제공했다.

TDD의 checkpoint commit은 사용자 승인 범위에 없어 생성하지 않았다. 테스트/실행 기록만 남겼다.

## 4. 실행 검증

Node 24.18.0, 기존 `tetris-ml` Python 환경을 사용했다. 전체 빌드와 DB artifact 검사는 같은 dist를 사용하므로 마지막 검증은 순차 실행했다.

| 검증 | 최종 결과·범위 |
| --- | --- |
| `bash scripts/verify.sh` | 813 pass·기존 1 skip·0 fail. Typecheck/build/artifact 포함 |
| `npm run test:db` | 실제 PostgreSQL 17.10 격리 container에서 9/9. Trace JSONB 읽기·중복 재저장 검증, cleanup complete |
| 새 runtime/schema 테스트 | 10/10 |
| 새 dev build manifest 테스트 | 1/1 |
| Trace-specific session 테스트 | 9/9 (ACK 하위 5개 포함), 전체 session 회귀도 필수 verify에 포함 |
| Chromium lifecycle/start | 8/8. 격리 port 5518와 별도 임시 raw log, 기본 off gameplay 회귀 |
| 신규 순수 모듈 coverage | line 100%, branch 약 90%, function 93.75%. 마지막 단순 branch 삭제 전 측정이며 전체 runtime coverage 주장이 아님 |
| Notebook headless | error 0, synthetic manifest 표/그래프, 실제 manifest 생성 skipped |
| Source Notebook | output 0·execution count 0·고유 cell ID, `PREPARE_MANIFEST=False` |
| `npm run verify:ml` | Node 35/35, Python 213/220: 기존 5 fail·2 error. **전체 gate 미통과** |

ML 실패/오류는 기존 사용자 실행 Notebook의 output/count·Full=True 설정·기존 report 덮어쓰기 방지 검사다. 출력 삭제·Full 설정 변경·검사 약화로 숨기지 않았다. 새 trace Notebook은 기존 Python 실험 suite에 임의로 편입하지 않고 Notebook 자체 assert/headless와 Node runtime 테스트로 검증했다.

검증 과정에서 localhost sandbox EPERM은 허용된 재실행으로 해소했다. 첫 격리 브라우저 시도는 port 5518 origin allowlist 누락으로 게임 진입 전에 실패했고 테스트 전용 설정을 보완한 재실행이 통과했다. 전체 verify/DB 빌드 병렬 실행에서는 일부 파일 단위 실패가 발생했다. 해당 4개 파일의 단독 88/88 및 전체 verify 단독 실행이 통과했으며 구현을 변경해 우회하지 않았다.

## 5. 보존·한계·다음 gate

- 기존 timing manifest SHA `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88`, B3 report SHA `601a55ac229c70c2ddf5ba6cf2dcb2e024597c543d284cfce2f72a0d25d6fd12`를 재확인했다. 학습/Test 재평가는 하지 않았다.
- 기존 사용자 Notebook 출력·dirty 파일 및 동시에 진행된 UI/CSS/E2E 변경을 보존했다. 검증은 공유 working tree 기준이며 clean main-only 증명이 아니다.
- Source manifest의 실제 게시·trace on 상태의 Human 브라우저 플레이·수집률/실제 bytes·부하·운영 정책은 미검증이다. 격리 DB 통과를 운영 저장 완료로 확대 해석하지 않는다.
- 다음은 사용자 출력/Full 설정 보존과 ML 검사 정합 방침 결정이다. 그 뒤 별도 승인 local pilot에서 complete/incomplete·Hold/공격 coverage·누락 편향·처리 시간·저장량을 측정한다. Dataset/학습은 그 다음 별도 gate다.
- Rollback: dev opt-in off. 이미 저장된 optional trace reader는 남기고 같은 event를 다시 게시하거나 DB/raw 데이터를 삭제하지 않는다.

## 6. 자체 점검

ECC agent-self-evaluation 기준: 정확성 4(합성/DB 검증은 있으나 실제 pilot 미확인), 완결성 3(필수 전체 ML gate 보류), 명확성 4(파일/상태 구분, 문서 길이는 개선 여지), 실행 가능성 3(ML gate 방침 합의 전 실제 pilot 보류), 간결성 4(새 Python/서비스 없이 재사용하되 검증 기록은 길다). 평균 3.6/5다.
우선 개선은 사용자 출력의 별도 보존과 source 검사 정합을 합의하는 것이다. 승인 없이 이를 변경하지 않는다. 다음 개선은 승인된 작은 local pilot이며 모델 확장이 아니다. 전체 완료로 과장하지 않는다는 점에서 사용자 기대와 일치하는지 확인이 필요하다.
