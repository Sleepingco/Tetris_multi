/**
 * 사용자가 첫 화면의 실제 링크를 눌러 single과 multiplayer lobby에 도달하는지 확인한다.
 *
 * URL만 바뀌는 것으로 끝내지 않고 각 목적지의 대표 UI까지 보여야 통과하므로,
 * 라우팅과 해당 페이지의 초기 mount를 함께 검증하는 가장 작은 navigation smoke test다.
 */
const { test, expect } = require("@playwright/test");

test("root의 실제 링크로 single과 lobby에 진입한다", async ({ page }) => {
    await page.goto("/");
    await page.locator("#btnSingle").click();
    await expect(page).toHaveURL(/\/pages\/tetrisSingle\.html$/);
    await expect(page.locator("#tetrisBoardCanvas")).toBeVisible();

    await page.goto("/");
    await page.locator("[data-multi-lobby-link]").click();
    await expect(page).toHaveURL(/\/pages\/multiLobby\.html$/);
    await expect(page.locator("#playerNicknameText")).toBeVisible();
});
