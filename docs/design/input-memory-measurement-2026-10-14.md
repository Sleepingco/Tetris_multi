# 입력·반복 재시작 메모리 분석 — 2026-10-14

후속 사용자 확인: 입력은 체감상 문제 없고 추가 계측은 하지 않기로 했다. 아래 수치는 브라우저 기록의 분석 결과로 유지하며 실제 블록 지연의 정량 완료를 뜻하지 않는다. [멀티 메모리·응답 단절 보완](multiplayer-memory-offline-2026-10-14.md)을 별도 기록했다.

## 자료와 측정 범위

- 입력: `/Users/parkseongho/Downloads/인풋.json`.
- A: `Heap-20261014T104416.heapsnapshot`.
- B: `Heap-20261014T104419.heapsnapshot`.
- C: `Heap-20261014T104423.heapsnapshot`.
- 사용자가 A/B/C 순서와 싱글 페이지에서 새로고침·페이지 이동 없이 재시작만 했음을 확인했다. 하드드롭 연타로 여러 게임을 종료했다. 정확한 반복 횟수는 제공되지 않았다.
- 파일 이름의 시각은 저장 시각이므로 실제 스냅샷 사이의 플레이 시간을 추정하는 근거로 사용하지 않았다.
- 입력 트레이스는 싱글 메모리 검사와 별개인 멀티플레이 페이지 기록이다. 기록 내 스크린샷에서도 사람 보드와 AI 상대를 확인했다.

결론: 이번 싱글 반복 재시작에서 메모리·이벤트 리스너·분리된 DOM이 계속 쌓이는 양상은 확인되지 않았다. 입력은 이벤트 핸들러가 빠르지만 브라우저 Event Timing 수치가 약 74ms여서, 실제 블록 변화와 연결한 추가 계측 전에는 입력 성능을 완료로 판정하지 않는다. 런타임 코드는 수정하지 않았다.

## 메모리 A/B/C 비교

| 항목 | A | B | C |
| --- | ---: | ---: | ---: |
| 객체 자체 크기 합계 | 23.347 MiB | 23.302 MiB | 23.409 MiB |
| 전체 노드 | 392,307 | 388,243 | 388,851 |
| detachedness=2 노드 | 209 | 209 | 209 |
| native EventListener | 2,978 | 2,978 | 2,978 |
| native V8EventListener | 2,908 | 2,908 | 2,908 |
| native RegisteredEventListener | 2,957 | 2,957 | 2,957 |
| HTMLDocument | 7 | 7 | 7 |

- A→B: −47,960 bytes (약 −46.84 KiB).
- B→C: +112,376 bytes (약 +109.74 KiB).
- A→C: +64,416 bytes (약 +62.91 KiB, +0.26%).
- 209개 detached 노드는 A/B/C에서 동일한 ID 집합이었다. 반복 후 새로운 detached 노드가 추가된 결과가 아니다.
- 일반 object·array 수는 A→C에서 각각 28,940→28,123, 10,168→9,625로 줄었다.
- B→C 크기 증가의 큰 항목은 V8 `InstructionStream` +43,104 bytes와 `TrustedByteArray` +30,936 bytes였다. 이 둘만으로 증가의 약 66%를 설명한다. 해당 객체는 게임 보드·DOM이 아니라 엔진의 코드 데이터다. 크기 증가만으로 누수라고 판단하지 않는다.

위 합계는 snapshot node의 `self_size`를 더한 것으로 JS 및 native 객체를 포함한다. 이전 Performance 기록의 `jsHeapSizeUsed` 또는 Chrome Task Manager의 탭 전체 메모리와 동일한 지표가 아니다. GPU·Canvas·Audio 전체 메모리와 retained size 합계를 뜻하지도 않는다.

### 남아 있는 객체의 참조 확인

C의 edge graph에서 weak edge를 제외하고 root부터 참조 경로를 확인했다. 이는 참조 경로 조사이며 dominator/retained-size 분석을 대신하지 않는다.

- 일부 detached NEXT `<li>`, `<div class="next-slot">`은 Document→단일 페이지 header→React Fiber의 sibling/child→stateNode 경로로 연결됐다.
- detached `<div class="game-text">`은 문서의 StyleEngine/Layout 객체를 거쳐 참조되고 있었다.
- `<audio>` 객체는 HistoryItem/DocumentState와 이전 페이지의 input 및 JS context를 거치는 경로가 있었다. 각 음원 요소 7개, HTMLDocument 7개가 A/B/C에서 유지되어 이번 재시작에 따른 증가로 보이지 않는다. 페이지 보존 원인을 모두 BFCache로 단정하지 않는다.
- 따라서 이미 남아 있는 고정된 객체는 있으나, 현재 자료는 반복 재시작마다 오래된 DOM이나 listener가 새로 누적되는 패턴을 보여주지 않는다. 최초 초기화에서의 불필요한 보존, 멀티 재접속·페이지 이동의 정리, 장시간 결과는 별개 검증 대상이다.

## 입력 트레이스

- 기록 시작: 2026-10-14 10:36:11.747 KST.
- renderer process 20590, main thread 2365616. renderer 분석 구간 약 9.718초.
- 유효 interaction ID를 갖는 keydown/keyup 각각 175건, 별도 click 1건.
- 이벤트 기록에는 실제 key code가 없어 175건 모두를 하드드롭 또는 이동·회전으로 분류하지 않았다. 하드드롭 연타라는 사용자 설명은 메모리 재시작 시나리오에 적용한다.

| keydown 지표 | 중앙값 | 95백분위 | 최대 |
| --- | ---: | ---: | ---: |
| Event Timing duration | 74.352ms | 78.921ms | 83.264ms |
| 입력 발생→이벤트 처리 시작 | 8.116ms | 13.054ms | 17.527ms |
| 이벤트 핸들러 처리 | 0.049ms | 0.080ms | 0.719ms |
| 핸들러 종료 이후 구간 | 65.666ms | 68.446ms | 74.118ms |

마지막 행은 `duration − (processingEnd − timeStamp)`로 계산했다. 브라우저가 기록한 이벤트의 presentation delay이며, 입력 큐 대기·게임 판단·Canvas drawing·실제 화면 표시 중 각각 어느 부분에서 시간이 걸렸는지는 분리하지 못한다. 표의 중앙값·95백분위끼리 단순 합산하면 전체 percentile이 되지 않는다.

- 50ms 초과 renderer `RunTask`: 0건.
- 최대 `RunTask`: 41.117ms. 녹화 시작의 `CpuProfiler::StartProfiling` 39.186ms가 포함됐다.
- 그 시작 작업을 제외한 최대 `RunTask`: 2.556ms. 긴 JS 실행으로 입력 지연을 설명할 근거는 없다.
- `BeginFrame` 593건, `DrawFrame` 582건, `DroppedFrame` 11건 (부분 갱신 포함 1건). 원시 갱신 기회 대비 약 1.85%로, 이전 녹화와 같은 조건이라고 가정해 직접 성능 차이를 판정하지 않는다.
- `AnimationFrame::Presentation` 간격 중앙값·95백분위 약 16.667ms. 대응 `BeginFrame`부터 표시까지 중앙값 24.238ms다. 이것은 입력 Event Timing이나 게임별 Canvas 갱신 빈도와 다른 지표다.
- 스크린샷이 450개 포함된 짧은 기록이며, 게임 UI는 보드가 세로로 쌓이는 viewport였다. 이전 두 보드가 나란히 보이던 기록과 화면 조건도 달랐다. 녹화 옵션·viewport·환경 차이의 영향을 별도로 확인해야 한다.

## 다음 확인과 완료 범위

1. 싱글 반복 재시작 메모리는 **이번 제공 자료에서 누적 누수 징후 없음**으로 기록한다. 이 검사만으로 멀티 파편 효과·재접속·페이지 이동의 정리까지 완료 처리하지 않는다.
2. 입력은 동일한 viewport·효과 설정을 유지하고 게임 키 수신→input queue 소비→해당 입력의 Canvas 갱신 시점을 짧게 계측해 확인한다. 큐를 16ms timer로 소비하므로 현재 이벤트 핸들러 시간만으로 게임 반응을 계산하면 안 된다. 이 분석에서는 계측을 추가하지 않았다.
3. 원인을 확인하기 전에 타이머 주기·게임 규칙·공격 효과 강도나 시간을 변경하지 않는다.

분석은 표준 JSON 파싱으로 수행했고 node/edge 개수, node ID 유일성, 핵심 이벤트 집계를 assertion으로 확인했다. 새로 측정하거나 런타임 코드를 변경하지 않아 전체 테스트는 실행하지 않았다.

참고: [Chrome heap snapshot 비교·참조 설명](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots), [Chrome Interactions 설명](https://developer.chrome.com/docs/devtools/performance/reference#view-interactions), [프로젝트 측정 가이드](real-device-performance-guide.md).
