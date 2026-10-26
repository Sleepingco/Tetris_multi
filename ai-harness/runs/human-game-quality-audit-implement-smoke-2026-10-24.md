# Human game quality audit — implement-smoke

- Date: 2026-10-24 (Asia/Seoul)
- Branch: `main`; 기준 HEAD `fb61828b0e3678844fb9ea1c5c62c1d6fe639912`
- 시작 working tree: clean. [명세](../ml-experiments/experiments/human-game-quality-audit.md)
- 이번 변경: 신규 Notebook·테스트·명세, 기존 readiness 내부 index 한 필드,
  연결 문서와 PLAN/change-log. runtime·원본·모델·dependency는 변경하지 않았다.
- MODE: implement-smoke. Full 정책 검토·dataset 생성·fit·stage/commit/push는 미실행.

## 구현과 사용자가 읽는 순서

Notebook 20개 cell은 1~10단계의 질문→공통 코드→후보 기준→시간 의미→수집→
분류 근거→synthetic 예제→실행→분포 표→한계 순서다. parser/identity/IO는 기존
Notebook의 정의 셀을 로드한다. 기존 index의 allValidByLine은 compact metadata이며
원본 payload/보드를 보관하지 않는다. 별도 parser Python 파일을 만들지 않았다.
새 테스트는 정의 셀을 직접 실행하며 실험 구현을 복사하지 않는다.

검토 후보는 short 30초 / max 600초 / hard-drop tail 5조각 / AI tail 60초다.
adopted cutoff가 아니며 report의 모든 학습·모델 채택 eligibility는 false다.
AI tail은 마지막 Human 원본 행 뒤 AI 이벤트끼리의 관측 span이다. Human/AI의
서로 다른 시계를 빼거나 AI 단독 진행 버그를 확정하지 않는다.

## 실제 smoke와 증거

- Source: `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`
- Bytes 650,669,388 / lines 122,095 / source games 246.
- SHA-256: `eb64f86731ecb148ebf398773cb8e23cdf71217fc44f3bcb88460299bb092344`
- Source 전체 metadata와 선택된 4게임 상세 검사를 분리했다. Human 첫 3게임과
  Human 없는 첫 게임 1개다. 이전 readiness의 hold 추가 smoke와는 선택 규칙이 다르다.
- Human 139구간, include_candidate 3 / exclude_candidate 1 / review 0.
- 27.93초짜리 정상 Hard 경기를 길이만으로 제외하지 않았다. 제외 후보 한 게임은
  Human 0·AI 20,065배치이며 종료가 없어 duration=null과 미완결 사유를 유지했다.
- 포함은 확정 정상/학습 승인이라는 뜻이 아니다. fullCohortCovered=false,
  modelFitCount=0, datasetExported=false, policyStatus=provisional_review_only.

최종 실행 명령은 명세의 full 명령에서 mode=smoke로, report와 executed 경로를
아래 임시 경로로 바꾼 것이다. 두 실행의 공통 코드/후보 정책은 동일하다.

- Report run1/run2: `/private/tmp/human-game-quality-20261024-final-run1.json`, `final-run2.json` (동일 prefix)
- Report SHA-256: `60a4f4947545eb27783ad159e0ce7145a2493198cb92c5aa278a47c8f84882a5`
- Executed run1/run2: `/private/tmp/human-game-quality-20261024-final-executed-run1.ipynb`, `final-executed-run2.ipynb` (동일 prefix)
- Source Notebook SHA-256: `d19ef7508c2fd4f605172389048e02a7a4f9adc407f91016163c29e1f3eda8ce`
- Dependency Notebook SHA-256: `1ebd86a966f33be3cb13fd42d098a07b647a0a0ea33cadbbb3da2c2e5fd0d8f1`

Smoke 산출물은 개발 임시 증거다. 원본·기존 full report는 프로젝트 ignored 경로에
그대로 있으며 새 사용자 full은 명세대로 프로젝트 실험 디렉터리에 보관한다.

## 검증과 환경

- 새 unittest 17개 통과: PVE 패자·PVP 양쪽/alias, 짧은 정상/포기 의심 경계,
  piece 공백·다른 행동, 장시간 경계, lifecycle·DB 시각 누락, AI tail 시계 분리,
  AI-only, source 중복·충돌·파싱 실패, 정책/개인정보/결정성/경로·checksum 보호.
- 최초 경로 테스트는 macOS /var→/private/var realpath 차이로 실패해 기대 경로를
  resolve 기준으로 수정했다. 공통 경로 검증을 완화하지 않았다.
- 최종 verify:ml Node 35/Python 148 통과. 필수 verify Node 781 pass·기존 1 skip·0 fail.
- nbformat schema·cell ID/빈 source output·Markdown 링크/fence·git diff --check 확인.
- 실제 smoke 두 JSON은 byte-identical, 두 executed Notebook error 0.
- 기존 readiness 함수의 실제 smoke 결과를 재계산해 SHA `257b4371eb23d35a0aa94b389829c30ed34502c28d6ba4704f125ea7ccb6ec26` 유지 확인.
  원본·기존 full report는 덮어쓰지 않았다. 기존 full 감사도 재실행하지 않았다.
- Node 24.18.0, Python 3.12.13, nbformat 5.10.4, nbconvert 7.17.1, pandas 3.0.3.
  Jupyter/로컬 HTTP는 허용된 localhost 실행으로 검증했다. 새 패키지는 없다.

## 다음 gate

사용자가 명세의 full 명령을 실행한다. 원본 기준 게임 길이·마지막 하드드롭·AI tail의
사유/분포/정상 사례를 확인해 후보 정책을 채택 또는 수정한다. 품질 gate 후 Human
구간 수와 실제 pair 수는 아직 계산하지 않았다. 학습 dataset 명세·생성·모델 학습을
이번 작업에서 자동 시작하지 않는다.
