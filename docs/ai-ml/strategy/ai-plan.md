# AI 현재 계획

정리일: 2026-10-24. 단계: **행동 모방용 게임 품질 기준 정리**, 수치 경계·dataset 생성·학습·새 runtime 통합 미실행.

프로젝트의 구현·운영 상태는 [PLAN.md](../../../PLAN.md), 실제 코드와 테스트를 따른다.
이 문서는 AI 작업의 목표·순서만 관리한다. 당시 수치와 실행 명령은
[실험 연대기](../../archive/ai-ml/README.md), 이전 제안은
[V4 역사본](../../archive/ai-ml/plans/placement-v4-roadmap.md)에 보존한다.

## 현재 기반과 목표

- 기존 V4는 125게임의 Human 배치 선택을 학습한 16-feature 선형 ranker다.
  gameplay 평가 결론은 `imitation_only_not_gameplay_ready`, 기본 정책은 heuristic이다.
- 현재 게임은 `buffer20-v1`의 40×10 보드와 v3 로그를 사용한다.
  기존 20행 V4는 새 규칙에서 `RULESET_INCOMPATIBLE` fallback을 사용한다.
  과거 20행 metric과 현재 규칙의 성능을 같은 결과로 제시하지 않는다.
- 새 목표는 Human의 입력 순서·간격과 hold 사용을 배워 사람이 조작하는 듯한
  실험적 PVE를 만드는 것이다. 개인화·프로 수준 공격·T-Spin 빌드업은 후속 가설이다.
- PVE는 Human만, PVP는 양쪽 Human을 승패와 무관하게 후보로 삼는다. 정상 플레이의
  실력·승패가 아니라 조기 포기·비정상 장시간·기록 오류를 게임 품질 gate로 구분한다.
  의심/판정 불가 게임은 첫 dataset에 넣지 않고 별도 목록으로 보존한다.
- 기존 로그는 재사용 후보지만 상태 복원·입력 결과·시간 의미를 검증해야 한다.
  v3 저장 성공만으로 행동 학습 적합성을 인정하지 않는다. 수집 rate limit 때문에
  placement가 누락될 수 있으므로 완전한 연속 기록이라고 가정하지 않는다.

## 작업 순서와 완료 기준

현재 1단계의 구조 감사는 완료했다. [full 결과 기록](../../../ai-harness/runs/human-action-data-readiness-analyze-result-2026-10-24.md):
235게임·10,816구간·입력 88,845건이며 기록 간격 usable 10,645 / limited 171이다.
상태 조건부 행동과 hold는 각 10,816구간 모두 unverified이므로 2단계 전체 dataset
생성으로 바로 넘어가지 않는다. 후속 코드 조사에서 createdAt은 키 입력 시각이 아닌
**브라우저 runtime의 처리 시도 직전 시각**임을 확인했다. Git 이력의 기록 함수 38개
버전도 같지만 경기별 실행 빌드 연결은 미확인이다. [timing-only 범위](../contracts/human-action-dataset.md#첫-timing-only-dataset의-제한된-범위)에 따라
다음 작업은 **게임 품질 감사와 인접 입력 간격 dataset의 실험 명세 작성**이다.
게임 길이 분포·종료 직전 하드드롭 연속·AI 단독 진행 의심을 먼저 확인해 수치 경계를
학습 전에 고정한다. [품질 계약](../contracts/human-action-dataset.md#1단계-게임-품질-gate)을 따른다.
9,485구간은 게임 품질 gate 전의 hold 없는 후보 수이지 확정 학습 대상이 아니다.
품질 gate 후 구간/pair 수·split·분포 baseline을 명세에서 고정한다.
실제 반응시간·성공 입력 간격·상태 조건부 controller 학습으로 의미를 확대하지 않는다.

현재 데이터는 전부 legacy 20×10이며 현재 v3/40행은 이 full 감사 대상이 아니다.
새 게임 수집은 검증되지 않은 필드를 자동으로 보완하지 않는다. 상태·hold 학습은
replay/추가 기록 증거가 확보될 때 별도로 진행한다.

| 단계 | 질문·산출물 | 다음 단계 조건 |
| --- | --- | --- |
| 1. 데이터 적합성 | [첫 명세](../../../ai-harness/ml-experiments/experiments/human-action-data-readiness.md), 입력/시간/hold 복원 감사 Notebook | 검증 가능한 구간·없는 정보·제외 수를 설명 |
| 2. 행동 dataset | [설계 계약](../contracts/human-action-dataset.md), versioned manifest와 분할 | game split 누수 0, raw 불변, replay 가능 범위 확인 |
| 3. 조작 간격 | 고정 배치·경로에서 고정 간격/행동별 시간 분포/작은 지도학습 비교 | 평균 속도를 맞춘 비교와 실행·체감 개선 확인 |
| 4. 조작 순서 | 관측 상태·목표 조건부 다음 행동 예측 | 로그 외 자체 실행 상태에서도 유효한 조작·목표 도달 확인 |
| 5. Hold | 사용/미사용 예측과 교체 후 재계획 | 직전 상태 복원, 사용 제한·빈 hold·spawn 충돌 검증 |
| 6. 모델 확정 | 독립 test, artifact/feature/ruleset 버전·checksum, Python 최종 trainer | 사전 기준과 재현성 통과. 미달이면 보류 |
| 7. 사이트 체험 | 별도 통합 계획, TypeScript 추론·서버 실행·opt-in UI | 수치 parity, 유한 대기·행동 수, fallback·PVE 회귀 통과 |

Hold 기록의 복원은 1단계부터 조사하지만 hold 정책 학습은 별도 실험으로 한다.
Hold는 조각과 queue를 바꾸므로 기존 목표 경로에 끼워 넣지 않고 실제 교체 뒤
현재 상태에서 목표와 경로를 다시 계산한다. 타이밍만 학습하는 단계에서는
지원하지 않는 hold 구간을 명시적으로 분리한다.

## 학습·평가 방침

- 실험은 Python Notebook과 작은 worked example로 작성한다. 확정 후 최종 trainer를 `.py`로 분리한다.
- 첫 후보는 작은 지도학습 모델이다. 단순 시간 분포와 선형 baseline을 먼저 측정하고,
  트리·시퀀스 모델은 설명되는 한계가 있을 때만 비교한다. 모델 종류는 아직 채택하지 않았다.
- 전처리는 train만 사용한다. game 단위 split을 기본으로 하고 시간순·사용자별
  일반화 범위를 명시한다. test를 보고 모델·threshold를 선택하지 않는다.
- 행동별 precision/recall·macro F1, 간격 오차, 목표 도달·막힌 행동 반복·fallback,
  처리 시간과 게임 안정성을 구분한다. Hold는 항상 미사용 baseline과 비교한다.
- 사람다운 체감은 모델명을 가린 동일 조건 영상으로 확인한다. 느려진 효과와
  학습 효과를 구분한다. 정량 기준은 baseline 측정 뒤 후보 결과를 보기 전에 고정한다.
- [공통 하네스](../../../ai-harness/ml-experiments/README.md)에 따라 smoke와 full을 분리한다.
  문서 작성 자체는 실험·full 실행·배포 승인이 아니다.

## 사이트 적용 시 설계할 경계

기존 authoritative 입력 경로를 사용한다. 모델은 board를 직접 수정하지 않는다.
대기는 다음 실행 시각으로 관리하고 ticker를 차단하지 않는다. 상태가 변했거나
hold·spawn이 발생하면 낡은 계획을 폐기한다. 실패하면 현재 상태에서 heuristic
또는 기존 실행 경로로 돌아가며 실제 policy와 fallback을 관측할 수 있게 한다.

별도 평가·통합 계약은 해당 단계에서 작성한다. artifact의 지원 ruleset, 모델 로딩,
추론 예산, Python/TypeScript parity, 로그 source 분리, 서버 재시작·다중 room·재접속,
UI의 실험 표시와 rollback을 포함한다. 배치 판단이 heuristic이면 그 사실을 설명한다.
자동 온라인 학습은 도입하지 않는다.

## 현재 참고 문서의 상태

| 문서 | 상태 |
| --- | --- |
| [AI 문서 안내](../README.md) | 현재 진입점 |
| [로그·dataset 정책](game-log-dataset-policy.md) | v3 저장과 legacy placement의 경계 |
| [V4 신규 로그 재학습안](new-log-cleaning-training-plan.md) | 보류 제안. 실행 완료 이력 아님 |
| [이전 대화 요약](data-cleaning-training-conversation-summary.md) | 조사 배경. 실행 지침 아님 |
| [과거 실험 순서](../../archive/ai-ml/README.md) | 완료·보류를 구분한 읽기 목차 |
