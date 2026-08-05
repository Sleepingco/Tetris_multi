# Python Placement Experiment Notebook

## 역할

`scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb`는 Human placement
선택을 모방하는 pairwise ranking baseline의 실험 기록이자 실행 가능한 계약이다.
원본 `human-behavior-v2` JSONL을 pandas로 직접 읽고, Python에서 feature를 만들며,
game 단위 13-fold LOGO를 수행한다.

기존 JavaScript parity 경로는 과거 수치 회귀 검증용으로 유지하지만, 이 노트북은
JS feature exporter, JS optimizer, JS evaluation report를 읽거나 호출하지 않는다.

## 실행

저장소 루트에서 고정 Conda 환경을 만든다.

```bash
conda env create -f environment-ml.yml
```

노트북은 headless 실행 결과와 report를 저장소 밖에 둔다.

```bash
PLACEMENT_EXPERIMENT_REPORT=/private/tmp/placement-logo-report.json \
conda run -n tetris-ml python -m jupyter nbconvert \
  --to notebook --execute scripts/ml/notebooks/placement_pairwise_logo_experiment.ipynb \
  --output placement-logo-executed.ipynb --output-dir /private/tmp \
  --ExecutePreprocessor.timeout=600
```

홈 디렉터리 쓰기나 localhost kernel IPC가 제한된 sandbox에서는 Jupyter의
`JUPYTER_CONFIG_DIR`, `JUPYTER_DATA_DIR`, `JUPYTER_RUNTIME_DIR`, `IPYTHONDIR`을
`/private/tmp` 아래로 지정하고 kernel 실행 권한을 별도로 허용해야 한다.

`PLACEMENT_EXPERIMENT_REPORT`를 생략하면 report는
`/private/tmp/placement-pairwise-logo-experiment-report.json`에 기록된다. 노트북은
source 네 파일과 report 경로의 lexical path, realpath, 기존 inode 충돌을 거부한다.

## 실험 계약

- 입력: `manifest.json`, `train.jsonl`, `validation.jsonl`, `rejected.jsonl`
- feature: 명시적으로 고정된 schema v1의 16개 값
- label: decision마다 유일한 `selectedBySource`
- split: 각 game을 정확히 한 번 validation으로 사용하는 LOGO
- preprocessing: fold train candidate에만 fit한 `StandardScaler`
- model: decision-balanced symmetric pair를 사용하는 `LogisticRegression(lbfgs)`
- output: fold 진단과 micro/macro/median/range/worst-fold가 담긴 결정적 JSON

`metadata.isWinner`, 식별자, heuristic score와 input sequence는 feature가 아니다.
canonical Top-1과 tie-aware Top-1은 별도로 해석한다. 결과는 Human 선택 모방
성능이며 gameplay 승률이나 AI 강도를 뜻하지 않는다.

## 종료 게이트

노트북 마지막 셀은 `continue_experimenting`, `ready_to_freeze`,
`blocked_by_data` 중 하나를 기록한다. `ready_to_freeze`는 사용자 승인 전에는
선택하지 않는다. 최종 전체 데이터 모델 학습과 production artifact export는
별도 작업으로 남긴다.
