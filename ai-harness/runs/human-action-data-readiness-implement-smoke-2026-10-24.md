# Human action data readiness — implement-smoke

- Date: 2026-10-24 (Asia/Seoul)
- Worktree: 현재 로컬 Tetris_multi 저장소, branch `main`
- 기준 HEAD: `bbf26b72554907017765338c331416f32debc80a`
- MODE: `implement-smoke`
- [명세](../ml-experiments/experiments/human-action-data-readiness.md)
- 시작 시 사용자 dirty/untracked 파일 39개를 fingerprint로 기록해 보존했다.
  신규 Notebook·테스트와 명세·이 실행 기록을 작성하고 상위 AGENTS의 이력 규칙에
  따라 PLAN/change-log에 이번 작업 기록만 추가했다. stage/commit/push는 하지 않았다.

## 구현과 경계

Notebook의 정의 셀을 synthetic 테스트와 source 감사가 공유한다. DB/app 파싱,
identity 충돌 전체 격리, 시간·순번·piece 경계, hold 문맥 미확인, canonical report와
exclusive publication을 구현했다. Source 전체 scan은 hash와 작은 metadata만 보관하고
상세 보드·입력은 전체 메모리에 모으지 않는다. 과거 규칙은 unspecified로 보존한다.
학습·dataset 생성·Node replay·운영 DB·수집 정책·runtime은 변경하지 않았다.

## 입력과 smoke 결과

- Source: `data/datasets/tetris-ml-snapshots-backup-0908/raw/game-events.jsonl`
- Bytes: 650,669,388; lines: 122,095
- Source SHA-256: `eb64f86731ecb148ebf398773cb8e23cdf71217fc44f3bcb88460299bb092344`
- Metadata scan: unique placement 121,619; Human 10,816; heuristic 110,803.
  JSON failure·event invalid·exact duplicate·identity conflict는 모두 0건이다.
- 상세 smoke: 4게임 / Human 184구간 / 입력 1,514건. 전체 Human 상세 감사는 미실행이다.
- 기록 간격: usable 182, limited 2. 간격 1,330개·0ms 11개, median 158ms·p95 370ms.
  첫 반응시간이나 물리 키 입력 시간으로 해석하지 않는다.
- Hold 시도 21건 모두 성공 미확인. next_action_with_state·hold_decision은
  각 184구간 모두 unverified. replayStatus=unverified, modelFitCount=0.
- 실행 전후 source SHA 일치. 두 report는 byte-identical이다.

## 재현 명령과 증거

```bash
IPYTHONDIR=/private/tmp/human-action-ipython-20261024 \
HUMAN_ACTION_RUN_MODE=smoke \
HUMAN_ACTION_REPORT=/private/tmp/human-action-readiness-20261024-smoke-run1.json \
conda run -n tetris-ml jupyter nbconvert --to notebook --execute \
  scripts/ml/notebooks/human_action_data_readiness.ipynb \
  --ExecutePreprocessor.timeout=600 \
  --output /private/tmp/human-action-readiness-20261024-smoke-executed-run1.ipynb
```

Run2는 report와 executed의 run1을 run2로 바꿨다. 기존 report는 덮어쓰지 않으므로
재현 시 새 파일명을 지정한다. Smoke 증거는 임시 산출물이며 유일한 장기 원본이 아니다.

- Reports: `/private/tmp/human-action-readiness-20261024-smoke-run1.json`, `run2.json` (동일 prefix)
- Report SHA-256: `257b4371eb23d35a0aa94b389829c30ed34502c28d6ba4704f125ea7ccb6ec26`
- Source Notebook SHA-256: `ad8bafc396d687b7aa4bcf66ab32eca9c994e9c009d7375109fd3fde8abe5533`
- Executed Notebook: 같은 prefix의 `executed-run1.ipynb`, `executed-run2.ipynb`. error output 각 0.
- Node 24.18.0, conda tetris-ml Python 3.12.13, nbconvert 7.17.1, nbformat 5.10.4.
  새 dependency나 환경 변경은 없다.

## 검증과 보완

- Synthetic·Notebook 테스트: 16/16. malformed/0ms/역전/누락·hold·중복/충돌·mixed
  ruleset·piece gap·출력 alias/symlink/hardlink·source mutation·작은 full fixture를 검사했다.
- `npm run verify:ml`: Node 35 / Python 131 통과.
- `bash scripts/verify.sh`: type/build/artifact 통과, compiled Node 781 pass·기존 1 skip·0 fail.
- 처음에는 conda에 이름 tetris-ml인 kernelspec이 없어 python3로 맞췄다. 실제 DB의
  identity_version은 정수가 아닌 identity-v1임을 확인해 parser와 synthetic fixture를 수정했다.
- sandbox에서는 Jupyter·HTTP 테스트의 localhost bind가 EPERM으로 차단됐다.
  허용된 실행에서 smoke와 필수 verify를 다시 수행해 통과했다. 코드 실패와 구분한다.
- Source Notebook output/execution count는 비었고 고정 cell ID는 중복되지 않는다.

## 다음 gate

상태: `data_readiness_smoke_valid`. 사용자 full 감사 명령은 명세에 있다.
Full 결과로 과제별 dataset 범위·필요한 새 기록을 판단한다. 현재 smoke는 모델 채택,
사이트 통합 또는 전체 Human 데이터의 적합성을 증명하지 않는다.
