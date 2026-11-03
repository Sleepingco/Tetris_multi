# ML 코드 안내

실험과 검사를 같은 부모 폴더에서 역할별로 찾는다.

```text
scripts/ml/
├── notebooks/    설명·단계별 실험·데이터 감사 (.ipynb)
├── tests/        Notebook 구성/함수·학습기·추론기·요약기 검사 (.py)
│   └── fixtures/ 공통 검사 입력·기대값 (.json)
└── *.py          최종 학습·reference 추론·결과 요약 등 CLI
```

Notebook을 이해하려면 [현재 AI 계획](../../docs/ai-ml/strategy/ai-plan.md)과
[실험 시간순 목차](../../docs/archive/ai-ml/README.md)를 먼저 본다.
실험은 Notebook에서 설명하고, 확정된 최종 학습·배포용 처리는 Python 파일로 둔다.
2026-10-28부터 새 실험·실행·요약과 작은 assert 검증은 Notebook에만 작성한다. 새 Python 구현/테스트 파일은 추가하지 않고 기존 파일은 보존한다. 게임 수집 runtime과 서버 검증은 TypeScript/기존 Node 테스트의 책임이므로 이 제한과 구분한다.
테스트는 분석 구현을 복사하지 않고 해당 Notebook/모듈을 검사한다. 제목·필수 코드
문자열 검사도 학습 문서 구성을 보존하기 위해 유지한다.

2026-10-28 커밋 준비에서는 작업 폴더의 실행 Notebook을 변경하지 않고 Git 저장 버전만 output/count를 비우고 B2/B3의 `RUN_FULL=False`, `FULL_REPORT=None`을 복원했다. 그 source를 내보낸 격리 복사본은 `verify:ml` Node 35/35·Python 220/220을 통과했다. 로컬 실행본의 출력/Full 설정 차이가 Git에 수정 상태로 남는 것은 의도적이며 Python 검사를 삭제하거나 약화하지 않았다.

저장소 루트에서 전체 ML 검증:

```bash
npm run verify:ml
```

새 데이터 감사 테스트만 실행:

```bash
conda run -n tetris-ml python -m unittest scripts.ml.tests.test_human_action_data_readiness_notebook
```

후속 게임 품질 검토는 [human_game_quality_audit.ipynb](notebooks/human_game_quality_audit.ipynb)와
[실험 명세](../../ai-harness/ml-experiments/experiments/human-game-quality-audit.md)를 본다.
기존 Notebook의 parser·identity·경로 보호를 정의 셀에서 재사용하며 별도 Python 구현을 복사하지 않는다.
후보 분류는 학습 승인이 아니고 full 명령은 명세에 있다.

게임 품질 full 검토 뒤 사용자가 첫 dataset 정책을 승인했다. 완료된 생성기는
[human_timing_dataset.ipynb](notebooks/human_timing_dataset.ipynb)와
[timing 명세](../../ai-harness/ml-experiments/experiments/human-timing-dataset.md)를 따른다.
이전 action → 기록된 처리 시도 간격 pair만 만들고 hold segment·검토 게임은 분리한다.
새 dataset 폴더에는 train/validation/test와 제외 근거 JSONL·manifest를 쓴다.
사용자 full 생성·무결성 검토는 완료했다. 새로 재현할 때는 명세의 사용자 명령을 쓰고 output dataset 폴더를 미리 만들지 않는다.

0ms가 특정 게임에 집중된 기록을 살펴보는 코드는
[human_timing_zero_ms_diagnostic.ipynb](notebooks/human_timing_zero_ms_diagnostic.ipynb)에 있다.
[진단 명세·실행 방법](../../ai-harness/ml-experiments/experiments/human-timing-zero-ms-diagnostic.md)을 따른다.
최초에는 사용자 요청으로 코드만 작성했다. 이후 사용자 실행 결과를 해석했고
[마지막 runtime 재현](../../ai-harness/runs/human-timing-zero-ms-reproduction-2026-10-26.md)도 수행했다.
기록 메커니즘은 재현했지만 과거 입력 원천은 미확인으로 조사를 종료했다. 기존 dataset과 split은
읽기 전용이고 전체 Human 입력과 채택 pair의 분모를 구분한다. 원인을 자동 확정하거나 데이터를 제외하지 않는다.

기존 [timing baseline 명세](../../ai-harness/ml-experiments/experiments/human-timing-baseline.md)는 사용자 full Validation 결과 검토까지 완료했다.
고정 평균·전체 분포·이전 action별 분포를 Train만으로 만들고 Validation에서 비교한다.
후보 고정 뒤 같은 모델의 Test 전체/지정 게임 제외 결과로 영향을 확인한다.
[baseline Notebook](notebooks/human_timing_baseline.ipynb)과 [테스트](tests/test_human_timing_baseline_notebook.py)를 작성했다.
별도 Python 실험 구현은 없으며 report 안에 candidate bundle을 보존한다. 이후 사용자 full Validation과 고정 B2 Test 결과 검토를 완료했다.
사용자가 source Notebook을 직접 실행·저장한 작업 파일의 output/count는 보존 중이다. 실행 성공과 별개로 빈 source 형식 검사는 보류이며, 이번 명세 준비에서는 전체 ML suite를 재실행하지 않았다.
GUI 모두 실행은 기본 smoke다. 전체 Validation 실행·재실행 경로·gate 조건은 명세의 사용자 실행 방법을 따른다.

후속 [고정 B2 Test 평가 명세](../../ai-harness/ml-experiments/experiments/human-timing-b2-test-evaluation.md)의
[Notebook](notebooks/human_timing_b2_test_evaluation.ipynb)·[테스트](tests/test_human_timing_b2_test_evaluation_notebook.py)를 작성했다.
공통 정의 뒤 3번은 가상 smoke 설정/실행/결과, 4~5번은 실제 full 설정/실행/결과다.
기본 `RUN_FULL = False`라 모두 실행해도 실제 Test를 열지 않는다. Smoke는 기본 메모리 결과라 반복 실행해도 파일 충돌이 없다.
실제 Test는 사용자가 full 섹션을 켜 실행했고, 33게임/9,859 pair·fit 0·game-macro CRPS 51.87ms를 확인했다. 자세한 결과와 한계는 명세를 따른다.

[과거 간격 조건 명세](../../ai-harness/ml-experiments/experiments/human-timing-history-baseline.md)의
[Notebook](notebooks/human_timing_history_baseline.ipynb)·[테스트](tests/test_human_timing_history_baseline_notebook.py)는
B2(action)와 B3(action+과거 간격 구간)를 같은 Train/Validation에서 비교한다.
기존 dataset을 다시 만들지 않고 인접 lineage로 과거 간격 하나를 연결한다. 첫 pair/gap에서는 B2 fallback이며 기존 Test는 열지 않는다.
3번 가상 smoke → 4번 full 설정/실행 → 5번 결과 순서다. 기본 모두 실행은 가상 smoke만, 사용자 full은 `RUN_FULL=True`로 명시한다.
기존 Test를 이미 본 뒤의 가설이므로 같은 cohort로 새 후보의 독립 최종 일반화를 주장하지 않는다. 현재는 추가 수집 없이 개발 검증과 합성 실행 검사를 계획한다.

사용자 Full Validation 해석을 완료했다. B2/B3 game-macro CRPS는 53.028/49.743ms이며 B0~B3는 timing 비교 기준으로 남긴다.
[기존 로그 활용 조사](../../docs/ai-ml/experiments/human-action-observation-link-audit.md#6-기존-로그만으로-완성할-경로-조사-2026-10-28)에서 timing v1에 다음 행동 label도 있음을 재확인했다. 다음은 기존 pair로 행동+간격 공동 예측을 정의하는 명세이며 Hold는 기존 raw의 별도 view로 다룬다. 신규 수집 계획/문서는 삭제했고 전량 재수집이나 기존 timing 실험 반복을 요구하지 않는다.

[공동 기준선 명세](../../ai-harness/ml-experiments/experiments/human-action-timing-joint-baseline.md)의 [Notebook](notebooks/human_action_timing_joint_baseline.ipynb)은 사용자 Full 해석까지 완료했다. 직전 action 조건의 NLL/F1·marginal CRPS 개선은 부분 기준선의 근거이며 전체 controller 채택은 아니다. 6절 Smoke는 가상 데이터만, 7절 Full은 새 출력 경로를 지정한 사용자 재현용이며 자동 반복하지 않는다. 별도 Python 파일 실행은 필요 없다.

[연결 점검 Notebook](notebooks/human_placement_action_link_readiness.ipynb)은 [명세](../../ai-harness/ml-experiments/experiments/human-placement-action-link-readiness.md)와 [계약](../../docs/ai-ml/contracts/human-placement-action-link.md)에 따라 지정 Train 원본 3개/28 pair의 구조 연결을 확인했다. 기본 모두 실행은 4절 가상 Smoke만 처리한다. 실제 표본을 보려면 5절의 `RUN_TRAIN_SAMPLE=True`로 바꾸고 설정 → 실행 → 결과 셀을 실행한다. `SAMPLE_OUTPUT=None`이면 메모리 결과이며 저장하려면 새 JSON 경로를 지정한다. 6절 Full은 아직 지원하지 않고 차단한다. 전체 cohort·학습·Validation/Test·core replay를 수행하지 않았으며 연결 성공을 상태 조건부 학습 준비 완료로 읽지 않는다.

후속 [상태·규칙 근거 Notebook](notebooks/human_placement_context_evidence.ipynb)은 [명세](../../ai-harness/ml-experiments/experiments/human-placement-context-evidence.md)의 사용자 실제 표본 해석까지 마쳤다. 4절의 `RUN_CONTEXT_SAMPLE=True`는 재현용이며 자동 반복하지 않는다. Snapshot/기록 순서의 일관성과 상태/규칙 근거의 한계를 확인했고 실제 replay·학습은 하지 않았다.

[오프라인 view Notebook](notebooks/human_placement_action_offline_views.ipynb)은 [명세](../../ai-harness/ml-experiments/experiments/human-placement-action-offline-views.md)에 따라 사용자 작은 Train·Full 생성/해석을 마쳤다. 기존 raw·품질·split·parser로 배치 snapshot/정답, control prefix/정답, oracle 조건과 eligibility를 분리했다. 기존 생성물을 덮어쓰거나 반복 생성하지 않는다. 해당 Notebook의 4절/5절은 과거 생성 재현용이며 모델 학습 코드는 아니다.

위 offline view의 사용자 Full은 180게임·7,959구간으로 마감했다. 다시 생성하지 않고 새 [목표 조건 prefix Notebook](notebooks/human_goal_conditioned_prefix.ipynb)과 [명세](../../ai-harness/ml-experiments/experiments/human-goal-conditioned-prefix.md)를 따른다. 기본 모두 실행은 가상3epoch Smoke이며 4절 Full은 `RUN_FULL=True`, `FULL_REPORT="data/ml-experiments/human-goal-conditioned-prefix/full-report-run1.json"`로 사용자가 실행한다. 여기서 이름은 dataset revision이 아니라 **새 JSON report 경로**다. 두 비교군의 독립 행동/시간 MLP를 각각30epoch 학습하고 pandas·Matplotlib으로 결과를 표시한다. 실제 Full fit·runtime은 자동 실행하지 않았다.

## 결과 읽기: pandas + Matplotlib

2026-11-04 커밋 전 정리에서 사용자 실행 설정·출력16개는 ignored `data/ml-experiments/source-checkpoint-20261104/`에 그대로 보존했다. Git용 source는 빈 출력/count와 기본 Full/실제 표본 비활성 상태다. 기존 결과를 보려면 해당 실행본 또는 실험별 report를 열고, 새 실행 때만 source 설정을 명시적으로 변경한다. 별도 Python 파일 실행이나 Full 반복은 필요하지 않다.

현재 [입력·정답 진단 Notebook](notebooks/human_placement_input_target_audit.ipynb)은 [명세](../../ai-harness/ml-experiments/experiments/human-placement-input-target-audit.md)에 따라 승인된 Train149게임 Full2회/결과 해석을 완료했다. 기본은 내부 assert만 실행한다. 결과는4절 `REPORT_TO_READ="data/ml-experiments/human-placement-input-target-audit/full-report-run1.json"`로 읽거나 ignored `data/ml-experiments/human-placement-input-target-audit/executed-analysis.ipynb`를 연다.3절에서 재실행하려면 `RUN_FULL=True`와 아직 없는 run3 등 새 경로를 지정한다. 기존 report는 덮어쓰지 않는다. 동일 입력의 최빈 정답 비율은 관측 표본의 결정적 일치 한계일 뿐 미래 정확도 상한이 아니며, 저장된 boardBefore와 정답 셀 겹침도 자동 제외 근거가 아니다. Validation/Test payload·raw·새 로그·model/scaler fit은 사용하지 않는다.

[배치 snapshot Notebook](notebooks/human_placement_snapshot_baseline.ipynb)의 사용자 run2를 해석했다. 보드 입력의 신호와6epoch 이후 NLL 과적합을 확인했고 최종 지표는 기존 run1과 같았다. 기존 실행본/보고서는 보존한다. 최종 좌표/셀은 정답일 뿐 입력이 아니며 예측 class는 합법 후보로 검증되지 않았다.

[L2 정규화 Notebook](notebooks/human_placement_l2_regularization.ipynb)의 사용자 Full을 해석했다. NLL 개선이 Top-1/MRR 개선으로 이어지지 않아 alpha0.0001을 다음 비교 기준으로 유지한다. 기존 source/보고서는 보존한다.

[보드 스케일링 Notebook](notebooks/human_placement_board_scaling.ipynb)의 사용자 Full은 NLL 개선/Top-1 저하로 해석했다. 다음 [학습 게임 수별 Notebook](notebooks/human_placement_game_count_learning_curve.ipynb)과 [명세](../../ai-harness/ml-experiments/experiments/human-placement-game-count-learning-curve.md)는38/75/112/149게임·동일1530업데이트를 비교한다. 작은 조건도 Smoke가 아닌 정식 비교군이다.

기본 모두 실행은 실제 fit 없는 내부 검사뿐이다.3절 `RUN_FULL=True`, `FULL_REPORT="data/ml-experiments/human-placement-game-count-learning-curve/full-report-run1.json"`로 실행한다.4절에서 전체 Validation/coverage·공통 정답/공통 어휘 projection과 예산 표를 본다. 결과만 읽을 때는 RUN_FULL=False와 REPORT_TO_READ를 사용하며 별도 Python 파일을 먼저 실행할 필요는 없다.

2026-11-03 [정보 분리 Notebook](notebooks/human_goal_information_ablation.ipynb)은 사용자 승인으로 **별도 Smoke 학습 없이 Full1회**를 실행했다. [명세/결과](../../ai-harness/ml-experiments/experiments/human-goal-information-ablation.md)의3조건은 기존 학습·평가 함수를 재사용한다. 기본 모두 실행은 짧은 내부 검사만 수행하며, 저장 결과는4절 `REPORT_TO_READ="data/ml-experiments/human-goal-information-ablation/full-report-run1.json"`로 읽는다. 결과만 볼 때 RUN_FULL을 켜지 않는다. 실제 실행본은 같은 ignored 폴더의 `executed-full-run1.ipynb`다. 기존 실행 Notebook·보고서는 변경하지 않았다.

취소된 trace pilot 준비 Notebook은 제거했다. 현재는 기존 Notebook과 원본·dataset·실행 결과를 보존한다.

현재 Human 감사 Notebook 두 개는 pandas 요약·비교표와 Matplotlib 그래프를 제공한다.
적합성 감사는 과제별 상태·입력 시도 분포, 게임 품질 감사는 분류·난이도·확인된
게임 길이·사유 분포와 검토 목록을 보여준다. 그래프 제목에서 smoke/full을 구분한다.
누락 시간은 0으로 채우지 않고, 실제 간격 원자료가 없는 report에는 요약 통계만 표시한다.
과거 종료된 placement 실험 Notebook은 당시 증거이므로 일괄 수정하지 않는다.

환경 재현은 저장소 루트에서 `conda env update -n tetris-ml -f environment-ml.yml`로 한다.
`matplotlib-base`는 GUI toolkit 없이 Notebook 그래프에 필요한 패키지다.
기존 full 결과를 다시 볼 때는 각 Notebook의 시각화 설명에 있는 report 로딩 코드를
감사 실행 셀 **대신** 실행하고 표·그래프 셀로 넘어간다. 기존 report·executed Notebook은
그대로 보존한다. 새 source와 예전 executed Notebook의 코드가 다른 것은 표시 보완 이력이며,
이전 report의 dependency SHA를 현재 Notebook SHA로 바꾸지 않는다.

2026-10-24에 기존 루트의 `python_tests/`를 `scripts/ml/tests/`로 옮겼다.
과거 실행 기록에서 `python_tests.<module>`은 당시 명령이며, 지금 실행하려면
`scripts.ml.tests.<module>` 또는 `unittest discover -s scripts/ml/tests`를 사용한다.
원본 로그·dataset·model·report는 기존 `data/` 정책을 유지한다.
