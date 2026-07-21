const { test, expect } = require("@playwright/test");

const PAGES = [
    ["index", "/pages/index.html"],
    ["multiLobby", "/pages/multiLobby.html"],
    ["tetrisSingle", "/pages/tetrisSingle.html"],
    ["tetrisMulti", "/pages/tetrisMulti.html"],
];

test("production CSP는 네 페이지와 first-party artifact를 위반 없이 제한한다", async ({ browser, request }) => {
    const reportOnly = process.env.CSP_MODE === "report-only";
    const expectedHeader = reportOnly
        ? "content-security-policy-report-only"
        : "content-security-policy";
    const unexpectedHeader = reportOnly
        ? "content-security-policy"
        : "content-security-policy-report-only";
    const violations = [];
    const browserErrors = [];

    for (const [entryName, pagePath] of PAGES) {
        const response = await request.get(pagePath);
        expect(response.status()).toBe(200);
        expect(response.headers()[expectedHeader]).toContain("default-src 'none'");
        expect(response.headers()[unexpectedHeader]).toBeUndefined();
        const html = await response.text();
        const modulePath = html.match(/<script type="module"[^>]+src="([^"]+)"/)?.[1];
        expect(modulePath).toBeTruthy();
        expect((await request.get(`/pages/${entryName}.tsx`)).status()).toBe(404);
        expect((await request.get(`${modulePath}.map`)).status()).toBe(404);

        const context = await browser.newContext();
        const page = await context.newPage();
        await page.exposeFunction("recordGoal11aCspViolation", violation => {
            violations.push({ page: entryName, ...violation });
        });
        await page.addInitScript(() => {
            document.addEventListener("securitypolicyviolation", event => {
                globalThis.recordGoal11aCspViolation({
                    directive: event.effectiveDirective,
                    blockedUri: event.blockedURI,
                });
            });
        });
        page.on("console", message => {
            if (message.type() === "error") {
                browserErrors.push({ page: entryName, message: message.text() });
            }
        });
        page.on("pageerror", error => {
            browserErrors.push({ page: entryName, message: error.message });
        });
        await page.goto(pagePath);
        await page.waitForTimeout(250);
        await context.close();
    }

    expect(violations).toEqual([]);
    expect(browserErrors).toEqual([]);
});
