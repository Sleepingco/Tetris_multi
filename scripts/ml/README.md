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
테스트는 분석 구현을 복사하지 않고 해당 Notebook/모듈을 검사한다. 제목·필수 코드
문자열 검사도 학습 문서 구성을 보존하기 위해 유지한다.

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

다음 [timing baseline 명세](../../ai-harness/ml-experiments/experiments/human-timing-baseline.md)는 준비 완료다.
고정 평균·전체 분포·이전 action별 분포를 Train만으로 만들고 Validation에서 비교한다.
후보 고정 뒤 같은 모델의 Test 전체/지정 게임 제외 결과로 영향을 확인한다. 현재는 명세만 있으며
해당 baseline Notebook·테스트·학습 결과는 아직 없다. 다음 구현도 Notebook 안에서 하고 별도 .py로 복사하지 않는다.

## 결과 읽기: pandas + Matplotlib

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
