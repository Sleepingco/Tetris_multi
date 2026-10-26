# ML Experiment: Human timing-only dataset v1

## 상태와 질문

- Experiment ID: `human-timing-dataset`, MODE: `implement-smoke`
- 현재 상태: 사용자 full 생성·무결성 검토 완료, `dataset_preparation_closed_with_timing_ambiguity`. 아래 implement-smoke 절은 구현 당시 기록이다. [마감 기록](../../runs/human-timing-zero-ms-reproduction-2026-10-26.md)을 따른다.
- 질문: 승인된 게임에서 기록된 입력 처리 시도 간격만 누수 없이 추출·분할할 수 있는가?
- 이번 범위는 dataset 생성기 Notebook·synthetic 검사·작은 smoke다. 모델 fit·full 생성·runtime 적용은 하지 않는다.
- 사용자는 2026-10-24 대화에서 포함 후보 213게임 사용, 의심 22게임 격리, Human 없는 11게임 제외를 승인했다. 원본과 과거 report는 보존한다.

## 승인된 게임 정책 `quality-policy-v1`

- 30초 미만이고 종료 직전 5개 이상 연속 piece에서 hard_drop만 있으면 격리한다.
- 검증된 lifecycle duration이 600초 초과면 제외한다. 정상 짧은 패배는 길이만으로 제외하지 않는다.
- 마지막 Human 원본 행 뒤 AI 이벤트끼리의 관측 span이 60초를 넘거나 lifecycle이 불완전하면 격리한다. 포기 의도·버그·실제 이탈 시간을 확정하지 않는다.
- 승패 무관: PVE Human만, PVP 양쪽 Human. 품질 report의 include_candidate만 사용한다.
- 승인 근거 report SHA: `97388649259414fe2f5119e76ffa57922b3202f85c920540674f0fc494973ff4`.
- 과거 report의 `provisional_review_only`와 dependency SHA는 당시 실행 증거로 유지한다. 이번 manifest가 별도 정책 채택을 기록한다.

## 입력·고정 조건

- Source: `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`.
- Quality report: `data/ml-experiments/human-game-quality-audit/full-report.json`.
- 두 파일의 checksum·source linkage·full flag·게임 분류 합계·목록을 확인한다. 품질 report와 원본/선택 게임이 다르면 중단한다.
- 기존 readiness Notebook의 정의 셀만 재사용한다. parser/검사 로직을 Python 파일로 복사하지 않는다.
- 지원 범위: legacy 20×10, schema 1/2, ruleset unspecified. v3/40행 전이·현재 엔진 replay는 하지 않는다.
- 단계 순서: 승인된 game → Human → 지원 metadata → timing usable → hold 없는 segment → 인접 pair 검사 → game split → JSONL/manifest.
- 인접 pair는 같은 입력 배열의 i-1/i만 비교한다. 두 timestamp finite·0 이상, delta 0 이상, 같은 pieceIndex, sequence 정확히 +1, tick 비역전을 요구한다. 잘못된 pair 양옆을 새로 연결하지 않는다.
- hold가 있는 segment는 전체 분리한다. 첫 행동 반응시간·서로 다른 piece 간격을 만들지 않는다. 0ms·긴 간격은 관측값으로 보존하고 clipping하지 않는다.

## 출력 schema와 split

표본은 `previousAction`만 feature, `recordedIntervalMs`가 label이다. `nextActionDiagnostic`, gameId, playerNumber, pieceIndex, sourceLine와 input index는 진단·lineage이며 feature가 아니다. 원본 playerId·절대 timestamp·board·winner·최종 placement는 복사하지 않는다.

- Split seed: `human-timing-v1-20261024`.
- `SHA-256(seed + newline + gameId)`의 오름차순, 동률은 Unicode gameId로 정렬한다. Python random/hash를 사용하지 않는다.
- 최소 3게임. train=floor(0.70N), validation=max(1,floor(0.15N)), test=나머지다. train은 최소 1·최대 N-2로 제한한다. 213게임이면 149/31/33게임이다.
- pair를 보기 전에 game을 분할하며 PVP 양쪽도 같은 split이다. 개인별·시간순 holdout으로 주장하지 않는다. 표본 없는 game도 원래 split에 남기며 어느 split이든 표본 0이면 실패한다.
- `train.jsonl`, `validation.jsonl`, `test.jsonl`, `rejected-segments.jsonl`, `rejected-pairs.jsonl`, `manifest.json`.
- Manifest: source/quality/code SHA, 승인 정책, cohort·split gameId, count·사유·구간/pair 분포·0ms 비율·파일별 SHA/bytes. 분포는 진단이며 fit/preprocessing은 없다.
- 새 폴더만 생성하고 기존 폴더·symlink·path alias를 덮지 않는다. manifest는 마지막에 쓴다. 실패 시 manifest 없는 부분 폴더는 완료본이 아니며 자동 삭제하지 않는다.

## 허용 변경·검증

- `scripts/ml/notebooks/human_timing_dataset.ipynb`, `scripts/ml/tests/test_human_timing_dataset_notebook.py`, 이 명세·관련 run record, 품질 감사 결과·정책 승인 문서, 현재 안내·계획·이력.
- pandas 표·Matplotlib 분포/구간 제외 그래프와 작은 worked example을 Notebook 안에 둔다.
- Smoke: 승인된 include game의 Unicode 앞 5개. 전체 metadata scan은 하되 해당 5게임의 pair만 만든다. full과 같은 생성 경로를 사용한다.
- Synthetic: PVE AI 제외·PVP 양쪽·hold·시간/sequence/tick/piece 오류·0ms·긴 간격·단절 비연결·정렬/결정성·누수·원본/품질 변경·출력 보호·빈 split·표/그래프.
- Targeted → `npm run verify:ml` → `bash scripts/verify.sh`. Full은 사용자가 한 번 실행한다.
- Full도 `policyDecisionEligible=false`, `canonicalResultEligible=false`, `modelFitCount=0`이다. 생성 성공은 모델/사이트 승인이나 실제 키 입력 재현 증거가 아니다.

## 사용자 full 명령

저장소 루트에서 실행한다. output dataset 폴더는 **미리 만들지 않는다**. 이미 존재하면 새 version 이름을 사용한다.

```bash
mkdir -p data/ml-experiments/human-timing-dataset
MPLCONFIGDIR=/private/tmp/tetris-ml-matplotlib \
HUMAN_TIMING_RUN_MODE=full \
HUMAN_TIMING_OUTPUT=data/datasets/human-timing-v1-20261024-full \
conda run -n tetris-ml jupyter nbconvert \
  --to notebook --execute scripts/ml/notebooks/human_timing_dataset.ipynb \
  --ExecutePreprocessor.timeout=600 \
  --output "$(pwd)/data/ml-experiments/human-timing-dataset/executed-full.ipynb"
```

Full 생성 결과에서 count·분포·제외 편향을 검토한 뒤에만 별도 명세의 train-only 시간 분포 baseline으로 진행한다. 이번 작업은 baseline 학습·test 기반 cutoff 조정·v3 전이·수집 변경·stage/commit을 포함하지 않는다.

## Implement-smoke 결과 (2026-10-24)

- 5게임 Human 210구간 → 181구간/1,223 pair. Hold 26/timing limited 3구간을 분리했다.
- Train/validation/test: 3/1/1게임, 847/138/238 pair, game 누수 0. 0ms pair는 5/3/1개다.
- 두 실행의 6개 파일이 byte-identical이며 manifest SHA는 `998d4cbe90c80a7584e2a8a162ea9cae253aee22f3989cf9e45a0992e9d6477a`다.
- Targeted 13개, verify:ml Node 35/Python 163, 필수 verify 781 pass·기존 1 skip 통과.
- 원본·기존 full report 불변, executed Notebook error 0·표/그래프 확인. Full dataset은 생성하지 않았다.
- [실행 기록](../../runs/human-timing-dataset-implement-smoke-2026-10-24.md).
