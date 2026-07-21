// =============================
// Renderer Helpers (DOM only)
// =============================

import type { Board } from "../core/board.ts";
import type { PieceState } from "../core/piece.ts";
import type { BlockDefinitions, PieceType } from "../state/blocks.ts";

const BLOCK_COLORS: Record<string, string> = {
        tree: "#8B5CF6",   // Violet
        bar: "#0EA5E9",    // Sky
        square: "#F59E0B", // Amber
        zee: "#EF4444",    // Red
        eleft: "#3B82F6",  // Blue
        eright: "#F97316", // Orange
        ess: "#10B981",    // Emerald
        garbage: "#64748B" // Slate
};

const CELL_SIZE = 30; // 300px width / 10 cols
const BREAK_START_PROGRESS = 0.45;

export type PreviewCells = HTMLLIElement[][];
export type NextPreviewCells = PreviewCells[];

export type LineClearFragment = {
        x: number;
        y: number;
        width: number;
        height: number;
        alpha: number;
};

type FlashRow = number | { row: number; progress: number };
type RenderedPiece = PieceState & { ghostRow?: number };

/**
  * 라인 클리어 후반부에 블록이 깨지는 파편 좌표를 계산한다.
  *
  * @param {Object} params
  * @param {number} params.row - 보드 행 인덱스
  * @param {number} params.col - 보드 열 인덱스
  * @param {number} params.progress - 라인 클리어 애니메이션 진행률(0~1)
  * @param {number} params.cellSize - 셀 한 칸 크기
  * @returns {Array<{x: number, y: number, width: number, height: number, alpha: number}>} 파편 렌더 정보
  */
export function createLineClearFragments({
        row,
        col,
        progress,
        cellSize = CELL_SIZE,
}: {
        row: number;
        col: number;
        progress: number;
        cellSize?: number;
}): LineClearFragment[] {
        const safeProgress = Number.isFinite(progress)
                ? Math.max(0, Math.min(progress, 1))
                : 0;
        if (safeProgress < BREAK_START_PROGRESS) return [];

        const breakProgress = (safeProgress - BREAK_START_PROGRESS) / (1 - BREAK_START_PROGRESS);
        const baseX = col * cellSize;
        const baseY = row * cellSize;
        const centerX = baseX + cellSize / 2;
        const centerY = baseY + cellSize / 2;
        const fragmentSize = Math.max(5, cellSize * (0.42 - breakProgress * 0.12));
        const travel = cellSize * (0.15 + breakProgress * 0.65);
        const alpha = Math.max(0, 1 - breakProgress * 0.95);

        return [
                [-1, -1],
                [1, -1],
                [-1, 1],
                [1, 1],
        ].map(([xDirection, yDirection]) => ({
                x: centerX + xDirection * travel - fragmentSize / 2,
                y: centerY + yDirection * travel - fragmentSize / 2,
                width: fragmentSize,
                height: fragmentSize,
                alpha,
        }));
}

/**
  * 대상 Canvas 요소를 가져오고 컨텍스트를 반환합니다.
  *
  * @param {HTMLCanvasElement} canvasEl - 대상 캔버스
  * @returns {CanvasRenderingContext2D|null} 2D 컨텍스트
  */
export function getBoardContext(canvasEl: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
        if (!canvasEl) return null;
        return canvasEl.getContext("2d");
}

/**
  * Canvas 좌표계에 블록 한 칸을 현재 테마 색상으로 그린다.
  *
  * @param {CanvasRenderingContext2D} ctx - 대상 2D 컨텍스트
  * @param {number} col - 블록 열 인덱스
  * @param {number} row - 블록 행 인덱스
  * @param {string} color - 채울 색상
  * @returns {void}
  */
function drawBlock(ctx: CanvasRenderingContext2D, col: number, row: number, color: string): void {
        const x = col * CELL_SIZE;
        const y = row * CELL_SIZE;
        const padding = 1;
        const size = CELL_SIZE - padding * 2;

        // 모던하고 심플한 플랫 버튼형 디자인
        ctx.fillStyle = color;
        if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(x + padding, y + padding, size, size, 4);
                ctx.fill();
        } else {
                ctx.fillRect(x + padding, y + padding, size, size);
        }

        // 안쪽 상단의 은은한 하이라이트 (글래스 느낌 보조)
        ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
        if (ctx.roundRect) {
                ctx.beginPath();
                // 상단 절반 정도에 하이라이트
                ctx.roundRect(x + padding, y + padding, size, size * 0.4, 4);
                ctx.fill();
        } else {
                ctx.fillRect(x + padding, y + padding, size, size * 0.4);
        }
}

function drawBlockFragment(
        ctx: CanvasRenderingContext2D,
        fragment: LineClearFragment,
        color: string,
): void {
        ctx.save();
        const inheritedAlpha = Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1;
        ctx.globalAlpha = inheritedAlpha * Math.max(0, Math.min(fragment.alpha, 1));
        ctx.fillStyle = color;

        if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(fragment.x, fragment.y, fragment.width, fragment.height, 3);
                ctx.fill();
        } else {
                ctx.fillRect(fragment.x, fragment.y, fragment.width, fragment.height);
        }

        ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
        ctx.fillRect(fragment.x, fragment.y, fragment.width, fragment.height * 0.35);
        ctx.restore();
}

function drawBreakingBlock(
        ctx: CanvasRenderingContext2D,
        col: number,
        row: number,
        color: string,
        progress: number,
): void {
        const fragments = createLineClearFragments({ row, col, progress });
        if (fragments.length === 0) {
                drawBlock(ctx, col, row, color);
                return;
        }

        fragments.forEach(fragment => {
                drawBlockFragment(ctx, fragment, color);
        });
}
/**
  * 다음 블록 미리보기 DOM(4x4)을 2개 생성하고 셀 참조를 반환한다.
  *
  * @param {Object} params
  * @param {HTMLElement} params.nextPreviewEl - 미리보기 컨테이너
  * @param {number} params.nextQueueSize - 표시할 다음 블록 개수
  * @param {number} params.previewSize - 미리보기 그리드 크기(보통 4)
  * @returns {Array<Array<Array<HTMLLIElement>>>} 미리보기 셀 참조
  */
export function buildNextPreview({ nextPreviewEl, nextQueueSize, previewSize }: {
        nextPreviewEl: HTMLElement | null;
        nextQueueSize: number;
        previewSize: number;
}): NextPreviewCells {
        if (!nextPreviewEl) return []
        nextPreviewEl.innerHTML = ""
        const previewCells: NextPreviewCells = []

        for (let i = 0; i < nextQueueSize; i++) {
                const slot = document.createElement("div")
                slot.classList.add("next-slot")
                const label = document.createElement("span")
                label.classList.add("slot-label")
                label.textContent = `Next ${i + 1}`
                const cells = buildPreviewGrid(slot, previewSize)
                nextPreviewEl.append(slot)
                previewCells.push(cells)
        }

        return previewCells
}

/**
  * 홀드 블록 미리보기 DOM(4x4)을 생성하고 셀 참조를 반환한다.
  *
  * @param {Object} params
  * @param {HTMLElement} params.holdPreviewEl - 홀드 컨테이너
  * @param {number} params.previewSize - 미리보기 그리드 크기(보통 4)
  * @returns {Array<Array<HTMLLIElement>>|null} 홀드 셀 참조
  */
export function buildHoldPreview({ holdPreviewEl, previewSize }: {
        holdPreviewEl: HTMLElement | null;
        previewSize: number;
}): PreviewCells | null {
        if (!holdPreviewEl) return null
        holdPreviewEl.innerHTML = ""
        return buildPreviewGrid(holdPreviewEl, previewSize)
}

/**
  * 엔진 보드와 activePiece 상태를 Canvas에 렌더링합니다.
  *
  * @param {Object} params
  * @param {CanvasRenderingContext2D} params.ctx - 2D 컨텍스트
  * @param {Array<Array<string|null>>} params.board - 엔진 보드 상태
  * @param {{pieceType: string, rotation: number, row: number, col: number, ghostRow?: number}} params.activePiece - 활성 조각(및 고스트 피스 정보)
  * @param {number} params.rows - 보드 높이
  * @param {number} params.cols - 보드 너비
  * @param {Record<string, Array<Array<[number, number]>>>} params.blocks - 블록 정의
  * @param {Array<number>} params.flashRows - 라인 클리어 시 번쩍임 효과를 줄 행 인덱스 배열
  * @returns {void}
  */
export function renderBoardCanvas({
        ctx,
        board,
        activePiece,
        rows,
        cols,
        blocks,
        flashRows,
}: {
        ctx: CanvasRenderingContext2D | null;
        board: Board;
        activePiece: RenderedPiece | null;
        rows: number;
        cols: number;
        blocks: BlockDefinitions;
        flashRows: FlashRow[];
        isFlash?: boolean;
}): void {
        if (!ctx) return;

        const width = cols * CELL_SIZE;
        const height = rows * CELL_SIZE;
        const canvasStyle = getComputedStyle(ctx.canvas);
        const gridColor = canvasStyle.getPropertyValue("--game-board-grid").trim() || "rgba(255, 255, 255, 0.04)";

        // === 보드 지우기 ===
        ctx.clearRect(0, 0, width, height);

        // === 배경 그리드 선(가이드) 그리기 ===
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let r = 0; r <= rows; r++) { ctx.moveTo(0, r * CELL_SIZE); ctx.lineTo(width, r * CELL_SIZE); }
        for (let c = 0; c <= cols; c++) { ctx.moveTo(c * CELL_SIZE, 0); ctx.lineTo(c * CELL_SIZE, height); }
        ctx.stroke();

        // === 고정된 플록(seized) 그리기 ===
        ctx.save();
        for (let row = 0; row < rows; row++) {
                // 이 행이 삭제되는(번쩍이는) 중이라면 애니메이션 효과 적용
                const isFlashing = flashRows && flashRows.some(fr => typeof fr === 'object' ? fr.row === row : fr === row);

                if (isFlashing) {
                        const flashData = flashRows.find(fr => typeof fr === 'object' ? fr.row === row : fr === row);
                        const progress = typeof flashData === "object" ? flashData.progress : 0;

                        // line clear flash의 밝기 변화를 계산한다.
                        let scale = 1;
                        let translateY = 0;
                        let opacity = 1;

                        if (progress < 0.15) {
                                scale = 1;
                                opacity = 1 - (progress / 0.15) * 0.65; // 1 -> 0.35
                        } else if (progress < 0.35) {
                                scale = 1 + ((progress - 0.15) / 0.20) * 0.08; // 1 -> 1.08
                                opacity = 0.35 + ((progress - 0.15) / 0.20) * 0.65; // 0.35 -> 1
                        } else if (progress < 0.60) {
                                scale = 1.08 + ((progress - 0.35) / 0.25) * 0.06; // 1.08 -> 1.14
                                opacity = 1 - ((progress - 0.35) / 0.25) * 0.3; // 1 -> 0.7
                        } else {
                                scale = 1.14 - ((progress - 0.60) / 0.40) * 0.46; // 1.14 -> 0.68
                                opacity = 0.7 - ((progress - 0.60) / 0.40) * 0.7; // 0.7 -> 0
                                translateY = -((progress - 0.60) / 0.40) * 24; // 0 -> -24
                        }

                        // 행 중앙 기준 변환 적용
                        ctx.save();
                        const rowCenterY = row * CELL_SIZE + (CELL_SIZE / 2);
                        const rowCenterX = width / 2;

                        ctx.translate(rowCenterX, rowCenterY + translateY);
                        ctx.scale(scale, scale);
                        ctx.translate(-rowCenterX, -rowCenterY);
                        ctx.globalAlpha = Math.max(0, opacity);

                        // 하얗게 빛나는 배경 그리기
                        ctx.fillStyle = "rgba(255, 255, 255, 1)";
                        ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
                        ctx.shadowBlur = 15;
                        ctx.fillRect(0, row * CELL_SIZE, width, CELL_SIZE);

                        // 해당 줄의 블록들도 투명도/크기가 같이 변하도록 그림
                        ctx.shadowBlur = 0;
                        for (let col = 0; col < cols; col++) {
                                const pieceType = board[row][col];
                                if (pieceType) {
                                        drawBreakingBlock(ctx, col, row, BLOCK_COLORS[pieceType], progress);
                                }
                        }
                        ctx.restore();
                        continue;
                }

                // 일반 블록 렌더링
                for (let col = 0; col < cols; col++) {
                        const pieceType = board[row][col];
                        if (pieceType) {
                                drawBlock(ctx, col, row, BLOCK_COLORS[pieceType]);
                        }
                }
        }
        ctx.restore();

        if (!activePiece || !activePiece.pieceType) return;

        const currentOffsets = blocks[activePiece.pieceType][activePiece.rotation];
        const color = BLOCK_COLORS[activePiece.pieceType];

        // === 고스트 피스(도착 지점) 그리기 ===
        const ghostRow = activePiece.ghostRow;
        if (ghostRow !== undefined && activePiece.pieceType) {
                ctx.globalAlpha = 0.25; // 반투명
                currentOffsets.forEach(([offsetX, offsetY]) => {
                        const targetCol = activePiece.col + offsetX;
                        const targetRow = ghostRow + offsetY;
                        if (targetRow >= 0) {
                                drawBlock(ctx, targetCol, targetRow, color);
                        }
                });
                ctx.globalAlpha = 1.0; // 투명도 복구
        }

        // === 현재 떨어지는 블록 그리기 ===
        currentOffsets.forEach(([offsetX, offsetY]) => {
                const targetCol = activePiece.col + offsetX;
                const targetRow = activePiece.row + offsetY;
                if (targetRow >= 0) { // 화면 밖 위쪽(음수 row)은 그리지 않음
                        drawBlock(ctx, targetCol, targetRow, color);
                }
        });
}

/**
  * 다음에 등장할 블록 2개를 미리보기 영역에 렌더링한다.
  *
  * @param {Object} params
  * @param {Array<Array<Array<HTMLLIElement>>>} params.nextPreviewCells - 미리보기 셀 캐시
  * @param {Array<string>} params.pieceQueue - 블록 큐
  * @param {Record<string, Array<Array<[number, number]>>>} params.blocks - 블록 정의
  * @returns {void}
  */
export function renderNextPieces({ nextPreviewCells, pieceQueue, blocks }: {
        nextPreviewCells: NextPreviewCells;
        pieceQueue: PieceType[];
        blocks: BlockDefinitions;
}): void {
        if (!nextPreviewCells) return

        nextPreviewCells.forEach((cells, idx) => {
                resetPreviewCells(cells)
                renderPieceOnCells(cells, pieceQueue[idx], blocks)
        })
}

/**
  * 홀드 영역에 홀드된 블록을 렌더링한다.
  *
  * @param {Object} params
  * @param {Array<Array<HTMLLIElement>>|null} params.holdPreviewCells - 홀드 셀 캐시
  * @param {string|null} params.holdPieceType - 홀드된 블록 타입
  * @param {Record<string, Array<Array<[number, number]>>>} params.blocks - 블록 정의
  * @returns {void}
  */
export function renderHoldPiece({ holdPreviewCells, holdPieceType, blocks }: {
        holdPreviewCells: PreviewCells | null;
        holdPieceType: PieceType | null;
        blocks: BlockDefinitions;
}): void {
        resetPreviewCells(holdPreviewCells)
        renderPieceOnCells(holdPreviewCells, holdPieceType, blocks)
}

/**
  * 4x4 미리보기 그리드를 생성하고 셀 참조를 반환한다.
  *
  * @param {HTMLElement} container - 그리드를 넣을 컨테이너
  * @param {number} size - 그리드 크기
  * @returns {Array<Array<HTMLLIElement>>} 생성된 셀 참조
  */
function buildPreviewGrid(container: HTMLElement, size: number): PreviewCells {
        const cells: PreviewCells = Array.from({ length: size }, () => [])
        const grid = document.createElement("ul")
        grid.classList.add("next-grid")

        for (let row = 0; row < size; row++) {
                for (let col = 0; col < size; col++) {
                        const cell = document.createElement("li")
                        cell.classList.add("next-cell")
                        grid.append(cell)
                        cells[row].push(cell)
                }
        }

        container.append(grid)
        return cells
}

/**
  * 미리보기 셀의 클래스를 초기 상태로 돌린다.
  *
  * @param {Array<Array<HTMLLIElement>>|null} cells - 초기화할 셀 배열
  * @returns {void}
  */
function resetPreviewCells(cells: PreviewCells | null): void {
        if (!cells) return
        cells.flat().forEach(cell => {
                cell.className = "next-cell"
        })
}

/**
  * 지정된 셀 그리드에 블록 모양을 렌더링한다.
  *
  * @param {Array<Array<HTMLLIElement>>|null} cells - 렌더할 셀 그리드
  * @param {string|null} pieceType - 표시할 블록 타입
  * @param {Record<string, Array<Array<[number, number]>>>} blocks - 블록 정의
  * @returns {void}
  */
function renderPieceOnCells(
        cells: PreviewCells | null,
        pieceType: PieceType | null | undefined,
        blocks: BlockDefinitions,
): void {
        if (!cells || !pieceType) return
        const offsets = blocks[pieceType][0]
        const minX = Math.min(...offsets.map(([x]) => x))
        const minY = Math.min(...offsets.map(([, y]) => y))

        offsets.forEach(([offsetX, offsetY]) => {
                const row = offsetY - minY
                const col = offsetX - minX
                const cell = cells[row]?.[col]
                if (!cell) return
                cell.classList.add(pieceType, "preview")
        })
}
