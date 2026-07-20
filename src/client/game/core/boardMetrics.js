// =============================
// Board Metrics
// 휴리스틱 AI와 ML feature 생성을 위한 순수 board 평가 함수 모음이다.
// =============================

function isFilledCell(cell) {
    return cell !== null && cell !== undefined;
}

function getBoardColumnCount(board) {
    if (!Array.isArray(board) || board.length === 0) return 0;
    return Array.isArray(board[0]) ? board[0].length : 0;
}

/**
 * 각 column의 쌓인 높이를 계산한다.
 *
 * @param {Array<Array<string|null>>} board - 평가할 board
 * @returns {number[]} column별 높이
 */
function getColumnHeights(board) {
    const rows = Array.isArray(board) ? board.length : 0;
    const cols = getBoardColumnCount(board);
    const heights = Array(cols).fill(0);

    for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
            if (isFilledCell(board[row]?.[col])) {
                heights[col] = rows - row;
                break;
            }
        }
    }

    return heights;
}

/**
 * 블록 아래에 있는 빈 칸 수를 계산한다.
 *
 * @param {Array<Array<string|null>>} board - 평가할 board
 * @returns {number} hole 수
 */
function countHoles(board) {
    const rows = Array.isArray(board) ? board.length : 0;
    const cols = getBoardColumnCount(board);
    let holes = 0;

    for (let col = 0; col < cols; col++) {
        let hasBlockAbove = false;

        for (let row = 0; row < rows; row++) {
            if (isFilledCell(board[row]?.[col])) {
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
 * 완성된 line 수를 계산한다.
 *
 * @param {Array<Array<string|null>>} board - 평가할 board
 * @returns {number} 모든 cell이 채워진 row 수
 */
function countCompleteLines(board) {
    const cols = getBoardColumnCount(board);
    if (cols === 0) return 0;

    return board.filter(row => {
        if (!Array.isArray(row) || row.length < cols) return false;
        return row.slice(0, cols).every(isFilledCell);
    }).length;
}

/**
 * board 평가 지표를 한 번에 계산한다.
 *
 * @param {Array<Array<string|null>>} board - 평가할 board
 * @returns {{
 *   columnHeights: number[],
 *   aggregateHeight: number,
 *   maxHeight: number,
 *   holes: number,
 *   bumpiness: number,
 *   completeLines: number
 * }} board metrics
 */
export function getBoardMetrics(board) {
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
