# Tetris placement AI 전체 계획

마지막 정리: 2026-07-20

현재 프로그램 상태: **imitation_only_not_gameplay_ready**

현재 production 결정: **keep_heuristic_default**

현재 활성 실험: **없음**

Artifact 상태: `canonicalArtifact=false`, `productionIntegration=false`

---

## 1. 이 문서의 역할

이 문서는 Tetris placement AI에서 완료한 작업과 앞으로 할 작업을 한눈에 보는 실행 계획이다.

문서별 책임은 다음과 같다.

| 문서 | 책임 |
|---|---|
| [ai-plan.md](ai-plan.md) | 완료 단계, 앞으로의 작업 순서, 의존성, 동결·통합 gate |
| [ai-experiments-log.md](ai-experiments-log.md) | 각 실험의 데이터, metric, checksum, 명령과 상세 근거 |
| [placement-pair-weight-decomposition.md](placement-pair-weight-decomposition.md) | 최신 pair-weight 실험의 학습용 walkthrough |
| [PLAN.md](../PLAN.md) | 전체 게임·멀티플레이 프로젝트의 현재 상태와 우선순위 |
| [archived ai-pve-plan.md](archive/ai-ml/plans/ai-pve-plan.md) | 현재 구현으로 대체된 초기 PVE AI 구조 계획 |
| [README.md](README.md) | 현재 재사용 파일, historical evidence, local ignored evidence의 단일 진입점 |

실제 상태가 문서와 다르면 Git, 실제 코드, 테스트 결과를 우선한다.

[archived ai-pve-plan.md](archive/ai-ml/plans/ai-pve-plan.md)의 Current State는
ML 실험 이전의 역사적 설명이다. 최신 placement ML 진행 상태는 이 문서와
ai-experiments-log.md를 기준으로 본다.

---

## 2. 5분 요약

현재까지는 다음을 완료했다.

~~~text
Human gameplay log
→ game 단위 immutable dataset
→ Human placement imitation 평가와 V4 선택
→ 125-game candidate artifact
→ reference inference·game-over safety 검증
→ dev-only PVE integration
→ deterministic gameplay evaluation 종료
~~~

현재 알게 된 사실:

- Python 실험 스택은 기존 JavaScript 수치 계약을 정확히 재현한다.
- 새 학습·feature·평가는 Python Notebook을 단일 실험 경로로 사용한다.
- 현재 모델은 16-feature Logistic Regression 기반 Human 선택 모방 모델이다.
- 동일 occupied-cell placement가 rotation/pivot alias로 중복 기록돼 있었다.
- 동일 물리 placement를 묶는 row compression 자체는 metric을 떨어뜨리지 않는다.
- 관측된 Micro MRR 하락 약 0.001153은 pair-weight 재분배로 설명된다.
- V4 cell-grouped 방식은 물리적 선택지 하나를 하나의 pair 단위로 표현하며 V3보다 계산량이 작다.
- V4 125-game candidate artifact는 생성됐지만 `canonicalArtifact=false`다.
- Reference inference와 game-over safety 계약, dev-only PVE integration은 검증됐다.
- Human 선택 모방 metric은 실제 생존, 공격, 승률 또는 강한 gameplay AI를 의미하지 않는다.
- 30-stream gameplay screening은 pass 경계에서 종료됐지만 V4-only game-over와 board diagnostics 때문에 gameplay replacement 근거가 부족하다.
- Production/PVE 기본 정책은 heuristic이며, V4는 Human imitation·offline analysis 범위에만 유지한다.

현재 위치:

~~~text
데이터·평가 파이프라인 검증 완료
→ V4 candidate trainer·reference safety·dev-only integration 완료
→ gameplay evaluation 종료
→ Human imitation 용도 유지
→ gameplay replacement 보류
→ heuristic production 기본 정책 유지
~~~

---

## 3. 작업 위치와 현재 checkpoint

### 3.1 Worktree와 branch

| 구분 | 값 |
|---|---|
| AI worktree | /Users/parkseongho/visualstudio-workspace/Tetris_multi-ai |
| AI branch | codex/python-sklearn-logo-evaluation |
| main worktree | /Users/parkseongho/visualstudio-workspace/Tetris_multi |
| main 역할 | 실제 게임 실행과 최종 통합 |

작성 시점 Git 상태:

- Git branch, HEAD, main과의 계보, dirty/untracked 파일은 작업 시작 시 실제 Git으로 확인한다.
- V4 125-game candidate artifact와 dev-only PVE 경계는 완료됐지만 production artifact가 아니다.
- Gameplay evaluation의 상세 근거와 ignored report SHA는 [gameplay analyze-result record](../ai-harness/runs/placement-v4-pve-gameplay-benchmark-analyze-result-2026-07-20.md)에 보존한다.

### 3.2 현재 바로 다음 작업

현재 활성 실험이나 자동 다음 작업은 없다.

새 작업은 Human imitation 목적과 gameplay promotion 목적을 먼저 분리하고, 별도 승인된 질문·입력 cohort·성공 기준으로 시작한다. 현재 결정만으로 feature 추가, hybrid, 재학습, 100-stream 확장, production/PVE 기본값 변경을 시작하지 않는다.

---

## 4. 변하지 않는 AI 개발 원칙

### 4.1 실험과 production 코드 분리

~~~text
게임 로그 수집·candidate 생성
  = JavaScript 게임 규칙 경계

feature·pair·weight·모델·평가 실험
  = Python Notebook 경계

동결된 최종 학습과 artifact export
  = Python trainer 경계

production inference
  = 동결 이후 JavaScript에 한 번 이식
~~~

새 실험을 JavaScript와 Python에 동시에 구현하지 않는다.

### 4.2 Notebook 우선

실험 단계에서는 Jupyter Notebook을 사용한다.

Notebook은 다음을 사람이 읽을 수 있게 보여야 한다.

1. 왜 이 질문을 하는가
2. 무엇을 고정하는가
3. 무엇 하나만 바꾸는가
4. 작은 worked example
5. 전체 평가
6. 실패 사례
7. 결론과 다음 gate

representation, feature, pair weighting, scaler, estimator와 metric이 동결되고 사용자가 ready_to_freeze를 승인한 뒤에만 최종 trainer를 Python 파일로 만든다.

### 4.3 한 실험에서 한 변수만 변경

다음 항목을 동시에 여러 개 바꾸지 않는다.

- representation
- feature
- pair construction
- sample weight
- scaler
- estimator
- hyperparameter
- evaluation metric

동시에 바꾸면 결과 원인을 설명할 수 없으므로 실험을 분리한다.

### 4.4 데이터 불변성

- Notebook은 live game-events.jsonl을 직접 학습 입력으로 사용하지 않는다.
- 매 데이터 확대는 새 이름의 immutable snapshot으로 만든다.
- 기존 snapshot을 덮어쓰지 않는다.
- source log와 snapshot 네 파일 SHA-256을 기록한다.
- train/validation gameId leakage가 없어야 한다.
- snapshot은 worktree 외부의 영구 위치에도 보관한다.

### 4.5 Production 보류

다음 조건 전에는 production model, runtime 또는 PVE를 변경하지 않는다.

- weighting policy 동결
- feature와 representation 동결
- final trainer 결정성 검증
- 실제 gameplay benchmark
- JavaScript inference parity
- main의 authoritative multiplayer prerequisite 통과
- heuristic fallback 준비
- 사용자 production 승인

---

## 5. 완료한 계획

### Phase 0 — Dataset 기반 구축

상태: **완료**

목적:

- Human placement 로그를 provenance와 checksum이 있는 dataset으로 변환
- gameId 단위 train/validation 경계 설정
- 원본 로그 불변성 보장

완료 내용:

- placement dataset exporter
- schema v2
- all-completed와 Human source 정책
- manifest, train, validation, rejected 계약
- 16-feature allowlist

핵심 결론:

> 모든 모델 실험은 live log가 아니라 immutable snapshot에서 시작한다.

남긴 gate:

- snapshot checksum과 manifest 정책이 다르면 모델 실험을 시작하지 않는다.

---

### Phase 1 — JavaScript와 Python 단일-fold parity

상태: **완료, 역사적 기술 검증으로 동결**

목적:

- Python이 기존 JavaScript의 feature, scaler, pair, weight, rank 의미를 정확히 이해했는지 검증

결과:

- JS-equivalent 수치가 허용오차 1e-12 이내
- candidate rank와 metric 일치
- sklearn 차이는 데이터 계약이 아니라 optimizer 종료점 차이

핵심 결론:

> Python 실험 스택을 사용할 수 있으며 새 실험을 JavaScript에 재구현할 필요가 없다.

남긴 gate:

- JavaScript parity는 매 실험마다 반복하지 않고 최종 production inference 이식 시 다시 사용한다.

---

### Phase 2 — JS feature table과 Python 13-fold 평가

상태: **과도기 완료, 현재 경로에서는 폐기**

목적:

- 전체 LOGO 평가가 가능한지 빠르게 확인

결과:

- 13-fold sklearn 평가 경로 검증
- JS feature-table exporter가 불필요한 중간 계층이라는 점 확인

핵심 결론:

> 과도기 파일을 복원하지 않고 Python이 dataset JSONL을 직접 읽는 구조로 전환한다.

남긴 gate:

- 새 실험에서 JS feature table을 다시 만들지 않는다.

---

### Phase 3 — Python-native 13게임 LOGO baseline

상태: **완료, continue_experimenting**

데이터:

- game: 13
- decision: 554
- candidate: 18,950

주요 결과:

- Top-1: 0.463899
- MRR: 0.636154
- 13 / 13 fold 수렴

핵심 위험:

- game 수가 작음
- fold 편차가 큼
- selected-feature duplicate decision 327

핵심 결론:

> 파이프라인은 동작하지만 일반화나 모델 동결을 주장할 수 없다.

남긴 gate:

- 데이터를 확대하고 같은 계약으로 다시 평가한다.

---

### Phase 4 — 26게임 immutable snapshot과 LOGO

상태: **완료, continue_experimenting**

데이터:

- game: 26
- decision: 1,158
- candidate: 39,375
- pair: 38,217

주요 결과:

- Top-1: 0.484456
- MRR: 0.645290
- 26 / 26 fold 수렴

핵심 위험:

- 기존 13게임을 포함하므로 독립 성능 향상 증거가 아님
- selected-feature duplicate decision 670
- zero-difference pair 1,010
- winner game 3개

핵심 결론:

> 데이터 확대 후에도 표현 중복이 남아 있으므로 새 feature보다 중복 원인을 먼저 조사한다.

남긴 gate:

- zero-difference와 tie의 물리적 의미를 확인한다.

---

### Phase 5 — Geometry collision 분석

상태: **geometry_does_not_resolve_collision**

질문:

- 1,010 zero-difference pair가 geometry feature 부족 때문에 생겼는가

결과:

- 1,010 pair 모두 occupied-cell 집합이 동일
- rotation은 표현 ID만 구분
- 추가 geometry feature는 실제 물리 placement를 구분하지 못함

핵심 결론:

> 문제는 feature 부족이 아니라 같은 물리 placement의 rotation/pivot alias다.

남긴 gate:

- 동일 occupied-cell candidate를 physical equivalence class로 정의한다.

---

### Phase 6 — Occupied-cell pair canonicalization

상태: **pair_canonicalization_valid_but_metric_tradeoff**

변화:

| 항목 | Raw | Cell grouped |
|---|---:|---:|
| Candidate 또는 class | 39,375 | 26,403 |
| Pair | 38,217 | 25,245 |
| Zero-difference pair | 1,010 | 0 |

결과:

- physical-class Micro MRR: 0.727805 → 0.726652
- Micro delta: -0.0011527812
- canonicalization 계약은 유효
- row grouping과 pair weight 변화가 동시에 일어남

핵심 결론:

> Metric 하락만 보고 raw representation이 더 좋다고 결론 낼 수 없다.

남긴 gate:

- alias 제거와 pair-weight 변화의 효과를 분해한다.

---

### Phase 7 — 확대된 live log 준비 상태 감사

상태: **감사 완료, canonical snapshot과 모델 평가는 미수행**

감사 시점:

- game lifecycle: 46게임 상당
- Human decision: 1,972
- candidate: 66,721
- 시험 export 두 번 byte-identical

핵심 결론:

> 추가 로그는 다음 snapshot을 만들 수 있는 상태지만, 움직이는 live log를 canonical dataset으로 취급하면 안 된다.

남긴 gate:

- 게임과 서버를 멈춘 안정 시점에 새 이름으로 snapshot을 생성한다.
- 기존 26게임 snapshot을 덮어쓰지 않는다.

---

### Phase 8 — Pair-weight controlled decomposition

상태: **pair_weight_tradeoff_explained**

프로그램 gate: **continue_experimenting**

비교:

- V0: raw baseline
- V1: zero pair 제거, 기존 weight 유지
- V2: informative pair에 weight 재분배
- V3: physical class별 weight 균등화, raw row 유지
- V4: physical class 대표 row 하나만 유지

Primary physical-class 결과:

| Variant | Top-1 | Micro MRR |
|---|---:|---:|
| V0 | 659 | 0.727805 |
| V1 | 659 | 0.727805 |
| V2 | 658 | 0.727084 |
| V3 | 657 | 0.726652 |
| V4 | 657 | 0.726652 |

Attribution:

- V1−V0 zero sample 제거: 변화 0
- V2−V1 informative-mass 재정규화: Micro MRR -0.0007210023
- V3−V2 generator multiplicity 제거: Micro MRR -0.0004317789
- V4−V3 row compression: 변화 0

핵심 결론:

- 전체 하락의 약 62.5%는 informative-mass 재정규화
- 약 37.5%는 generator multiplicity 제거
- row compression 자체의 rank와 metric 변화는 0
- V3와 V4가 같은 결과이므로 V4가 더 작은 표현
- 이 비율은 고정 순서의 controlled decomposition이며 Shapley attribution이 아님

남긴 gate:

> V4를 확장 실험의 canonical candidate로 사용하되, 더 큰 snapshot과 시간 순서 holdout에서 검증한 뒤 weighting policy를 동결한다.

---

## 6. 완료 단계에서 확정한 결정

### 확정

- Python Notebook이 새 ML 실험의 단일 진실 원천이다.
- Dataset ingestion과 reachable candidate 생성은 기존 JavaScript 게임 규칙 경계를 유지한다.
- Feature는 명시적인 allowlist로 관리한다.
- LOGO는 gameId 단위로 수행한다.
- Scaler는 각 fold의 train candidate에만 fit한다.
- Human 선택 여부와 outcome 정보는 feature에 넣지 않는다.
- Physical-class metric을 representation 진단의 primary metric으로 사용한다.
- 동일 occupied-cell alias는 서로 다른 물리 placement가 아니다.
- Row compression은 정보 손실 원인이 아니다.
- GPU 전환은 현재 16-feature 선형 모델의 우선 과제가 아니다.
- V4 125-game candidate artifact, reference inference와 game-over safety 계약은 완료됐다.
- dev-only PVE integration은 검증됐지만 production 기본 정책을 바꾸지 않는다.
- gameplay evaluation은 `imitation_only_not_gameplay_ready`로 종료했고 production 결정은 `keep_heuristic_default`다.

### 아직 확정하지 않음

- V4 weighting의 최종 production 채택
- 현재 16-feature의 최종 충분성
- 최종 estimator와 hyperparameter
- final full-data model
- heuristic보다 gameplay가 강한지
- production runtime 연결

### 현재 보류 또는 종료

- V4를 gameplay replacement로 승격하는 일
- 100-stream gameplay 확장, hybrid policy, 추가 재학습
- production/PVE 기본 정책 변경

---

## 7. 역사적 roadmap (현재 실행 계획 아님)

이후 Stage 1~10은 Phase 8 시점에 작성된 historical planning record다.
Stage 7의 trainer, Stage 8의 reference inference, Stage 9의 dev-only PVE와
gameplay evaluation은 완료됐다. 최신 상태와 제한은 이 문서의 앞부분,
[ai-experiments-log.md](ai-experiments-log.md), 그리고 [gameplay analyze-result record](../ai-harness/runs/placement-v4-pve-gameplay-benchmark-analyze-result-2026-07-20.md)를 우선한다.

앞으로의 계획은 **10개 milestone**과 이를 실제 프롬프트 크기로 나눈 **20개 작업 단위**로 관리한다.

- Milestone은 의미 있는 연구·통합 checkpoint다.
- 작업 단위는 에이전트에게 한 번에 맡길 수 있는 한 목적의 일이다.
- Feature 가설이 하나 추가될 때마다 실험과 untouched 확인 작업이 반복될 수 있다.
- Migration 대기와 main merge는 Python 연구를 막지 않는다. 단, Node/runtime 단계는 migration 선행조건을 기다린다.

~~~text
현재 Phase 8 마감
  ├─ AI milestone merge 준비 ── migration merge window에서 main 동기화·병합
  │
  └─ Python 연구 계속
       목표·weight 계약
       → 실행 경로 preflight
       → 새 immutable snapshot
       → temporal holdout
       → expanded LOGO와 weighting freeze
       → failure analysis
       → feature 실험 N회와 untouched 확인
       → estimator gate
       → final offline promotion
       → Python trainer·artifact·reference inference

migration Goal 8 main 반영 + PVP/PVE E2E green
       ↓
Node scorer parity
       ↓
authoritative gameplay arena
       ↓
production-candidate dossier
       ↓
별도 사용자 승인 후에만 기본 PVE 활성화 검토
~~~

따라서 현재 예상 작업량은 다음과 같다.

~~~text
핵심 작업 단위 = 20
추가 작업 단위 = feature 가설 반복 N × 최대 2
기본 production 활성화 = 위 계획 밖의 별도 승인 작업
~~~

---

## 8. 한 프롬프트의 작업 단위

지난 pair-weight 프롬프트는 다음 여섯 작업을 한 번에 포함했다.

1. 기존 baseline 감사
2. 실험 설계와 Notebook 구현
3. 사전 probe
4. 여러 차례 full 실행
5. 결과 문서와 canonical report
6. 전체 검증

이 때문에 50분 이상 걸렸다.

앞으로 한 프롬프트는 다음을 넘지 않는다.

- 핵심 질문 하나
- 변경 이유 하나
- 비싼 full 실행 한 종류
- canonical 산출물 한 묶음
- 완료 gate 하나

각 프롬프트는 다음 형식을 사용한다.

~~~text
목표
→ 고정 입력
→ 이번에 하나만 바꿀 변수
→ 산출물
→ smoke 검증
→ 필요한 경우 full 실행
→ 실패 시 중단 조건
→ 다음 gate
~~~

### 기술 단계와 commit 프롬프트 수

이 문서의 10개 milestone을 그대로 한 프롬프트씩 실행하지 않는다. 아래 20개 작업 단위가 기본 프롬프트 경계다.

- 구현과 검증을 한 작업 단위로 묶되 서로 다른 연구 질문은 합치지 않는다.
- Commit은 기본 행동이 아니다. 프롬프트에 명시적으로 포함하거나 사용자가 결과 확인 후 별도로 승인한다.
- Migration 대기처럼 외부 상태만 확인하는 작업은 코드 변경 없이 끝날 수 있다.
- 가설 기각도 실패가 아니라 문서화할 수 있는 정상 종료다.

예상 대화 수:

~~~text
각 작업 단위에 commit 승인 포함: 약 20개
commit을 결과 확인 뒤 별도로 승인: 약 25~35개
feature 반복: 위 수치 + 가설당 최대 2개
~~~

---

## 9. 역사적 작업 분해 (현재 자동 실행 금지)

### 9.1 프롬프트 단위 작업 목록

| 작업 | 한 번에 맡길 목적 | 핵심 완료 gate |
|---:|---|---|
| 1 | Phase 8 stale 문서, 결과, 테스트를 확인하고 해당 파일만 commit | `.DS_Store`·dataset 제외, 결정성·검증 통과 |
| 2 | Phase 0~8 merge-readiness와 snapshot 복구 경로 감사 | 변경 범위, archive, migration 충돌 위험 설명 가능 |
| 3 | 진행 중 migration Goal의 main 반영 상태 확인 | 해당 Goal fast/full gate green; Python 연구와 병행 가능 |
| 4 | 승인된 merge window에서 AI branch를 최신 main에 동기화하고 milestone merge | 재검증 통과와 사용자 merge 승인 |
| 5 | Human imitation과 gameplay promotion 목표·metric 계약 | 최적화 목표와 production 승격 지표 분리 |
| 6 | Occupied-cell representation과 V4 weighting 정책 계약 | pairless decision, choice-required metric, 대표 action 규칙 명시 |
| 7 | 새 immutable snapshot 생성과 외부 archive | 두 export 동일, SHA·cohort 경계·복구 경로 확보 |
| 8 | 수학 계약을 바꾸지 않는 실행 경로 최적화와 smoke | 기존 fixture·score·rank 일치, smoke는 canonical 부적격 |
| 9 | 기존 26게임 train → 신규 cohort temporal holdout | 정책을 결과 전에 고정, leakage 0 |
| 10 | 확장 snapshot V0/V4 LOGO와 weighting freeze 판단 | 두 full run 동일, fold 안정성, 사용자 승인 |
| 11 | 고정 baseline failure analysis | missing-signal 가설 하나 또는 feature 충분성 결론 |
| 12 | Feature 가설 하나만 실험 | 다른 계약 고정, 채택·기각 근거 기록 |
| 13 | 채택 feature를 untouched cohort에서 한 번 확인 | 사전 threshold 통과; 같은 holdout 재튜닝 금지 |
| 14 | Estimator 하나 비교 또는 Logistic Regression 유지 결정 | 비선형 근거 없으면 `skip_with_evidence` |
| 15 | 잠근 계약으로 final offline promotion 평가 | 별도 promotion cohort를 한 번만 사용 |
| 16 | Full-data Python trainer와 versioned artifact 생성 | 두 artifact byte-identical, runtime 변경 없음 |
| 17 | Python reference inference와 artifact validation | score/rank fixture, schema·finite·오류 입력 검증 |
| 18 | 최종 frozen scorer만 Node에 한 번 이식 | migration Goal 8 이후 Python↔Node parity |
| 19 | Authoritative matched-seed gameplay arena | ML 대 heuristic gameplay·latency·failure gate |
| 20 | Production-candidate dossier 작성 | model card, fallback, rollback, 모든 근거 완비 |

작업 3과 4는 Git·migration lane이다. 작업 5~17의 Python 연구는 AI worktree에서 이를 기다리지 않고 진행할 수 있다. 반대로 작업 18 이후는 migration Goal 8과 gameplay E2E가 main에 반영되기 전에는 시작하지 않는다.

아래 Stage 1~10은 이 20개 작업을 의미 있는 milestone으로 묶어 설명한다.

### Stage 1 — Phase 8 검토와 commit

작업 유형: Git checkpoint

목적:

- Pair-weight decomposition을 다음 실험과 분리된 하나의 이유로 고정

입력:

- Phase 8 Notebook
- 계약 테스트
- 설명 문서
- canonical result
- ai-experiments-log.md Phase 8

먼저 바로잡을 문서 상태:

- ai-experiments-log.md의 오래된 HEAD·worktree 설명
- Phase 8 이전 질문을 가리키는 `다음 실험 gate`
- canonical snapshot과 영구 archive를 혼동할 수 있는 표현

확인:

- Run1, Run2, canonical result SHA가 같음
- 새 Notebook 계약 테스트 12 / 12
- verify:ml 통과
- 전체 verify 통과
- .DS_Store 제외
- Dataset snapshot 제외

완료 조건:

- Phase 8 파일만 stage
- 의미가 분명한 commit 하나
- commit 후 남은 변경을 보고

그다음 별도 merge-readiness 감사에서 4cf8585와 Phase 8 전체 범위, snapshot 복구 경로, 최신 main과의 충돌 가능성을 확인한다. 이 감사 통과는 자동 main merge를 뜻하지 않는다.

중단 조건:

- 예상하지 않은 파일이 stage됨
- report와 canonical result가 다름
- baseline 또는 leakage gate가 깨짐

---

### Stage 2 — 목표·representation·weight 계약과 새 immutable snapshot

작업 유형: 연구 계약과 데이터 provenance

목적:

- Human 선택 모방과 gameplay promotion 목표를 분리
- 다음 평가 전에 representation과 weighting의 의미를 고정
- 추가된 게임을 새 canonical dataset으로 고정

먼저 문서로 고정할 계약:

- Offline 학습 목표는 Human placement imitation이다.
- Production 승격 목표는 heuristic 대비 gameplay 성능과 안전성이다.
- 동일 occupied-cell candidate는 하나의 physical choice로 본다.
- V4 cell-grouped weighting을 다음 검증의 기본 후보로 사용하되 자동 동결하지 않는다.
- 물리적 선택지가 하나뿐인 decision은 학습 pair에서 제외한다.
- 평가에는 전체 decision과 `choice-required` decision을 구분한다.
- 동일 class에서 runtime action을 고르는 대표 규칙은 결정적이어야 한다.
- Generator alias 개수는 학습 weight를 늘리지 않는다.

입력:

- main worktree의 live data/logs/game-events.jsonl

절차:

1. 게임과 서버를 멈춘다.
2. lifecycle과 JSON parse를 확인한다.
3. source SHA와 line 수를 기록한다.
4. 새 NNg-YYYYMMDD 경로를 정한다.
5. all-completed, Human source 정책으로 export한다.
6. manifest 정책을 검사한다.
7. train/validation gameId leakage를 검사한다.
8. 네 output SHA를 기록한다.
9. /private/tmp에 같은 export를 한 번 더 만들어 byte 비교한다.
10. snapshot을 영구 보관 위치에 복사한다.

이 단계에서는 모델을 학습하지 않는다.

완료 조건:

- Source log 실행 전후 불변
- JSON parse failure 0
- lifecycle 이상 없음
- leakage 0
- 두 export byte-identical
- 새 snapshot 경로와 checksum 문서화

중단 조건:

- live log가 export 중 변경됨
- 기존 snapshot 경로가 재사용됨
- manifest 정책이 26게임 실험과 다름
- selected placement 또는 schema rejection이 설명되지 않음

---

### Stage 3 — 계산 경로 최적화와 smoke benchmark

작업 유형: 실험 성능 개선

목적:

- 수학 계약을 바꾸지 않고 반복적인 Pandas pair 생성을 제거
- 전체 실행 전에 실패를 빠르게 발견

고정:

- 16-feature
- V0와 V4 정의
- scaler
- LogisticRegression
- C
- metric과 tie-break

개선 대상:

- decision group을 fold마다 한 번만 구성
- feature difference를 fold마다 한 번만 계산
- V0/V4는 같은 base pair table에서 weight만 변경
- 반복적인 전체 DataFrame 검색과 iterrows 최소화
- stage timing은 canonical report가 아닌 실행 로그에만 기록

Smoke 규칙:

- 정렬된 gameId의 처음 1~2 fold
- full과 같은 함수와 변환 경로
- runMode: smoke
- canonicalEligible: false
- smoke metric으로 모델 성능 결론 금지

완료 조건:

- 기존 구현과 fixture 결과 일치
- 2-fold smoke 통과
- baseline coefficient, score, rank 허용오차 통과
- full run은 실행하지 않음
- 성능 개선 전후 측정

중단 조건:

- 최적화가 pair identity나 weight를 바꿈
- smoke 전용 계산 코드가 full 경로와 달라짐
- 결정적 정렬이 깨짐

---

### Stage 4 — 신규 게임 temporal holdout

작업 유형: 앞으로의 데이터에 대한 검증

목적:

- 기존 26게임으로 학습한 V0와 V4가 이후 추가된 게임에서 어떤 차이를 보이는지 확인

설계:

~~~text
Train:
  기존 26게임 snapshot

Validation:
  새 snapshot에만 추가된 gameId

Compare:
  V0 raw weighting
  V4 cell-grouped weighting
~~~

주의:

- 같은 사용자의 이후 게임이므로 다른 사용자 일반화 증거는 아니다.
- 정책은 실험 전에 V0와 V4로 고정한다.
- 결과를 본 뒤 tolerance나 weighting을 조정하지 않는다.
- 새 gameId를 scaler와 model fit에 넣지 않는다.

주요 metric:

- Physical-class Top-1, Top-3, MRR, mean rank
- Raw-candidate metric
- difficulty segment
- game별 분포
- worst new game
- duplicate와 pairless decision

완료 조건:

- temporal train/validation leakage 0
- source snapshot checksum 불변
- 두 정책 모두 수렴
- 결과와 실패 사례 문서화

중단 조건:

- 기존 26게임과 신규 gameId를 구분할 수 없음
- new-game validation이 scaler 또는 pair fit에 섞임
- 새 snapshot이 기존 26게임을 완전하게 포함하지 않음

---

### Stage 5 — 확장 snapshot V0/V4 LOGO와 weighting freeze

작업 유형: 확대 안정성 검증

목적:

- 전체 확장 snapshot에서 V4 정책의 fold 안정성을 확인
- weighting policy 동결 여부 결정

실행:

- V0와 V4만 학습
- V1~V3 attribution을 매번 다시 학습하지 않음
- 1~2 fold smoke
- Full run1
- Run1 invariant 확인
- Full run2
- report byte 비교

평가:

- Micro, macro, median, range
- worst fold
- fold 개선/동일/하락
- physical-class primary metric
- coefficient와 rank 변화
- convergence
- leakage
- pair와 weight 진단

Weighting freeze 조건:

- V4의 물리적 의미가 유지됨
- Expanded LOGO와 temporal holdout에서 치명적인 불안정이 없음
- V0의 이점이 alias multiplicity에 의존한다는 해석이 유지됨
- pairless decision 처리가 설명 가능
- run1/run2 결정성 통과
- 사용자가 weighting policy 동결 승인

가능한 상태:

- weighting_policy_ready_to_freeze
- weighting_policy_requires_more_data
- weighting_policy_blocked_by_instability
- blocked_by_baseline_mismatch

이 단계가 성공해도 전체 모델이 ready_to_freeze인 것은 아니다.

---

### Stage 6 — 실패 사례와 feature 충분성 gate

작업 유형: 모델 표현력 판단

목적:

- 현재 16-feature로 최종 모델을 만들 수 있는지 결정

분석:

- worst fold와 worst new game
- Human 선택이 낮은 순위인 decision
- physical-class tie
- selected-feature duplicate
- normal/hard 차이
- 높이·hole·bumpiness 분포 밖 사례
- current feature로 구분 불가능한 선택

질문:

1. 실패가 데이터 부족인가
2. feature가 상태 정보를 잃는가
3. label이 일관되지 않은가
4. Human 선택 자체가 noisy한가
5. gameplay 목표와 imitation 목표가 어긋나는가

완료 상태:

- feature_set_sufficient_for_baseline
- feature_hypothesis_required
- more_data_required

feature가 충분하면 Stage 7로 간다.

feature가 부족하면 다음 optional loop를 수행한다.

---

### Optional Loop — Feature 가설 실험

작업 유형: 가설당 한 프롬프트

원칙:

- 한 Notebook에 feature 가설 하나
- 기존 dataset에 존재하는 leakage 없는 원시값만 사용
- feature 외 계약 고정
- 기존 baseline과 같은 split에서 비교
- 새 feature가 왜 decision을 구분하는지 worked example 제공
- 채택 또는 기각을 명시

새 feature가 dataset에 없는 counterfactual 게임 규칙을 요구하면 Python에서 게임 엔진을 임의 재구현하지 않는다.

필요한 원시 정보를 JavaScript dataset schema에 추가하는 별도 작업으로 분리한다.

Loop 종료 조건:

- feature가 여러 snapshot에서 안정적인 개선을 보임
- 실패 사례를 줄이는 이유가 설명됨
- leakage와 미래 정보 의존 없음
- 추가 가설의 기대 가치가 낮음
- 사용자가 feature set 동결 승인

채택 후보는 같은 development fold의 개선만으로 동결하지 않는다. 튜닝에 사용하지 않은 cohort에서 사전에 적은 threshold로 한 번 확인한다.

- 확인에 실패하면 feature를 기각하거나 다시 가설 단계로 돌아간다.
- 확인 결과를 본 뒤 같은 holdout에 맞춰 feature나 threshold를 조정하지 않는다.
- 조정이 필요하면 그 cohort는 더 이상 untouched가 아니므로 다음 확인에는 새 cohort가 필요하다.

---

### Stage 7 — Estimator gate, final promotion, Python trainer와 artifact

작업 유형: 실험에서 동결된 구현으로 전환

Trainer 작성 전에 두 작업을 별도로 닫는다.

1. 선형 모델의 잔차나 비선형 상호작용 근거가 있을 때만 estimator 하나를 비교한다.
2. 근거가 없으면 Logistic Regression을 `skip_with_evidence`로 유지한다.
3. 모든 계약을 잠근 뒤 개발에 사용하지 않은 promotion cohort에서 final offline 평가를 한 번 수행한다.
4. Promotion 결과에 맞춰 다시 튜닝하지 않는다. 실패 후 변경하려면 새 promotion cohort가 필요하다.

선행 조건:

- representation 동결
- feature 순서와 schema version 동결
- pair weighting 동결
- scaler와 estimator 동결
- hyperparameter 동결
- metric과 tie-break 동결
- 여러 snapshot 또는 temporal holdout 검증
- 사용자 ready_to_freeze 승인

구현:

- 동결된 전체 dataset으로 학습하는 Python 파일
- model artifact export
- feature names와 순서
- scaler mean과 scale
- coefficient
- estimator config
- source snapshot checksum
- environment version
- model schema version

Artifact를 만든 뒤 Python reference inference를 별도 작업으로 검증한다.

- 고정 fixture의 candidate score와 rank
- feature 순서와 schema version
- NaN·Infinity·누락·잘못된 artifact 거부
- 동일 입력의 결정적 출력

중요:

~~~text
Notebook
  = 질문, 가설, worked example, 실험 근거

Final trainer .py
  = 동결된 계약을 반복 실행하는 도구
~~~

Trainer는 Notebook 로직을 새로 설계하지 않고 동결된 로직을 추출한다.

완료 조건:

- 두 번 학습한 artifact byte-identical
- dataset 불변
- malformed input에서 완성 artifact를 남기지 않음
- Notebook fixture와 feature, pair, weight 계약 일치
- productionIntegration: false 유지

---

### Stage 8 — JavaScript offline inference와 parity

작업 유형: 동결 모델 이식

목적:

- Python에서 확정한 모델을 JavaScript 점수 계산으로 한 번만 이식

시작 gate:

- Migration Goal 7의 multiplayer/PVE React lifecycle이 main에 반영됨
- Migration Goal 8의 `runtime/render/net/AI` TypeScript checkpoint가 main에 반영됨
- Goal 8 이후 PVP/PVE E2E와 fast/full gate가 green

이 gate 전에는 Python trainer와 artifact 연구까지만 진행한다. 먼저 JavaScript scorer를 만들면 migration에서 같은 통합 경계를 다시 이식해야 한다.

범위:

- model artifact loader
- 고정 feature 순서 검증
- scaler 적용
- linear score 계산
- canonical tie-break
- malformed artifact 거부

아직 하지 않음:

- PVE runtime 연결
- production model 교체
- 게임 루프 변경

Parity gate:

- Python과 JavaScript candidate score 허용오차 통과
- rank 일치
- metric 일치
- tie-break 일치
- model artifact checksum 일치
- source dataset 변경 없음

Parity가 실패하면 Stage 9로 가지 않는다.

---

### Stage 9 — Heuristic 대비 gameplay benchmark

작업 유형: 실제 게임 목표 평가

목적:

- Human 선택 모방 모델이 실제 gameplay에서 사용할 가치가 있는지 확인

비교:

- 기존 heuristic AI
- 동결된 ML ranker
- 필요하면 heuristic fallback 또는 hybrid

측정 후보:

- game over까지 placement 수
- 생존 시간
- lines cleared
- attack lines
- holes와 max height
- 승률
- invalid placement
- inference failure와 fallback count

실행 조건:

- 같은 seed 또는 같은 bag 조건
- 충분한 반복 수
- 난이도별 분리
- model이 게임 규칙을 직접 변경하지 않음
- 실패 시 heuristic fallback

완료 상태:

- gameplay_candidate_supported
- imitation_only_not_gameplay_ready
- gameplay_regression_detected

Offline imitation metric이 높아도 gameplay benchmark가 실패하면 PVE에 연결하지 않는다.

---

### Stage 10 — Production-candidate dossier와 별도 활성화 판단

작업 유형: 승격 근거 정리와 승인 gate

AI branch에서 기본 PVE 활성화를 바로 진행하지 않는다.

Node scorer와 arena를 위한 통합 branch/worktree는 최신 main과 migration 상태가 안정된 시점에 생성한다.

필수 외부 선행 조건:

- main의 server authoritative flow 안정화
- own board rollback 재현과 해결
- 두 브라우저 회귀 통과
- garbage, gameOver, reconnect 회귀 없음
- migration merge 상태 확인

Candidate dossier에 포함할 근거:

- frozen objective, representation, feature, weighting, estimator 계약
- snapshot provenance와 promotion cohort 사용 이력
- offline metric과 known limitation
- Python artifact와 Node parity
- gameplay arena와 latency/failure 결과
- model card
- feature flag, heuristic fallback, rollback 절차

통합 원칙:

- AI는 DOM, Canvas 또는 UI 상태를 읽지 않음
- serialized/authoritative game state만 읽음
- placement generator는 기존 게임 규칙 사용
- ML은 candidate score만 담당
- 실패 시 heuristic fallback
- Human-vs-Human 경로와 분리
- 제한된 PVE 모드부터 적용

Production 승인 조건:

- inference parity 통과
- gameplay benchmark 통과
- invalid placement 0
- timeout과 malformed artifact fallback 검증
- PVE E2E와 전체 회귀 통과
- rollback 또는 multiplayer 안정성에 영향 없음
- 사용자 명시 승인

이 Stage의 성공 상태는 `production_candidate`다. 기본 PVE 활성화와 실제 배포는 이 계획 밖의 별도 사용자 승인 작업이며, 가능하면 migration Goal 10 storage cutover와 Goal 11 hardening/CI 이후에 수행한다.

---

## 10. Main·migration과 병렬 작업 경계

AI 실험 worktree와 migration worktree는 계속 분리한다.

| 작업 | 위치 |
|---|---|
| Dataset·Notebook·Python 평가 | Tetris_multi-ai |
| Vite/React/TypeScript migration | migration 전용 worktree |
| 게임 실행과 통합 기준 | main |
| 최종 model inference/PVE 통합 | 최신 main에서 새 integration worktree |

병행 기준:

- Python 실험, freeze 판단, trainer와 neutral artifact는 migration과 병행할 수 있다.
- AI milestone의 main merge는 진행 중 migration Goal이 main에 반영되고 검증된 merge window에서만 한다.
- Node scorer와 authoritative arena는 migration Goal 8이 main에 반영된 뒤 시작한다.
- Live telemetry canary가 필요하면 가능하면 Goal 10 DB/JSONL cutover 이후로 미룬다.
- 기본 production 활성화와 배포는 Goal 11 hardening/CI 및 별도 승인을 기다린다.

주의:

- 브랜치만 나누고 같은 working tree에서 전환하지 않는다.
- AI 실험 중 migration 파일을 수정하지 않는다.
- Goal 7/8이 바꿀 multiplayer/PVE lifecycle과 runtime/AI 경계에 scorer를 먼저 붙이지 않는다.
- AI branch의 실험 이력을 runtime 통합 commit과 섞지 않는다.
- 충돌이 생기면 실험 결과를 재생성하기보다 Git 계보와 파일 책임을 먼저 정리한다.

---

## 11. Commit과 merge 계획

### Commit 원칙

한 commit은 하나의 이유를 가진다.

권장 checkpoint:

1. Phase 8 pair-weight decomposition
2. Phase 0~8 merge-readiness와 문서 정합성
3. 목표·representation·weight 계약
4. 확장 snapshot과 검증용 계산 최적화
5. Temporal holdout과 expanded LOGO 결과
6. Weighting·feature freeze 결정
7. Final promotion, Python trainer와 artifact
8. Node offline inference parity
9. Gameplay arena
10. Production-candidate dossier

Snapshot data 자체는 Git에 commit하지 않는다. 대신 manifest 정보와 checksum을 문서에 기록한다.

### Merge 원칙

- 실험이 끝날 때마다 main에 자동 merge하지 않는다.
- AI experiment branch는 weighting과 feature freeze까지 일관된 이력을 유지할 수 있다.
- 권장 main merge milestone은 Phase 0~8 기반, representation·weight·feature freeze, Python artifact, Node parity, gameplay candidate의 다섯 구간이다.
- 각 merge 전에 최신 main 동기화와 관련 fast/full gate를 다시 실행한다.
- 진행 중 migration Goal의 main 반영 전에는 AI milestone merge를 보류하되 Python-only 연구는 계속할 수 있다.
- JavaScript runtime과 PVE 변경은 최신 main에서 새 integration branch로 수행한다.
- Migration과 충돌 가능성이 있는 production 파일은 migration merge 상태를 확인한 뒤 수정한다.
- push, PR, merge, branch 삭제는 사용자 승인 없이 수행하지 않는다.

---

## 12. 실행시간과 결정성 관리

### 12.1 실행 순서

새로 실행시간이 긴 Notebook은 다음 순서를 지킨다.

~~~text
정적 계약 테스트
→ 결정적 1~2 fold smoke
→ full run1
→ run1 checksum·leakage·convergence 확인
→ full run2
→ run1/run2 byte 비교
→ canonical result 승격
~~~

Run1 검증 전에 Run2를 시작하지 않는다.

### 12.2 Full run을 다시 해야 하는 변경

- 학습 또는 평가 코드
- feature 순서
- pair construction
- weighting
- scaler 또는 estimator
- snapshot
- 정렬 또는 tie-break
- report 수치 내용

### 12.3 Full run이 필요 없는 변경

- 설명 문장 오타
- Markdown 구조
- 링크 수정
- 결과에 영향을 주지 않는 문서 정리

문서만 바꾼 뒤 이미 통과한 full 학습을 다시 실행하지 않는다.

### 12.4 성능 원칙

- GPU 이식보다 반복 pair 계산 제거를 먼저 한다.
- 16-feature Logistic Regression은 CPU 기준을 유지한다.
- Fold 병렬화가 필요하면 worker별 BLAS thread를 제한해 oversubscription을 막는다.
- 병렬화 전후 report 결정성을 검증한다.
- 실행시간은 비결정적이므로 canonical JSON에 넣지 않는다.

---

## 13. 재현성과 파일 위치

### Repository에 둔다

- source Notebook
- Notebook 계약 테스트
- 사람이 읽는 실험 문서
- 검증된 canonical result
- environment-ml.yml
- final trainer와 model schema

### /private/tmp에 둔다

- smoke/full executed Notebook
- run1/run2 report
- exporter recheck
- traceback과 임시 실행 로그
- Jupyter runtime/config 우회 파일

### /private/tmp에 두면 안 된다

- source Notebook
- source Python code
- immutable snapshot의 유일한 사본
- canonical result의 유일한 사본
- 최종 model artifact

완료 기준:

> /private/tmp를 모두 삭제해도 source Notebook, 환경, snapshot 보관본과 문서만으로 같은 결과를 다시 만들 수 있어야 한다.

---

## 14. 동결 gate

### 14.1 Weighting freeze

- V4의 물리적 의미가 명확함
- pairless decision과 `choice-required` metric 계약이 명확함
- generator alias 수가 model weight에 영향을 주지 않음
- Temporal holdout과 expanded LOGO 안정성
- pairless decision 정책 설명 가능
- 두 full report 결정성
- 사용자 승인

### 14.2 Feature freeze

- 현재 feature로 실패 사례를 설명 가능
- 추가 feature 가설의 기대 가치가 낮음
- leakage 없는 feature만 사용
- 여러 snapshot에서 결과 안정
- 채택 feature가 untouched cohort에서 사전 threshold 통과
- 사용자 승인

### 14.3 Model freeze

- representation, feature, weight, scaler, estimator, C 동결
- deterministic final trainer
- model artifact schema와 checksum
- malformed input 실패 안전성
- 별도 promotion cohort의 one-shot 평가 통과
- 사용자 승인

### 14.4 Production gate

- Python↔JavaScript parity
- gameplay benchmark
- heuristic fallback
- authoritative multiplayer prerequisite
- migration Goal 8 main 반영과 PVP/PVE E2E green
- PVE 회귀 테스트
- 사용자 승인

하위 gate 통과가 상위 gate 통과를 자동으로 의미하지 않는다.

~~~text
Weighting freeze
≠ Feature freeze
≠ Model freeze
≠ Production approval
~~~

---

## 15. 중단 조건

다음 중 하나라도 발생하면 완료라고 보고하지 않고 현재 단계에서 멈춘다.

- Source checksum 불일치
- Dataset schema 또는 manifest 불일치
- Snapshot 영구 archive 또는 checksum 복구 경로 없음
- gameId leakage
- validation data가 scaler나 fit에 들어감
- baseline 재현 실패
- convergence failure
- run1/run2 비결정성
- canonical report 불일치
- 설명할 수 없는 metric 개선
- Untouched 또는 promotion cohort를 결과 확인 후 다시 튜닝에 사용함
- gameplay regression
- JavaScript parity 실패
- main 또는 migration의 예상하지 않은 파일 변경
- migration Goal 8 이전 runtime scorer 통합
- production fallback 부재

어려운 결과나 낮은 metric은 자동 중단 조건이 아니다. 계약 위반과 근거 없는 결론이 중단 조건이다.

---

## 16. 모델과 추론 수준 권장

현재 Codex 세션에서 선택 가능한 모델 기준:

| 작업 | 권장 모델 | 추론 수준 |
|---|---|---|
| Git checkpoint, snapshot export, 문서 정리 | GPT-5.6 Terra | medium 또는 high |
| Notebook 구현과 일반 ML 실험 | GPT-5.6 Sol | high |
| Leakage, temporal split, freeze 판단 | GPT-5.6 Sol | xhigh |
| Python↔JavaScript parity와 production 검토 | GPT-5.6 Sol | xhigh 또는 max |

모델을 높이는 것보다 프롬프트 범위를 한 단계로 제한하는 것이 실행시간과 품질에 더 큰 영향을 준다.

---

## 17. 이 계획의 갱신 규칙

각 단계가 끝나면 다음만 갱신한다.

1. 현재 checkpoint
2. 해당 Stage 상태
3. 새로 통과하거나 실패한 gate
4. 다음 바로 한 단계
5. 예상 단계 수에 영향을 주는 optional loop

상세 metric과 명령은 ai-experiments-log.md에 기록하고 이 문서에 중복해서 계속 늘리지 않는다.

완료된 Phase의 결론은 새 근거 없이 다시 쓰지 않는다.

---

## 18. 현재 상태와 새 작업 gate

~~~text
현재 활성 실험은 없다.

V4는 Human placement imitation과 offline analysis에만 유지한다.
Gameplay replacement와 production/PVE 기본 정책은 heuristic으로 유지한다.
~~~

새 작업은 다음을 먼저 문서화한 별도 승인으로만 시작한다.

1. Human imitation인지 gameplay promotion인지 한 가지 목표
2. immutable input cohort 또는 game simulation 조건
3. 사전 고정된 metric, safety rule, production 영향 범위
4. 결과를 보관할 run record와 ignored evidence 경로

상세 historical metric과 실행 명령은 [ai-experiments-log.md](ai-experiments-log.md)와 각 run record를 사용한다.
