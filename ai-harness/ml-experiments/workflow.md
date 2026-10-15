# ML Experiment Workflow

## 공통 실행 규칙

[공통 계약](constraints.md)을 지키며 현재 MODE 절만 적용한다. 실험 명세와 현재 입력·환경이 맞는지 먼저 확인한다.
기존 사용자 승인 범위 안에서 진행하고, 문서의 MODE나 환경변수를 바꾸는 것만으로 권한이 추가됐다고 해석하지 않는다.
완료 보고에는 수행한 작업, 검증 결과, 미실행·실패·남은 위험을 구분한다. 다음 MODE·실험·재학습·runtime 통합은 자동 시작하지 않는다.

## 1. `implement-smoke`

1. Git branch, HEAD와 기존 dirty 상태를 기록한다.
2. 현재 실험 명세의 입력과 allowlist를 확인한다.
3. Existing exporter와 이전 실험 계약을 재사용할 수 있는지 확인한다.
4. 질문 하나를 설명하는 Notebook과 계약 테스트를 최소 범위로 구현한다.
5. 정적·targeted 검증을 실행한다.
6. Full과 같은 경로로 작은 smoke를 실행한다.
7. Smoke 결과가 성능 결론이 아님을 명시한다.
8. 실제 dataset 경로가 채워진 복사 가능한 full 명령 하나를 제공한다.
9. 변경과 남은 dirty 상태를 보고한다. 사용자 요청에 commit 권한이 포함된 경우에만 해당 범위로 수행한다.

## 2. `run-full`

1. 구현 보고와 smoke 통과를 확인한다.
2. Source, dataset, Notebook checksum을 기록한다.
3. 제공된 명령을 수정하지 않고 실행한다.
4. Full report와 executed Notebook을 `/private/tmp`에 생성한다.
5. Error, traceback, leakage, convergence와 source 불변성을 확인한다.
6. 사용자에게 report 경로·SHA-256과 검증·실패·미검증 결과를 보고한다.
7. 결과를 보고 parameter를 조정하거나 다음 실험을 시작하지 않는다.

## 3. `analyze-result`

1. Report가 `runMode: full`, `fullCohortCovered: true`, `policyDecisionEligible: true`, `canonicalResultEligible: false`인지 확인한다.
2. Dataset, feature, scaler, estimator와 비교 variant가 명세와 같은지 확인한다.
3. Leakage, convergence, finite score와 count invariant를 먼저 본다.
4. Primary metric, game 분포와 worst case를 해석한다.
5. 개선 원인을 설명할 수 있는지 확인한다.
6. 사전 정의한 정량 rule이 있으면 적용한다. 없다면 자동 채택하지 않고 기술 리드 판단이 필요한 상태와 근거를 보고한다.
7. Training pool 편입 여부의 판단 근거를 보고한다. 데이터 편입이나 재학습을 자동 수행하지 않는다.
8. 다음 질문 하나만 제안한다.

## 4. `freeze-audit`

다음 조건에서만 수행한다.

- Representation, feature, weight, scaler, estimator와 metric이 모두 잠겼다.
- 여러 cohort 또는 temporal holdout에서 결과가 안정적이다.
- Full run1/run2가 byte-identical이거나 허용된 수치 차이가 설명된다.
- 알려진 worst case와 한계가 기록됐다.
- 사용자가 freeze 판단을 요청했다.

Freeze 성공은 production 승인을 의미하지 않는다. Python artifact, Node parity와 gameplay benchmark는 별도 단계다.

## 반복 학습 주기

다음은 연구 흐름의 참고도다. 현재 MODE를 마쳤다고 다음 단계를 실행하는 지시가 아니다.

```text
누적 training cohort
→ 새 game cohort 수집
→ temporal holdout 평가
→ 정책 유지 여부 판단
→ 승인된 새 cohort를 training에 편입
→ 다음 새 cohort 수집
```
