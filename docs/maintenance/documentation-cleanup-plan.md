# 프로젝트 문서 정리 계획

- 작성일: 2026-10-15
- 상태: 계획 작성. 아래 정리 작업은 아직 실행하지 않았다.
- 목적: 처음 보는 사람은 프로젝트와 근거를 빠르게 이해하고, 개발자는 현재 계약·운영 절차·다음 작업을 찾을 수 있게 한다.
- 원칙: 기존 주제별 폴더를 유지하고, 사실 오류와 잘못된 참조를 먼저 고친다. 분량이나 AI 도구 사용 흔적만으로 문서를 삭제하지 않는다.

## 1. 적용 기준과 이번 작업 범위

하네스 정리가 반영된 로컬 `main`의 `0590fee`를 공통 문서 정리의 기준으로 삼는다. 당시 `main`은 추적 중인 Markdown 문서 117개를 포함한다. 실제 실행 시 HEAD와 사용자 변경은 다시 확인한다.

조사 시작 때의 checkout은 `codex/next-preview-four`였고 계획 작성 마무리 시점에는 `main`으로 전환된 상태를 확인했다. Feature 브랜치에는 디자인·성능 기록과 데이터 정제 대화 요약이 추가되어 있지만, `main`의 하네스 정리 커밋은 포함되어 있지 않다. 두 브랜치의 문서·구현 상태를 섞어 현재 상태로 설명하지 않는다.

- `main`에서 완료한 migration archive 이동과 활성 하네스 축소는 재실행하지 않는다.
- 공통 문서는 해당 변경이 있는 기준에서 정리한다. feature 브랜치에만 있는 문서는 아래 조건부 단계로 남긴다. 이를 위해 기능 브랜치를 자동 merge하거나 문서만 복사하지 않는다.
- 사용자가 옮긴 `docs/learning/QnA.md`는 기존 변경이다. 현재 `main`에는 루트 `QnA.md`도 추적되어 있으며 두 파일의 내용이 같지 않다. 실행 시 차이를 비교해 고유 내용을 보존하고 학습 경로로 정리한다. 어느 한쪽을 다른 브랜치의 이전 Q&A로 덮어쓰지 않는다.
- 이번 요청에서는 이 계획 파일 하나만 작성한다. 실제 이동·통합·삭제·테스트 수정·커밋·push는 수행하지 않는다.

실행 범위는 문서의 역할 정리, 현재 사실 보정, 탐색 링크 정리와 이동에 직접 연결된 참조 복구다. 이미 잘못된 문서 경로를 읽는 Python 테스트 두 곳은 최소 경로 수정 대상으로 명시한다. 게임 로직·ML 계산·Notebook·데이터·모델·배포 동작은 범위 밖이다.

## 2. 확인한 문제와 우선순위

| 우선순위 | 확인한 근거 | 정리 방향 |
| --- | --- | --- |
| P0 | Python 문서 계약 테스트 두 개가 존재하지 않는 옛 `docs/*.md` 경로를 읽는다. 실제 문서는 `docs/ai-ml/experiments/`에 있다. `main`과 feature 브랜치 모두 같은 참조를 사용한다. | 현재 경로로 연결하고 관련 계약 검사를 수행한다. 이 계획 단계에서는 테스트를 실행하지 않았으므로 실패 실행 결과로 표현하지 않는다. |
| P0 | `docs/ai-ml/README.md`의 AI/ML archive와 ML harness 안내 링크가 모두 자신의 `README.md`를 가리킨다. | 파일 존재 여부뿐 아니라 링크 제목과 목적지가 일치하는지 확인한다. |
| P0 | 포트폴리오 문서는 production DB 활성화·운영 import를 수행하지 않았다고 적지만, PLAN과 운영 기록에는 2026-07-24 배포·import 결과가 있다. | 확인 시점과 근거를 붙여 모순을 해소한다. 현재 운영 환경을 새로 검증한 것처럼 쓰지 않는다. |
| P0 | README의 수동 배포·배포 자동화 미구현 설명과 달리 `deploy-production.yml`에는 수동 호출 방식의 배포 workflow가 있다. | 초기 수동 배포, 현재 구현된 workflow, 실제 배포 성공 증거, 미구현 무중단 배포를 구분한다. |
| P1 | `main`의 PLAN은 1,143줄이며 현재 계획·상세 아키텍처·완료된 migration gate가 함께 있다. AI 계획은 1,669줄, 실험 로그는 1,888줄이다. | 현재 판단과 다음 작업을 앞에 두고 상세 계약·과거 근거는 담당 문서로 연결한다. 줄 수 자체를 삭제 목표로 삼지 않는다. |
| P1 | 코드 정리 계획은 2026-07-19 완료로 기록되어 있지만 실행 프롬프트가 활성 maintenance 폴더에 남아 있다. | 계획과 실행 프롬프트를 함께 보관하고 재실행 지침에서 제외한다. |
| P1 | 멀티 회귀 체크리스트에 옛 Input Relay 표현, JSONL만 전제한 확인 절차와 과거 수동 결과가 섞여 있다. | 현재 authoritative snapshot·저장 모드 기준의 절차와 과거 결과를 구분한다. |
| P2 | 포트폴리오 상세 문서는 1,924줄이고 `[직접 작성]` 항목이 남아 있다. | 프로젝트 소개·중요한 결정·근거·한계를 중심으로 편집한다. 담당 역할 등 사용자 사실은 임의로 채우지 않는다. |

`main`의 일반 Markdown 파일 링크를 정적으로 확인했을 때 QnA와 change-log에서 feature 브랜치 전용 문서 두 개를 가리키는 링크가 각각 발견됐다. 이는 정리 전부터 존재하는 불일치다. 상대 파일 링크 일부를 검사한 결과이며 앵커·외부 URL·링크 의미까지 모두 검증한 결과는 아니다.

## 3. 문서별 처리 방침

### 계속 유지하고 역할을 좁힐 문서

| 파일·영역 | 판단 | 남길 역할과 수정 범위 |
| --- | --- | --- |
| `README.md` | 유지·보정 | 소개, 실행 방법, 대표 설계와 검증 근거, 한계, 상세 문서 입구. 날짜 없는 “최신 CI 통과”와 낡은 배포 상태를 보정한다. |
| `PLAN.md` | 유지·축소 | 현재 구현 범위, 진행 중인 작업, 다음 우선순위, 보류 이유와 관련 링크. 상세 엔진 설명·운영 명령·완료된 gate 본문을 중복 소유하지 않는다. |
| `AGENTS.md`, `ai-harness/` | 유지 | `main`의 정리 결과를 사용한다. 에이전트 작업 지침으로 유지하고 포트폴리오 소개 문서와 역할을 구분한다. 경로 이동으로 필요한 링크만 보정한다. |
| `change-log.md` | 현 위치 유지 | 날짜별 개발 이력. 대화체·긴 과거 설명을 이번에 전부 다시 쓰지 않는다. 앞으로의 새 항목은 결과·이유·검증·관련 문서 위주로 적는다. |
| `docs/architecture/current-project-architecture-report.md` | 유지·통합 | 현재 계층, 상태 소유권, 서버 권위·보정·동시성 제어, React/Canvas 경계와 선택 이유. PLAN에만 있는 유효한 설명을 흡수한다. |
| `tetris-flow.md` | 이동·유지 | `docs/architecture/tetris-flow.md`로 이동한다. 아키텍처 개요와 다른 함수 호출·상태 전이 설명을 보존하고 실제 코드와 맞지 않는 부분만 고친다. |
| `docs/quality/troubleshooting.md` | 유지·정리 | 문제→원인→수정→검증 근거를 찾는 문서. 날짜별 목차를 보강하고 운영 상세 사례는 기존 history 문서로 연결한다. |
| `docs/quality/multiplayer-regression-checklist.md` | 유지·갱신 | 현재 수동 회귀 절차. 내 보드 예측과 상대 보드 snapshot, 재접속, PVP/PVE와 저장 모드 차이를 반영한다. 기존 2026-06-30 결과는 과거 결과로 유지한다. |
| `docs/operations/deployment/oci-single-vm-deployment.md` | 유지 | VM·네트워크·인증서·DB의 최초 준비 절차. 반복 운영 작업은 production runbook으로 연결한다. |
| `docs/operations/deployment/postgres-production-runbook.md` | 유지·보정 | 일상 점검, backup/restore, 배포, 장애와 rollback. 자동 workflow와 수동 절차의 역할을 명시한다. 분량을 이유로 복구 절차를 제거하지 않는다. |
| `docs/operations/database/database-event-storage-blueprint.md` | 유지 | Canonical event, identity, 멱등성, 신뢰 경계와 저장소 설계. 현재 계약과 도입 당시 결정 과정을 구분한다. |
| `docs/operations/history/**` | 현 위치 보존 | 실제 배포·장애·명령 해설의 증거. 이미 history 역할이므로 archive로 또 옮기지 않는다. 현재 실행 명령은 runbook으로 안내한다. |
| `docs/ai-ml/contracts/placement-ml-evaluation-contract.md` | 유지 | dataset·feature·평가 계약의 기준. 설명을 줄이기 위해 계약·누수 방지 조건을 삭제하지 않는다. |
| `docs/ai-ml/strategy/game-log-dataset-policy.md` | 유지·보정 | 로그 포함·제외와 dataset 정책. 초기 개발 우선순위를 현재 상태로 읽게 하는 서두를 갱신한다. |
| `docs/ai-ml/strategy/heuristic-ai-design.md` | 유지·보정 | 휴리스틱 후보 생성·평가·입력 실행 경계. 구현된 API와 예전 제안 API를 구분한다. |
| `docs/ai-ml/strategy/ai-plan.md` | 유지·축소 | 현재 모델 정책, 진행 중인 실험·정제 계획과 다음 판단. 완료된 실험의 수치·명령·긴 연대기는 기존 실험 로그로 연결한다. |
| `docs/ai-ml/strategy/new-log-cleaning-training-plan.md` | 활성 계획 유지 | 아직 실행하지 않은 정제·학습 범위와 판단 조건. 오래됐다는 이유로 완료·폐기 처리하지 않는다. |
| `docs/ai-ml/experiments/**` | 현 위치 유지 | 실험 설명·재현 명령·결과 JSON·평가 근거. 같은 수치를 현재 계획 여러 곳에 반복하지 않는다. |
| `docs/ai-ml/README.md` | 유지·보정 | AI 문서 입구. 잘못된 자기 링크와 dev-only/사용자 선택형 runtime 설명의 불일치를 고친다. |
| `docs/portfolio/portfolio-project-document.md` | 유지·편집 | 제출용 설명: 문제, 본인의 기여, 핵심 결정, 검증 근거와 한계. 기술 세부사항은 architecture·quality·운영·실험 문서로 연결한다. |
| `docs/learning/QnA.md` | 사용자 이동 보존 | 개인 학습 기록. 질문의 기초 수준을 이유로 삭제하지 않는다. 이동 후 상대 링크만 필요한 범위에서 보정한다. |
| 기존 `docs/archive/**` | 보존 | 과거 계획·명세·검증 근거. 현재 코드와 달라졌다고 당시 결과를 다시 쓰지 않는다. |

새 공통 문서는 `docs/README.md` 하나를 추가한다. README에서 이 문서로 들어가 아키텍처·실행/검증·운영·AI·학습·과거 기록을 고를 수 있게 한다. 카테고리마다 별도 README나 범용 ADR 양식을 일괄 생성하지 않는다.

### 현재 작업에서 떼어 내 보관할 문서

| 원래 위치 | 예정 위치 | 이유와 보존 조건 |
| --- | --- | --- |
| `docs/maintenance/codebase-cleanup-plan.md` | `docs/archive/maintenance/codebase-cleanup-plan.md` | 완료일·검증 결과·보류 항목을 함께 보존한다. |
| `docs/maintenance/codebase-cleanup-goal-prompt.md` | `docs/archive/maintenance/codebase-cleanup-goal-prompt.md` | 종료된 작업의 실행문이다. 과거 템플릿 안내를 붙이고 새 작업에서 실행하지 않는다. |
| `docs/maintenance/harness-improvement-plan.md` (`main`) | `docs/archive/maintenance/harness-improvement-plan.md` | 완료된 하네스 정리의 근거다. PLAN·change-log의 링크도 함께 갱신한다. |
| `docs/superpowers/plans/2026-06-05-multiplayer-nickname-entry.md` | `docs/archive/plans/2026-06-05-multiplayer-nickname-entry.md` | 옛 Vanilla 구현·세션 설계를 전제로 한 계획이다. 현재 로그인/닉네임 흐름과 이력을 대조해 대체된 계획으로 표시한다. 빈 체크박스를 임의로 완료 표시하지 않는다. |

보관 폴더 안의 원래 본문은 유지하고 보관 안내·탐색 링크만 필요한 만큼 수정한다. 과거 명령 속 경로·커밋·날짜·실행 결과는 당시 값으로 남긴다. 이동 전후 파일 수와 내용을 비교한다.

### Feature 브랜치에만 있는 문서

아래 문서의 정리는 해당 코드와 문서를 함께 다루는 시점에 적용한다. `main`에 문서만 끌어와 구현 완료로 표시하지 않는다.

| 파일 | 예정 처리 |
| --- | --- |
| `docs/design/charcoal-gold-design-plan.md` | 디자인 계약과 남은 수동 검증이 있어 활성 상태로 유지한다. 최종 검증 전에는 archive로 옮기지 않는다. |
| `docs/design/real-device-performance-guide.md` | 반복 가능한 검증 절차이므로 `docs/quality/real-device-performance-guide.md`로 옮기고 디자인 계획에서 연결한다. |
| `docs/design/performance-trace-2026-10-13.md` | 측정 기록이므로 `docs/quality/history/performance-trace-2026-10-13.md`로 옮긴다. |
| `docs/design/input-memory-measurement-2026-10-14.md` | `docs/quality/history/input-memory-measurement-2026-10-14.md`로 옮긴다. 입력 측정의 한계와 남은 확인을 보존한다. |
| `docs/design/multiplayer-memory-offline-2026-10-14.md` | `docs/quality/history/multiplayer-memory-offline-2026-10-14.md`로 옮긴다. 테스트 통과와 실제 기기 관찰을 구분한다. |
| `docs/ai-ml/strategy/data-cleaning-training-conversation-summary.md` | 미결정 조건·사용자 요구가 계획에 모두 반영됐는지 먼저 대조한다. 고유 정보는 계획에 반영하고 원문은 `docs/learning/data-cleaning-training-conversation-summary.md`로 옮긴다. |

성능 기록의 남은 검증 항목은 디자인 계획에서 계속 추적한다. history로 옮기는 행위 자체가 검증 완료를 뜻하지 않는다.

### 삭제하거나 새로 만들 필요가 없는 것

- 현재 조사로 확정한 영구 삭제 대상 문서는 없다. “현재 실행에 불필요”와 “기록 가치가 없음”을 구분한다.
- 통합 후 중복된 본문은 줄일 수 있지만, 고유한 설계 이유·실패 사례·검증 근거가 옮겨졌는지 먼저 확인한다. 기존 Git 이력을 활용하고 모든 원본의 복사본을 또 만들지 않는다.
- `docs/portfolio/velog-project-retrospective.md`, `velog-research-notes.md`는 현재 로컬에 있으며 ignore 대상이다. 공개 저장소 정리 범위에 자동 포함하거나 삭제하지 않는다.
- `.gitignore`의 `docs/portfolio/*` 규칙에도 `portfolio-project-document.md`는 이미 추적 중이다. ignore만으로 비공개가 되는 것은 아니다. 기존 파일 편집에 ignore 규칙 변경은 필요하지 않다.
- 별도 `legacy/` 최상위 폴더, 문서 사이트, 훅, 새로운 문서 빌드 도구, 중복된 전체 로드맵은 추가하지 않는다.
- Git 이력 삭제, AI 사용 흔적 은폐, 개인 위키로의 업로드는 이번 범위에 포함하지 않는다.

## 4. 실제 실행 순서

### 1단계 — 기준과 참조 복구

1. 실행할 checkout의 branch·HEAD·dirty 상태와 기존 사용자 파일을 기록한다. `main` 기준과 feature 전용 범위를 확인한다.
2. 문서 목록을 tracked·사용자 이동·ignored 초안으로 구분하고 이동 예정 파일의 원본을 비교할 기준을 확보한다.
3. AI README의 archive 링크를 `../archive/ai-ml/README.md`, harness 링크를 `../../ai-harness/ml-experiments/README.md`로 수정한다.
4. 아래 Python 테스트의 문서 경로만 실제 위치로 수정한다. 문서 내용을 검사하는 assertion은 그대로 유지한다.
5. `main`에서 feature 문서를 가리키는 기존 링크는 해당 문서가 존재하는 검증된 커밋의 GitHub 링크로 연결하거나 브랜치 전용 기록임을 명시한다. 없는 로컬 파일을 현재 문서로 연결하지 않는다.

| 소비자 | 이전 경로 | 사용할 경로 |
| --- | --- | --- |
| `scripts/ml/tests/test_placement_cell_equivalence_notebook.py` | `docs/placement-cell-equivalence-logo.md` | `docs/ai-ml/experiments/placement-cell-equivalence-logo.md` |
| `scripts/ml/tests/test_placement_pair_weight_decomposition_notebook.py` | `docs/placement-pair-weight-decomposition.md` | `docs/ai-ml/experiments/placement-pair-weight-decomposition.md` |

완료 기준: 문서 계약 테스트가 파일을 찾고 원래 검증을 통과한다. 링크 제목과 목적지가 일치한다. 다른 브랜치의 내용은 현재 구현으로 합쳐지지 않는다.

### 2단계 — 독자별 입구와 현재 사실 보정

1. `docs/README.md`에 짧은 문서 지도를 만든다. 첫 독자는 README→아키텍처→대표 문제 해결 기록으로, 운영자는 runbook으로, ML 작업자는 기존 AI README로 연결한다.
2. README와 포트폴리오의 DB·배포·검증 상태를 실제 코드와 날짜가 있는 기록에 맞춘다. 외부 서비스의 현재 상태를 추정하지 않는다.
3. 포트폴리오는 핵심 사례 3~4개를 문제·선택·검증·한계 형식으로 편집한다. 일반 용어 사전이나 전체 파일 목록은 기존 상세 문서로 연결한다.
4. 담당 역할·직접 수행 범위 등 기록만으로 확정할 수 없는 항목은 사용자 확인 필요 항목으로 남긴다. 도구 사용과 본인 판단을 과장하지 않는다.

완료 기준: 소개 문서에서 프로젝트 실행, 주요 기술 결정, 검증 근거, 현재 한계를 찾을 수 있다. 상세 문서를 읽지 않아도 구현과 계획의 차이가 드러난다.

### 3단계 — 완료된 계획 보관과 PLAN 축소

1. 위 보관 표에 따라 완료·대체된 계획을 이동하고 모든 유입 링크를 같은 변경에서 고친다.
2. PLAN의 상세 구조·입력/상태 설명은 architecture와 flow 문서에 통합한다. 고유 내용의 목적지를 확인한 뒤 중복 본문을 제거한다.
3. 완료된 migration gate는 기존 `docs/archive/migration/runs/` 기록과 비교한다. 이미 같은 근거가 있으면 링크로 대체하고, 고유한 결정·검증 근거만 적절한 역사 기록에 보존한다.
4. PLAN에 현재 구현 요약, 진행 중인 작업, 다음 우선순위, 보류 이유를 남긴다. 과거 통과 테스트 수를 현재 결과처럼 반복하지 않는다.
5. `tetris-flow.md` 이동과 루트·본문의 참조를 함께 수정한다. 기존 설명의 코드 경로·함수명을 확인한다.

완료 기준: PLAN을 읽고 현재 할 일과 완료된 일이 구분된다. 이전 계획과 검증 결과는 계속 찾을 수 있고 현재 실행 지침으로 오해되지 않는다.

### 4단계 — AI·운영·품질 문서의 중복 정리

1. AI 계획은 현재 정책과 판단을, 실험 로그는 과거 수치·명령·증거를 소유하게 한다. 계약 문서·실험 명세·결과 JSON의 경로와 내용은 보존한다.
2. OCI 최초 설치와 일상 운영의 중복 명령은 해당 책임 문서로 연결한다. 파괴적 명령의 금지, backup/restore, 권한·credential 분리, rollback 조건은 생략하지 않는다.
3. 멀티 수동 체크리스트를 현재 server authoritative 구조에 맞추고 기존 실행 결과와 빈 체크 항목을 구분한다.
4. Feature 문서의 조건이 충족되면 위 표의 성능 기록·대화 요약 정리를 수행한다. 남은 검증과 미결정 사항을 활성 계획에서 추적한다.
5. 링크·앵커·참조·보존 검증 후 실제 변경 결과만 change-log에 기록한다. 커밋은 실행 시 사용자의 지시 범위에 따른다.

완료 기준: 동일한 운영 명령이나 실험 수치가 여러 현재 문서에서 서로 다른 기준으로 관리되지 않는다. 과거 결과를 고치거나 새 성과를 만들어내지 않는다.

## 5. 검증과 완료 기준

문서 전용 변경:

- `git diff --check`, 신규 파일의 공백·코드 fence 짝·마지막 개행을 확인한다.
- 변경 파일과 유입 문서의 상대 링크, 제목 앵커, 이미지 경로를 검사한다. 존재하는 파일로 연결돼도 의미가 틀린 자기 링크는 별도로 확인한다.
- `rg`로 Markdown뿐 아니라 `src/`, `test/`, `scripts/ml/tests/`, `scripts/`, `.github/`, Notebook의 이전 경로 참조를 찾는다. 과거 명령의 문자열은 현재 참조와 구분한다.
- archive 이동은 본문 보존을 비교한다. 통합 문서는 고유 정보·검증 근거의 새 위치를 확인한다.
- Q&A·로컬 초안·모델·dataset·Notebook·runtime과 배포 설정이 의도치 않게 바뀌지 않았는지 확인한다.
- 외부 링크나 실제 운영 상태를 확인하지 않았다면 그 범위를 명시한다. 문서 편집만으로 새 CI·운영·성능 검증을 통과했다고 쓰지 않는다.

1단계에서 문서 계약 테스트 경로를 수정하는 경우:

```bash
conda run -n tetris-ml python -m unittest discover -s scripts/ml/tests -p 'test_placement_cell_equivalence_notebook.py'
conda run -n tetris-ml python -m unittest discover -s scripts/ml/tests -p 'test_placement_pair_weight_decomposition_notebook.py'
bash scripts/verify.sh
```

위 Python 검사는 Notebook을 실행하지 않고 문서·Notebook의 계약을 확인한다. 테스트를 수정하므로 저장소 규칙에 따라 `verify.sh`도 실행한다. 나머지 문서만 변경한 단계에는 전체 게임 테스트를 반복하지 않는다. 긴 ML 학습·full 평가·실제 OCI 배포는 이 정리의 검증에 필요하지 않다.

최종 확인:

- README와 문서 지도에서 실행·설계·운영·AI·과거 기록에 도달한다.
- 현재 설명, 미래 계획, 당시 확인 결과가 구분된다.
- 승인된 이동의 링크와 테스트 소비자가 함께 수정되어 있다.
- 고유한 설계 결정과 실패·검증 증거가 사라지지 않는다.
- 사용자 파일 이동과 브랜치별 구현 차이가 보존된다.
- 실패·미실행 검증, 사용자 확인이 필요한 포트폴리오 사실과 조건부 단계를 남김없이 보고한다.

되돌릴 때는 이동 파일과 그 유입 링크·테스트 경로를 같은 변경 단위로 되돌린다. 사용자 기존 변경이나 관계없는 기능 커밋을 함께 되돌리지 않는다.

## 6. 계획 작성 시 확인한 범위

문서 목록·제목·관련 본문, Git 추적/ignore 상태, `main`과 현재 브랜치 차이, 문서 경로를 직접 읽는 테스트, 검증 스크립트와 배포 workflow의 존재를 확인했다. 본 계획 작성 중 다른 문서를 수정하거나 테스트·ML 실험·운영 명령을 실행하지 않았다.

실제 정리 시에는 통합 대상 본문과 해당 코드·caller를 더 대조해야 한다. 특히 포트폴리오의 개인 기여, 새 배포의 실제 성공 여부, 디자인의 남은 수동 검증은 이번 저장소 조사만으로 확정하지 않는다.
