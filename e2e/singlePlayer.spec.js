const { test, expect } = require("@playwright/test");

async function readBottomBoard(page, bottomRows = 6) {
    return page.locator("#tetrisBoardCanvas").evaluate((canvas, rowsToRead) => {
        const context = canvas.getContext("2d");
        const cols = 10;
        const rows = 20;
        const cellWidth = canvas.width / cols;
        const cellHeight = canvas.height / rows;
        let occupiedCellCount = 0;

        for (let row = rows - rowsToRead; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const x = Math.floor((col + 0.5) * cellWidth);
                const y = Math.floor((row + 0.5) * cellHeight);
                const alpha = context.getImageData(x, y, 1, 1).data[3];
                if (alpha >= 240) occupiedCellCount += 1;
            }
        }

        return { occupiedCellCount };
    }, bottomRows);
}

test("싱글 기본 입력은 조각을 이동·회전·하강한 뒤 board에 고정한다", async ({ page }) => {
    await page.goto("/pages/tetrisSingle.html");

    await expect(page.locator(".next-preview .next-cell")).toHaveCount(32);
    await expect(page.locator(".score")).toHaveText("0");
    expect((await readBottomBoard(page)).occupiedCellCount).toBe(0);

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");

    await expect.poll(async () => Number(await page.locator(".score").textContent()), {
        timeout: 3_000,
    }).toBeGreaterThan(0);
    await expect.poll(async () => (await readBottomBoard(page)).occupiedCellCount, {
        timeout: 3_000,
    }).toBeGreaterThanOrEqual(4);
    await expect(page.locator(".game-text")).not.toBeVisible();
});
