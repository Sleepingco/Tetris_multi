// =============================
// runtime → DOM UI 어댑터
// runtime이 selector나 class 구조를 몰라도 점수, garbage, game over, preview를 갱신하도록 DOM 작업을 묶는다.
// gameState를 저장하거나 게임 규칙을 판단하지 않고 전달받은 값을 화면에 반영한다.
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
/**
  * 페이지 DOM 요소와 preview renderer를 runtime이 호출할 작은 UI API로 감싼다.
  * preview cell 참조는 이 closure 안에서만 보관해 매 frame DOM을 다시 찾거나 만들지 않는다.
  * 요소가 없는 구성도 허용하므로 Canvas+React HUD 페이지와 기존 DOM 페이지가 같은 runtime을 쓸 수 있다.
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

        // 아래 helper와 반환 메서드는 DOM 표시만 바꾸며 gameplay 상태를 소유하지 않는다.
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
                // 단순 표시 setter는 같은 UI 경계에 있으므로 개별 규칙 함수로 해석하지 않는다.
                renderScore(score) {
                        if (!scoreEl) return
                        scoreEl.innerText = score
                },
                renderLines(lines) {
                        if (!linesEl) return
                        linesEl.innerText = lines
                },
                /**
                  * lock 전까지 대기 중인 incoming garbage 수와 위험 강조 class를 함께 갱신한다.
                  * 잘못된 값은 0으로 표시하지만 authoritative 원천 상태 자체는 변경하지 않는다.
                  */
                renderPendingGarbage(lines) {
                        if (!pendingGarbageEl) return
                        const safeLines = Number.isInteger(lines) && lines > 0 ? lines : 0
                        const incomingStatusEl = getIncomingStatusEl()

                        pendingGarbageEl.innerText = safeLines
                        setElementClass(incomingStatusEl, "is-danger", safeLines > 0)
                },
                showGameOver() {
                        if (!gameOverEl) return
                        gameOverEl.style.display = "flex"
                },
                hideGameOver() {
                        if (!gameOverEl) return
                        gameOverEl.style.display = "none"
                },
                /**
                  * next preview DOM을 한 번 만들고 이후 조각 표시에서 재사용할 cell을 저장한다.
                  */
                buildNextPreview() {
                        nextPreviewCells = buildNextPreview({
                                nextPreviewEl,
                                nextQueueSize,
                                previewSize,
                        })
                },
                /**
                  * hold preview DOM을 한 번 만들고 이후 조각 표시에서 재사용할 cell을 저장한다.
                  */
                buildHoldPreview() {
                        holdPreviewCells = buildHoldPreview({
                                holdPreviewEl,
                                previewSize,
                        })
                },
                renderNextPieces(pieceQueue, blocks) {
                        renderNextPieces({
                                nextPreviewCells,
                                pieceQueue,
                                blocks,
                        })
                },
                renderHoldPiece(holdPieceType, blocks) {
                        renderHoldPiece({
                                holdPreviewCells,
                                holdPieceType,
                                blocks,
                        })
                },
        }
}
