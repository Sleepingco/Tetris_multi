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
