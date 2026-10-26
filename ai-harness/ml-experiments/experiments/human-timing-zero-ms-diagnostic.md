# Human timing 0ms 진단 — 사용자 실행용

## 상태·범위

- 현재 상태: `closed_origin_unverified`. 최초 요청은 **코드 작성·실행하지 않기·방법 안내**였으며 아래 작성 기록은 당시 상태다. 이후 사용자가 Notebook을 실행했고 마지막 runtime 재현도 승인했다.
- Notebook·synthetic 테스트를 작성하지만 이번 turn에서는 함수·예제·단위 테스트·smoke·full·verify suite를 실행하지 않는다. 검증된 implement-smoke 완료 상태가 아니다.
- 질문: 특정 게임의 0ms가 입력 순서·tick·piece·placement 시각과 어떤 관계로 기록됐는가?
- 기록 패턴 진단이지 실제 keydown·입력 성공·과거 runtime batch의 원인 확정이 아니다.
- Source/dataset/정제 정책/split을 바꾸거나 test를 삭제·재분할하지 않는다. 학습·재추출·수집 코드·새 dependency·runtime·Git 작업은 범위 밖이다.

## 코드·입력

- [Notebook](../../../scripts/ml/notebooks/human_timing_zero_ms_diagnostic.ipynb).
- [Synthetic 테스트](../../../scripts/ml/tests/test_human_timing_zero_ms_diagnostic_notebook.py). 분석 구현을 복사하지 않고 Notebook 정의 셀을 직접 검사한다.
- 기본 dataset: `data/datasets/human-timing-v1-20261024-full`.
- Manifest SHA: `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88`.
- 기본 target: `119e01c9-b982-4907-9480-2308f4604635`. Notebook 설정 셀의 TARGET_GAME_ID를 바꾸면 같은 dataset의 다른 게임도 볼 수 있다.
- 원본·품질 report·dependency·파일별 SHA를 manifest와 대조하고 실행 전후 변화를 거부한다. 다른 dataset은 manifest pin과 입력 계약을 별도 검토한다.
- 기존 readiness Notebook의 parser·identity·구간 판정을 재사용한다. 대상과 같은 mode/difficulty의 Train gameId 앞 3개만 비교한다. 0ms 비율이나 모델 점수로 비교군을 고르지 않는다.
- 선택 게임의 전체 Human 입력을 보므로 hold/미채택 segment도 포함한다. dataset에 채택된 pair와 sourceLine/inputIndex/action/간격을 대조하고 표에 표시한다.
- 입력 순서는 원본 sourceLine과 배열 순서다. source 순서를 실행 순서라고 가정하지 않는다. 간격은 같은 segment 내부에서만 계산하고 tick 차이는 ms로 환산하지 않는다.
- playerNumber는 게임 안의 가명 번호다. 원본 playerId·nickname·board·절대 timestamp는 표에 내보내지 않는다. 그래프는 player별 첫 유효 관측 입력 대비 상대 시각만 표시한다.

## 표와 그래프

1. 대상/Train 비교 게임의 전체 Human raw pair와 채택 dataset pair의 0ms 수·비율: 분모를 분리한다.
2. 대상 segment의 연속 0ms pair 길이, 모든 timestamp 동일 여부, placement 시각과 같은 입력 수, sequence/tick 역전·반복 필드.
3. 대상 입력 순서·action·sequence·tick·상대 시각·간격·dataset 채택 표시, 0ms/이상 순서 예제.
4. Matplotlib의 관측 순서→상대 시각, segment별 0ms 비율, 선택 게임 간 raw/dataset 비율 비교.

연속 길이는 입력 개수가 아니라 인접 pair 수다. timestamp 누락은 None/NaN으로 남기며 0으로 채우지 않는다. 음수 delta도 진단에는 남긴다. 동일 필드 반복·동일 시각·서로 다른 tick은 관측 사실이고 원인 판정은 `unverified`다.

## 직접 실행하는 방법

### Notebook에서 실행

1. `tetris-ml` Python 커널을 선택한다.
2. 원본에 output을 저장하지 않으려면 먼저 **다른 이름으로 저장**해 `data/ml-experiments/human-timing-zero-ms-diagnostic/executed.ipynb` 사본을 만든다. 폴더가 없으면 사용자가 먼저 생성한다.
3. 설정의 dataset 경로·target gameId를 확인한다.
4. 위에서 아래로 실행한다. synthetic 예제 뒤의 **5. 실제 진단** 셀부터 raw를 읽는다.
5. 비교표·0ms 예제·긴 연속 구간 표를 확인한다. 특정 sourceLine은 Notebook 안내의 필터 식으로 펼친다.
6. checksum 오류가 나면 중단한다. SHA 검사를 제거하거나 기존 dataset을 다시 쓰지 않는다.

### 터미널에서 별도 실행본 생성

아래는 **사용자가 실행할 명령**이며 에이전트가 실행하지 않았다. 기존 실행본이 있으면 새 출력 이름을 사용한다.

```bash
mkdir -p data/ml-experiments/human-timing-zero-ms-diagnostic
MPLCONFIGDIR=/private/tmp/tetris-ml-matplotlib \
conda run -n tetris-ml jupyter nbconvert \
  --to notebook --execute scripts/ml/notebooks/human_timing_zero_ms_diagnostic.ipynb \
  --ExecutePreprocessor.timeout=600 \
  --output "$(pwd)/data/ml-experiments/human-timing-zero-ms-diagnostic/executed.ipynb"
```

작성한 synthetic 테스트만 먼저 확인하려면:

```bash
conda run -n tetris-ml python -m unittest scripts.ml.tests.test_human_timing_zero_ms_diagnostic_notebook
```

이 테스트는 실제 raw 진단을 실행하지 않으며 입력 변환·0ms 연속·누락/역전·비교군·source Notebook 계약을 확인한다. 기존 사용자 timing Notebook에는 실행 output이 있어 전체 verify:ml의 별도 source 형식 검사에 영향을 줄 수 있다. 이번 작업은 이를 임의로 지우지 않는다.

## 다음 gate

사용자가 실행한 표·그래프에서 12구간 전체의 짧은 0ms 반복, 순서/tick 역전 0, 원인 미확정을 확인했다.
마지막 runtime test 4개로 같은 tick 묶음의 동일 ms 기록을 재현했으나 과거 입력 원천은 특정하지 못했다.
사용자 stop condition에 따라 조사는 종료하고 기존 v1 dataset 준비로 복귀한다. 추가 계측·자동 제외·재학습은 시작하지 않는다.
[재현·dataset 마감 기록](../../runs/human-timing-zero-ms-reproduction-2026-10-26.md)을 따른다.

## 작성 단계 자체 검토 — 실행 검증 아님

요약: 요청한 코드·실행법은 작성했으나 사용 가능성은 실제 실행으로 확인하지 않았다. 전체 3.8/5.

| 축 | 점수 | 근거·다음 확인 |
| --- | ---: | --- |
| 정확성 | 3 | JSON·셀·링크·공백만 정적으로 확인했다. Python 구문·함수·그래프는 실행하지 않아 테스트와 실데이터 대조가 필요하다. |
| 완결성 | 4 | 원본/채택 pair·누락/역전·hold·Train 비교군과 synthetic 검사를 작성했다. 실제 입력의 모든 예외 처리는 아직 검증하지 않았다. |
| 명료성 | 4 | 8단계 설명과 표의 분모·원인 미확정을 표시했다. 실행 화면의 가독성은 사용자 확인이 필요하다. |
| 실행 가능성 | 4 | 커널·GUI 순서·CLI·단위 테스트 명령을 제공했다. 사용자 로컬 커널 실행은 이번에 확인하지 않았다. |
| 간결성 | 4 | parser를 재사용하고 별도 실행 CLI·출력 bundle을 추가하지 않았다. 입력 SHA/lineage 보호로 Notebook의 정의 셀은 길다. |

주요 후속 개선은 사용자의 synthetic 테스트 → 진단 실행 결과 확인이다. 재실행 검증은 추가 권한 없이 진행하지 않는다.
Self-check: 무실행 코드 작성과 실행법이라는 사용자 요청에는 부합한다. 실행 통과를 원하는지까지는 추측하지 않으며 아직 검증 완료로 전달하지 않는다.
