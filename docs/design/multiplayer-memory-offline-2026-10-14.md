# 멀티 메모리와 서버 응답 단절 보완 — 2026-10-14

## 사용자 확인

- 입력은 체감상 문제 없음. 사용자 요청에 따라 추가 입력 계측은 수행하지 않는다. 이전 Event Timing 수치를 실제 블록 지연으로 확정하지 않는다.
- Chrome Network Offline을 약 10초 유지했을 때 PVE 상대는 멈추지만 내 예측 조각은 계속 진행하고, 게임 오버로 보이는 상태에서도 종료 안내가 없었다.
- 자료: Downloads의 `멀티측정A`, `멀티측정B`. 확장자는 없지만 Chrome heap snapshot JSON이다. A/B가 정확히 어떤 전후 조건인지와 이벤트 횟수는 확인되지 않아 조건부 비교로 기록한다.

## 메모리 비교

| 항목 | A | B |
| --- | ---: | ---: |
| node self_size 합계 | 16.431 MiB | 16.920 MiB |
| 전체 노드 | 309,017 | 319,649 |
| detachedness=2 | 13 | 13 |
| native EventListener | 1,798 | 1,798 |
| native V8EventListener | 1,737 | 1,736 |
| HTMLDocument | 4 | 4 |
| combat-projectile / combat-achievement / achievement-spark DOM | 0 | 0 |

- B−A: +513,401 bytes (약 0.490 MiB, 3%). JS 및 native 객체의 자체 크기 합계이며 GPU·오디오 전체 메모리는 아니다.
- detached 13개는 A/B에서 동일한 ID였다. 12개는 기존 audio 요소, 1개는 div다. 새 파편·성과 문구가 분리된 DOM으로 남은 흔적은 없다.
- 증가 상위 그룹은 V8 InstructionStream +148,992 bytes, array backing storage +107,076 bytes, TrustedByteArray +67,496 bytes, Object +58,036 bytes다. 이 집계만으로 배열·객체를 누수 또는 정상 객체라고 단정하지 않는다.
- 두 자료의 공통 node ID는 286,406개다. 파편·문구·리스너 누적 징후는 확인되지 않았지만 C나 동일 조건의 추가 반복 자료 없이 전체 메모리의 지속 증가 여부를 확정할 수는 없다.

## 오프라인 증상의 재현과 원인

기대 동작은 서버 업데이트가 중단되면 내 로컬 예측도 멈추고 재접속 상태를 표시하는 것이다. 기존 코드는 Socket.IO disconnect가 발생해야 page의 destroyGameSession 경로를 실행했다. 상대 보드는 snapshot-only이고 내 보드는 prediction이므로, 소켓 connected 상태가 유지되는 동안 메시지만 멈추면 상대만 정지하고 내 입력·중력은 계속됐다. 멀티 승패는 서버 확정 결과를 받으므로 연결이 없는 상태에서 local top-out만으로 종료 결과를 만들 수도 없다.

격리된 production 서버와 Chromium에서 다음을 확인했다.

1. 일반 CDP Offline 및 Playwright setOffline은 transport close를 발생시켜 기존 재연결 화면이 표시됐다. 사용자의 Chrome Offline 설정과 이 자동화 방식이 완전히 같다고 단정하지 않는다.
2. 열린 WebSocket의 메시지를 양방향에서 차단하고 소켓 연결은 유지하면 사용자 보고와 같은 상태가 재현됐다. 10초 뒤 connected=true, 상대 snapshot count는 그대로, 재연결 안내 없음, 내 hard drop 점수는 0→32로 바뀌었다.
3. Socket.IO의 기본 heartbeat 단절 판정은 pingInterval 25초 + pingTimeout 20초까지 기다릴 수 있다. 즉각적인 UI 중단을 이 신호에만 맡기는 경로가 문제였다. 서버의 이 설정은 변경하지 않았다.

## 최소 수정

- multiplayerGameSession의 기존 500ms bag heartbeat에서 마지막 유효한 authoritative snapshot 시점을 함께 확인한다. 별도 timer는 추가하지 않는다.
- 경기 시작 후 5초 동안 해당 room의 내/상대 snapshot이 없으면 세션을 destroy한다. 입력 listener·중력·애니메이션·heartbeat·미확정 입력과 placement log를 기존 정리 경로로 폐기한다.
- roomClient의 reconnectPlayerSession이 기존 socket을 끊고 저장 credential로 다시 연결한다. 기존 nonterminal disconnect→재연결 안내→session:ready→game:join 흐름을 재사용한다.
- countdown 전에는 timeout을 적용하지 않고 start에서 기준 시점을 갱신한다. 다른 room이나 actor의 snapshot은 timeout을 연장하지 못한다.
- 서버 승패·공격·AI·bag·로그 형식과 입력 tick은 변경하지 않는다. 정상 상황에서도 서버 snapshot이 5초 이상 멈추면 로컬 예측을 계속하지 않고 재인증하는 정책이다.

## 검증과 다시 확인할 방법

- 단위 검증: countdown 예외, 유효 snapshot에 의한 시간 갱신, 다른 room/actor 무시, timeout 후 두 runtime/timer/keyboard 정리와 한 번 재인증.
- 브라우저 회귀: 정상 무입력 구간에는 재접속하지 않음, 열린 소켓 메시지 단절 뒤 안내·입력 정지, 파편·문구 제거, 복구 시 최신 서버 상태 적용, 단절 중 입력 폐기, 새 입력의 단일 실행.
- typecheck 통과. `bash scripts/verify.sh` 675개 통과·1개 skip.
- 관련 E2E 10개 통과: multiplayerNetworkStall, multiplayerReactLifecycle, multiplayerPve, combatAchievements.
- 이후 항목별 커밋 전 전체 Chromium E2E도 47/47 통과했다.

사용자의 실행 중인 서버는 중지하지 않았다. 새 빌드가 생성됐으므로 Network를 No throttling으로 되돌린 뒤 페이지를 새로 열어 갱신된 파일을 로드한다. Offline을 10초 유지해 기존 transport 단절이나 서버 snapshot 중단 후 약 5~5.5초 안에 재연결 안내가 뜨는지 확인한다. 연결이 복구되면 최신 match로 재join하며, 이미 종료된 match는 기존 종료/로비 경로를 따른다.

사용자가 수정 후 Chrome 오프라인·복구의 정상 작동을 확인했다. 수정 후 장시간 재접속 메모리 비교는 아직 수행되지 않았다. 입력은 사용자 체감 확인으로 기록하고 정량 완료로 표시하지 않는다.

참고: [Socket.IO heartbeat 설정](https://socket.io/docs/v4/server-options/#pingtimeout), [Chrome heap snapshot](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots).
