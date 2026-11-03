# ML Experiment: Human 배치·조작 연결 점검

## 상태·질문

- Experiment ID: `human-placement-action-link-readiness`
- Task: data audit, MODE: `implement-smoke`, Program gate: `continue_experimenting`
- Lifecycle: `implemented_sample_checked`. Notebook 구현·가상 smoke·승인된 작은 Train 표본 점검을 마쳤다. 전체 ML 작업 파일 gate는 기존 실행본 형식 실패로 미통과이며 아래 검증과 구분한다.
- 질문: **기존 Train의 지정 원본 3개에서 보드·선택 배치·조작 prefix를 기존 timing pair와 정확히 연결할 수 있는가?**
- 근거/세부 계약: [Human 배치·조작 연결 계약](../../../docs/ai-ml/contracts/human-placement-action-link.md).
- Baseline/changed variable/estimator/scaler/optimizer: 해당 없음. 모델 비교가 아니라 연결 검사다.

## 입력·고정 범위

- Source: `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`, SHA `eb64f86731ecb148ebf398773cb8e23cdf71217fc44f3bcb88460299bb092344`.
- Manifest: `data/datasets/human-timing-v1-20261024-full/manifest.json`, SHA `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88`.
- Train JSONL SHA: `c42c01d6fba0eb7128b77c0773a1669a9be620530a2fb99171dcca67ff3fb7c3`.
- Frozen readiness report SHA: `27f2a5dc3dae6143d22b0930987b3cd102e90d07ae1f228deadd0da41db41b4a`.
- Quality report SHA: `97388649259414fe2f5119e76ffa57922b3202f85c920540674f0fc494973ff4`.
- 실제 표본은 sourceLine `118015, 118021, 118023`뿐이다. 기존 Train의 Human 기록임을 원본을 파싱하기 전에 고정 index로 확인한다.
- 승인된 quality-policy-v1과 game split을 유지한다. 새 dataset·Validation/Test JSONL·다른 game payload를 모델에 제공하지 않는다.

## 확인하는 것과 확인하지 않는 것

- DB envelope/app 정규화·원본 identity·기존 readiness의 sourceLine→game/player/piece binding·quality Human 대응을 재사용한다. 전체 player index를 다시 검사하지 않으므로 mapping 근거는 `frozen_readiness_binding`으로 명시한다.
- 기존 `extract_pairs`로 재추출한 pair가 선택된 timing row와 일치하는지 확인한다. 새 parser를 만들지 않는다.
- 저장된 occupied cells의 자료형·셀 4개·중복·경계를 확인하고 physical class를 정의한다. Pivot 음수 좌표만으로 버리지 않는다. 조각 geometry/core와의 동등성은 미검증으로 남긴다.
- Placement의 board/anchor와 control의 관측 prefix를 분리하고 selectedPlacement·미래 action/time은 feature에 넣지 않는다.
- Reachability는 `not_checked`, action state는 `sequence_only`, 과거 build/관측 시점은 `unverified`로 보고한다. 현재 core로 legacy replay를 하지 않는다.
- Full cohort 처리·모델 학습·dataset 출판·Hold 확장·runtime/PVE는 범위 밖이다. Full 절에 미구현/별도 승인임을 표시하고 True로 바꿔도 전체 처리는 시작하지 않는다.

## 실행·출력

- Notebook: `scripts/ml/notebooks/human_placement_action_link_readiness.ipynb` 하나. 별도 `.py`/테스트·패키지 없음.
- 기본 모두 실행: 손계산 예제·내부 assert·가상 Smoke만. 실제 dataset/report open 없음.
- 작은 Train 표본은 별도 `RUN_TRAIN_SAMPLE=False`를 사용자가 켠다. 이번 사용자 요청으로 개발 중 지정 3개 점검은 승인됐다.
- `HUMAN_PLACEMENT_LINK_RAW`, `HUMAN_PLACEMENT_LINK_DATASET`은 저장소 상대 경로이며 고정 SHA가 일치하는 자료만 허용한다.
- `HUMAN_PLACEMENT_LINK_SAMPLE_REPORT`는 새 JSON 출력 경로다. 기존 파일·alias·symlink/hardlink를 거부하고 공통 독점 게시 함수를 사용한다.
- 결과는 pandas 표·Matplotlib의 검사 축 분포와 3개 보드/선택 셀 시각화다. 그림의 선택 셀은 label이며 입력 상태로 오해하지 않도록 표시한다.
- Report: `runMode=smoke`, `auditScope=synthetic` 또는 `train_sample`, `fullCohortCovered=false`, `policyDecisionEligible=false`, `canonicalResultEligible=false`, `modelFitCount=0`, Test/Validation open 0.
- 상태 `placement_action_link_readiness_complete`는 해당 표본의 감사 완료이며 학습 준비 완료·관측/규칙 검증 완료가 아니다. 미확인 축 coverage를 함께 본다.
- 원본 bytes는 checksum용으로 읽되 raw JSON 파싱은 지정 줄만 수행한다. Train timing JSONL은 lookup을 위해 순회하므로 visited rows와 실제 retained pair 수를 구분한다.

## Gate·검사

- 고정 source/report/manifest/Train SHA·game split·승인 게임/사람·sourceLine 결합 실패는 실제 점검을 중단한다. 입력 전후 SHA가 다르면 게시하지 않는다.
- 개별 malformed placement/입력·Hold·lineage 충돌은 격리 사유로 보고한다. 기존 timing pair를 바꾸거나 대체 label을 만들지 않는다.
- 내부 assert: normalization 충돌, player/split 불일치, 인접 index/action/time·gap reset, 미래 label 비유입, 물리 class alias·음수 pivot·잘못된 셀, 중복 identity, 경로 보호·원본 불변·기본 실제 입력 off.
- 작은 표본 검증 후 `npm run verify:ml`, `bash scripts/verify.sh`와 source output/ID·문서 검증을 수행한다. 기존 사용자 Notebook의 output/full 설정은 보존하며 그 gate 실패를 새 코드 실패와 구분한다.
- 다음 gate는 이 표본의 coverage 해석과 정합 범위 선택이다. 전체 raw 검사·replay·학습을 자동 진행하지 않는다.

## 허용·금지·rollback

허용: 새 Notebook·이 명세·연결 계약·계획/안내/PLAN/change-log의 필요한 상태/참조 갱신.
금지: 기존 Notebook/원본/report·dataset·core/runtime·DB·dependency 수정, Test/Validation JSONL open, 모델 fit·commit/push/merge 자동 실행.
Rollback은 새 Notebook/명세·참조 변경만 되돌린다. 원본·운영 데이터 삭제나 모델 교체는 없다.

## 실행 결과 — 2026-10-29

- [Notebook](../../../scripts/ml/notebooks/human_placement_action_link_readiness.ipynb) 21개 cell에 공통 정의·작은 예제·내부 검사·가상 Smoke·실제 Train 표본 설정/실행/결과·Full 범위 차단을 분리했다. 기본 실제 입력은 off이며 source output/count는 비었다.
- 가상 headless 2회: 각각 오류 0·그래프 2개, report byte-identical. SHA `5ed3bd95ff21415ee08d4f03c29a789d4c36acc0fbe355f5ca7e13cfea02ee59`.
- 실제 표본: sourceLine 118015/118021/118023, 1게임·3 segment·28 pair(5/22/1)·물리 class 3개, 격리 0이다. Raw JSON 파싱은 3개뿐이며 Train timing lookup에서 41,151행을 순회했다. 모델 fit 0·dataset 출판 0·Validation/Test open 0이다.
- 실제 Jupyter 실행은 메모리의 sample 설정만 켜고 source는 바꾸지 않았다. 오류 0·가상/실제 그래프 총 4개다. 실제 report는 ignored `data/ml-experiments/human-placement-action-link-readiness/train-sample-run2.json`, SHA `14a8c4c61271ffaf580e3ff55d46ccb6afa3b028e973817b50af30214b342962`다. Run1은 입력 형식 hardening 전 개발 점검본이며 현재 source 근거는 run2다.
- 검사 축: 구조 연결 3개 통과, player mapping 3개는 기존 frozen readiness binding 재사용이다. 관측 시점 unverified 3, reachability not_checked 3, geometry stored_cells_shape_only 3, actionState sequence_only 3이다. 상태 조건부 학습 준비 완료가 아니다.
- 내부 assert 여섯 묶음은 feature/label 분리·0ms·음수 pivot, alias/envelope/player/time 충돌, 미래 label·gap/Hold/중복, 잘못된 셀/입력 격리, 출력 보호를 확인했다. 기본 모두 실행을 실제 입력 open 금지 guard 아래서 확인했다.
- 필수 verify: Node 793 pass·기존 1 skip·0 fail. 현재 `verify:ml`: Node 35 pass, Python 213/220(기존 실행본 output/count/Full 설정의 5 fail·2 error)이다. 사용자의 기존 파일은 보존했다. Git HEAD 원본 Notebook의 격리 cwd Python 회귀는 220/220이며 새 Notebook을 자동 검사한 결과로 혼동하지 않는다.
- source/원본/report SHA 불변·새 source의 고유 ID·빈 output·문서 링크/fence/diff를 확인한다. 전체 cohort·core replay·학습·runtime·commit은 실행하지 않았다.

다시 확인하려면 Notebook 5절의 `RUN_TRAIN_SAMPLE=True`와 필요할 때 새 `SAMPLE_OUTPUT`을 지정한다. 기본 None이면 메모리 결과만 표시한다. 6절 Full은 범위 밖이며 True로 바꿔도 차단한다.
다음은 이 제한된 표본 결과의 해석과 과거 관측 시점/규칙 근거 확인 범위의 선택이다. 새 수집·전량 replay·모델 학습으로 자동 진행하지 않는다.
