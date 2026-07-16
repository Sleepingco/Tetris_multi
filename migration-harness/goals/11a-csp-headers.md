# Goal 11A — CSP and Security Headers

## 목적

production HTTP 응답에 적용할 CSP와 보안 header를 gameplay, Socket.IO와 asset 동작을 깨뜨리지 않게 도입한다.

## 선행조건

- Goal 10의 main 반영
- inline script/style, external asset, worker와 WebSocket origin inventory 완료
- controlled preview에서 CSP report 관찰 가능

## 범위

- inline bootstrap의 external module 이전 또는 nonce/hash 정책
- CSP `default-src`, `script-src`, `style-src`, `img-src`, `font-src`, `connect-src`
- Socket.IO WebSocket/polling과 asset origin 반영
- MIME sniffing, frame, referrer와 필요한 security header
- report-only → enforce 단계와 violation 관찰
- source map 공개 정책

## 제외 범위

- 인증 시스템 재설계
- 무관한 UI/asset 교체
- 근거 없는 `unsafe-inline` 상시 허용

## 완료 기준과 검증

- enforce CSP에서 네 page, sound, Canvas, PVP/PVE와 Socket.IO가 동작한다.
- expected flow에서 CSP violation과 browser console error가 없다.
- header integration test와 full Playwright가 통과한다.
- local development 정책과 production 정책이 구분된다.

## Rollback과 Merge Gate

header policy를 독립적으로 완화/revert할 수 있어야 한다. 기능 오류를 숨기기 위해 전체 CSP를 제거하지 않는다.

