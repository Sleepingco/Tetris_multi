import { HIDDEN_ROWS, VISIBLE_ROWS, BOARD_ROWS } from "../state/config.ts";

export const UPPER_DISPLAY_ROWS = 4;

export function internalRowToCanvasRow(row: number): number {
        return UPPER_DISPLAY_ROWS + row - HIDDEN_ROWS;
}
// =============================
// Canvas와 preview 렌더러
// core/runtime이 확정한 board, activePiece, animation 진행값을 화면에 그리기만 한다.
// 충돌, lock, line clear 같은 게임 규칙은 결정하지 않으며 렌더용 계산도 원본 상태를 바꾸지 않는다.
// =============================

import type { Board } from "../core/board.ts";
import type { PieceState, PlaceablePieceState } from "../core/piece.ts";
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

export type HardDropEffect = {
        piece: PlaceablePieceState;
        fromRow: number;
        progress: number;
};

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
  * line clear 후반부에 한 cell이 네 방향으로 흩어지는 파편 좌표를 계산한다.
  * 진행률을 0~1로 제한하며 Canvas를 직접 그리지 않아 애니메이션 계산을 독립적으로 검사할 수 있다.
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
  * runtime이 전달한 Canvas에서 2D 그리기 문맥을 얻는다.
  * Canvas가 없는 테스트나 React mount 전에는 null을 반환해 렌더 단계를 건너뛰게 한다.
  */
export function getBoardContext(canvasEl: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
        if (!canvasEl) return null;
        return canvasEl.getContext("2d");
}

// 아래 draw helper들은 cell 좌표를 pixel 좌표로 바꾸고 한 프레임 안의 시각 효과만 그린다.
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
  * next slot별 preview grid를 한 번 만들고, 이후 갱신에 재사용할 cell 참조를 반환한다.
  * gameState의 queue를 읽지 않으며 DOM 구조 생성만 담당한다.
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
                const cells = buildPreviewGrid(slot, previewSize)
                nextPreviewEl.append(slot)
                previewCells.push(cells)
        }

        return previewCells
}

/**
  * hold preview grid를 한 번 만들고 이후 갱신에 재사용할 cell 참조를 반환한다.
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
  * 한 프레임을 `배경 grid → 고정 board → ghost piece → active piece` 순서로 Canvas에 그린다.
  * `flashRows`에는 row와 진행률이 들어올 수 있으며, 해당 줄만 변형·파편 효과로 표시한다.
  * board와 activePiece는 읽기만 하고 gameplay 상태를 변경하지 않는다.
  */
export function renderBoardCanvas({
        ctx,
        board,
        activePiece,
        rows,
        cols,
        blocks,
        flashRows,
        hardDropEffect = null,
}: {
        ctx: CanvasRenderingContext2D | null;
        board: Board;
        activePiece: RenderedPiece | null;
        rows: number;
        cols: number;
        blocks: BlockDefinitions;
        flashRows: FlashRow[];
        hardDropEffect?: HardDropEffect | null;
        isFlash?: boolean;
}): void {
        if (!ctx) return;

        const width = cols * CELL_SIZE;
        const bufferRules = board.length === BOARD_ROWS;
        const hiddenRows = bufferRules ? HIDDEN_ROWS : 0;
        const upperRows = bufferRules ? UPPER_DISPLAY_ROWS : 0;
        const visibleRows = bufferRules ? VISIBLE_ROWS : rows;
        const height = (upperRows + visibleRows) * CELL_SIZE;
        if (ctx.canvas.height !== height) ctx.canvas.height = height;
        const canvasStyle = getComputedStyle(ctx.canvas);
        const gridColor = canvasStyle.getPropertyValue("--game-board-grid").trim() || "rgba(255, 255, 255, 0.04)";

        // === 보드 지우기 ===
        ctx.clearRect(0, 0, width, height);

        // === 배경 그리드 선(가이드) 그리기 ===
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let r = 1; r <= visibleRows; r++) { ctx.moveTo(0, (r + upperRows) * CELL_SIZE); ctx.lineTo(width, (r + upperRows) * CELL_SIZE); }
        for (let c = 0; c <= cols; c++) { ctx.moveTo(c * CELL_SIZE, upperRows * CELL_SIZE); ctx.lineTo(c * CELL_SIZE, height); }
        ctx.stroke();

        // 모든 cell과 연출은 동일한 내부 행 좌표를 쓴다.
        ctx.save();
        ctx.translate(0, (upperRows - hiddenRows) * CELL_SIZE);
        // === 고정된 플록(seized) 그리기 ===
        ctx.save();
        for (let row = Math.max(0, hiddenRows - upperRows); row < board.length; row++) {
                // 이 행이 삭제되는(번쩍이는) 중이라면 애니메이션 효과 적용
                const isFlashing = flashRows && flashRows.some(fr => typeof fr === 'object' ? fr.row === row : fr === row);

                if (isFlashing) {
                        const flashData = flashRows.find(fr => typeof fr === 'object' ? fr.row === row : fr === row);
                        const progress = typeof flashData === "object" ? flashData.progress : 0;

                        const strength = Math.min(4, flashRows.length);

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

                        scale = 1 + (scale - 1) * (0.65 + strength * 0.15);

                        // 행 중앙 기준 변환 적용
                        ctx.save();
                        const rowCenterY = row * CELL_SIZE + (CELL_SIZE / 2);
                        const rowCenterX = width / 2;

                        ctx.translate(rowCenterX, rowCenterY + translateY);
                        ctx.scale(scale, scale);
                        ctx.translate(-rowCenterX, -rowCenterY);
                        ctx.globalAlpha = Math.max(0, opacity);

                        // 하얗게 빛나는 배경 그리기
                        ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + strength * 0.12})`;
                        ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
                        ctx.shadowBlur = 8 + strength * 4;
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

        if (hardDropEffect) {
                const { piece, fromRow, progress } = hardDropEffect;
                const fade = 1 - Math.max(0, Math.min(1, progress));
                const trailHeight = Math.min(120, Math.max(0, piece.row - fromRow) * CELL_SIZE);
                ctx.save();
                ctx.fillStyle = BLOCK_COLORS[piece.pieceType];
                blocks[piece.pieceType][piece.rotation].forEach(([offsetX, offsetY]) => {
                        const x = (piece.col + offsetX) * CELL_SIZE + 2;
                        const y = (piece.row + offsetY) * CELL_SIZE;
                        ctx.globalAlpha = fade * 0.14;
                        ctx.fillRect(x, y - trailHeight, CELL_SIZE - 4, trailHeight);
                        ctx.globalAlpha = fade * 0.85;
                        ctx.fillRect(x, y + CELL_SIZE - 3, CELL_SIZE - 4, 3);
                });
                ctx.restore();
        }

        if (!activePiece || !activePiece.pieceType) { ctx.restore(); return; }

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
        ctx.restore();
        if (bufferRules && currentOffsets.every(([, y]) => internalRowToCanvasRow(activePiece.row + y) < 0)) {
                ctx.fillStyle = color;
                for (const col of new Set(currentOffsets.map(([x]) => activePiece.col + x))) {
                        ctx.fillRect(col * CELL_SIZE + 3, 1, CELL_SIZE - 6, 4);
                }
        }

}

/**
  * cached preview cell을 초기화한 뒤 queue 앞쪽 조각들을 차례로 표시한다.
  * queue를 소비하지 않으므로 다음 스폰 순서에는 영향을 주지 않는다.
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
  * cached hold cell을 초기화하고 현재 hold 조각이 있으면 기본 회전 모양을 표시한다.
  */
export function renderHoldPiece({ holdPreviewCells, holdPieceType, blocks }: {
        holdPreviewCells: PreviewCells | null;
        holdPieceType: PieceType | null;
        blocks: BlockDefinitions;
}): void {
        resetPreviewCells(holdPreviewCells)
        renderPieceOnCells(holdPreviewCells, holdPieceType, blocks)
}

// preview helper는 DOM 생성, class 초기화, 기본 회전 모양 표시를 한 책임씩 나눠 수행한다.
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

function resetPreviewCells(cells: PreviewCells | null): void {
        if (!cells) return
        cells.flat().forEach(cell => {
                cell.className = "next-cell"
        })
}

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
