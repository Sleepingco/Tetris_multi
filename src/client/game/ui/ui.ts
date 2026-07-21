// =============================

import type { BlockDefinitions, PieceType } from "../state/blocks.ts";
import type { NextPreviewCells, PreviewCells } from "../render/tetrisRender.ts";

type ClassElement = { classList?: Pick<DOMTokenList, "add" | "remove"> };
type TextElement = ClassElement & {
        innerText: string | number;
        classList?: DOMTokenList;
        closest?: (selector: string) => Element | null;
        parentElement?: ClassElement | null;
};
type GameOverElement = { style: { display: string } };

type GameUiOptions = {
        scoreEl: TextElement | null;
        linesEl: TextElement | null;
        pendingGarbageEl: TextElement | null;
        gameOverEl: GameOverElement | null;
        nextPreviewEl: HTMLElement | null;
        holdPreviewEl: HTMLElement | null;
        nextQueueSize: number;
        previewSize: number;
        buildNextPreview: (options: {
                nextPreviewEl: HTMLElement | null;
                nextQueueSize: number;
                previewSize: number;
        }) => NextPreviewCells;
        buildHoldPreview: (options: {
                holdPreviewEl: HTMLElement | null;
                previewSize: number;
        }) => PreviewCells | null;
        renderNextPieces: (options: {
                nextPreviewCells: NextPreviewCells;
                pieceQueue: PieceType[];
                blocks: BlockDefinitions;
        }) => void;
        renderHoldPiece: (options: {
                holdPreviewCells: PreviewCells | null;
                holdPieceType: PieceType | null;
                blocks: BlockDefinitions;
        }) => void;
};

export type GameUi = {
        renderScore: (score: number) => void;
        renderLines: (lines: number) => void;
        renderPendingGarbage: (lines: number) => void;
        showGameOver: () => void;
        hideGameOver: () => void;
        buildNextPreview: () => void;
        buildHoldPreview: () => void;
        renderNextPieces: (pieceQueue: PieceType[], blocks: BlockDefinitions) => void;
        renderHoldPiece: (pieceType: PieceType | null, blocks: BlockDefinitions) => void;
};
// UI Adapter
// 런타임이 DOM 세부 구현을 몰라도 되도록 화면 조작을 묶어 둔다.
// =============================

/**
  * 점수, 게임오버, 미리보기 렌더링을 담당하는 UI 어댑터를 만든다.
  *
  * @param {Object} params - UI 연결에 필요한 DOM 요소와 렌더러 함수들
  * @param {HTMLElement|null} params.scoreEl - 점수 표시 요소
  * @param {HTMLElement|null} params.linesEl - 삭제한 줄 수 표시 요소
  * @param {HTMLElement|null} params.pendingGarbageEl - 대기 garbage 표시 요소
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
        linesEl,
        pendingGarbageEl,
        gameOverEl,
        nextPreviewEl,
        holdPreviewEl,
        nextQueueSize,
        previewSize,
        buildNextPreview,
        buildHoldPreview,
        renderNextPieces,
        renderHoldPiece,
}: GameUiOptions): GameUi {
        let nextPreviewCells: NextPreviewCells = []
        let holdPreviewCells: PreviewCells | null = null

        function getIncomingStatusEl(): ClassElement | null {
                return pendingGarbageEl?.closest?.(".stat--incoming")
                        ?? pendingGarbageEl?.parentElement
                        ?? pendingGarbageEl
                        ?? null
        }

        function setElementClass(element: ClassElement | null, className: string, enabled: boolean): void {
                const classList = element?.classList
                if (!classList) return

                if (enabled) {
                        classList.add(className)
                        return
                }

                classList.remove(className)
        }

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
                  * 삭제한 줄 수 표시 영역에 최신 값을 반영한다.
                  *
                  * @param {number} lines - 표시할 누적 line 수
                  * @returns {void}
                  */
                renderLines(lines) {
                        if (!linesEl) return
                        linesEl.innerText = lines
                },
                /**
                  * lock 전까지 대기 중인 incoming garbage 수를 표시한다.
                  *
                  * @param {number} lines - 표시할 pending garbage 수
                  * @returns {void}
                  */
                renderPendingGarbage(lines) {
                        if (!pendingGarbageEl) return
                        const safeLines = Number.isInteger(lines) && lines > 0 ? lines : 0
                        const incomingStatusEl = getIncomingStatusEl()

                        pendingGarbageEl.innerText = safeLines
                        setElementClass(incomingStatusEl, "is-danger", safeLines > 0)
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
