# ML Experiment: Human 배치 입력·정답 진단

## 질문과 승인 범위

- ID: `human-placement-input-target-audit`. 구현은 `implement-smoke`, 사용자 승인 뒤 실제 진단은 `run-full`로 진행한다. `executionPolicy=full-only`이며 Smoke 학습은 없다.
- 질문: 현재 배치 모델의 정확한 입력에서 동일 입력·다중 Human 정답과 배치 사례 희소성이 어느 정도인가? 데이터량/구조의 원인을 단정하기 전에 관측 가능한 제약을 센다.
- 사용자가 2026-11-03에 학습 없는 Train 전체 Full 진단 실행을 승인했다. 신경망/Scaler fit·새 수집·Validation/Test payload·raw/DB·모델 변경·데이터 제외·runtime·Git mutation은 범위 밖이다.

## 고정 입력과 재사용

- Dataset: `data/datasets/human-placement-action-offline-v1-20261102-run1`. Manifest SHA `9ae27fc0b85903f412b434f5667e51376e7d5bb3170d3bab3d439f0e415f28bf`, Train SHA `535e87540b5d9983b4065df2904df5702f13aa7ba40df640f6fcb7dfa332c08c`.
- Train 6,440행 중 기존 placement 적격 6,417구간/149게임만 사용한다. 기존 부적격 23행은 정책을 바꾸지 않고 집계에서 분리한다. 정답 2,133종과 vocabulary SHA를 고정한다.
- 입력은 기존 모델과 정확히 같은 boardBefore 점유 200 + pieceType one-hot 7이다. 블록 색상/최종 pose/정답/행동열/시간/게임 ID/승패는 입력 동등성에 넣지 않는다. 정답은 Human occupied-cell physical class다.
- [snapshot Notebook](../../../scripts/ml/notebooks/human_placement_snapshot_baseline.ipynb)의 정의 SHA `233ceca8322bd4335b798cdd452064d389e0ddbce6451610c7ba7d56a1dd9c5c`에서 parser·physical key·checksum·report 출력 보호를 재사용한다. 이전 Notebook 실행 셀/출력은 실행하거나 수정하지 않는다.
- 지난 학습곡선 `data/ml-experiments/human-placement-game-count-learning-curve/full-report-run1.json`, SHA `974f23947e1f4b0f87fb581f658a365e13a7de88f4d0384d75a52d193dfb28e4`를 경계·coverage 문맥으로만 읽는다. Validation 1,516구간 중 OOV 152라는 기존 값은 재계산하지 않는다. Manifest Test 33 ID/지난 report Validation 31 ID와 Train gameId를 대조하며 새 payload는 읽지 않는다.

## 계산과 해석 계약

1. 207차원 raw binary 입력 tuple로 그룹화한다. SHA는 표시용이며 hash 충돌로 그룹을 합치지 않는다.
2. 동일 입력의 정답별 빈도·게임 수, 반복 입력 수·영향 구간·여러 게임에 걸친 다중 정답을 센다.
3. `sum(입력 그룹별 최빈 정답 빈도) / 전체 Train 구간`을 관측 표본의 결정적 일치 한계로 계산한다. 반복 입력만의 분모도 따로 보고한다. 이는 학습된 모델 점수·미래 성능 상한·로그 오류 비율이 아니다. 다중 정답이 없어도 정보가 충분하다는 증거가 아니다.
4. Class별 구간/게임/고유 입력 수와 support 1·2·3–5·6–10·11+ 분포를 보고한다. 희소성은 원인 후보이며 빈도만으로 성능 저하의 인과를 확정하지 않는다.
5. 기존 parser로 board shape·4개 고유 셀·좌표·physical key를 확인한다. 정답 셀과 boardBefore 점유의 겹침은 별도로 센다. 관측 시점이 미확인이므로 겹침을 자동 오류/정제/제외로 판정하지 않는다. Python 게임 규칙/geometry/reachability를 재구현하지 않는다.
6. pandas 요약·분포/입력 그룹/경험적 불일치 그래프와 같은 입력의 정답 셀 그림을 제공한다. 전체 count 분모와 조건부 한계를 표시한다.

## 실행과 산출물

- Source: [human_placement_input_target_audit.ipynb](../../../scripts/ml/notebooks/human_placement_input_target_audit.ipynb). 새 Python/테스트 파일·dependency는 없다. 내부 assert로 검사한다.
- 기본 `RUN_FULL=False`이며 모두 실행은 실제 dataset/reference/fit 없이 가상 예제 검사만 한다. 3절 `RUN_FULL=True`로 설정하고 전체 실행한다.
- 기본 report: `data/ml-experiments/human-placement-input-target-audit/full-report-run1.json`. 기존 경로는 덮어쓰지 않는다. 재실행은 run2처럼 새 파일명을 사용한다. 환경변수는 `HUMAN_PLACEMENT_INPUT_AUDIT_REPORT`, 입력은 기존 `HUMAN_PLACEMENT_DATASET`, reference는 `HUMAN_PLACEMENT_INPUT_AUDIT_REFERENCE`다. 경로를 바꿔도 고정 checksum은 유지한다.
- 결과만 읽을 때는 Full을 끄고 4절 `REPORT_TO_READ`에 report 경로를 넣는다. 설정만으로 실행 권한이 추가되지는 않는다.
- Report는 source/reference/input SHA, count·희소성·다중 정답·겹침, 기존 coverage 재표시와 미검증을 기록한다. source definition SHA는 설정/출력을 제외한다. 날짜·사용자 절대 경로·실행시간은 넣지 않는다.
- `modelFitCount=0`, `scalerFitCount=0`, `validationPayloadRead=false`, `testFileRead=false`, `rawFileRead=false`, `dataExcludedByAudit=0`을 유지한다. status는 `input_target_audit_requires_review`, program gate는 `continue_experimenting`이다.

## 검증과 다음 gate

- 가상 5구간의 입력 그룹 2개/다중 정답 그룹 1개/경험적 일치 4/5를 손계산과 대조한다. 색상 무시·순서 결정성·입력 비변경·단일 입력·support 분모·NaN/잘못된 정답·중복 ID·split·output 경로 보호를 검사한다.
- 기본 셀 전체를 실제 data open/MLP fit/partial_fit/Scaler fit 차단 상태로 검증한다. 전체 모델 fit을 하지 않고 실제 입력 로딩의 SHA/코호트만 먼저 확인한다.
- `npm run verify:ml`, `bash scripts/verify.sh`, 문서 링크·fence·diff를 확인한다. 기존 사용자 실행본의 ML 형식 실패는 임의 수정/테스트 약화 없이 별도 보고한다.
- 승인된 실제 Full은 실행 오류·count·표/그림·입력 불변성과 JSON 결정성을 확인하고 결과를 해석한다. 결과를 보고 다음 반복 학습곡선/구조 비교를 자동 시작하지 않는다.
- 관측 시점·historical build/ruleset·geometry/합법성/도달 가능성·현재 40행 호환성·전체 Human controller는 미검증이다. 결과로 신규 수집을 요구하거나 Human 정답을 heuristic으로 교체하지 않는다.

## 실행·해석 기록 (2026-11-03)

- 내부/default guard와 읽기 전용 Train preflight를 통과했다. 기본 전체 셀은 실제 data open·MLP fit/partial_fit·StandardScaler fit 차단 상태에서 성공했다. Source15개 cell ID는 고유하고 output/count는 비어 있으며 Full=False다.
- 사용자 승인 Full2회는 오류0이며 JSON이 byte-identical이다. SHA `635045e9dde6d301e27463c06ac045545fb948068707e0c6981355d4eb1c0155`.
- 로컬 ignored 산출물: `data/ml-experiments/human-placement-input-target-audit/full-report-run1.json`, `full-report-run2.json`, `executed-full-run1.ipynb`, `executed-full-run2.ipynb`, `executed-analysis.ipynb`. Agg로 실행한 두 Full 실행본에는 인라인 그림이 없어, 기존 report만 읽는 analysis 실행본에서 표/그림2개를 확인했다. 이 후속 읽기는 재집계/재학습을 하지 않는다.
- Train149게임/6417구간/2133종. 사례1개 class718종,2개 class523종으로 합1241종(58.18%)이다. 해당 구간은1764개(27.49%). 한 게임에만 등장한 class는724종이다.
- 입력 그룹6160개 중 반복65그룹/322구간이다.6095구간(94.98%)은 그 입력이 표본에서 한 번뿐이다. 다중 정답은36입력 그룹/246구간/143게임이며36그룹 모두 여러 게임에 걸친다.
- 입력별 최빈 정답 합은6341/6417(98.82%), 최소 관측 불일치는76개(1.18%)다. 반복 입력만 보면246/322(76.40%)가 최빈 정답에 일치한다. 이 값은 실제 신경망 정확도/미래 상한이 아니다. 단발 입력이 많아 높은 전체 경험적 일치 한계를 정보 충분성의 근거로 쓸 수 없다.
- 저장된 보드/셀 형식 검증6417개 통과·정답 셀 점유 겹침0이다. 관측 시점이나 당시 규칙을 증명하지는 않는다. 가장 큰 다중 정답 예시3개는 빈 보드의 zee/tree/bar이며 각각28/27/23구간이다. 초기 빈 보드에서의 자연스러운 다른 선택과 기록 문제를 혼동하지 않는다.
- 기존 source Notebook 전체·dataset 네 파일·지난 학습곡선 report의 byte SHA는 전후 불변이다. Validation/Test payload/raw/DB·모델/Scaler fit·데이터 수정/제외·runtime·Git mutation은0이다.
- 위 payload 미사용은 내용 파싱/학습/진단을 하지 않았다는 뜻이다. 외부 실행 검증은 snapshot 네 파일의 불변성을 확인하려고 Validation/rejected 파일도 byte checksum으로 읽었다. Notebook의 Train-only 집계에는 넣지 않았고 Test/raw는 열지 않았다.
- `bash scripts/verify.sh`:793 pass·기존1 skip. `npm run verify:ml`:Node35 pass·Python213/220(기존 사용자 실행본5 fail·2 error)로 전체 ML gate는 보류다. Jupyter와 Node localhost listen의 sandbox EPERM은 권한 재실행 통과로 구분한다. 사용자 Notebook과 기존 테스트를 정리/약화하지 않았다.
- 해석: 관측 동일 입력의 다중 정답만으로 낮은 Validation 성능을 설명할 근거는 부족하고 입력/배치 희소성이 뚜렷하다. 신규 자료 없이 데이터 부족과 구조의 기여를 완전히 분리할 수는 없다. 다음 반복 학습곡선/구조 비교는 별도 선택·명세 뒤 진행한다.
