// =============================
// 보드 지표
// 같은 board를 숫자 특징으로 바꿔 휴리스틱 AI, 로그 분석, ML feature 생성에서 공유한다.
// 모든 함수는 board를 읽기만 하며 게임 규칙이나 화면 상태를 변경하지 않는다.
// =============================

export type BoardMetrics = {
    columnHeights: number[];
    aggregateHeight: number;
    maxHeight: number;
    holes: number;
    bumpiness: number;
    completeLines: number;
};

function isFilledCell(cell: unknown): boolean {
    return cell !== null && cell !== undefined;
}

function getBoardColumnCount(board: unknown): number {
    if (!Array.isArray(board) || board.length === 0) return 0;
    return Array.isArray(board[0]) ? board[0].length : 0;
}

/**
 * 각 column에서 가장 위에 있는 블록부터 바닥까지의 높이를 계산한다.
 * 중간에 빈칸이 있어도 가장 위 블록을 기준으로 하며, 빈 column의 높이는 0이다.
 */
function getColumnHeights(board: unknown): number[] {
    const boardRows = Array.isArray(board) ? board : [];
    const rows = boardRows.length;
    const cols = getBoardColumnCount(board);
    const heights = Array(cols).fill(0);

    for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
            if (isFilledCell(boardRows[row]?.[col])) {
                heights[col] = rows - row;
                break;
            }
        }
    }

    return heights;
}

/**
 * 같은 column에서 블록이 한 번 나온 뒤 그 아래에 있는 빈칸 수를 센다.
 * 이 빈칸은 위 블록을 치우기 전에는 채우기 어려워 AI가 위험도로 사용한다.
 */
function countHoles(board: unknown): number {
    const boardRows = Array.isArray(board) ? board : [];
    const rows = boardRows.length;
    const cols = getBoardColumnCount(board);
    let holes = 0;

    for (let col = 0; col < cols; col++) {
        let hasBlockAbove = false;

        for (let row = 0; row < rows; row++) {
            if (isFilledCell(boardRows[row]?.[col])) {
                hasBlockAbove = true;
                continue;
            }

            if (hasBlockAbove) {
                holes++;
            }
        }
    }

    return holes;
}

/**
 * 모든 column이 채워진 row 수를 센다.
 * 실제 줄 삭제는 하지 않으며, 배치 전후 결과를 평가할 숫자만 반환한다.
 */
function countCompleteLines(board: unknown): number {
    const boardRows = Array.isArray(board) ? board : [];
    const cols = getBoardColumnCount(board);
    if (cols === 0) return 0;

    return boardRows.filter((row: unknown) => {
        if (!Array.isArray(row) || row.length < cols) return false;
        return row.slice(0, cols).every(isFilledCell);
    }).length;
}

/**
 * board 하나를 AI와 ML이 사용하는 공통 지표 묶음으로 변환한다.
 * - `aggregateHeight`는 전체 높이 부담, `maxHeight`는 즉시 top-out 위험을 나타낸다.
 * - `holes`는 메우기 어려운 빈칸, `bumpiness`는 인접 column의 높이 차이 합이다.
 * - 호출자는 보통 배치 전후 지표의 차이를 feature로 사용한다.
 */
export function getBoardMetrics(board: unknown): BoardMetrics {
    const columnHeights = getColumnHeights(board);

    return {
        columnHeights,
        aggregateHeight: columnHeights.reduce((total, height) => total + height, 0),
        maxHeight: Math.max(0, ...columnHeights),
        holes: countHoles(board),
        bumpiness: columnHeights.reduce((total, height, index) => {
            if (index === columnHeights.length - 1) return total;
            return total + Math.abs(height - columnHeights[index + 1]);
        }, 0),
        completeLines: countCompleteLines(board),
    };
}
