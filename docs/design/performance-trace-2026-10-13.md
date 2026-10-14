# Chrome 실기기 트레이스 분석 — 2026-10-13

## 측정 자료와 결론

- 입력: `/Users/parkseongho/Downloads/Trace-20261013T143713.json` (약 188 MiB).
- 녹화 시작: 2026-10-13 14:37:13 KST.
- 분석 대상: `localhost:5500` 멀티플레이 페이지의 renderer process 13088, main thread 2325569, layer tree 6.
- `TracingStartedInBrowser`부터 renderer의 마지막 이벤트 종료까지 약 87.62초. 이벤트 전체 범위에는 녹화 시작 이전 브라우저 이벤트도 들어 있어 약 89.07초다.
- 녹화 중 이벤트 효과가 실제 실행됐다. `achievement-pop` 시작 16건과 보드 강조·공격 대기 숫자 애니메이션 등이 포함된다.

이 녹화의 브라우저 표시 주기는 대체로 60Hz이며, 반복되는 긴 메인 스레드 작업은 확인되지 않았다. 소수의 누락·부분 갱신 표시는 있으나 현재 효과가 심한 끊김을 만들었다고 결론 내릴 근거는 없다. 이 결과는 해당 기기와 한 번의 녹화에 한정한다.

## 프레임

| 항목 | 결과 | 해석 |
| --- | ---: | --- |
| `BeginFrame` | 5,261회 | 기록된 화면 갱신 기회 |
| `DrawFrame` | 5,253회 | 합성기의 그리기 이벤트 수 |
| `DroppedFrame` | 8회, 약 0.15% | 부분 갱신 표시 4회를 포함한 원시 이벤트 집계 |
| 부분 갱신 없는 누락 표시 | 4회, 약 0.076% | `hasPartialUpdate: false` |
| `DrawFrame` 간격으로 계산한 표시 빈도 | 약 59.97회/초 | 게임 Canvas 자체의 갱신 횟수와는 다름 |
| `AnimationFrame::Presentation` 간격 중앙값 / 95백분위 | 16.667ms / 16.667ms | 브라우저 표시 시점 사이의 간격 |
| 표시 시점 간격 최대 | 33.333ms | 약 두 화면 주기, 25ms 초과 간격은 3회 |
| `DrawFrame` 간격 최대 | 38.923ms | 그리기 이벤트 시점의 간격이며 표시 간격과 구분 |

`DroppedFrame`의 부분 갱신 여부는 Chrome DevTools 프레임 처리기가 사용하는 값이다. 분모는 원시 `BeginFrame` 수이며, DevTools에서 재구성하는 프레임 수나 사용자가 체감한 끊김 횟수와 완전히 동일하지 않다. `PipelineReporter`는 별도 처리 단계와 부분 표시 상태를 기록하므로 이 집계에 더하지 않는다.

누락 이벤트의 녹화 기준 시점:

- 부분 갱신 없는 누락: 8.511초, 10.011초, 22.028초, 70.094초.
- 부분 갱신 포함: 0.012초, 86.062초, 86.095초, 86.127초.
- 표시 시점 간격이 약 33.3ms인 구간: 58.619초, 86.136초, 86.219초부터.

두 목록은 서로 다른 이벤트를 집계하므로 일치하지 않는다. 시작과 끝을 임의로 제외해 결과를 개선하지 않았다.

## 메인 스레드와 효과

- `RunTask` 총 실행 시간: 약 2.20초 / 분석 구간 87.62초. 전체 브라우저 CPU 사용률이나 GPU 사용률을 뜻하지 않는다.
- 50ms 초과 `RunTask`: 0회.
- 가장 긴 `RunTask`: 30.369ms. 내부에 `CpuProfiler::StartProfiling` 29.786ms가 포함되어 녹화 시작 비용으로 확인된다.
- 시작 1초 이후 가장 긴 `RunTask`: 5.862ms.
- 단일 `Layout` 최대 0.658ms, 단일 `Paint` 최대 0.256ms.
- 시작 지점을 제외한 각 누락 시점의 앞 20ms~뒤 40ms 범위에서 가장 긴 main-thread task도 약 0.46ms 이하였다. 긴 JavaScript 작업을 누락 원인으로 지목할 근거는 없다. GPU·운영체제 스케줄링 등 다른 원인은 이 관찰만으로 확정하지 않는다.

애니메이션의 `compositeFailed` 경고 이벤트는 161건이었다. 동일한 animation ID가 재사용되므로 시간순 시작·종료와 ID를 함께 매칭했다.

| 대상 | 속성 | 경고 이벤트 |
| --- | --- | ---: |
| `SECTION.playfield.playfield--multi` | `box-shadow` | 65건 |
| `SPAN.pending-garbage` | `color` | 42건 |
| `SPAN.pending-garbage` | `text-shadow` | 42건 |
| 효과 버튼·홈 링크 | 각 방향 `border-*-color` | 합계 12건 |

실제 코드에는 보드 강조 효과의 `boxShadow` 애니메이션(`src/client/pages/tetrisMulti.tsx`)과 대기 숫자의 색·그림자 transition(`src/client/styles/tetris.css`)이 있다. 경고는 합성 단계만으로 처리되지 않는 속성이 있다는 뜻이며, 프레임 누락의 인과관계를 증명하지 않는다. 이 기록의 비용이 작으므로 효과를 제거하거나 라이브러리를 교체할 필요는 확인되지 않았다. 추후 저사양 기기에서 문제가 재현된다면 그림자 자체의 변화 대신 고정된 강조 레이어의 opacity를 변화시키는 작은 수정을 우선 검토한다.

## 입력 반응과 메모리의 제한적 관찰

- 유효 interaction ID가 있는 `keydown` 454건: Event Timing duration 중앙값 34.747ms, 95백분위 42.309ms, 최대 49.765ms.
- 키 입력 이벤트의 processing duration 95백분위: 약 0.062ms. 입력 처리 시작까지의 지연 95백분위: 약 8.488ms.
- Event Timing은 해당 이벤트와 이후 표시를 관찰하는 브라우저 지표다. 입력 큐를 16ms timer로 소비하는 게임의 특정 블록 변화, 서버 승인, 상대방 표시까지 확인한 값은 아니다. 물리적인 키 누름→화면 변화 측정도 아니다.
- JS heap 사용량: 시작 약 13.50 MiB, 종료 19.97 MiB, 최소 12.85 MiB, 최대 21.47 MiB.
- 5초 구간별 heap 최솟값은 첫 구간 12.85 MiB, 80~85초 구간 13.65 MiB다. 종료값에는 아직 수거되지 않은 객체가 포함될 수 있다.
- DOM nodes는 987→989, event listeners는 1,826→1,776이었다. 이 녹화에서는 급격한 누적이 보이지 않지만, 한 게임으로 메모리 누수 유무를 확정할 수 없다.

## 다음 확인

1. 같은 기기·화면 크기에서 기본 효과와 효과 축소를 각각 고정하여 비슷한 공격 상황으로 비교한다. 단일 녹화만으로 두 모드의 차이를 산출하지 않는다.
2. 메모리는 [실기기 측정 가이드](real-device-performance-guide.md)의 같은 페이지 재시작 A/B/C heap snapshot 절차로 확인한다.
3. 입력 반응을 게임 자체 기준으로 확정하려면 입력 enqueue→processTick→해당 보드 drawing 시점을 연결하거나 고속 촬영으로 측정한다. 계측 코드는 이번 분석에 추가하지 않았다.

코드는 변경하지 않았으며 기존 기능 검증을 다시 실행하지 않았다. 녹화 기기의 CPU 모델, 저사양 기기 결과, 서버 RTT, GPU 메모리, 장시간 재시작 누수 검증은 이 자료로 완료 처리하지 않는다.

참고: [Chrome 프레임·입력·애니메이션 설명](https://developer.chrome.com/docs/devtools/performance/reference), [DevTools FramesHandler 구현](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/handlers/FramesHandler.ts).
