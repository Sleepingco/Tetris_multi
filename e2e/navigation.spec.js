/**
 * 사용자가 첫 화면의 실제 링크를 눌러 single과 multiplayer lobby에 도달하는지 확인한다.
 *
 * URL만 바뀌는 것으로 끝내지 않고 각 목적지의 대표 UI까지 보여야 통과하므로,
 * 라우팅과 해당 페이지의 초기 mount를 함께 검증하는 가장 작은 navigation smoke test다.
 */
const { test, expect } = require("@playwright/test");

test("root의 실제 링크로 single과 lobby에 진입한다", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => sessionStorage.setItem("tetris:nickname", "SavedMultiName"));
    await expect(page.locator("#nicknameInput")).toBeVisible();
    await page.locator("#btnSingle").click();
    await expect(page).toHaveURL(/\/pages\/tetrisSingle\.html$/);
    await expect(page.locator("#tetrisBoardCanvas")).toBeVisible();
    await expect(page.evaluate(() => sessionStorage.getItem("tetris:nickname")))
        .resolves.toBe("SavedMultiName");

    await page.goto("/");
    await page.locator("#nicknameInput").fill("MultiPlayer");
    await page.locator("#btnMulti").click();
    await expect(page).toHaveURL(/\/pages\/multiLobby\.html$/);
    await expect(page.locator("#playerNicknameText")).toBeVisible();
    await expect(page.locator("#playerNicknameText")).toHaveText("MultiPlayer");
});

test("좁은 홈에서 모션 축소와 Guest 키보드 진입을 지원한다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    for (const selector of ["#homeTitle", "#btnSingle", "#nicknameInput", "#btnMulti"]) {
        const element = page.locator(selector);
        await expect(element).toBeVisible();
        const bounds = await element.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.getAnimations().filter(animation =>
        animation.playState === "running").length)).toBe(0);
    await page.locator("#nicknameInput").press("Enter");
    await expect(page).toHaveURL(/\/pages\/multiLobby\.html$/);
    await expect(page.locator("#playerNicknameText")).toHaveText(/^Guest\d{4}$/);
});
