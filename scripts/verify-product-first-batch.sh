#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 완료 표시는 실제 검증 명령이 성공한 항목에만 출력한다.
bash scripts/verify.sh
printf '[PASS] 전체 타입·빌드·artifact·unit 검증\n'
printf '[PASS] B02 반복 입력·취소·입력 한도\n'
npm run test:e2e
printf '[PASS] B01 모바일 컨트롤 및 기존 플레이 회귀\n'
printf '[PASS] B03 친구 대전 안내\n'
printf '[PASS] B04 초대 링크·오류·기존 방 충돌 처리\n'
printf '기존 외부 artifact 조건부 skip 여부는 위 테스트 집계를 확인하세요.\n'
printf '첫 묶음 자동 검증 Todo 100%% PASS. 실제 Android/iOS 조작 검증은 별도입니다.\n'
