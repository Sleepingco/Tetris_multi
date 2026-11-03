# ML Experiment: 사람 배치·조작 오프라인 학습 view 구성

## 상태·질문

- Experiment ID: `human-placement-action-offline-views`, Lifecycle: `full_constructed_analyzed`. 사용자 Full 생성/해석 완료. 전체 ML 형식 gate 보류는 별개다.
- 질문: **승인된 기존 Human 자료를 입력·정답·oracle 조건·과제별 eligibility가 분리된 segment view로 구성할 수 있는가?**
- [Notebook](../../../scripts/ml/notebooks/human_placement_action_offline_views.ipynb)의 사용자 작은 Train·Full을 검토했다. 새 immutable view dataset은 생성됐고 모델 fit은 이 단계에서 하지 않았다.
- 기준: [사용 범위 offline-use-v1](../../../docs/ai-ml/contracts/human-placement-action-link.md#9-기존-로그의-학습-사용-범위--offline-use-v1), [기존 Human 품질/시간 계약](../../../docs/ai-ml/contracts/human-action-dataset.md).
- Baseline/변경 변수/estimator/scaler/optimizer: 해당 없음. 단일 데이터 구성 과제이며 모델 비교는 후속 명세다.

## 입력·cohort

- 기존 raw: `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`, SHA `eb64f86731ecb148ebf398773cb8e23cdf71217fc44f3bcb88460299bb092344`.
- 기존 timing manifest: `data/datasets/human-timing-v1-20261024-full/manifest.json`, SHA `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88`.
- Frozen readiness report SHA `27f2a5dc3dae6143d22b0930987b3cd102e90d07ae1f228deadd0da41db41b4a`, quality report SHA `97388649259414fe2f5119e76ffa57922b3202f85c920540674f0fc494973ff4`.
- `quality-policy-v1`·기존 game split·승패 무관 Human 정책 유지. 기존 Train 149/Validation 31게임을 구성 후보로 삼고 실제 component 적격 수는 생성 결과로 보고한다. 전부 적격이라고 가정하지 않는다.
- Test 33게임은 기존 manifest의 예약 ID metadata만 유지한다. Test JSONL·그 게임 raw payload는 열지 않는다.
- Raw를 줄 단위로 읽되 frozen readiness의 승인 Train/Validation sourceLine만 JSON으로 파싱한다. 새로운 전체 raw index/replay를 선행하지 않는다.
- 첫 실제 Smoke는 기존 Train sourceLine 118015/118021/118023뿐이다. 승인된 게임이라고 모든 segment를 자동 채택하지 않는다.
- 기존 parser/정규화·frozen player 대응·구간/시간·물리 class 정의와 출력 보호를 재사용한다. 새 Python parser/게임 규칙·JS 학습을 만들지 않는다.

## view·표본 계약

- 원본 segment 한 번만 표현하고 nested placement/control/oracleCondition/eligibility로 나눈다. 별도 candidate별 반복 sample은 만들지 않는다.
- Placement inputSnapshot과 Human 선택 class는 오프라인 snapshot 관계다. 시점/geometry/reachability 확인 상태를 유지하고 `offlineOnly=true`, `inferenceEligible=false`로 둔다.
- Control은 관측 prefix와 이미 지난 간격만 입력 후보, 다음 action/시도 간격은 정답이다. 미래 행동·전체 길이/정규화 진행률·마지막 여부·결과 지표를 feature에 넣지 않는다.
- 첫 action 종류는 raw에서 보존할 수 있다. BOS는 경계 기호이며 첫 시간 label은 null/미지원으로 둔다. 원본에 없는 spawn 대기를 합성하지 않는다.
- 실제 0ms는 보존한다. Pair 연결은 같은 source/game/player/piece 및 인접 index/sequence에서만 하며 gap에서 reset한다.
- Oracle Human goal은 placement label을 재사용한 decoder 조건이다. Placement input에 복사하지 않고 전체 policy 결과와 별도로 식별한다.
- 첫 no-Hold 구성은 Hold 포함 segment를 `hold_deferred`로 표시하고 해당 연결 학습 view에서 격리한다. 원본/게임 전체를 삭제하거나 Hold 미사용을 사용 가능 상태의 음성 label로 만들지 않는다.
- Component 하나가 실패하면 사유를 보존하고 나머지 과제의 사용 가능 여부는 별도로 남긴다. 구조 연결·source 충돌은 명시적으로 거부하며 임의 정답으로 보정하지 않는다.
- Game/player/piece·sourceLine·trust·schema·mode/difficulty/outcome은 lineage/편향 진단용이다. 개인 식별/승패·heuristic을 모델 입력이나 정답으로 쓰지 않는다.
- 지원 규모는 legacy 20×10의 기록 구조다. 명시되지 않은 ruleset/build/stage는 `unspecified/unverified`로 유지하고 현재 40행 호환을 가정하지 않는다.

## 산출물·실행 분리

- Notebook 하나: `scripts/ml/notebooks/human_placement_action_offline_views.ipynb`. 새 `.py`·별도 Python 테스트·패키지를 늘리지 않는다.
- 설명/작은 예제·정의·가상 Smoke·작은 실제 Train 설정/실행/결과·기본 비활성 Full을 분리한다. 표/그래프는 pandas·Matplotlib로 구성 수·eligibility·격리 편향을 보여준다. 모델 지표는 계산하지 않는다.
- 기본 모두 실행은 가상 자료만 처리한다. 처음에는 작은 Train view를 메모리에서 구성한다. 명세 밖 raw·Validation/Test를 자동 열지 않는다.
- 이후 승인된 Full에서만 새 immutable 출력 디렉터리에 segment 단위 `train.jsonl`, `validation.jsonl`, 양쪽 component 모두 사용 불가인 항목의 `rejected.jsonl`, `manifest.json`을 게시한다. 부분 실패는 정상 row의 component 사유로 보존한다.
- 기존 dataset·보고서·디렉터리는 덮어쓰지 않는다. Source/checksum·code/정의 SHA·정책 revision·split·예정 후보 수/실제 사용 수·component별 사유를 manifest에 기록한다. Token·raw playerId·개인정보는 출력하지 않는다.
- `offline-use-v1`·미검증 flags와 Test 미사용을 보존한다. `dataConstructionComplete`와 학습/제품 준비를 구분하고 `modelFitCount=0`, `productionIntegration=false`, `canonicalResultEligible=false`다.
- Source byte 읽기/선택 raw 파싱 수·unique segment·component별 pair/first-action/물리 class 수를 따로 집계한다. 단일 합계로 데이터 손실·지원 범위를 숨기지 않는다.
- Full의 출력은 독점 생성한 새 디렉터리에 JSONL을 fsync한 뒤 manifest를 원자적으로 마지막 게시하는 commit-marker 계약이다. manifest 없는 디렉터리는 미완성으로 취급한다. I/O 실패 시 임의 삭제/덮어쓰기 없이 보존하며 검사 뒤 새 revision으로 재시도한다. 디렉터리 전체 rename의 원자성을 주장하지 않는다.

## 구현·검증 결과 (2026-11-02)

- 20개 cell: 설명/예제·공유 정의·3절 가상 Smoke·4절 실제 작은 Train·5절 Full·한계/다음 gate다. 모든 code output/count는 비어 있고 ID는 고유하다.
- 기본 모두 실행에서 실제 data 파일 open 차단 검사를 통과했다. 배치/control 부분 실패, Hold 보류, BOS/null·실제 0ms, gap reset, alias 표현, identity 중복/충돌, 입력 순서 불변을 내부 assert로 검사한다.
- 가상 Test 줄을 의도적으로 JSON 파싱 불가능하게 두고 그 전후 선택 줄만 파싱했다. 실제 Test/raw는 이 검증에서 읽지 않았다. 독점 출력·symlink/dangling/parent alias·hardlink·상위 경로 거부와 I/O 실패 시 manifest 미게시를 검사했다.
- headless 최종 가상 2회 report byte-identical, SHA `89ed8d1bfdb19988c39a73412811a25d9d412fd0e7de4f3a06490d2b51009877`. 각 실행 error 0·Matplotlib 그림 1개다. 증거: `/private/tmp/human-offline-views-release-6dPxeO/` (가상 검증 임시 산출물이며 source/유일한 연구 증거 보관소가 아님).
- `bash scripts/verify.sh`: 793 pass·기존 1 skip. `npm run verify:ml`: Node 35 pass, Python 213/220 (기존 사용자 실행 Notebook의 5 fail·2 error). 사용자 파일은 수정하지 않았고 Git HEAD 원본을 별도 cwd에 내보낸 기존 Python 회귀는 220/220이다. 새 Notebook 내부 검사와 기존 suite의 범위를 구분한다.
- 최초 headless는 등록되지 않은 `tetris-ml` kernel 이름 때문에 실행 전 실패했다. 설치된 환경의 `python3` kernelspec을 사용하도록 source를 수정한 뒤 두 실행을 통과했다. 환경/패키지/kernelspec 설치 변경은 없다.
- 다음 사용자 실행: Notebook 4절에서 `RUN_TRAIN_SAMPLE=True`로 설정하고 실행·결과 셀을 실행한다. 기존 Train 세 줄만 메모리에서 구성한다. 이 결과 해석 뒤 별도 승인으로 5절 `FULL_DATASET_NAME`에 새 폴더 이름과 `RUN_FULL=True`를 설정한다. CLI나 Python 테스트 선행 실행은 필요 없다.
- Full 생성 코드·실제 적격 수·실데이터 메모리 규모는 아직 실행 검증하지 않았다. 전체 prefix 명시 보존은 긴 조작열에서 커질 수 있다. 학습/추론·현재 ruleset 호환 준비 완료를 뜻하지 않는다.

## 사용자 Full 결과 해석 (2026-11-02)

- 출력 revision: `data/datasets/human-placement-action-offline-v1-20261102-run1`. Manifest SHA `9ae27fc0b85903f412b434f5667e51376e7d5bb3170d3bab3d439f0e415f28bf`.
- 180게임(Train149/Validation31), 원본 8,929구간 중 7,959 보존·970 Hold 보류. Test33은 예약 metadata만 유지했다. 저장 Notebook error0·세 JSONL 행수/SHA·고정 입력 SHA·정의 SHA·게임 누수0을 읽기 전용으로 대조했다.
- Train/Validation 보존 구간 6,440/1,519, 배치+oracle 공통 적격 6,417/1,516, 행동 정답 전체 47,591/11,699, 간격 정답 41,151/10,180이다. 공통 적격의 행동 정답은 47,537/11,691, 시간 정답은 41,120/10,175다.
- 간격 없는 73구간은 하드드롭 한 번만 기록돼 BOS 행동 label로 보존했다. 실제 0ms는 347/51,331 pair(약0.68%)다.
- 보존된 26구간은 selected cell 범위 오류로 배치만 부적격이고 control은 유지했다. 전체 사유27에는 Hold 보류1건이 겹친다. 보류는 원본 삭제/나쁜 플레이 판정이 아니다.
- Full dataset 구성 성공이며 inferenceEligible=false, modelFitCount=0이다. 현재 ruleset/state 정합·Human 모방 성능·실제 rollout의 증거가 아니다.
- 다음은 [목표 조건 prefix 실험](human-goal-conditioned-prefix.md)이다. 기존 Notebook/생성 dataset을 수정하거나 Full 구성을 반복하지 않는다.

## Gate·내부 검사

- 고정 SHA·quality/split·Human 대응·중복/충돌·lineage·input enum/시간/보드 형식을 검증한다. 새 source/revision을 조용히 받아들이지 않는다.
- Assert: no Test payload parse, input/label/oracle 분리, BOS 첫 시간 미지원·0ms 유지, gap reset, alias 중복 방지, component 부분 실패·Hold 격리, 입력 순서 불변·독점 출력/경로 보호·정의/원본 불변.
- Small Smoke는 같은 구성 경로를 사용하고 `fullCohortCovered=false`, `policyDecisionEligible=false`다. 가상 결과를 실제 전체 규모/학습 준비 근거로 쓰지 않는다.
- Model fit·학습용 vocabulary/scaler·예산·loss 최적화는 수행하지 않는다. Validation을 전처리 fit에 쓰거나 희소 행동/미관측 class를 점수 때문에 제거하지 않는다.
- 첫 학습 비교 질문은 같은 적격 교집합에서 `prefix_only`와 `oracle_goal_prefix`를 비교하는 것이다. 구체 모델/예산/threshold는 별도 학습 명세에서 fit 전에 고정한다. 이 비교로 Human 배치 모델·A/B 전체 구조·자체 실행을 대신하지 않는다.
- 구현 후 Notebook 내부 검사·가상 Smoke·필수 ML/Node 검증·문서 검증을 수행한다. 사용자 실행본의 형식 차이는 보존/분리한다. Full은 사용자가 실행하거나 명시 승인할 때만 한다.

## 허용·금지·다음 gate

다음 구현의 허용 범위는 예정 Notebook·이 명세·공통 계약/계획/안내/PLAN/change-log의 필요한 갱신이다.
기존 Notebook/원본/dataset/report·runtime/PVE/DB·의존성은 변경하지 않는다. 새 수집·학습·전체 replay·Git mutation을 자동 수행하지 않는다.
사용자 Full 구성·과제별 적격 수 해석은 완료했다. 이후 모델 fit은 별도 목표 조건 실험에서 수행하며 replay·runtime은 자동 시작하지 않는다.
Rollback은 새 코드/명세·참조 변경만 되돌리며 기존 데이터나 모델을 삭제하지 않는다.
