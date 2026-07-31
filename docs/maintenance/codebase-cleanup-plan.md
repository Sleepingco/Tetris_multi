# Codebase Cleanup Execution Plan

- 작성일: 2026-07-19
- 상태: Phase 0~5 구현 및 검증 완료
- 대상: over-engineering audit에서 확인된 dead code, legacy 경로, 반복 테스트
- 기본 원칙: 동작 보존, 삭제 우선, 한 변경에 한 이유, 새 dependency 0개
- Goal 실행 프롬프트: `docs/maintenance/codebase-cleanup-goal-prompt.md`

## 1. 목적

다음 기술 마이그레이션이나 기능 작업 전에 이미 대체된 코드를 제거해, 불필요한 코드까지 옮기거나 유지하는 일을 막는다.

완료 기준은 삭제 줄 수가 아니라 다음 세 가지다.

1. 삭제 대상에 production caller가 없다.
2. server authoritative ownership과 client prediction/ack 계약이 유지된다.
3. 각 단계의 자동·브라우저 회귀 검증이 통과한다.

감사에서 계산한 약 1,450~2,050줄은 우선순위 참고값일 뿐 목표치로 사용하지 않는다. 삭제하려면 새 abstraction이나 복잡한 호환 계층이 필요한 항목은 그대로 둔다.

## 2. 유지해야 할 경계

이번 작업은 구조 재설계가 아니다. 다음 경계는 유지한다.

- `core / state / runtime / render / ui / entry` 책임 분리
- server `authoritativeState`와 player별 mutation FIFO
- `clientSequence` / `lastProcessedClientSequence` / pending input 보호
- own snapshot correction과 rollback 회귀 테스트
- server `pendingGarbageQueue`, client DTO의 `pendingGarbageLines`, `core/garbage.js`
- Socket.IO trust-boundary validation과 chat rate limit/plain-text 처리
- placement JSONL log, validator, repository, dataset/export 경로
- JS/Python parity 검증과 안전한 artifact writer
- 접근성에 필요한 상태 표시와 live announcement

이번 작업에 포함하지 않는다.

- full snapshot coalescing 또는 전송 주기 최적화
- React/Vite/TypeScript migration
- replay, spectator, matchmaking 같은 새 기능
- dependency 교체·추가
- 로그 schema 변경

## 3. 감사 항목 판정

| 항목 | 판정 | 실행 시점 |
| --- | --- | --- |
| legacy chat client와 `chatting` handler | 삭제 | Phase 1 |
| handler가 없는 gameplay event tombstone 테스트 | 삭제 | Phase 1 |
| `getDropRow` / `generatePlacements` | 삭제 | Phase 1 |
| 참조 없는 public surface·CSS·중복 stylesheet | 호출자 재확인 후 삭제 | Phase 1 |
| client local `pendingGarbageQueue`와 cancel/apply UI 경로 | server 경로를 유지하며 삭제 | Phase 2 |
| 상대에게 보내는 미사용 `game:input` relay | 삭제 | Phase 3 |
| server `inputLog` / `recordInput` | 가까운 replay/export가 없으면 삭제 | Phase 4 |
| 네 CLI의 수제 option parser | Node 최소 버전 고정 후 선택 적용 | Optional |
| 반복 test setup | 앞선 삭제가 끝난 후 남은 동일 setup만 축소 | Phase 5 |
| sound registry, serializer, preview DI, DOM/Canvas wrapper | 해당 파일을 다른 이유로 수정할 때만 검토 | 현재 보류 |

`inputLog` 판정의 기본값은 삭제다. Phase 4 시작 전에 바로 다음 승인 작업이 match replay/export를 실제로 소비하는 경우에만 유지한다. 미래 가능성만으로는 유지하지 않는다.

## 4. 실행 계획

### Phase 0. 기준선 고정

목적은 기존 실패를 cleanup 회귀로 오인하지 않도록 하는 것이다.

- 현재 rollback 문서 변경과 cleanup 코드 변경을 분리한다.
- 각 삭제 직전에 `rg`로 production import와 caller를 다시 확인한다.
- cleanup과 migration 또는 새 기능 구현을 같은 변경에 섞지 않는다.
- 기준선 검증 결과를 첫 cleanup 작업에 기록한다.

검증:

```bash
bash scripts/verify.sh
npm run test:e2e -- e2e/multiplayerRollback.spec.js --repeat-each=5
```

중단 조건:

- 기준선 테스트가 실패한다.
- 감사 이후 production caller가 추가됐다.
- 삭제를 위해 새 compatibility layer가 필요하다.

### Phase 1. 확정된 dead leaf 삭제

서로 독립적으로 되돌릴 수 있도록 아래 순서대로 작은 변경을 만든다.

#### 1-1. Superseded AI placement 경로

- `placementGenerator.js`의 `getDropRow`와 `generatePlacements`를 제거한다.
- reachable planner가 사용하는 `normalizePlacement`와 `canPlacePlacement`는 유지한다.
- 직선-drop 전용 테스트를 제거한다.
- heuristic evaluator의 unreachable-placement 테스트는 필요한 placement를 명시적으로 만들어 reachable planner 선택만 검증하도록 축소한다.

#### 1-2. Legacy socket/chat 경로

- 로드되지 않는 `src/client/net/chat.js`와 서버 `chatting` handler를 제거한다.
- `global:chat` / `room:chat`과 보안 검증은 유지한다.
- 등록되지 않은 `game:snapshot`, `game:garbage:attack`, `game:over`가 아무 동작도 하지 않는지 확인하는 tombstone 테스트를 제거한다.
- authoritative event와 권한·입력 validation 테스트는 유지한다.

#### 1-3. 미사용 surface와 style

- production caller가 없는 `multiCanvasEls`, `applyServerBag`, `getBestPlacement`, 중복 board metric wrapper부터 제거한다.
- 사용처가 없는 `.line-clear`, `.cta`와 게임 페이지의 중복 `style.css` link를 실제 렌더 결과 확인 후 제거한다.
- test cleanup 비용이 큰 `stop`, placement log getter, `queryElement` 같은 표면은 이 단계에 억지로 포함하지 않는다.

Phase 1 검증:

```bash
bash scripts/verify.sh
```

완료 조건:

- 제거한 export/event/style의 production 참조가 0이다.
- AI, socket, page bootstrap 테스트가 통과한다.
- 새 helper나 대체 abstraction을 추가하지 않았다.

### Phase 2. Client local garbage 이중 경로 제거

목적은 실제 권위가 없는 client queue를 제거하고 server garbage만 단일 원천으로 남기는 것이다.

삭제 대상:

- client runtime의 `pendingGarbageQueue`
- client-only `queueGarbageLines`, cancel/apply queue 경로와 전용 테스트
- production event가 없는 garbage log/pulse timer와 관련 DOM/CSS

반드시 유지할 것:

- server `authoritativeState.pendingGarbageQueue`
- `playerGameplayStep`의 cancel/apply 판정
- `core/garbage.js`
- snapshot의 `pendingGarbageLines`와 화면의 Incoming 숫자
- placement log의 기존 result 필드 형태

구현 시 `rawAttackLines`와 placement log scalar의 현재 의미를 바꾸지 않는다. client queue가 항상 비어 있던 경로는 `attackLines = rawAttackLines`, cancel/incoming/applied 값은 0인 기존 결과를 유지한다. 별도의 client garbage 모델을 새로 만들지 않는다.

`.garbage-log` live region을 제거한다면 Incoming 숫자의 접근성 알림이 약해지지 않도록 기존 `aria-live` 역할을 보존한다.

검증:

```bash
bash scripts/verify.sh
npm run test:e2e -- e2e/multiplayerRollback.spec.js e2e/multiplayerGameOver.spec.js e2e/multiplayerPve.spec.js
```

수동 확인:

- 두 탭에서 incoming 숫자가 server snapshot과 일치한다.
- 공격 cancel/apply 후 양쪽 board가 수렴한다.
- garbage overflow와 gameOver가 서버 결과로 확정된다.

### Phase 3. 미사용 `game:input` relay 제거

rollback 안정화 gate는 통과했으므로 상대가 소비하지 않는 relay만 제거한다.

- 서버의 `clientSocket.to(roomId).emit("game:input", ...)`을 제거한다.
- client `receiveGameInput` adapter를 제거한다.
- relay 자체를 검사하는 테스트를 제거하거나 authoritative state·ack 검증으로 축소한다.

반드시 유지할 것:

- client → server `game:input`
- sender의 `game:input:result`
- `game:authoritative:snapshot`
- input validation, expected transform, sequence validation
- player mutation FIFO와 gravity ordering

검증:

```bash
bash scripts/verify.sh
npm run test:e2e -- e2e/multiplayerRollback.spec.js --repeat-each=5
npm run test:e2e -- e2e/multiplayerSession.spec.js
```

### Phase 4. 소비자 없는 server `inputLog` 제거

시작 gate:

- 다음 승인 작업에 match replay/export consumer가 없다.
- placement JSONL log와 server `inputLog`가 별개임을 다시 확인한다.

삭제 대상:

- player별 `inputLog`, `nextInputSequence`
- `recordInput`과 상한 관리
- socket handler의 기록 호출
- inputLog 전용 테스트와 현재 구조를 설명하는 active 문서 항목

반드시 유지할 것:

- `clientSequence`와 `lastProcessedClientSequence`
- duplicate/out-of-order rejection
- placement decision JSONL log와 validator/repository
- AI의 authoritative input 실행과 placement `inputSequence`

역사 기록인 `change-log.md`, 과거 Q&A, archive 문서는 다시 쓰지 않는다. 현재 계약을 설명하는 `AGENTS.md`, `PLAN.md`, architecture report만 실제 코드에 맞게 수정한다.

검증:

```bash
bash scripts/verify.sh
npm run test:e2e -- e2e/multiplayerRollback.spec.js
npm run test:e2e -- e2e/multiplayerPve.spec.js
```

### Optional. CLI parser를 `node:util.parseArgs`로 교체

이 작업은 표준 라이브러리 전환이지만 cleanup의 필수 완료 조건은 아니다.

- 지원하는 최소 Node 버전이 `parseArgs` 사용 가능 버전으로 명시된 뒤 진행한다.
- 현재 parser의 required option, unknown option 실패, 숫자 검증, export 계약을 유지한다.
- Node 버전 기준이 아직 문서화되지 않았다면 승인된 Node baseline 작업까지 보류한다.

검증:

```bash
node --test test/testPlacementDatasetExporter.js test/testPlacementEvaluation.js test/testPlacementPairwiseRanker.js test/testPlacementParityBundle.js
bash scripts/verify.sh
```

### Phase 5. 남은 test setup 축소

삭제될 테스트를 먼저 리팩터링하지 않는다. Phase 1~4가 모두 통과한 뒤 실제로 남은 중복만 다시 측정한다.

- 기존 Socket/ticker fixture를 우선 재사용한다.
- setup이 완전히 같은 경우에만 `test.beforeEach`를 사용한다.
- 한 테스트 파일씩 변경한다.
- fixture option이 계속 늘어나면 통합을 중단하고 명시적 setup을 유지한다.
- production 파일은 변경하지 않는다.

검증:

```bash
bash scripts/verify.sh
```

## 5. 변경 단위

권장 커밋 경계는 다음과 같다.

1. superseded placement generator 삭제
2. legacy chat 경로 삭제
3. gameplay tombstone 테스트 삭제
4. 작은 unused public surface 삭제
5. 사용처 없는 style과 중복 stylesheet 삭제
6. client local garbage 경로 삭제
7. unused `game:input` relay 삭제
8. 조건을 통과한 경우 server `inputLog` 삭제
9. 남은 test fixture 중복 축소

각 커밋은 앞 커밋의 검증이 통과한 뒤 시작한다. 실패했을 때 여러 기능을 함께 되돌리지 않도록 runtime, network, test-only 변경을 합치지 않는다.

## 6. 전체 완료 조건

- 삭제된 항목의 production caller가 없다.
- server authoritative garbage와 snapshot ownership이 유지된다.
- own-board rollback E2E가 5회 반복 통과한다.
- PVP/PVE의 input, lock, garbage, gameOver가 회귀하지 않는다.
- `bash scripts/verify.sh`가 최종 상태에서 통과한다.
- 제거된 legacy 경로가 active 문서에 현재 구조처럼 남아 있지 않다.
- dependency는 추가·삭제하지 않는다.
- 모든 단계가 독립 커밋으로 되돌릴 수 있다.

예상 줄 수보다 작은 결과가 나와도 위 조건을 만족하면 완료다. 반대로 줄 수를 맞추기 위해 사용 중인 코드나 검증 경계를 삭제하지 않는다.

## 7. 실행 결과

- 완료일: 2026-07-19
- Phase 0~5를 순서대로 적용했다.
- production caller가 없는 legacy AI·chat·socket·UI 경로를 제거했다.
- client local garbage queue를 제거하고 server `pendingGarbageQueue`와 DTO `pendingGarbageLines`를 유지했다.
- 소비자가 없던 상대 `game:input` relay와 server match `inputLog`를 제거했다.
- 기존 `createStartedPvpSocketFixture`와 완전히 같은 PVP test setup 6곳만 통합했다. 새 fixture나 option은 추가하지 않았다.
- tracked diff 기준 163줄 추가, 1,763줄 삭제로 순감소 1,600줄이다. 문서 보정이 추가 줄의 대부분이다.
- dependency 변경은 없다.

검증 결과:

- `bash scripts/verify.sh`: 497 tests passed
- `e2e/multiplayerRollback.spec.js`: Phase 0, Phase 3, 최종 상태에서 각각 5회 반복 통과
- `e2e/multiplayerPve.spec.js`: Phase 2, Phase 4, 최종 상태에서 통과
- `e2e/multiplayerGameOver.spec.js`, `e2e/multiplayerSession.spec.js`: 관련 단계와 최종 상태에서 통과
- 싱글/PVE 페이지는 중복 stylesheet 제거 후 Canvas와 상태 UI 렌더를 브라우저에서 확인했다.

Optional CLI parser 교체와 보류한 micro-cleanup은 이번 완료 조건에 포함하지 않았다. 최소 Node 버전 확정 또는 해당 파일을 다른 이유로 수정할 때 다시 판단한다.
