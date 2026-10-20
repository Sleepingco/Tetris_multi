# Tetra Arena 실제 기기 성능 측정 가이드

작성일: 2026-10-13. 갱신일: 2026-10-19.

2026-10-19에 게임의 효과 축소 기능을 제거했다. 현재 측정은 일반 효과를 기준으로 하며 이전 버전의 축소 모드 측정과 혼합하지 않는다.

[프레임 분석](performance-trace-2026-10-13.md), [입력·싱글 재시작 메모리 분석](input-memory-measurement-2026-10-14.md), [멀티 메모리 A/B·응답 단절 보완](multiplayer-memory-offline-2026-10-14.md)을 기록했다. 싱글 재시작에서 누적 누수 징후는 없고, 멀티 파편·성과 문구 DOM도 A/B에서 남지 않았다. 입력은 사용자 체감상 문제 없음으로 확인했고 추가 계측은 보류한다. 사용자가 수정 후 Chrome 오프라인·복구의 정상 작동을 확인했다. 장시간 재접속 메모리·페이지 이동 확인은 남아 있다. 아래 절차의 목표 수치는 프로젝트의 조사 기준이며 공인 통과 기준은 아니다.

## 1. 같은 조건에서 비교하기

먼저 평소 사용하는 Mac/노트북에서 production 빌드를 측정한다. 개발 서버의 HMR·개발용 React 검사 비용을 섞지 않는다.

```bash
nvm use 24.18.0
npm run build
PORT=5512 \
GAME_EVENT_STORAGE=jsonl \
GAME_EVENTS_LOG_PATH=/tmp/tetra-performance-game-events.jsonl \
SOCKET_ALLOWED_ORIGINS=http://127.0.0.1:5512 \
CSP_CONNECT_ORIGINS=ws://127.0.0.1:5512 \
npm start
```

Chrome에서 `http://127.0.0.1:5512/pages/index.html`을 연다. 기존 개발 서버와 구분되는 로컬 측정 서버이며 로그도 /tmp에 분리한다. 끝나면 이 서버를 실행한 터미널에서 Ctrl+C로 종료한다.

- 기기·OS·브라우저 버전·화면 주사율·게임 viewport 크기·Git HEAD와 미커밋 변경 유무를 기록한다.
- 전원 연결, 동일한 전원 모드와 브라우저 확대율을 유지하고 불필요한 앱·확장 기능을 끈다.
- CPU/네트워크 throttling을 끈 상태가 실기기 기준선이다. throttling과 390px 화면 에뮬레이션은 보조 확인이며 실제 휴대전화 결과로 기록하지 않는다.
- DevTools는 별도 창으로 열어 게임 viewport를 일정하게 유지한다. PVP는 두 창을 나란히 보여 숨겨진 탭의 절전 처리를 피한다.
- 30초 정도 예열한 뒤 같은 시나리오를 일반 효과로 3회 반복한다. 오디오는 같은 상태로 유지한다.
- 난수와 AI 행동이 다르므로 공격·줄 삭제·성과 발생 수를 기록하고 비슷한 구간을 비교한다. 코드 변경 전후 비교는 각 버전을 별도로 같은 환경에서 측정하며 두 버전 모두 일반 효과를 사용한다.

| 시나리오 | 실행 내용 |
|---|---|
| 싱글 입력 | 30초간 좌우 이동·회전·홀드·하드 드롭. 벽에 막힌 입력은 지연 표본에서 제외 |
| 효과가 많은 구간 | 줄 삭제·TETRIS/T-SPIN/COMBO·공격/피격이 겹치는 30~60초 구간 |
| PVP | 두 창에서 공격·상쇄를 반복. 내 보드 반응과 상대 반영을 분리해 관찰 |
| 장시간 및 정리 | 가능한 동안 5~10분 플레이하고 반복 재시작·로비 이동 후 증가 추세 확인 |

## 2. 프레임: 애니메이션 구간을 기록하기

1. DevTools → Rendering → **Frame rendering stats**를 켜서 동작 중 프레임을 관찰한다.
2. Performance → Record를 누르고 30~60초 시나리오를 실행한 뒤 Stop한다.
3. **Frames**에서 dropped/partially presented frame과 오래 걸린 프레임을 찾는다. **Main**에서 같은 순간의 JS·Layout·Paint·GC를 확인한다. 절차는 [Chrome Performance 문서](https://developer.chrome.com/docs/devtools/performance/reference)와 [Rendering 문서](https://developer.chrome.com/docs/devtools/rendering/performance)에 따른다.

60Hz의 화면 주기는 약 16.7ms, 120Hz는 약 8.3ms다. 지속적인 프레임 누락이나 효과가 겹칠 때 반복되는 긴 프레임을 우선 조사한다. 50ms를 넘는 main-thread 작업은 long task로 분류된다. [long task 설명](https://web.dev/articles/optimize-long-tasks)

이 게임은 화면 변화가 있을 때 Canvas를 다시 그린다. 정지 구간에서 FPS 수치가 낮다고 바로 실패로 판단하지 않는다. 애니메이션·이동이 실제로 진행되는 구간을 비교한다. Screenshots와 상세 계측도 부하를 만들므로 프레임 비교는 동일한 옵션으로 진행하고, 입력 확인용 스크린샷 기록은 별도로 짧게 남긴다.

## 3. 입력: 키 입력과 게임 화면 변경을 연결하기

1. Performance의 Screenshots를 켜고 10~15초만 기록한다. 녹화 시작 후 게임판을 클릭해 입력 포커스를 돌린다. 먼저 좌우 이동·회전을 한 번씩 20~30회 입력하고, 효과가 많은 상태에서 같은 입력을 반복한다.
2. Interactions에 기록된 keyboard interaction의 input delay·processing·presentation delay를 확인한다. [Interactions 설명](https://developer.chrome.com/docs/devtools/performance/reference#view-interactions)
3. 실제 게임 반응은 Main의 keydown → 입력 처리 timer → Canvas 갱신과 스크린샷의 조각 변경을 함께 확인한다. 이 저장소의 입력은 queue에 들어간 뒤 16ms timer에서 처리된다. 다음 paint가 다른 UI 변화일 수도 있어 INP 수치 하나로 조각 반응을 확정하지 않는다.
4. 중간값·가장 느린 입력·반복적으로 느린 상황을 기록한다. 불명확한 표본은 임의의 ms 값으로 채우지 말고 해당 trace를 남긴다.

프로젝트의 초기 검토 목표로는 60Hz에서 내 입력이 대체로 두 화면 주기(약 33ms) 안에 보이는지를 볼 수 있다. 이는 보장된 수치나 공인 통과 기준이 아니라, 현재 16ms 입력 루프를 바탕으로 한 조사 기준이다. 눈에 띄는 반복 지연·누락·이중 입력이 있으면 원인을 확인한다.

DevTools는 물리 키의 스위치 작동부터 디스플레이 발광까지 전 구간을 측정하지 않는다. 기존 기기가 120/240fps 촬영을 지원하면 키를 누르는 장면과 화면을 함께 촬영해 대략적인 체감 지연을 보조 확인할 수 있다. 촬영 주기는 약 8.3/4.2ms지만 정확한 스위치 작동 시점과 카메라 오차를 포함한다.

내 보드의 로컬 예측 반응과 상대 보드의 서버 반영은 따로 기록한다. 상대 반영에는 네트워크와 서버 처리가 포함되므로 내 입력 반응 목표를 그대로 적용하지 않는다. 더 정확한 분리가 필요하면 후속 계측에서 입력 sequence·렌더 commit·서버 ack에 performance mark를 붙인다. 이번 변경에는 계측 코드를 추가하지 않았다.

## 4. 메모리: 늘었다가 줄어드는지 확인하기

1. 같은 문서에서 반복 가능한 싱글을 먼저 사용한다. 한 경기를 끝내고 재시작한 뒤 다시 게임 오버까지 진행해 예열한다. 게임 오버 화면에서 효과 종료 후 3초 기다리고 Memory → **Heap snapshot A**를 찍는다.
2. 게임 오버 → 재시작을 10회 반복한다. 각 효과 종료 후 3초 이상 기다리고 마지막에도 게임 오버 화면에서 **snapshot B**를 찍는다. 다시 10회 반복해 **C**를 찍는다.
3. **Comparison**으로 A/B/C를 비교하고 `Detached` 객체의 **Retainers**에서 누가 참조를 유지하는지 확인한다. heap snapshot은 GC를 실행한 뒤 수집되므로 일시적인 할당과 남아 있는 객체를 구분하는 데 도움이 된다. [Chrome heap snapshot 문서](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots)

메모리가 처음 늘어나는 것만으로 누수라고 판단하지 않는다. 예열·캐시·오디오 버퍼 때문에 초반 증가가 가능하다. 같은 정리 상태로 돌아온 뒤에도 반복 횟수에 따라 계속 증가하고, 이전 runtime·timer·listener·분리된 DOM을 유지하는 참조가 있으면 조사한다. Console에 DOM이나 runtime 객체를 저장하면 DevTools 자체가 그 참조를 유지할 수 있으니 측정 중 객체를 저장하지 않는다.

멀티는 한 경기 안에서 공격 효과가 반복되는 구간의 Memory allocation과 종료 후 남은 객체를 확인한다. 효과가 없는 상태에서는 `.combat-projectile`, `.combat-achievement`가 사라져야 한다. 재접속과 페이지 이동도 반복하되, 이 프로젝트는 여러 HTML 문서를 사용하므로 이동 전후 heap 객체를 같은 runtime의 증가처럼 단순 비교하지 않는다. Chrome Task Manager의 메모리 추세와 이전 문서를 붙잡는 참조를 함께 본다. BFCache와 브라우저 캐시의 유한한 보존도 구분한다. [메모리 문제 조사 방법](https://developer.chrome.com/docs/devtools/memory-problems)

JS heap만으로 Canvas/GPU·오디오 메모리 전체를 판단하지 않는다. 탭의 memory footprint와 Rendering의 GPU memory도 함께 기록한다. Node 서버 메모리는 별도 측정 대상이다.

## 5. 결과를 남기기

| 기기/브라우저/Hz | 모드·viewport | 효과 설정 | 발생한 공격/성과 수 | 긴 프레임·누락 | 입력 중간/최악 | 정리 후 heap A/B/C | 재현 단계 |
|---|---|---|---|---|---|---|---|
| 측정 후 입력 | | | | | | | |

Performance trace와 heap snapshot은 다른 기록이다. 각각 저장하고 위 조건·입력 순서·느려진 시점을 함께 남긴다. 로컬 테스트의 기록으로 충분하다. 측정값을 확인한 다음에만 성능 완료 여부와 필요한 수정 범위를 결정한다.

## 6. 남은 항목의 실행 절차

### 실제 블록 입력 반응

기본 프레임과 싱글 재시작 메모리 검사는 같은 방식으로 다시 반복할 필요가 없다. 사용자는 입력 체감상 문제 없음을 확인했고 현재 추가 계측을 하지 않기로 했다. 아래 두 방법은 추후 필요할 때 사용할 선택적 절차다. 입력 Event Timing은 블록이 반응한 시점을 직접 식별하지 못하므로 다음 두 방법을 구분한다.

- 지금 가능한 보조 확인: 120/240fps 촬영을 지원하는 기존 기기로 키보드와 화면을 함께 촬영한다. 녹화 도구의 부하를 제외하려면 이때 DevTools 녹화는 끈다. 빈 보드에서 벽에 막히지 않는 좌우 이동·회전을 0.5~1초 간격으로 20~30회 수행한다. 키를 누르는 모습부터 조각 변화가 처음 보이는 화면까지 촬영 프레임 수를 세고 `프레임 수 × 1000 / 촬영 FPS`로 계산한다. 키의 실제 스위치 작동 시점·rolling shutter·화면 주사 오차가 있으므로 대략적인 값이다.
- 코드 계측이 필요한 확인: 같은 입력 ID로 key handler 진입→queue 소비→해당 입력 후 Canvas drawing 완료 시점을 `performance.mark`로 연결한다. 입력을 무시한 경우도 구분하고, 오래 누르기 자동 반복은 별도 표본으로 둔다. 짧은 10~15초 Performance trace에서 실제 조각 변화와 표시 이벤트를 함께 확인한다. Canvas 함수 종료는 drawing 명령 완료이며 실제 디스플레이 표시를 보장하지 않는다. 멀티 server ack·상대 보드 반영은 별도 구간으로 측정한다. 현재 코드에는 이 계측이 없고 이 문서 변경에서도 추가하지 않았다.

처리 단계의 시간은 내가 계측으로 확인하고, 물리적 체감 반응은 사용자의 촬영·관찰로 보완한다. 브라우저 duration 74ms를 실제 블록 지연으로 단정하거나 원인 확인 전에 16ms timer를 변경하지 않는다.

### 멀티 공격 효과의 정리

1. 멀티 경기를 시작하고 음원·초기 HUD가 예열되도록 잠깐 플레이한다. 효과가 사라진 뒤 3초 이상 지난 시점에 snapshot A를 찍는다.
2. 같은 경기·같은 페이지에서 공격·피격·성과 문구가 여러 번 발생하도록 플레이한다. 대략 10회 정도의 이벤트를 목표로 하되 실제 횟수와 종류를 함께 기록한다.
3. 효과가 사라진 뒤 3초 이상 지난 시점에 B를 찍고 같은 과정을 반복해 C를 찍는다. AI가 계속 효과를 만들면 효과가 없는 시점을 기다리거나 사람 상대 경기에서 입력을 잠깐 멈춘다. 경기 도중 새로고침·로비 이동은 이 검사와 섞지 않는다.
4. 효과가 없는 시점의 `.combat-projectile`, `.combat-achievement` DOM은 0개여야 한다. UI에 고정된 incoming bar·HUD는 제거 대상이 아니다.
5. snapshot에서 분리된 파편·문구·Animation 객체가 반복할수록 누적되거나 종료된 애니메이션을 Map·timer가 계속 참조하는지 확인한다. GC 후 전체 크기 증가만으로 판정하지 않는다.

보낼 자료: A/B/C `.heapsnapshot`, 이벤트 종류·대략 횟수, 각 snapshot 시점에 효과가 종료됐는지 여부. 현재 존재하는 자동화 테스트는 효과 표시·pagehide 정리를 검사하지만 실제 기기의 장시간 메모리 측정을 대신하지 않는다.

### 멀티 재접속의 정리

1. 서버를 계속 켜둔 상태에서 게임 중 효과가 없는 시점에 snapshot A를 찍는다. 서버를 재시작하면 메모리에 저장된 room/match가 사라지므로 재접속 검사와 다른 시나리오가 된다.
2. Chrome Network 패널의 throttling을 **Offline**으로 바꾸고 화면에 **재연결 중**이 실제 표시되는지 확인한다. transport가 열린 채 서버 snapshot만 중단되는 경우도 새 보완 경로가 약 5~5.5초 뒤 예측을 정리하고 재인증한다. 10초 동안 서버 갱신이 없는데도 내 블록이 계속 움직이고 안내가 없다면 실패로 기록한다. 트래픽도 계속 들어온다면 Offline 시뮬레이션이 적용됐는지부터 확인한다.
3. **No throttling**으로 되돌려 같은 게임 화면으로 복구되는지 확인한다. 단절 중 눌렀던 키가 복구 직후 몰아서 실행되거나 소리·공격·줄 삭제 문구가 중복되면 기록한다.
4. 5회 반복해 복구 후 효과가 없는 시점에 B를 찍고, 다시 5회 반복해 C를 찍는다. 한 번의 키 입력이 한 번만 반영되는지도 확인한다. 단절 중 서버 게임은 진행될 수 있어 게임이 종료되면 해당 상황은 종료 처리 검사로 분리하고 억지로 같은 경기 비교에 넣지 않는다.
5. 반복 후 runtime·listener·timer·effect가 늘어나는지 참조를 비교한다. 현재 `e2e/multiplayerReactLifecycle.spec.js`에는 offline→online 후 재join과 listener 중복을 확인하는 자동화 경로도 있다.

보낼 자료: A/B/C `.heapsnapshot`, 실제로 복구된 횟수, 이상 동작 시 화면 또는 짧은 trace. [Chrome Offline 설정](https://developer.chrome.com/docs/devtools/network/reference#emulate-offline)

### 페이지 이동과 저사양 환경

- 멀티 경기 종료→로비 복귀→새 경기 시작을 5~10회 반복한다. 브라우저 뒤로/앞으로 복귀도 따로 확인한다. 이전 경기 소리·이펙트가 남거나 한 번 입력이 두 번 반영되지 않아야 한다. 여러 문서를 오가는 검사이므로 서로 다른 문서의 heap 합계를 같은 runtime의 A/B/C처럼 직접 비교하지 않는다. 이전 문서를 붙잡는 참조와 탭 전체 메모리 추세를 함께 본다.
- 가능하면 다른 실제 기기에서 일반 효과로 같은 viewport·주사율·녹화 옵션을 유지해 30~60초, 3회 기록한다. 휴대전화 크기 에뮬레이션이나 CPU throttling은 실제 기기 결과와 분리한다. 상대 보드의 서버 반영 지연을 내 보드의 로컬 입력 지연과 섞지 않는다.
