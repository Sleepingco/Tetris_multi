/**
 * 싱글플레이 키 입력이 Canvas의 실제 조각 위치와 고정 결과에 반영되는지 검증한다.
 *
 * Math.random과 Playwright clock을 고정해 같은 조각·같은 tick을 재현하고, Canvas cell
 * 중앙 픽셀에서 불투명한 tree 조각만 읽는다. 이동→회전→soft drop→hard drop 순서로
 * 실행한 뒤 예상 좌표와 점수 변화를 비교한다.
 */
const { test, expect } = require("@playwright/test");

const INPUT_TICK_MS = 16;
const TREE_COLOR = [139, 92, 246];

function sortCells(cells) {
    return [...cells].sort((left, right) => {
        return left.row - right.row || left.col - right.col;
    });
}

function translateCells(cells, rowDelta, colDelta) {
    return sortCells(cells.map(({ row, col }) => ({
        row: row + rowDelta,
        col: col + colDelta,
    })));
}

async function readOpaqueTreeCells(page, { minRow = 0, maxRow = 19 } = {}) {
    return page.locator("#tetrisBoardCanvas").evaluate((canvas, options) => {
        const context = canvas.getContext("2d");
        const cols = 10;
        const rows = 20;
        const cellWidth = canvas.width / cols;
        const cellHeight = canvas.height / rows;
        const cells = [];

        for (let row = options.minRow; row <= Math.min(options.maxRow, rows - 1); row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const x = Math.floor((col + 0.5) * cellWidth);
                const y = Math.floor((row + 0.5) * cellHeight);
                const [red, green, blue, alpha] = context.getImageData(x, y, 1, 1).data;
                const matchesTreeColor = [red, green, blue].every((channel, index) => {
                    return Math.abs(channel - options.treeColor[index]) <= 4;
                });

                if (alpha >= 240 && matchesTreeColor) cells.push({ row, col });
            }
        }

        return cells;
    }, { minRow, maxRow, treeColor: TREE_COLOR });
}

async function applyKeyboardAction(page, key) {
    await page.keyboard.press(key);
    await page.clock.runFor(INPUT_TICK_MS);
}

test("싱글 입력 결과가 Canvas 이동·회전·하강·고정 상태에 각각 반영된다", async ({ page }) => {
    await page.addInitScript(() => {
        Math.random = () => 0;
    });
    const pausedTime = new Date("2026-07-17T00:00:00.000Z");
    await page.clock.install({ time: pausedTime });
    await page.clock.pauseAt(pausedTime);
    await page.goto("/pages/tetrisSingle.html");

    await expect(page.locator(".next-preview .next-cell")).toHaveCount(64);
    await expect(page.locator(".score")).toHaveText("0");
    const initialCells = sortCells(await readOpaqueTreeCells(page, { maxRow: 3 }));
    expect(initialCells).toEqual([
        { row: 0, col: 3 },
        { row: 0, col: 4 },
        { row: 0, col: 5 },
    ]);

    await applyKeyboardAction(page, "ArrowLeft");
    const movedCells = sortCells(await readOpaqueTreeCells(page, { maxRow: 3 }));
    expect(movedCells).toEqual(translateCells(initialCells, 0, -1));

    await applyKeyboardAction(page, "ArrowUp");
    const rotatedCells = sortCells(await readOpaqueTreeCells(page, { maxRow: 3 }));
    expect(rotatedCells).toEqual([
        { row: 0, col: 3 },
        { row: 0, col: 4 },
        { row: 1, col: 3 },
    ]);
    expect(rotatedCells).not.toEqual(movedCells);

    await applyKeyboardAction(page, "ArrowDown");
    const softDroppedCells = sortCells(await readOpaqueTreeCells(page, { maxRow: 3 }));
    expect(softDroppedCells).toEqual([
        { row: 0, col: 3 },
        { row: 1, col: 3 },
        { row: 1, col: 4 },
        { row: 2, col: 3 },
    ]);
    expect(softDroppedCells).toEqual(expect.arrayContaining(
        translateCells(rotatedCells, 1, 0),
    ));

    const scoreBeforeHardDrop = Number(await page.locator(".score").textContent());
    expect(await readOpaqueTreeCells(page, { minRow: 14 })).toEqual([]);

    await applyKeyboardAction(page, "Space");
    const lockedCells = sortCells(await readOpaqueTreeCells(page, { minRow: 14 }));
    expect(lockedCells).toEqual([
        { row: 17, col: 3 },
        { row: 18, col: 3 },
        { row: 18, col: 4 },
        { row: 19, col: 3 },
    ]);
    await expect.poll(async () => Number(await page.locator(".score").textContent()))
        .toBeGreaterThan(scoreBeforeHardDrop);
    await expect(page.locator(".game-text")).not.toBeVisible();
});

test("싱글에서 직접 만든 Mini 슬롯은 실제 벽차기 후 일반 T-Spin 점수를 주지 않는다", async ({ page }) => {
    await page.addInitScript(() => {
        Math.random = () => 0;
    });
    const time = new Date("2026-10-21T00:00:00Z");
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
    await page.goto("/pages/tetrisSingle.html");
    await expect(page.locator(".next-preview .next-cell")).toHaveCount(64);
    // T를 보관하고 S·J·Z는 왼끝에, L은 2열에 세우고 I는 5열 바닥에 둔다.
    for (const key of ["KeyC", "ArrowLeft", "ArrowLeft", "ArrowLeft", "Space",
        "ArrowLeft", "KeyZ", "Space",
        "ArrowLeft", "ArrowLeft", "ArrowLeft", "Space",
        "ArrowLeft", "ArrowLeft", "ArrowLeft", "Space",
        "ArrowRight", "ArrowRight", "Space", "KeyC", "ArrowRight"]) {
        await applyKeyboardAction(page, key);
    }
    for (let row = 0; row < 18; row++) await applyKeyboardAction(page, "ArrowDown");
    await applyKeyboardAction(page, "ArrowUp");
    const expected = [{ row: 17, col: 4 }, { row: 18, col: 4 }, { row: 18, col: 5 }, { row: 19, col: 4 }];
    expect(sortCells(await readOpaqueTreeCells(page, { minRow: 14 }))).toEqual(expected);
    const scoreBeforeMini = await page.locator(".score").textContent();
    await applyKeyboardAction(page, "Space");
    expect(sortCells(await readOpaqueTreeCells(page, { minRow: 14 }))).toEqual(expected);
    await expect(page.locator(".score")).toHaveText(scoreBeforeMini);
    await expect(page.locator(".game-text")).not.toBeVisible();
});
