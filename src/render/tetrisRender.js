// =============================
// Renderer Helpers (DOM only)
// =============================

/**
 * 20x10 보드 DOM을 재구성하고 셀 참조(boardCells)를 반환한다.
 *
 * @param {Object} params
 * @param {HTMLElement} params.boardEl - 보드 컨테이너(ul)
 * @param {number} params.rows - 보드 높이
 * @param {number} params.cols - 보드 너비
 * @returns {Array<Array<HTMLLIElement>>} 생성된 보드 셀 참조
 */
export function buildBoard({ boardEl, rows, cols }) {
    if (!boardEl) return []
    boardEl.innerHTML = ""
    const boardCells = []

    for (let row = 0; row < rows; row++) {
        const rowLi = document.createElement("li")
        const rowUl = document.createElement("ul")
        const cellRow = []

        for (let col = 0; col < cols; col++) {
            const cell = document.createElement("li")
            rowUl.append(cell)
            cellRow.push(cell)
        }

        rowLi.append(rowUl)
        boardEl.append(rowLi)
        boardCells.push(cellRow)
    }

    return boardCells
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
export function buildNextPreview({ nextPreviewEl, nextQueueSize, previewSize }) {
    if (!nextPreviewEl) return []
    nextPreviewEl.innerHTML = ""
    const previewCells = []

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
export function buildHoldPreview({ holdPreviewEl, previewSize }) {
    if (!holdPreviewEl) return null
    holdPreviewEl.innerHTML = ""
    return buildPreviewGrid(holdPreviewEl, previewSize)
}

/**
 * 엔진 보드와 activePiece 상태를 DOM 클래스에 반영해 화면을 업데이트한다.
 *
 * @param {Object} params
 * @param {Array<Array<HTMLLIElement>>} params.boardCells - 보드 셀 캐시
 * @param {Array<Array<string|null>>} params.board - 엔진 보드 상태
 * @param {{pieceType: string, rotation: number, row: number, col: number}} params.activePiece - 활성 조각
 * @param {number} params.rows - 보드 높이
 * @param {number} params.cols - 보드 너비
 * @param {Record<string, Array<Array<[number, number]>>>} params.blocks - 블록 정의
 * @param {Array<string>} params.pieceTypes - 블록 타입 목록
 * @returns {void}
 */
export function renderBoard({ boardCells, board, activePiece, rows, cols, blocks, pieceTypes }) {
    if (!boardCells) return

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cell = boardCells[row]?.[col]
            if (!cell) continue

            cell.classList.remove("moving", "seized", "line-clear")
            pieceTypes.forEach(type => cell.classList.remove(type))

            const lockedPiece = board[row][col]
            if (lockedPiece) {
                cell.classList.add(lockedPiece, "seized")
            }
        }
    }

    if (!activePiece?.pieceType) return

    blocks[activePiece.pieceType][activePiece.rotation].forEach(([offsetX, offsetY]) => {
        const targetCol = activePiece.col + offsetX
        const targetRow = activePiece.row + offsetY
        const cell = boardCells[targetRow]?.[targetCol]
        if (!cell) return
        cell.classList.add(activePiece.pieceType, "moving")
    })
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
export function renderNextPieces({ nextPreviewCells, pieceQueue, blocks }) {
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
export function renderHoldPiece({ holdPreviewCells, holdPieceType, blocks }) {
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
function buildPreviewGrid(container, size) {
    const cells = Array.from({ length: size }, () => [])
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
function resetPreviewCells(cells) {
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
function renderPieceOnCells(cells, pieceType, blocks) {
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
