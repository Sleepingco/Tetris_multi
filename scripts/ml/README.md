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

2026-10-24에 기존 루트의 `python_tests/`를 `scripts/ml/tests/`로 옮겼다.
과거 실행 기록에서 `python_tests.<module>`은 당시 명령이며, 지금 실행하려면
`scripts.ml.tests.<module>` 또는 `unittest discover -s scripts/ml/tests`를 사용한다.
원본 로그·dataset·model·report는 기존 `data/` 정책을 유지한다.
