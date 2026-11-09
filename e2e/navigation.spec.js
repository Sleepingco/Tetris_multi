/**
 * 사용자가 첫 화면의 실제 링크를 눌러 single과 multiplayer lobby에 도달하는지 확인한다.
 *
 * URL만 바뀌는 것으로 끝내지 않고 각 목적지의 대표 UI까지 보여야 통과하므로,
 * 라우팅과 해당 페이지의 초기 mount를 함께 검증하는 가장 작은 navigation smoke test다.
 */
const { test, expect } = require("@playwright/test");

test("홈 장식은 모드 선택 영역의 원래 위치를 따른다", async ({ page }) => {
    await page.goto("/");
    for (const [width, leftWidth, rightWidth] of [[1600, "200px", "180px"], [1000, "140px", "130px"]]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.locator(".home-modes").evaluate(root => {
            const left = getComputedStyle(root, "::before");
            const right = getComputedStyle(root, "::after");
            return { left: [left.position, left.bottom, left.left, left.width],
                right: [right.position, right.bottom, right.right, right.width] };
        })).toEqual({ left: ["absolute", "58px", "-18px", leftWidth],
            right: ["absolute", "58px", "-18px", rightWidth] });
        expect(await page.evaluate(() => getComputedStyle(document.querySelector("#indexRoot"), "::before").display)).toBe("none");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#indexRoot"), "::before").position)).toBe("absolute");
});

test("격자 배경은 공용이고 블록 장식은 홈 화면에만 표시한다", async ({ page }) => {
    const backgrounds = [];
    for (const [path, selector] of [["/", ".home-modes"], ["/pages/tetrisSingle.html", "#singleRoot"], ["/pages/multiLobby.html", "#multiLobbyRoot"]]) {
        await page.goto(path);
        backgrounds.push(await page.evaluate(selector => ({
            background: getComputedStyle(document.body).backgroundImage,
            left: getComputedStyle(document.querySelector(selector), "::before").backgroundImage,
            right: getComputedStyle(document.querySelector(selector), "::after").backgroundImage,
        }), selector));
    }
    expect(backgrounds[0].background).toContain("radial-gradient");
    expect(backgrounds[0].left).toContain("svg");
    expect(backgrounds[0].right).toContain("svg");
    expect(backgrounds[0].left).not.toBe(backgrounds[0].right);
    for (const background of backgrounds.slice(1)) {
        expect(background.background).toBe(backgrounds[0].background);
        expect(background.left).toBe("none");
        expect(background.right).toBe("none");
    }
});

test("모바일 블록 장식은 홈 화면에만 나타난다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [path, selector] of [["/pages/tetrisSingle.html", "#singleRoot"], ["/pages/multiLobby.html", "#multiLobbyRoot"]]) {
        await page.goto(path);
        expect(await page.locator(selector).evaluate(root => [
            getComputedStyle(root, "::before").backgroundImage,
            getComputedStyle(root, "::after").backgroundImage,
        ])).toEqual(["none", "none"]);
    }
});

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

for (const theme of ["light", "dark"]) {
    for (const viewport of [{ width: 390, height: 550 }, { width: 740, height: 390 }]) {
        test(`홈 ${theme} ${viewport.width}x${viewport.height} 배경은 가이드와 스크롤 끝까지 문서 내용을 덮는다`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.emulateMedia({ reducedMotion: "reduce" });
            await page.addInitScript(value => localStorage.setItem("theme", value), theme);
            await page.goto("/");
            await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
            const assertCovered = async () => {
                const geometry = await page.evaluate(() => {
                    const body = document.body.getBoundingClientRect();
                    const root = document.querySelector("#indexRoot").getBoundingClientRect();
                    const footer = document.querySelector("footer").getBoundingClientRect();
                    const style = getComputedStyle(document.body);
                    return {
                        bodyBottom: body.bottom + scrollY,
                        contentBottom: Math.max(root.bottom, footer.bottom) + scrollY,
                        documentBottom: document.documentElement.scrollHeight,
                        documentWidth: document.documentElement.scrollWidth,
                        background: style.backgroundImage,
                        decorationBottom: ["::before", "::after"].map(pseudo => parseFloat(getComputedStyle(document.querySelector("#indexRoot"), pseudo).bottom)),
                        decorationTop: ["::before", "::after"].map(pseudo => {
                            const decoration = getComputedStyle(document.querySelector("#indexRoot"), pseudo);
                            return root.bottom + scrollY - parseFloat(decoration.bottom) - parseFloat(decoration.height);
                        }),
                        footerBottom: footer.bottom + scrollY,
                    };
                });
                expect(geometry.bodyBottom).toBeGreaterThanOrEqual(geometry.contentBottom - 1);
                expect(geometry.bodyBottom).toBeGreaterThanOrEqual(geometry.documentBottom - 1);
                expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width);
                expect(geometry.background).toContain("radial-gradient");
                expect(geometry.decorationBottom.every(bottom => bottom >= 0)).toBe(true);
                for (const top of geometry.decorationTop) {
                    expect(top).toBeGreaterThanOrEqual(geometry.footerBottom);
                }
                return geometry;
            };
            await assertCovered();
            await page.locator("#guide summary").click();
            await expect(page.locator("#guide")).toHaveAttribute("open", "");
            const expanded = await assertCovered();
            expect(expanded.documentBottom).toBeGreaterThan(viewport.height);
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
            await assertCovered();
            await expect(page.locator("footer")).toBeInViewport();
        });
    }
}
