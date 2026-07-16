# Goal 11B — Dependency Hardening

## 목적

Node와 ML dependency의 실제 취약점과 공급망 위험을 평가하고 호환 가능한 보안 업데이트를 적용한다.

## 선행조건

- Goal 11A의 main 반영
- npm lockfile과 Python/Conda environment의 재현 가능한 설치 확인
- advisory의 직접/전이 dependency와 실행 경로 조사

## 범위

- npm audit 및 공식 advisory 검토
- 직접 dependency와 중요한 전이 dependency 업데이트
- lockfile integrity와 install script 검토
- Python/Conda dependency 위험과 pinning 검토
- 잔여 advisory의 exploitability, 영향과 완화책 기록

## 제외 범위

- 취약점 수를 0으로 만들기 위한 무조건적인 major upgrade
- 기능 변경과 프레임워크 교체
- 근거 없는 audit ignore

## 완료 기준과 검증

- 적용한 업데이트마다 이유와 compatibility evidence가 있다.
- clean install, fast/full gate와 ML parity 검증이 통과한다.
- 남은 advisory는 severity, reachable 여부와 mitigation이 문서화된다.
- lockfile과 environment file이 일치한다.

## Rollback과 Merge Gate

dependency group별 revert가 가능해야 한다. breaking major가 필요하면 별도 Goal로 분리한다.

