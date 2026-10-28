# Human 행동 직전 관측 연결 감사

- 날짜: 2026-10-27 (Asia/Seoul)
- 상태: 감사 당시 `observation_link_audit_complete_partial_reuse_new_capture_required`. **2026-10-28 신규 수집 취소 — 기존 로그 전용 계획으로 변경**.
- 기준 branch/HEAD: `main` / `77af682e6f4914bba6a0534e628c9cd4a2bebac6`
- 범위: [AI 계획](../strategy/ai-plan.md)의 1단계. 기존 결과 재사용·기록/저장 caller 확인·작은 원본 trace 대조.
- 학습·dataset 생성·전체 replay·runtime/로그 schema 변경·운영 DB 접근·commit은 하지 않았다.

## 1. 결론 — 기존 자료는 살리고, 상황 정보는 보완한다

**기존 로그로 기록된 행동열·간격 분석은 가능하다. 그러나 모든 행동 직전의 상황과 첫 대기·공격 반응·Hold 성공까지 갖춘 dataset을 바로 만들 근거는 부족하다.**
이는 데이터 전체를 버리거나 모든 replay가 불가능하다는 뜻이 아니다.

- 재사용 가능: Human action 시도 순서, 같은 구간의 기록 시도 간격, Hold 시도 존재, placement 전후 보드/결과와 기존 품질·분할·검증 도구.
- 아직 미검증: 과거 action별 실제 출발 상태·성공 결과·Human이 당시 본 공격/보정 상태. 부분 replay는 초기 상태·당시 빌드·중간 사건이 확인된 구간에서만 후속 검토한다.
- 현재 trace에 없는 정보: spawn/조작 가능 전환 시각, 입력별 관측 snapshot, Hold 직전 availability/outcome, 공격을 Human에게 반영한 관측 시각.
- 현재 다음 계획: **기존 로그에서 확인된 행동열·리듬·Hold 시도와 문맥만으로 과제 한정**. 아래 수집 제안은 감사 당시 이력이며 사용자 결정으로 취소됐다. 모든 로그의 재수집을 요구하지 않는다.

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

## 6. 다음으로 제안하는 최소 수집 계약 — 아직 승인·구현 아님

1. **연결 키/버전:** game·가명 player·build/ruleset·관측 revision·clock segment·연속 event ID. Hold 전후의 조각 epoch를 pieceIndex와 구분한다.
2. **관측 checkpoint:** 조작 가능 전환, 공격 표시 변화, Hold/보정 등 관련 사건의 local 관측 시점과 공개 상태.
   행동 직전 관측을 정확히 연결할 수 있게 하되 모든 frame의 40×10 보드를 반복 저장하지 않는다.
3. **action attempt/outcome:** 같은 ID로 action·local 단조 시각·참조 관측 ID·성공/실패/사유·조각 전후를 연결한다.
   중력·조각 변화 때문에 action 사이 상태를 재현할 수 없다면 필요한 작은 delta/checkpoint를 남긴다.
4. **첫 대기/무입력 경계:** observation-ready와 첫 action, 관측 종료/연결 끊김/overflow/누락 표시.
   렌더 가능한 상태가 된 시간과 물리적으로 사람이 지각한 시간은 다르므로 label 이름을 정확히 정한다.
5. **저장 계약:** 새 versioned action trace로 검토한다. 기존 placement v3 의미를 조용히 변경하지 않는다.
   현재 durable event type은 start/placement/over이므로 **client 필드 추가만으로 DB에 보존되지 않는다**.
   validator/projector/저장·export·분석 경계와 byte/rate 상한·실패 보고를 함께 설계한다.

서버가 가진 원본을 추가로 복제해 gameplay 판단의 두 번째 원천으로 만들지 않는다.
이 trace는 학습용 관측 증거이며 critical input/ticker를 DB await로 막지 않는다.
원본 보드 대신 검증된 delta·정수 상대 시각·필요한 공개 필드만 보존하는 방식을 우선 비교한다.
공개 next 4개·관측 mask·시계 의미·누락 표시와 예상 bytes/game을 먼저 고정한 뒤 수집 구현을 요청한다.
수집할 게임 수는 이 설계만으로 임의 결정하지 않으며, 작은 pilot에서 행동/Hold/공격 coverage와 로그량을 보고 정한다.

### 기존 로그만으로 할 수 있는 최소 과제

기존 품질 gate를 통과한 구간에서 **과거 행동 prefix→다음 시도 action/기록 간격**의 상태 없는 기준선은 가능하다.
Hold 포함 구간은 별도 revision/품질 계약 검토가 필요하며 이번에 기존 timing dataset에 추가하지 않는다.
이는 새 목표의 일부 기준선일 뿐, 상황 조건부 모델이 완성됐다는 주장이 아니다.
당장 이 추가 baseline을 자동 구현하기보다 새 목표에 필요한 관측 계약부터 정한다.

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
