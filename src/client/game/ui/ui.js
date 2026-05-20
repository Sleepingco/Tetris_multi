// =============================
// UI Adapter
// 런타임이 DOM 세부 구현을 몰라도 되도록 화면 조작을 묶어 둔다.
// =============================

/**
 * 점수, 게임오버, 미리보기 렌더링을 담당하는 UI 어댑터를 만든다.
 *
 * @param {Object} params - UI 연결에 필요한 DOM 요소와 렌더러 함수들
 * @param {HTMLElement|null} params.scoreEl - 점수 표시 요소
 * @param {HTMLElement|null} params.gameOverEl - 게임오버 레이어 요소
 * @param {HTMLElement|null} params.nextPreviewEl - 다음 조각 미리보기 컨테이너
 * @param {HTMLElement|null} params.holdPreviewEl - 홀드 미리보기 컨테이너
 * @param {number} params.nextQueueSize - 표시할 다음 조각 개수
 * @param {number} params.previewSize - 미리보기 격자 크기
 * @param {Function} params.buildNextPreview - next preview DOM 빌더
 * @param {Function} params.buildHoldPreview - hold preview DOM 빌더
 * @param {Function} params.renderNextPieces - next preview 렌더러
 * @param {Function} params.renderHoldPiece - hold preview 렌더러
 * @returns {Object} 런타임에서 사용할 UI 메서드 모음
 */
export function createGameUi({
    scoreEl,
    gameOverEl,
    nextPreviewEl,
    holdPreviewEl,
    nextQueueSize,
    previewSize,
    buildNextPreview,
    buildHoldPreview,
    renderNextPieces,
    renderHoldPiece,
}) {
    let nextPreviewCells = []
    let holdPreviewCells = null

    return {
        /**
         * 점수 표시 영역에 최신 점수를 반영한다.
         *
         * @param {number} score - 표시할 점수
         * @returns {void}
         */
        renderScore(score) {
            if (!scoreEl) return
            scoreEl.innerText = score
        },
        /**
         * 게임오버 레이어를 화면에 표시한다.
         *
         * @returns {void}
         */
        showGameOver() {
            if (!gameOverEl) return
            gameOverEl.style.display = "flex"
        },
        /**
         * 게임오버 레이어를 숨긴다.
         *
         * @returns {void}
         */
        hideGameOver() {
            if (!gameOverEl) return
            gameOverEl.style.display = "none"
        },
        /**
         * 다음 조각 미리보기 DOM을 만들고 셀 캐시를 저장한다.
         *
         * @returns {void}
         */
        buildNextPreview() {
            nextPreviewCells = buildNextPreview({
                nextPreviewEl,
                nextQueueSize,
                previewSize,
            })
        },
        /**
         * 홀드 미리보기 DOM을 만들고 셀 캐시를 저장한다.
         *
         * @returns {void}
         */
        buildHoldPreview() {
            holdPreviewCells = buildHoldPreview({
                holdPreviewEl,
                previewSize,
            })
        },
        /**
         * 저장된 next preview 셀 캐시에 큐 상태를 렌더링한다.
         *
         * @param {string[]} pieceQueue - 다음 조각 큐
         * @param {Record<string, Array<Array<[number, number]>>>} blocks - 블록 정의
         * @returns {void}
         */
        renderNextPieces(pieceQueue, blocks) {
            renderNextPieces({
                nextPreviewCells,
                pieceQueue,
                blocks,
            })
        },
        /**
         * 저장된 hold preview 셀 캐시에 홀드 조각을 렌더링한다.
         *
         * @param {string|null} holdPieceType - 홀드된 블록 타입
         * @param {Record<string, Array<Array<[number, number]>>>} blocks - 블록 정의
         * @returns {void}
         */
        renderHoldPiece(holdPieceType, blocks) {
            renderHoldPiece({
                holdPreviewCells,
                holdPieceType,
                blocks,
            })
        },
    }
}
