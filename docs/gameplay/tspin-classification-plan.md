# 하드드롭 회전 기록과 T-Spin Mini 구현 계획

- 작성일: 2026-10-21 (Asia/Seoul)
- 코드 기준: `main`, `842b744`. 작성 시작 시 작업 폴더 clean.
- 상태: 사용자 승인으로 1·2단계 구현·로컬 검증 완료. 아래 보상값을 적용했다.
- 범위: 1단계 하드드롭 회전 기록 수정, 2단계 Mini/일반 분류와 킥 이력 연결.
- 별도 범위: 게임 오버·버퍼 존·20행 보드·가비지 적용 시점 변경, 디자인 개편, 새 라이브러리, AI 재학습·장시간 평가, 커밋·push·배포.

## 1. 목적과 구현 전 확인한 사실

같은 위치에 고정한 T 조각이 드롭 방법만으로 다르게 판정되는 문제를 먼저 고친다. 그다음 현재 boolean 판정을 `none / mini / full`로 확장해 Mini에 일반 T-Spin 보상을 주는 문제를 분리한다. 싱글과 멀티 예측은 같은 클라이언트 runtime을 쓰며, 멀티 최종 판정과 PVE 실행은 서버가 소유한다.

| 구현 전 사실 | 코드·앞선 조사 근거 |
| --- | --- |
| T 조각·마지막 회전·대각선 3코너만 검사 | [tSpin.ts](../../src/client/game/core/tSpin.ts)의 `isTSpinLock`은 boolean을 반환 |
| 낙하한 하드드롭이 회전 기록을 유지 | [클라이언트](../../src/client/game/runtime/tetris.ts)의 `hardDrop`, [서버](../../src/server/services/playerGameplayStep.ts)의 `applyHardDropInput` |
| 성공한 소프트드롭·중력·좌우 이동은 회전 기록을 해제 | [서버 입력](../../src/server/services/playerStateInput.ts), 클라이언트 `applyMoveIntent`, 서버 중력 처리 |
| 벽차기는 이미 동작하지만 성공한 후보 번호를 반환하지 않음 | [step.ts](../../src/client/game/core/step.ts)의 `resolveMoveAttempt`와 `resolveMoveIntent` |
| 서버 공개 snapshot에 회전 기록이 없음 | [matchService.ts](../../src/server/services/matchService.ts)의 내부 clone과 공개 DTO가 다름. runtime의 `getSnapshot`도 현재 회전 기록을 생략 |
| 500ms·15회 유예와 소프트드롭 착지 대기는 구현 완료 | [고정 유예 기록](lock-delay-anti-stall-plan.md). 이번 작업에서 다시 구현하지 않음 |

2026-10-20 조사에서 같은 T 조각을 회전한 뒤 13칸 하드드롭하면 `isTSpin=true`, 같은 거리 소프트드롭 후 제자리 하드드롭하면 `false`를 서버·싱글·멀티 예측에서 재현했다. 전면 코너 1개인 형태의 Single도 50점·기본 공격 2줄로 처리됐다. 관련 기존 테스트 109개가 통과했지만 이것은 당시 코드와 재현의 검증이며 새 구현의 통과 결과가 아니다.

## 2. 목표 규칙과 비교 자료의 범위

[Tetris Effect 공식 사이트의 가이드](https://www.tetriseffect.game/beginners-community-guide/)는 T 조각 중심의 대각선 3코너 원리를 설명한다. [2009 설계 문서 사본 §9.1](https://studylib.net/doc/27262492/2009-tetris-design-guideline)은 전면/후면 구분과 5번째 회전 지점에 따른 일반 T-Spin 승격, 그 뒤 추가 회전의 승격 유지를 설명한다.

이번 목표는 아래에 명시한 프로젝트 규칙이다. 모든 상용 작품·2009 문서의 모든 세부 조건·점수표와 완전히 같은 구현이라고 부르지 않는다. 3코너·전면 코너·5번째 후보 승격과 연속 회전 중 승격 유지를 적용하며, 별도 T-slot 공백 분석이나 다른 작품 전용 예외는 추가하지 않는다. 점수·공격은 아래 프로젝트 표를 따른다.

## 3. 1단계: 하드드롭 회전 기록 수정

### 3.1 변경 규칙

| 입력·상황 | 회전 기록 |
| --- | --- |
| 하드드롭의 실제 낙하 거리 > 0 | lock 판정 전에 해제 |
| 하드드롭의 실제 낙하 거리 = 0 | 기존 기록 유지. 없던 회전 자격을 만들지는 않음 |
| 성공한 좌우 이동·소프트드롭·중력 하강 | 기존처럼 해제 |
| 실패한 이동·회전, 막힌 소프트드롭 | 마지막 성공한 조작을 유지. 다만 고정 유예 만료는 그대로 적용 |
| 성공한 회전 | 기존처럼 회전 자격 설정 |

클라이언트 `hardDrop`과 서버 `applyHardDropInput`에서 낙하 거리를 계산한 뒤, 점수·T-Spin 판정·lock에 들어가기 전에 기록을 해제한다. 1단계에는 새 metadata·socket 필드·보상표·Mini 분류를 넣지 않는다. 하드드롭 점수 `거리 × 2`, 유예, 점수·공격표와 기존 T-Spin zero-drop 확정은 유지한다.

### 3.2 구현·검증 순서

1. 13칸 재현을 정식 회귀 테스트로 옮겨 수정 전 실패를 확인한다. 실제 회전 입력으로 기록을 만들며 `lastActionWasRotation=true` 주입만으로 끝내지 않는다.
2. 클라이언트·서버의 두 하드드롭 경로만 수정한다. 싱글·멀티 예측·PVE의 caller와 기존 로그 fixture를 확인한다.
3. 같은 보드·조각·도착 위치에 대해 하드/소프트/중력 경로를 비교한다. 1칸·여러 칸 낙하는 미인정, 바닥 회전 후 0칸 확정은 인정해야 한다. 실패 입력은 자격을 지우지 않는다.
4. 관련 unit·runtime·서버 테스트와 `bash scripts/verify.sh`, 실제 브라우저의 싱글/PVP/PVE 회귀를 통과시킨다. 로컬 예측과 서버의 점수·공격 결과를 확인한다.

주요 파일은 `src/client/game/runtime/tetris.ts`, `src/server/services/playerGameplayStep.ts`, `test/testTetrisRuntime.js`, `test/testPlayerGameplayStep.js`다. 기존 입력·세션 테스트와 PVE 테스트는 필요한 fixture만 갱신한다. 새 snapshot 보정으로 회전 이력을 복원하는 작업은 2단계에서 함께 마친다.

**완료 기준:** 양쪽 하드드롭 판정이 일치하고 0칸 회전 확정과 드롭 점수가 보존되며, 기존 유예·상쇄·중복 placement 회귀가 없어야 한다. 이 상태를 독립적인 플레이 가능 checkpoint로 둔다.

## 4. 2단계: Mini/일반 분류와 킥 이력

### 4.1 분류 기준

고정 전 보드로 검사하며, 고정할 T 조각 자체를 코너 점유에 포함하지 않는다.

1. T 조각이 아니거나 마지막 성공한 조작이 회전이 아니면 `none`.
2. 대각선 4코너 중 막힌 칸이 3개 미만이면 `none`.
3. 전면 코너 2개가 모두 막혔거나 유효한 5번째 후보 승격 이력이 있으면 `full`.
4. 나머지 3코너 형태는 `mini`.

| 현재 회전값 | T가 향하는 방향 | 검사할 전면 코너 |
| --- | --- | --- |
| 0 | 위 | 좌상·우상 |
| 1 | 오른쪽 | 우상·우하 |
| 2 | 아래 | 좌하·우하 |
| 3 | 왼쪽 | 좌상·좌하 |

중심은 기존처럼 `col+1, row+1`이다. 코너 점유의 좌우 벽·바닥 처리와 음수 행을 빈 공간으로 보는 규칙은 유지한다. 게임 오버·천장 규칙은 바꾸지 않는다.

### 4.2 성공한 킥 번호 전달

- `MoveOutcome`와 `MoveIntent`에 성공한 회전의 `kickIndex`를 전달한다. [기존 SRS 표](../../src/client/game/state/config.ts)는 `[0,0]`을 포함하므로 0~4이며 **5번째는 4**다.
- 충돌 없이 제자리에서 성공한 회전은 0, 벽차기는 실제 성공한 `tests[i]`의 i를 반환한다. 실패·비회전 결과를 과거 킥 성공으로 재사용하지 않는다.
- `resolveMoveAttempt`에서만 추가하고 `resolveMoveIntent`가 버리는 실수를 막도록 두 경계 모두 검사한다. SRS 후보 순서·오프셋과 회전 성공 여부는 바꾸지 않는다.

### 4.3 조각별 회전 이력의 단일 원천

1단계의 boolean 상태를 다음 의미의 nullable 객체로 교체한다. 최종 이름은 구현 시 기존 타입과 맞추되 같은 의미의 boolean 원천을 별도로 계속 수정하지 않는다.

```text
spinRotation = null | { lastKickIndex: 0..4, usedKick5: boolean }

null: 마지막 성공한 조작이 유효한 T 회전이 아님
lastKickIndex: 가장 최근 성공한 회전의 후보 번호
usedKick5: 이동/하강 없이 이어진 회전 중 5번째 후보를 사용했는지
```

| 상태 전이 | 처리 |
| --- | --- |
| T 회전 성공 | 후보 번호 교체, `usedKick5 = 이전 값 OR 이번 번호가 4` |
| 킥에 포함된 좌우·위아래 이동 | 회전의 일부이므로 이력을 지우지 않음 |
| 성공한 좌우 이동·중력·소프트드롭, 1칸 이상 하드드롭 | 객체를 null로 초기화 |
| 실패한 입력·0칸 하드드롭·시간 경과만 발생 | 유지. 단 유예 만료의 lock 처리는 별도 진행 |
| 새 spawn·허용된 hold 교체·재시작 | 초기화. hold가 같은 pieceIndex를 유지해도 초기화 |
| 서버 snapshot 보정·재join | 해당 활성 조각의 서버 이력 복원 |

5번째 후보 뒤 다른 후보로 회전했다고 승격 이력을 없애지 않는다. 반대로 한 번 사용했다는 이유로 좌우 이동·낙하·다음 조각까지 승격을 유지하지 않는다. 실패 회전이 성공한 것으로 기록되거나 다른 조각의 이력이 섞이지 않아야 한다.

### 4.4 계산 결과와 적용한 보상

`tSpinType = "none" | "mini" | "full"`을 판정의 원천으로 둔다. 기존 `isTSpin` 필드가 필요한 DTO·로그·B2B 경계에서는 `tSpinType !== "none"`으로 파생한다. Mini와 일반의 구별이 필요한 계산에서 boolean으로 다시 뭉개지 않는다.

| 종류 | 0줄 점수/공격 | 1줄 점수/기본 공격 | 2줄 점수/기본 공격 | 3줄 점수/기본 공격 |
| --- | --- | --- | --- | --- |
| 일반 T-Spin | 15 / 0 | 50 / 2 | 100 / 4 | 150 / 6 |
| Mini | 0 / 0 | 10 / 1 | 20 / 2 | 유효 Mini 결과로 만들지 않음 |

- 일반 T-Spin과 일반 줄 삭제의 기존 보상을 유지한다. Mini 점수는 기존 일반 줄 삭제의 `줄 수 × 10`을 사용하고 공격은 별도 0/1/2줄로 낮춘다. 사용자 승인 후 적용한 프로젝트 보상이며 상용 표준 점수라고 표현하지 않는다.
- 하드드롭 점수·콤보·기존 B2B 공격 보너스는 별도 합산한다. Mini도 줄 삭제가 있으면 B2B 자격이 있고, 0줄이면 B2B를 새로 시작하거나 보너스를 받지 않되 기존 연속 기록은 유지한다. 일반 줄 삭제의 B2B 해제와 combo 갱신은 유지한다.
- 점수 표는 클라이언트·서버에 각각 복사하지 않고 기존 `core/tSpin.ts` 안의 작은 공용 계산으로 사용한다. `garbage.ts`·`attackState.ts`가 분류를 전달받아 공격·B2B를 계산하고 기존 core 로더에 연결한다. 새 보상 service·설정 UI는 만들지 않는다.
- 고정 중 `tSpinType`을 한 번 계산하고 줄 삭제 완료까지 해당 결과를 사용한다. 동시에 수정 가능한 `isTSpin` 상태와 분류 상태를 중복 원천으로 두지 않는다. top-out 시 줄 삭제·보상 억제는 기존대로 유지한다.

## 5. 상태·전송·표시·로그 연결

| 경계 | 필요한 작업 |
| --- | --- |
| 클라이언트 상태 | `stateFactory.ts`, `stateSerialization.ts`, runtime의 별도 `getSnapshot`·`applySnapshot`까지 이력 복사·복원. 객체 참조 공유 금지 |
| 서버 상태·DTO | `matchService.ts`의 초기화·내부 clone·공개 DTO와 관련 타입에 이력 연결. 기존 공개 DTO에는 회전 boolean이 없으므로 serializer 수정만으로 완료 처리하지 않음 |
| 입력 신뢰 경계 | `shared/socketContracts.mjs`에서 S2C 이력·분류를 검증. C2S 입력으로 이력·판정·승격 여부를 바꾸는 필드는 허용하지 않음. 서버가 실제 입력 결과로 계산 |
| 예측·보정 | `entry/multiplayerGameSession.ts`와 기존 net snapshot 타입·보정 caller 확인. 같은 위치라도 이력이 다를 수 있으므로 재join·correction에서 복원. 미확정 입력이 있는 동안 늦은 snapshot으로 새 회전 기록을 덮지 않고, 기존 acknowledgment·보류 snapshot 흐름 안에서 동기화 |
| 유예와의 분리 | 회전 이력을 복원하려고 중력·500ms 예산을 새로 초기화하지 않음. 새 이력 전송과 기존 `lockDelay` 복원을 함께 검증 |
| placement·공격 | 클라이언트 로그용 placement 결과, 서버 `playerGameplayStep.ts`의 `PlacementResult`, combat effect 생성, ticker·socket·PVE 전달 경로가 같은 분류를 사용 |
| 성과 문구 | `pages/tetrisMulti.tsx`에서 Mini는 `T-SPIN MINI`, 일반은 기존 `T-SPIN`으로 표시. 기존 콤보·B2B·중복 방지·1.2초 cleanup·모바일 배치 유지. 새 애니메이션·음원 추가 없음 |
| 저장 계약 | `gameLogValidator.ts`, `gameEventProjector.ts`, runtime 로그 타입·PVE 로그 생성부에서 `tSpinType`의 enum·boolean 일관성을 확인하고 whitelist로 보존. 새 결과가 projector에서 빠져 DB에 저장되지 않는 상태 방지 |
| 기존 기록 | 기존 v1/v2 로그의 분류 필드 누락을 허용하고 미분류로 취급. 과거 `isTSpin=true`를 모두 full로 단정해 변환하지 않음. 새 producer는 분류를 항상 기록. `schemaVersion`·feature version을 근거 없이 올리거나 과거 canonical event/hash·행을 재작성하지 않음 |
| AI·학습 | 실제 PVE 입력은 같은 서버 정책 사용. AI 평가식·탐색 목표·모델·feature 이름/순서는 유지. 기존 dataset/export/parity 단위 검사로 optional 분류가 파이프라인을 깨지 않는지 확인하고 신규 분류 유무로 과거 자료와 구분 가능하게 함. 자동 정제·재학습·full 평가는 시작하지 않음 |

표의 파일 이름은 현재 확인한 경계다. 구현 직전 import·caller·fixture를 다시 검색해 필요한 변경만 확정한다. 기존 `isTSpinLock` 호출부를 새 분류로 전환한 뒤 내부에서 불필요한 boolean wrapper를 추가로 유지하지 않는다.

## 6. 2단계 구현 순서와 검증

### 6.1 순서

1. **판정 fixture:** 네 회전 방향의 전면/후면, Mini/일반, 5번째 후보, 5번째 후보 뒤 추가 회전의 기대값을 고정한다. 기본 3코너·비T·실패 입력·벽/바닥 경계도 포함한다.
2. **공용 규칙·상태 연결:** core의 분류·킥 결과, 양쪽 실행 경로와 초기화, 공용 점수·공격 계산을 연결한다. 중간 상태를 배포하거나 2단계 일부만 완료로 표시하지 않는다.
3. **복원·계약·저장:** snapshot·acknowledgment·재join, strict schema와 DTO, 로그 validator·projector, PVE·dataset fixture를 함께 갱신한다.
4. **성과 표시:** 서버 확정 분류로 Mini 문구를 구분한다. 기존 전달 ID·중복 방지·cleanup을 유지한다.
5. **회귀·기록:** 아래 기준과 필수 verify를 통과한 뒤 실제 결과·남은 위험을 PLAN과 change-log에 기록한다. 1단계와 2단계는 별도 변경 단위로 유지하며 사용자 요청 없이 커밋·push하지 않는다.

### 6.2 완료 기준

| 검사 | 통과 기준 |
| --- | --- |
| 네 방향 분류 | 각 방향의 3코너·전면 2칸은 full, 전면 1칸·후면 2칸은 mini. 코너 2개 이하는 none |
| 킥 전달 | 제자리 0, 2~5번째 후보의 정확한 index, 실패 시 번호 오염 없음. 일반 이동·회전의 성공 결과는 기존과 동일 |
| 승격 이력 | 5번째 후보로 성공 후 추가 회전에서 유지. 이동·낙하·hold·새 조각에서 해제. 0칸 하드드롭은 유지 |
| 기존 드롭 수정 | 1단계의 1칸/13칸/0칸·실패 입력 비교가 분류 도입 후에도 유지 |
| 보상·전투 | Mini/일반의 0·1·2줄, 일반 3줄, 콤보·B2B·연속/동시 상쇄, pending 적용·종료에서 중복 점수·공격 없음 |
| 동일성 | 같은 시작 상태와 입력열에서 싱글·멀티 예측·서버가 같은 분류·점수·공격 결과를 냄. PVE도 실제 실행 경로에서 확인 |
| 복사·보정 | snapshot 객체를 수정해 원본 이력이 바뀌지 않음. 회전 직후 correction·재join·늦은 snapshot·미확정 입력·hold에서 이력과 유예 보존 |
| 경계 검증 | 잘못된 킥 index·enum·자료형·불일치 boolean을 거부. 클라이언트가 조작한 이력으로 서버 판정 변경 불가 |
| 로그·데이터 | 기존 v1/v2 수용, 새 분류의 JSONL·canonical payload 보존, dataset/export와 기존 모델·feature 계약 유지. 운영 DB를 조회/변경한 결과로 오인하지 않음 |
| UI | Mini/일반·콤보 문구와 중복 방지·모바일 배치·종료 cleanup 정상. 게임 오버·보드 크기·기존 사운드 변화 없음 |

관련 테스트는 `test/testMoveStep.js`, `test/testTSpin.js`, `test/testTetrisRuntime.js`, `test/testPlayerGameplayStep.js`, `test/testStateSerialization.js`, `test/testSocketContracts.js`, `test/testMatchService.js`, `test/testMultiplayerGameSession.js`, `test/testGarbageRules.js`, `test/testAttackState.js`, `test/testCombatEffect.js`, `test/testGameEventProjector.js`, 로그 validator·PVE·dataset/export/parity 테스트다. 필요한 실제 입력 회귀는 기존 테스트에 추가하며 새 일반화 테스트 프레임워크는 만들지 않는다.

각 단계의 코드 변경 후 `bash scripts/verify.sh`를 실행한다. 2단계 최종 브라우저 검사는 기존 전체 Chromium E2E에 싱글·실제 2탭 PVP·PVE, Mini와 일반의 문구, 회전 직후 재접속 fixture를 추가해 실행한다. 테스트가 통과했다는 이유만으로 모든 상용 게임과 동일하다고 보고하지 않는다. 체감 확인·Linux CI는 실행한 경우에만 별도 기록한다.

## 7. 위험과 rollback

- 1단계는 과거 인정되던 공중 회전 후 낙하를 T-Spin에서 제외한다. 2단계는 일부 기존 일반 T-Spin을 Mini로 낮춰 점수·공격과 경기 양상을 바꾼다. 보상 표는 이 문서의 프로젝트 기준으로 적용했다.
- snapshot·combat effect 필드를 추가하면 엄격한 구버전 클라이언트는 새 payload를 거부할 수 있다. 서버·클라이언트를 같은 릴리스로 맞추고 기존 열린 탭을 새로고침한다. 진행 중 경기의 서버 메모리 이력을 무중단 변환하는 작업은 추가하지 않는다.
- 과거 로그에는 Mini를 복원할 정보가 부족하다. 킥 번호를 추정해 과거 데이터나 학습 산출물을 바꾸지 않는다. 규칙 변경 전후의 성능·보상 통계를 같은 조건으로 단순 비교하지 않는다.
- 1단계 rollback은 두 하드드롭 경로와 회귀 테스트를 함께 이전 상태로 복구한다. 잘못 인정하던 경로가 다시 열린다는 한계가 있다.
- 2단계 rollback은 core·상태·snapshot·입력 처리·보상·표시를 일관된 이전 릴리스로 복구한다. 이미 생성한 새 분류 로그를 읽는 호환 reader는 유지하거나 별도 보존해 로그 유실·검증 거부를 피한다. DB row·volume·기존 JSONL·데이터셋·모델을 삭제하지 않는다.

## 8. 구현과 검증 기록 (2026-10-21)

사용자의 1·2단계 구현 요청으로 공용 core·싱글·멀티 예측·서버 입력을 연결했다. 3단계인 게임 오버·버퍼 존은 보류한다. `spinRotation`을 회전 자격의 단일 상태로 사용하고 `tSpinType`으로 고정 결과·점수·공격을 계산한다. boolean은 결과 DTO와 로그에서만 파생한다.

- 1단계: 실제 회전 뒤 1칸·13칸 하드드롭의 오판정을 수정 전 실패로 확인했다. 클라이언트·서버에서 낙하 거리가 있으면 회전 자격을 지우고 제자리 확정은 보존했다. 독립 checkpoint에서 필수 verify는 Node **697 pass·1 skip**, Chromium 싱글·PVP·PVE·재접속 관련 **4/4** 통과였다.
- 2단계: 전면 코너·실제 SRS index 0~4·5번째 후보 뒤 연속 회전 승격과 이동·낙하·hold·spawn·재시작의 해제를 연결했다. `isTSpinLock` 내부 boolean API는 분류 API로 교체했다. Mini 0/1/2줄과 Full 1줄을 실제 회전 입력으로 만들어 싱글·멀티 예측·서버의 분류·보상·boardAfter를 비교했다. Full 전체 점수·공격표, Mini/B2B·콤보, Mini 상쇄·잔여 가비지, 기존 연속·동시 상쇄도 검사한다.
- 복원: 공개 snapshot에 이력 복사본을 포함한다. 기존 `syncLockDelay`는 같은 조각·좌표의 회전 이력과 유예를 함께 복원하는 `syncActivePieceState`로 교체했다. 기존 ack·보류 흐름 안에서만 적용하며 늦은 snapshot과 미확정 입력을 검사한다. 회전 이력 복원으로 유예 예산을 새로 만들지 않는다.
- 저장: 새 human/PVE placement 결과는 `tSpinType`을 기록한다. validator는 새 enum·boolean·줄 수 일관성을 검사하고 projector는 canonical payload에 보존한다. 필드가 없는 과거 v1/v2는 그대로 수용하며 full로 추정하지 않는다. PostgreSQL 테이블·운영 행·event hash·원본 JSONL·dataset·모델은 재작성하지 않았다.
- 브라우저: 싱글에서 고정 bag과 실제 키 입력으로 슬롯을 쌓아 Mini 확정 시 Full 점수가 붙지 않는지 확인한다. 실제 2탭 PVP·PVE에서 T를 회전한 직후 transport를 재연결해 이력 복원을 확인한다. 재접속 중 중력이 진행했으면 이력이 해제되는 규칙도 허용한다. 성과 fixture로 Mini/Full 문구·데스크톱 동시 배치·390px 기본/확대 글줄·중복·cleanup을 검사한다. 이 fixture 검사를 실제 경기에서 Mini 공격이 발생한 것과 혼동하지 않는다.
- 최종 검증: `bash scripts/verify.sh`의 공백·typecheck·build·artifact·Node 검사가 **709 pass·기존 조건부 1 skip·실패 0**으로 통과했다. 전체 Chromium E2E는 **53/53** 통과했다. 이후 TETRIS/Mini/Full 모두를 양쪽 보드·기본/확대 글줄에서 검사하도록 조합을 확대한 성과 E2E도 **1/1** 통과했다. 마지막 추가한 PVE 회귀는 실제 executor의 Mini Single 분류·10점·기본 공격 1줄과 저장/canonical payload 보존을 검증한다.
- 미검증: Linux CI·실기기 조작감/성능·실제 PostgreSQL 저장 통합은 이번에 실행하지 않았다. 기존 Python reference report 조건부 skip은 유지한다. 자동 학습·full 평가·커밋·push·배포도 수행하지 않았다.

적용 시 서버·클라이언트를 함께 갱신하고 열린 탭을 새로고침한다. 2단계 rollback은 위 §7대로 gameplay와 전송 계약을 함께 복구하며 새 로그를 읽는 호환 reader를 보존한다. 게임 오버 변경은 후속 별도 작업이다.
