# Human timing 0ms — 마지막 재현과 dataset 준비 복귀

## 범위와 종료 조건

- 사용자는 이번 재현 테스트를 마지막으로 하고 과거 원인을 찾지 못하면 AI dataset 준비로 돌아가도록 요청했다.
- Runtime·입력 코드·원본·dataset·split은 변경하지 않았다. 독립 Node test 4개와 기록만 추가한다.
- 이 테스트는 Python 모델 실험을 JS로 다시 구현한 것이 아니라 실제 로그 생성 원천인 client runtime을 호출하는 입력 기록 재현이다. Ponytail full에 따라 새 runner·dependency·계측 서비스는 만들지 않는다.

## 재현

[testInputTimingBatching.js](../../test/testInputTimingBatching.js)는 실제 createTetrisRuntime/attachKeyboardInput을 불러와 Audio·storage·document 경계와 wall/monotonic clock·interval callback만 통제한다. 임시 게임은 메모리 안에서만 만들고 서버·브라우저·운영 로그를 실행하지 않는다.

| 조건 | 관측·assert 결과 |
| --- | --- |
| 입력 1개를 1000ms에 enqueue, 1016ms에 소비 | 기록 1개, createdAt=1016, tick=1, sequence=1 |
| 1000/1001/1002/1003ms에 입력 4개 enqueue, 1016ms 한 tick에서 소비 | createdAt 모두 1016, tick 모두 1, sequence 1~4, 0ms pair 3개 |
| 같은 tick의 5번째 enqueue | null 반환. 4개 제한은 생성기가 아니라 수용 상한 |
| 서로 다른 tick에서 입력 4개 소비 | 기록 시각 1016/1096/1176/1256ms, 간격 80/80/80ms |
| listener 1개에서 keydown 1번 전달 | 큐/기록 1개, cleanup 후 listener 0개 |

고정 clock 실험은 timestamp가 enqueue가 아닌 소비 시점에서 샘플링됨을 검증한다. 실제 OS key repeat·브라우저 지연·과거 listener 개수·자동화 실행 이력을 재현한 것은 아니다.

실행 명령:

```bash
node --test test/testInputTimingBatching.js
```

Node 기준은 .nvmrc의 24.18.0이다. Targeted 4/4 통과.

## 검증 결과

- `bash scripts/verify.sh`: typecheck·build·artifact 검사와 Node 793 pass·기존 1 skip·0 fail 통과. HTTP 테스트의 localhost 사용이 가능한 허용 환경에서 실행했다.
- 변경 Markdown 상대 링크 129개·code fence와 `git diff --check`를 확인했다.
- 이번 변경은 Node 재현 테스트·문서뿐이므로 Python 감사/학습/Notebook과 `verify:ml`은 반복하지 않았다. 기존 사용자 Notebook output에 따른 ML source 형식 검사 문제를 임의로 수정하지 않았다.

## 종료 판단

- `recording_mechanism_reproduced_origin_unverified`.
- 여러 입력의 같은 tick 소비가 동일 ms 기록을 만드는 메커니즘은 확인했다.
- 과거 대상 게임의 방향 입력 4개 반복이 자동화·키 반복·중복 등록 중 어디서 왔는지는 특정하지 못했다. 2026-08-28 00:18경(KST) 원본과 당시 이전 Git의 같은 기록 코드는 단서이지 실행 build 연결 증거가 아니다.
- 사용자 stop condition에 따라 추가 원인 조사·새 계측·브라우저 재현을 자동 시작하지 않는다. 이 이슈를 dataset 준비의 무기한 blocker로 두지 않는다.
- 해당 게임의 자동화 여부를 확정하거나 test만 삭제/재분할하지 않는다. 0ms·긴 간격을 임의 보정하지 않는다.

## AI dataset 준비 복귀

- 기존 v1 full manifest SHA `c203a1db7b8f2aa7014c565b371088a9614f6abb0df5632e93fe6c807712fc88` 유지.
- 213게임, Human 10,516구간 → 9,283구간/61,190 pair. Hold 1,138·timing limited 95구간과 pair 3개 분리.
- Train/validation/test 149/31/33게임, 41,151/10,180/9,859 pair. 파일 SHA/bytes·표본 수·unique sampleId·인접 index·유한 비음수 label·game 누수 0을 재검증했다. 원본 SHA/bytes와 제외 파일도 불변이다.
- 의미는 **기록된 처리 시도 간격**이다. 키 누름·반응시간·개인 습관·hold·v3 전이의 증거가 아니다. 0ms 집중 현상은 알려진 label ambiguity로 보존한다.
- 다음 준비 gate는 기존 snapshot을 고정한 train-only timing baseline의 명세다. Train만 분포 계산에 사용하고 validation은 비교, test는 최종 평가로 보존한다. 이번에는 baseline fit·dataset 재생성·추가 게임 수집을 하지 않는다.
- 기존 source Notebook의 사용자 실행 output과 다른 dirty 변경은 그대로 보존한다. Commit/push/merge도 하지 않는다.
