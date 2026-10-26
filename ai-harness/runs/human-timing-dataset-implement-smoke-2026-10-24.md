# Human timing-only dataset — implement-smoke (2026-10-24)

## 권한·preflight

- Branch `main`, HEAD `08e8c5a836d1c552c4f916cfefd1c2411b2d5862`.
- 기존 Human 품질 감사·pandas/Matplotlib 보완의 dirty/untracked 변경을 보존했다. stage/commit·새 브랜치·worktree 이동은 하지 않았다.
- 사용자가 async 질문에 **승인 — 이 기준으로 진행**이라고 답했다. 213게임 사용·22게임 격리·11게임 Human 없음 제외, 원본 보존·승패 무관을 `quality-policy-v1`로 고정했다. Full 실행 승인이 아니라 implement-smoke 범위다.
- [명세](../ml-experiments/experiments/human-timing-dataset.md)와 현재 AI 계획을 따른다. Ponytail full: 별도 parser/trainer/생성 CLI 없이 Notebook 정의 셀을 재사용하고 테스트한다.

## 입력·승인 근거

- Raw `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`: 122,095행, 650,669,388 bytes, SHA `eb64f86731ecb148ebf398773cb8e23cdf71217fc44f3bcb88460299bb092344`.
- Quality full report SHA `97388649259414fe2f5119e76ffa57922b3202f85c920540674f0fc494973ff4`.
- 품질 full: 246게임 = 213/11/22. 검토 22는 조기 포기 의심 12, AI tail+미완결 7, 기타 lifecycle 미확인 3이다. 12개 의심은 전부 Hard여서 확정 포기로 해석하지 않는다.
- 기존 report의 provisional 상태·과거 code hash를 수정하지 않는다. 이번 dataset manifest에 별도 승인을 기록한다.

## 구현과 smoke

- `human_timing_dataset.ipynb`: 10단계 설명·작은 worked example·재사용 parser·정제·split·JSONL/manifest 게시·pandas 표/Matplotlib 그래프.
- `test_human_timing_dataset_notebook.py`: 기존 synthetic event 생성기를 재사용해 Notebook 함수·실제 표시 셀을 검사하는 13개 테스트.
- 작은 실제 cohort는 승인 include 목록의 Unicode 첫 5게임이다. 전수 metadata scan은 하지만 나머지 게임의 학습 pair는 만들지 않는다.
- Human 210구간, eligible/represented 181구간, 1,223 pair. Hold 26/timing limited 3구간 분리, rejected pair 0, piece gap 있는 유효 segment 5개다. gap을 가로지른 pair는 만들지 않는다.
- Train/validation/test: 3/1/1게임, 847/138/238 pair, gameId 누수 0. 0ms pair는 5/3/1개다.
- 테스트 중 혼합 geometry를 게임 gate가 먼저 격리하고 표본 없는 validation을 거부하는 동작을 확인했다. geometry 단위 검사 fixture를 train의 단일 geometry 게임으로 고쳐 각 gate를 독립적으로 검증했다. 실제 정책·split을 테스트에 맞춰 바꾸지 않았다.

## 출력·한계

- 검증 출력은 `/private/tmp/human-timing-dataset-20261024-final-run1/`와 `final-run2/`, 실행본은 대응 `final-executed-run1.ipynb`/`run2.ipynb`다. 새 full 폴더는 생성하지 않았다.
- Source Notebook output/execution count는 비운다. Full 명령은 명세에 있으며 사용자가 실행한다. 생성 성공은 모델/production 승인이나 성공 입력·반응시간 검증이 아니다.
- 다음은 사용자 full manifest의 count·분포·제외 편향 검토다. 그 뒤 별도 명세에서 train-only 시간 분포 baseline을 비교한다. 이번에는 학습·v3 전이·수집/사이트 변경을 하지 않는다.

## 최종 검증

- 최종 smoke의 6개 파일은 두 번 모두 byte-identical이다. Manifest SHA `998d4cbe90c80a7584e2a8a162ea9cae253aee22f3989cf9e45a0992e9d6477a`.
- Source Notebook SHA `bff6ab9842ce4e8796f683c52ce6ac00c56e10819cfd5c9900a3c5cebd232b57`, dependency SHA `7ccaebcb5db7c1e5c15067f3bceebc793b3ded2c81ccb414834b31d0959ad8ed`.
- 실행 환경: Python 3.12.13 / pandas 3.0.3 / Matplotlib 3.10.8. 두 실행의 error 0·source cell 일치와 JSONL 행 수·SHA·split gameId·인접 index·유한/비음수 label을 재집계해 확인했다.
- Notebook schema・18개 cell ID·source output 비움·실제 그래프 가독성을 확인했다. 원본과 품질/기존 적합성 full report SHA는 불변이다.
- 새 targeted 13/13, `npm run verify:ml` Node 35/Python 163, `bash scripts/verify.sh` 781 pass·기존 1 skip·0 fail, Markdown 상대 링크 203개·fence·`git diff --check` 통과.
- Jupyter kernel과 HTTP 회귀 테스트는 localhost 사용이 가능한 허용 환경에서 실행했다. 그 외 개발 중 테스트는 synthetic 입력만 썼다.
