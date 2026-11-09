const { test, expect } = require("@playwright/test");
const { createPveRoom } = require("./helpers/pve.js");

for (const mobile of [false, true]) {
    test(`${mobile ? "모바일" : "PC"} 네 화면은 같은 로고와 헤더 버튼 순서를 사용한다`, async ({ browser }, testInfo) => {
        const context = await browser.newContext({
            viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 900 },
            hasTouch: mobile,
            isMobile: mobile,
        });
        const page = await context.newPage();
        await page.addInitScript(() => {
            localStorage.setItem("theme", "light");
            localStorage.setItem("tetrisSoundEnabled", "false");
            HTMLMediaElement.prototype.play = () => Promise.resolve();
        });
        const marks = [];
        const sizes = [];
        async function checkHeader(name, hasHome) {
            const header = page.locator("header");
            await expect(header.getByRole("heading", { level: 1 })).toContainText("Tetra Arena");
            const mark = header.locator(".brand-mark");
            await expect(mark).toBeVisible();
            await expect.poll(() => mark.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
            marks.push(await mark.getAttribute("src"));
            sizes.push(await header.locator(".brand-logo").evaluate(element => getComputedStyle(element).fontSize));
            const sound = header.locator("#soundToggle");
            const theme = header.locator("#themeToggle");
            const buttons = hasHome ? [sound, theme, header.locator(".home-btn")] : [sound, theme];
            const boxes = [];
            for (const button of buttons) {
                await expect(button).toBeVisible();
                const box = await button.boundingBox();
                boxes.push(box);
                if (mobile) {
                    expect(box.width).toBeCloseTo(44, 3);
                    expect(box.height).toBeCloseTo(44, 3);
                    expect(box.x).toBeGreaterThanOrEqual(0);
                    expect(box.x + box.width).toBeLessThanOrEqual(390);
                    expect(await button.evaluate(element => getComputedStyle(element, "::before").maskImage)).toContain("data:image/svg+xml");
                    expect(await button.evaluate(element => getComputedStyle(element).fontSize)).toBe("0px");
                } else {
                    expect(await button.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(0);
                }
            }
            const logoBox = await header.locator(".brand-logo").boundingBox();
            expect(boxes[0].x).toBeGreaterThan(logoBox.x + logoBox.width);
            expect(boxes[0].y + boxes[0].height / 2).toBeLessThanOrEqual(logoBox.y + logoBox.height + 8);
            expect(boxes[0].x).toBeLessThan(boxes[1].x);
            if (hasHome) expect(boxes[1].x).toBeLessThan(boxes[2].x);
            if (mobile) expect(new Set(boxes.map(box => Math.round(box.y))).size).toBe(1);
            const previousTheme = await theme.getAttribute("aria-pressed");
            await theme.click();
            await expect(theme).not.toHaveAttribute("aria-pressed", previousTheme);
            const previousSound = await sound.getAttribute("aria-pressed");
            await sound.click();
            await expect(sound).not.toHaveAttribute("aria-pressed", previousSound);
            await header.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
        }
        try {
            await page.goto("/pages/index.html");
            await checkHeader("home", false);
            await page.goto("/pages/multiLobby.html");
            await checkHeader("lobby", true);
            await page.goto("/pages/tetrisSingle.html");
            await checkHeader("single", true);
            await createPveRoom(page, "normal");
            await page.locator("#btnPrimaryAction").click();
            await page.waitForURL(/tetrisMulti\.html/);
            await expect(page.locator('.game-text[data-player="1"]')).toBeHidden();
            await checkHeader("multi", true);
            expect(new Set(marks).size).toBe(1);
            expect(new Set(sizes).size).toBe(1);
        } finally {
            await context.close();
        }
    });
}
