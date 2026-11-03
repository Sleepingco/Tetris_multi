# Human 행동 직전 관측 연결 감사

- 날짜: 2026-10-27 (Asia/Seoul)
- 상태: **existing_log_imitation_feasibility_reviewed — 기존 로그 활용 조사·기존 수집 제안 삭제**.
- 기준 branch/HEAD: `main` / `77af682e6f4914bba6a0534e628c9cd4a2bebac6`
- 범위: [AI 계획](../strategy/ai-plan.md)의 1단계. 기존 결과 재사용·기록/저장 caller 확인·작은 원본 trace 대조.
- 학습·dataset 생성·전체 replay·runtime/로그 schema 변경·운영 DB 접근·commit은 하지 않았다.

후속 구조 검토(2026-11-04 정정): [현재 AI 계획](../strategy/ai-plan.md)의 모듈형 A와 통합 신경망 B는 미채택 후보이며 진행 순서는 미정이다. 아래 A/B 제안과 과거 “다음” 작업은 당시 조사 이력이지 신규 수집·artifact 직접 이식·다음 구현 승인이 아니다. 감사의 관측 한계는 유지한다.

## 1. 결론 — 기존 자료는 살리고, 상황 정보는 보완한다

**기존 로그로 기록된 행동열·간격 분석은 가능하다. 그러나 모든 행동 직전의 상황과 첫 대기·공격 반응·Hold 성공까지 갖춘 dataset을 바로 만들 근거는 부족하다.**
이는 데이터 전체를 버리거나 모든 replay가 불가능하다는 뜻이 아니다.

- 재사용 가능: Human action 시도 순서, 같은 구간의 기록 시도 간격, Hold 시도 존재, placement 전후 보드/결과와 기존 품질·분할·검증 도구.
- 아직 미검증: 과거 action별 실제 출발 상태·성공 결과·Human이 당시 본 공격/보정 상태. 부분 replay는 초기 상태·당시 빌드·중간 사건이 확인된 구간에서만 후속 검토한다.
- 현재 trace에 없는 정보: spawn/조작 가능 전환 시각, 입력별 관측 snapshot, Hold 직전 availability/outcome, 공격을 Human에게 반영한 관측 시각.
- 현재 목표: **기존 보드·selectedPlacement로 사람 배치 선택 학습 + 입력열·간격으로 조작/리듬 학습 → 같은 core로 결합 실행 검증**. 다음 행동·간격 공동 기준선은 부분 과제다. 신규 수집 제안은 삭제했고 아래 6절에 기존 자료만 사용하는 경로와 제한을 정리했다.

## 2. 확인 범위와 증거

이전 [readiness Full](../../../ai-harness/runs/human-action-data-readiness-analyze-result-2026-10-24.md)의
235게임·10,816 Human 구간·88,845입력과 상태/Hold unverified 판정을 재사용했다. Full 감사를 다시 실행하지 않았다.

| 증거 | 이번 확인 범위 |
| --- | --- |
| immutable legacy raw | `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`, 650,669,388 bytes. Source line 118012~118034만 JSON 해석, Train game의 일반/Hold trace 두 건 선택 |
| 기존 timing manifest | Train game 149개를 확인해 표본의 개발 cohort 소속 확인. Test JSONL은 열지 않음 |
| local raw v3 비교 | `data/logs/game-events.jsonl`의 당시 마지막 600행만 확인. 파일 전체 game 수·품질·production 수집 현황을 감사한 것이 아님 |
| 실제 source/caller | runtime→session→서버 저장 projector, authoritative snapshot/garbage 경로, HUD/Canvas 관측 범위 |

Local 파일은 242,701,620 bytes였고 읽는 동안 size/mtime가 변하지 않았다.
마지막 600행 bytes SHA는 `6073dea2a8e0173f4d8a00bac08182d47d6101665e3aa3820076443e752ae777`이다.
그 window에는 v3 Human placement 122건/heuristic 218건/start 5건/over 4건과 legacy 251건이 있었다.
**Window에서 본 구조만 설명한다.** Local raw 표본은 canonical DB 검증 통과·정상 Human 플레이 품질의 증명이 아니다.

문서에는 실제 game/player/room ID·원본 epoch·token을 복사하지 않았다.
Source line은 위 source checksum에 묶인 위치이고 시각은 첫 입력 대비 상대 ms다.

## 3. 필요한 정보별 생성·보존·연결 판정

| 필요한 정보 | 실제 생성·저장 위치/시점 | 판정·사용 범위 |
| --- | --- | --- |
| Human action 순서 | [drainInputQueue/recordAppliedInput](../../../src/client/game/runtime/tetris.ts), [projectInputSequence](../../../src/server/services/gameEventProjector.ts) | 실행 시도 기록으로 재사용. 성공/물리 keydown과 구분. 누락/중복/구간 경계 검증은 유지 |
| 입력 간격 | 입력을 소비하고 action을 호출하기 직전 `Date.now()`. Canonical nested timestamp 보존 | 같은 client clock의 인접 시도 간격으로 재사용. 인지 시간·enqueue 대기·실제 키 입력 시간으로 해석하지 않음 |
| 각 action 직전 활성 조각/성공 | runtime `activePieceBefore/After, applied, reason`을 `recordInputOutcome` callback에 전달 | 현재 실행 중에는 알지만 저장 input은 action/tick/pieceIndex/선택적 sequence/createdAt뿐. 과거 입력별 상태/성공은 직접 확인 불가 |
| 각 action 직전 보드 | `createPlacementDecisionContext`가 lock 직전 보드를 복사 | `boardBefore`는 각 입력 직전 보드가 아님. 이전 placement 결과를 그대로 연결하는 것도 일반적으로 불가 |
| `activePiece` 출발 anchor | spawn·Hold 교체의 `activateSpawnedPiece`, 보정 `applySnapshot`에서 `decisionStartPiece` 갱신 | 최종 저장 anchor가 최초 spawn 상태라는 보장 없음. Hold/보정 전 입력에 같은 anchor를 붙이면 안 됨 |
| 공개 next/Hold | queue/Hold는 lock 직전 복사. 현재 HUD에는 next 4개 표시 | 과거 행동 시점으로 소급 불가. 전체 queue를 feature로 사용하지 않음. 과거 UI 노출 범위도 빌드별 미확인 |
| Hold availability/결과 | 현재 runtime은 `holdUsedThisDrop` 검사, 결과는 callback으로 전달 | raw에는 Hold action만 있고 해당 직전 availability·성공 label 없음. 마지막 hold 슬롯으로 과거 상태를 역산하지 않음 |
| 첫 행동 대기 | spawn은 조각 복사만 하며 ready/spawn timestamp를 input에 저장하지 않음 | 첫 입력 timestamp는 있으나 시작 시점 없음. 이전 placement epoch나 tick×16으로 대체 금지 |
| 알려진 pending 공격 | 서버 queue→snapshot `pendingGarbageLines`→session→runtime/HUD | 통신/메모리에는 있지만 Human이 이를 반영한 시각·action 관측 snapshot을 placement 저장 경로가 보존하지 않음 |
| 중력/lock 상태·중간 보정 | runtime `performance.now`, 누적 중력, lockDelay, snapshot 적용 | placement 시퀀스에 완전한 시계/이벤트 이력이 없음. tick만으로 정확한 replay 증명 불가 |
| 결과/신뢰/종료 | v3 observation은 lock/post-line-clear 등의 **결과 관찰 단계**. Human은 client_reported | 행동 전 관측 snapshot과 다른 개념. authoritative placement receipt가 모든 과거 입력 성공·상태를 인증하지 않음 |
| 기록 누락/단절 | runtime input 상한·overflow 시 placement 미전송, session 보정/연결 종료 시 buffer 폐기, 서버 수집 한도 | 기록이 없다고 실제 무입력/긴 WAIT로 학습하면 안 됨. 종료·누락·중도 관측 종료 표시는 새 계약에 필요 |

현재 callback이 제공하는 것은 **조각 전후**이지 완전한 보드·공격·시계 snapshot이 아니다.
Callback을 저장하기만 하면 모든 상황 정보가 해결되는 것도 아니다.
[session](../../../src/client/game/entry/multiplayerGameSession.ts)은 `applied=true`인 local 입력만 서버로 보내지만
placement inputSequence에는 실패 시도도 들어갈 수 있다. 두 sequence의 숫자를 증거 없이 같은 입력 ID로 join하지 않는다.

### 사람이 볼 수 있는 정보와 내부 상태를 나눈다

- 현재 [HUD bridge](../../../src/client/game/runtime/displayBridge.ts)와 runtime은 next 4개를 표시한다.
  Legacy 표본의 저장 queue는 20/14개였다. 전체 저장 배열을 그대로 넣으면 당시 화면에 없던 정보를 줄 수 있다.
- [Canvas renderer](../../../src/client/game/render/tetrisRender.ts)는 현재 40행 보드에서 상단 4행 표시와 기본 20행,
  즉 내부 row 16~39를 그린다. 내부 row 0~15까지 모두 Human에게 보였다고 가정하지 않는다.
  실제 노출 mask와 조각/ghost 표현은 후속 관측 계약에서 고정한다.
- 서버 garbage hole 위치·비공개 bag 전체·미래 공격·결과 보드는 관측 feature가 아니다.
- Lock 예산 같은 내부 시간은 실행 안전성에 필요할 수 있지만, 화면에 직접 드러나지 않는 값을 Human 관측 feature로 쓸지는 구분해 결정한다.
  내부 상태를 쓰는 실험은 명시적 privileged-state 비교이지 동일 관측 조건의 모방 증거가 아니다.

## 4. 작은 trace 네 종류

### A. 일반 조작 — 순서/간격은 있지만 입력 직전 상태는 없다

Legacy line 118015, pieceIndex 1, 20×10, schema v2, Human/client_reported.
이 게임은 기존 timing Train에 속한다.

| Action | 첫 입력 대비 ms |
| --- | ---: |
| move_left | 0 |
| move_left | 177 |
| rotate | 272 |
| move_left | 304 |
| move_left | 464 |
| hard_drop | 514 |

Input의 저장 key는 `action, createdAt, pieceIndex, sequence, tick`이었다.
이 표로 순서·기록 간격은 확인하지만, 첫 move_left 직전 위치·회전 성공·첫 입력 이전 대기를 확인하지는 못한다.
첫 값 0은 이 문서가 첫 입력을 원점으로 바꾼 값이지 0ms 반응시간이 아니다.

### B. Hold — 같은 pieceIndex 안에서 anchor가 달라질 수 있다

Legacy line 118031, pieceIndex 6:

```text
move_left 0 → rotate 146 → move_left 384
→ hold 545 → move_left 623 → rotate 687
→ move_left 768 → move_right 1039 → hard_drop 1135 (ms)
```

저장 activePiece/선택 조각은 ess, 마지막 hold 슬롯은 square였다.
이 값으로 **Hold 전 조각/슬롯/사용 가능 여부와 성공을 확정하지 않는다**.

Local v3 tail의 342번째 row에도 pieceIndex 22의 입력 26개 중 index 10에 Hold가 있었다.

```text
move_right 1377 → move_right 1553 → hold 1761
→ move_right 1783 → rotate_ccw 1937 (첫 입력 대비 ms)
```

Hold 앞뒤 입력 모두 pieceIndex 22였다. 저장 anchor/선택 조각은 eright, 마지막 hold는 ess다.
한 pieceIndex가 한 종류 조각의 연속 조작이라는 가정은 사용할 수 없다.

### C. 공격/외부 변화 — 이전 boardAfter를 다음 시작 보드로 쓰면 안 된다

동일 legacy game/player의 pieceIndex 5(line 118028)→6(line 118031)는 연속 번호지만:

- 이전 placement boardAfter: garbage cell 9개
- 다음 placement boardBefore: garbage cell 36개
- 두 보드의 서로 다른 cell: 51개

이것은 **anchor 사이에 상태 변화가 있다는 증거**다. 정확한 공격 도착/적용 시각·발신자·Human 관측 시점의 증거는 아니다.
전체 규칙 replay를 하지 않았으므로 차이의 원인을 한 가지로 확정하지 않는다.

Local v3 tail의 275번째 row에는 AI attackLines=1의 post_garbage_spawn 결과가 있었다.
그러나 수신자가 이를 화면에서 알게 된 timestamp는 그 event에 없었다.
또한 그 window의 Human incomingGarbageLines는 모두 0이었다.
[현재 Human finalize 코드](../../../src/client/game/runtime/tetris.ts)는 이 결과 필드를 0으로 작성하므로
**0을 “그 action 당시 공격 위협 없음” label로 사용할 수 없다**. 발생한 공격 결과도 이전 시점 feature가 아니다.

### D. Spawn→첫 action — 끝만 있고 시작이 없다

Legacy 일반 trace에는 첫 입력 createdAt과 시작 조각 모양은 있으나 조작 가능 전환 시각은 없다.
v3 일반 표본에도 최초 rotate_ccw 뒤 상대 225/416/896/1842ms 입력이 있었지만 spawn/ready 시간 필드는 없었다.
v3 observation.nextSpawnOutcome=not_evaluated는 placement 결과의 뜻이지 spawn timestamp가 아니다.

직전 placement→다음 첫 입력에는 line-clear 연출·garbage·통신/보정 등이 섞일 수 있다.
두 clock/관찰 단계의 차이를 “고민 시간”으로 채우지 않는다.

## 5. Clock과 replay 경계

| 값 | 기준·한계 |
| --- | --- |
| input.createdAt | client wall clock, 소비/시도 직전. 같은 clock의 인접 차이에 한정 |
| input.tick | 예약/처리 순서에 사용하는 local 실행 번호. 고정 ms 환산 불가 |
| runtime performance.now | 중력/lock 등 local 단조 시간. 현재 stored input과 같은 원점이라고 가정하지 않음 |
| placement occurred_at | placement 생성 시각에서 유도한 event 시각. spawn 시점 아님 |
| DB ingested_at | DB 저장 시각. Human 관측·입력 clock과 직접 빼지 않음 |

완전한 replay에는 당시 규칙·초기 보드/조각/공개 queue/Hold, 중력/lock 경과,
외부 garbage/보정·입력 시도 순서·관찰 구간·대조 anchor가 필요하다.
현재는 모든 항목을 묶어 증명하지 못했다. 알려진 빌드가 없다는 이유만으로 모든 과제를 폐기하지 않지만,
현재 40행 엔진으로 과거 20행 기록을 재생해 같다고 가정하지 않는다.
후속의 작은 부분 replay는 가능성 조사이며 이번에 구현하거나 실행하지 않았다.

## 6. 기존 로그만으로 완성할 경로 조사 (2026-10-28)

### 결론과 학습 목표

**재수집 없이 기존 Human 로그의 보드 상태와 selectedPlacement로 배치 선택을 학습하고, inputSequence와 간격으로 조작/리듬을 학습하는 것이 목표다.**
모든 action 직전 상태가 없다는 한계와 placement 단위의 보드·선택 정답이 기록됐다는 사실은 다르다. 전자를 이유로 배치 학습 목표를 제거하지 않는다.
아래는 데이터 시점·정합성 검증을 포함한 계획이며 새 모델의 성능 확인이나 학습 실행 결과가 아니다. 공격 의도까지 복원됐다고 주장하지 않는다.

| 목표 | 기존 자료로 가능한 경로 | 제한 |
| --- | --- | --- |
| 조작 순서·습관 | 기록된 prefix에서 다음 semantic action 예측 | 키 누름/뗌·DAS/ARR·입력 성공은 학습 정답이 아님 |
| 행동과 리듬 연결 | 같은 표본의 다음 action과 간격을 함께 예측 | 첫 spawn 대기·사람의 고민/지각 시간으로 해석하지 않음 |
| Hold | 기존 원본의 Hold 포함 구간을 시도 label로 사용 | 성공·최적 사용·보드 조건부 전략의 증거는 별개 |
| 배치 결정 | 기존 Human의 boardBefore·조각 상태를 입력, selectedPlacement/물리 배치 class를 정답으로 지도 학습 | 기록 시점·Hold 경계·선택 배치의 합법성/도달 가능성 검증. V4 125게임 모델의 현재 40행 직접 이식은 하지 않음 |
| 보드/공격 조건부 전략 | 배치 단위에서 확인된 보드 상태를 학습에 사용하고 공격 시점은 확인되는 정보만 별도 가설 | 고정 직전 보드를 모든 과거 action 직전으로 소급하거나 미래 결과로 누락 상태를 채우지 않음 |

전체 경로는 **Human selectedPlacement로 학습한 배치 정책 + Human 입력열/간격으로 학습한 조작·리듬 모델 + 기존 core 실행**이다.
모듈형이어도 배치 목표는 학습 모델이 고른다. Core의 도달 가능 후보 생성·충돌 검사와 행동 실행은 합법성/실행 제약이지 휴리스틱 점수로 목표를 선택하는 정책이 아니다.
배치 선택 학습이 빠진 조작/리듬 체험만으로 완료 처리하지 않는다. 기존 자료의 시점·정합성이 맞지 않는 표본은 격리하고 근거가 있는 배치 표본을 사용한다. 학습 가능 범위나 성능이 부족하면 이를 미검증/미달로 보고하며 다른 목표로 조용히 대체하거나 추가 수집을 요구하지 않는다.

### 배치 선택과 조작 학습을 연결하는 데이터 계약

- 배치 입력 후보는 기존 raw의 `boardBefore`와 예측 시점에 대응하는 `activePiece`/조각 상태다. `selectedPlacement`는 **어디에 놓았는가의 정답**이며 배치 모델의 입력에 넣지 않는다. Hold/공개 next도 그 시점의 값이라는 근거가 있을 때만 입력에 포함한다.
- `boardBefore`가 고정 직전이라는 생성 코드의 의미를 보존한다. Spawn 당시 관측이라고 바꿔 부르거나 동일 보드를 과거 모든 action에 복사하지 않는다. 배치 단위의 보드·대상 조각·선택 위치 대응과 추론 시점의 상태 계약을 기존 자료로 검증한다.
- 기존 후보 생성/정규화·물리 배치 동치 class를 재사용해 사람 선택 class를 label로 만든다. 휴리스틱 점수·순위를 label/입력으로 쓰거나 학습 후보를 선호도에 따라 사전 선별하지 않는다. 실제 선택 class가 누락되거나 도달 불가이면 임의의 좋은 후보로 바꾸지 않고 사유를 남긴다.
- 배치 선택 이후의 `boardAfter`·실제 줄 삭제/공격량·승패를 예측 입력으로 넣지 않는다. 후보별 core simulation 특징을 사용한다면 같은 입력 보드에서 모든 후보에 동일하게 계산한 값인지 구분한다.
- 목표 조건부 조작 모델은 학습 때 Human 목표와 실제 입력열/간격을 연결할 수 있다. 그러나 전체 추론에서는 **배치 모델이 예측한 목표**를 사용해야 한다. 정답 목표를 미리 준 조작 decoder 성능은 별도 oracle 진단이다.
- Timing v1에는 보드와 selectedPlacement가 없으므로 그것만으로 전체 배치 모방 모델을 만들지 않는다. 기존 raw의 승인 게임에서 배치 view를 별도로 정의하고 game/player/piece/source lineage로 조작 view와 연결한다. 원본·timing v1·기존 split은 덮어쓰지 않는다.

### 이미 있는 dataset에서 바로 재사용할 정보

2026-10-28 읽기 전용 열/개수·checksum 확인 결과다. 학습·평가·dataset 재생성은 하지 않았다.

- 고정 timing v1: 승인된 213게임, 61,190 pair. Train 149게임/41,151 pair·Validation 31게임/10,180 pair·기존 Test 33게임/9,859 pair다.
- 열에는 `previousAction`, `nextActionDiagnostic`, `recordedIntervalMs`와 game/player/piece/sourceLine·인접 input index가 있다.
- 기존 시간 실험에서는 diagnostic이던 `nextActionDiagnostic`을 **새 공동 예측 과제의 label로만** 사용할 수 있다. 입력으로 쓰는 것은 누수다. 기존 schema/명세를 덮어쓰지 않고 새 실험 명세에서 이 의미를 고정한다.
- Train의 다음 행동 label은 left 11,181/right 13,373/rotate 9,363/hard_drop 6,358/soft_drop 838/rotate_ccw 38이다. Validation에는 rotate_ccw가 없다. 단순 accuracy만으로 희소 행동까지 배웠다고 판단하지 않는다.
- 이 dataset에서는 Hold 구간 1,138개와 timing-limited 95개가 제외됐다. 따라서 이것만으로 Hold 모델을 학습할 수는 없다. 기존 원본에 해당 구간이 남아 있으므로 재수집 문제가 아니라 추출 과제의 차이다.
- Readiness 전체 원본에는 Human 10,816구간/88,845입력·Hold 시도 1,173개가 있다. 이는 품질 gate 이전의 235 Human 게임 집계이므로 승인된 213게임의 학습 수로 바꿔 적지 않는다.

확인한 SHA-256:

| 기존 파일 | SHA-256 |
| --- | --- |
| readiness full report | `27f2a5dc3dae6143d22b0930987b3cd102e90d07ae1f228deadd0da41db41b4a` |
| quality full report | `97388649259414fe2f5119e76ffa57922b3202f85c920540674f0fc494973ff4` |
| timing manifest | `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88` |
| timing Train | `c42c01d6fba0eb7128b77c0773a1669a9be620530a2fb99171dcca67ff3fb7c3` |
| timing Validation | `7e9099916aae3e0f7c3875d8169e88f7847b0f9f517a506c78b2776d4d44660f` |

### 학습 두 버전과 단계를 한정한다

사용자 결정(2026-10-29)은 특정 개인이 아니라 수집된 여러 Human의 전반적인 성향을 모방하고, 다음 행동·시간 공동 기준선을 먼저 구현하는 것이다. 아래 순서는 이 결정을 반영하며 이번 문서 개정이 구현·Full 승인은 아니다.

1. 조작 부분의 첫 비교는 기존 pair의 `이미 끝난 행동 → 다음 시도 action + 간격`이다. Game/player/piece/sourceLine·인접 index로 prefix를 연결하고 gap에서 reset한다. 새 JSONL을 먼저 만들 필요는 없다. 현재 공동 명세는 조작/시간 부분의 비교 기준이며 전체 정책의 완료 조건을 대신하지 않는다.
2. 공동 기준선 결과 검토 뒤 기존 Human 보드·selectedPlacement의 정합한 배치 view를 정의하고 배치 분류/ranking 기준선을 학습·평가하는 명세를 준비한다. 휴리스틱 배치를 전제로 대체하지 않는다.
3. A는 **학습한 Human 배치 정책 → 목표 조건부 조작·간격 모델**이다. B는 정합한 보드/이력을 읽어 배치 head와 action/시간 head를 학습하는 통합 신경망 후보다. 학습 단위/관측 시점이 다른 view를 잘못 결합하지 않는다. 층/크기/loss/dependency는 비교 명세에서 정하며 지금 설치하지 않는다.
4. 학습 때 정답 action을 시간 head에 줄 수 있어도 추론에서는 선택한 action을 쓴다. 정답 action/배치 목표 조건의 점수와 전체 예측 목표 기반 rollout을 분리한다.
5. 기존 원본의 승인 gameId만 대상으로 Hold 포함 행동열 view를 정의한다. 시도 label과 성공/전략 label을 구분하고 같은 pieceIndex 안의 교체 전후 대응을 확인한다. 기존 timing v1은 불변이다.
6. 첫 행동의 action 분포와 첫 대기는 다른 문제다. 기존 raw로 첫 시도 종류는 볼 수 있지만 spawn→첫 입력 시간은 알 수 없다. 첫 대기를 실행 설정으로 제공하면 학습한 반응시간과 구분한다.

이는 기존 B3의 간격 예측만 세분화하는 계획이 아니다. **보드에서 사람의 배치 선택을 학습하는 경로와 그 목표를 실제 조작·리듬으로 실현하는 경로를 모두 검증**한다. 조작 부분 기준선의 성적만으로 전체 목표 달성을 주장하지 않는다.

### 실행·평가를 마감하는 방법

- Action: game-macro F1/NLL·행동별 recall·희소 행동 수를 보고 최빈 행동·단순 전이 기준선과 비교한다. 시간: 같은 label/표본에서 CRPS·분위수 보정·0ms/긴 꼬리 진단을 본다.
- 배치: Human 선택 물리 class의 Top-1/Top-3/MRR·게임별 편차와 선택 후보 누락률을 확인한다. 전체 실행에서는 예측 배치 목표 도달률·최종 placement 일치·조작/시간 품질을 함께 본다.
- 이미 본 Validation/Test를 새 독립 증거로 바꾸지 않는다. 기존 Train의 game-grouped 내부 검증으로 탐색하고 기존 Validation으로 고정 비교한다. Test 33게임은 이미 관측한 진단 cohort다. 재분할/교차 검증을 해도 외부 독립 검증으로 부르지 않는다.
- 신규 Human 게임이 없어도 기존 core의 고정 seed로 자체 실행 검사를 할 수 있다. 이는 합성 모델 평가이며 Human 학습 데이터에 섞거나 새로운 사람 정답으로 저장하지 않는다. Offline 점수와 실패 누적을 별도로 본다.
- 아무 행동이나 순서대로 재생하지 않는다. A/B는 추론 시 **Human 배치 모델이 예측한 목표**를 사용한다. Human 최종 배치를 미리 주는 실험은 목표 조건부 decoder 진단이지 전체 정책의 성능이 아니다. 목표와 관측 anchor가 확인되지 않는 표본은 결합 학습에서 격리한다.
- 실행기는 current state·Hold 제한·기존 reachable plan을 확인하고 bounded 대기/행동 수·관련 상태 변화 후 재판단·명시적 fallback을 적용한다. 이 runtime 안전성을 Human이 공격에 반응하는 전략을 배웠다는 증거로 쓰지 않는다.
- 제품 완료는 학습한 배치 선택과 조작/리듬 모두가 지원 ruleset에서 결합 검증을 통과한 opt-in 체험이다. 독립 Human 일반화·프로 수준 전략·휴리스틱보다 강함은 별도 근거가 필요하다. 단순 속도 조절이나 규칙 기반 배치 선택으로 이 목표를 대체하지 않는다.

### 연구 근거와 이번 프로젝트에 대한 추론

[Behavioral Cloning 공식 설명](https://imitation.readthedocs.io/en/latest/algorithms/bc.html)은 관측-action 쌍으로 정책을 지도 학습한다고 설명한다. 현재 확실히 관측한 행동 이력을 입력으로 쓸 수 있지만 누락된 보드 상태가 자동 복원된다는 뜻은 아니다. 여기서는 라이브러리를 도입하자는 제안이 아니라 label/입력 경계를 정하는 근거로 사용한다.
[Ross 등의 연구](https://proceedings.mlr.press/v15/ross11a.html)는 실행한 행동이 다음 관측 분포를 바꾼다는 순차 예측의 문제를 다룬다. 따라서 one-step F1/CRPS만으로 자체 플레이를 보장할 수 없다는 것이 이번 계획의 추론이다. 추가 사람 정답을 요청하는 DAgger는 현재 제약에 맞지 않아 제안하지 않는다.

이번 조사에서 새 모델의 학습 가능성·성능·체감 개선을 실측한 것은 아니다. 기존 증거로 실행 가능한 경로와 보장할 수 없는 범위를 분리했다.

## 7. 직접 확인하기 — 읽기 전용 pandas/Matplotlib 예제

원본과 기존 readiness Notebook이 있는 저장소 루트를 작업 경로로 한 Notebook cell에서 실행한다.
기존 parser 정의를 재사용하며 다른 실험 구현 파일을 만들지 않는다. 학습·파일 쓰기·Test 로딩은 없다.
line 번호는 이 문서의 immutable source SHA에만 해당한다.

```python
import json
from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt

root = Path.cwd()
book = json.loads((root / "scripts/ml/notebooks/human_action_data_readiness.ipynb").read_text())
scope = {"__name__": "readonly_observation_trace"}
for cell in book["cells"]:
    if cell.get("id") in ("imports", "parser"):
        exec("".join(cell["source"]), scope)

source = root / "data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl"
assert scope["sha256_file"](source) == "eb64f86731ecb148ebf398773cb8e23cdf71217fc44f3bcb88460299bb092344"
rows = []
with source.open("rb") as handle:
    for line_number, line in enumerate(handle, 1):
        if line_number in (118015, 118031):
            _, event, payload, _ = scope["normalize_event"](json.loads(line))
            assert payload["source"] == "human"
            inputs = payload["inputSequence"]
            origin = inputs[0]["createdAt"]
            rows.extend({"sourceLine": line_number, "action": item["action"],
                         "relativeMs": item["createdAt"] - origin} for item in inputs)
        if line_number >= 118031:
            break
assert len(rows) == 15
frame = pd.DataFrame(rows)
display(frame)
fig, ax = plt.subplots(figsize=(9, 3))
for number, group in frame.groupby("sourceLine"):
    ax.scatter(group["relativeMs"], group["action"], label=f"line {number}")
ax.set(xlabel="ms since first recorded attempt", ylabel="action",
       title="Recorded sequence; not spawn reaction time")
ax.legend()
plt.show()
```

첫 점이 0이라는 이유로 첫 반응이 즉시였다고 해석하지 않는다.
표/그래프는 행동 순서와 상대 시각을 보여줄 뿐 누락된 상태를 복원하지 않는다.

## 8. 검증·남은 제한

- 기준 raw SHA는 기존 Full/manifest의 값과 일치한다.
- timing manifest/Train/Validation SHA는 기존 고정 값과 일치한다. Test JSONL은 열거나 평가하지 않았다.
- 기존 readiness report SHA: `27f2a5dc3dae6143d22b0930987b3cd102e90d07ae1f228deadd0da41db41b4a`.
- 코드 caller 대조·범위가 제한된 raw trace 대조를 완료했다. 문서 예제는 15개 입력·Hold 1건·구간별 상대 원점 0의 assert와 표/그래프 생성을 통과했다. Headless Agg의 화면 표시/임시 font cache 경고는 있었으나 exit 0이며 artifact는 저장하지 않았다.
- 변경 문서 9개 상대 링크 293개·앵커 24개와 fence/공백 검사를 통과했다. 표본을 전체 game 판정으로 확대하지 않는다.
- 운영 PostgreSQL·전체 v3/40행 품질·과거 replay·물리 키 입력·실제 전략적 의도는 미검증이다.
- Runtime/실험 계산·Notebook·테스트·raw/dataset/report는 변경하지 않았다. 문서만 추가/갱신하며 전체 테스트를 반복하지 않는다.
- Rollback은 이번 문서 추가/상태 갱신만 되돌리는 범위다. 데이터 삭제/복구나 production rollback은 필요하지 않다.
