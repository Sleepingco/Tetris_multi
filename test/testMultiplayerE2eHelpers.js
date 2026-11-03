const test = require("node:test");
const assert = require("node:assert/strict");
const { waitForBoardConvergence } = require("../e2e/helpers/multiplayer.js");

test("보드 수렴 helper는 양쪽에서 검증한 RGB를 반환하고 다음 연출 프레임을 다시 읽지 않는다", async () => {
    let sourceReads = 0;
    let observerReads = 0;
    const sourcePage = {
        locator() {
            return {
                async evaluate() {
                    sourceReads += 1;
                    return { fingerprint: sourceReads === 1 ? "139:92:246" : "138:92:246" };
                },
            };
        },
    };
    const observerPage = {
        locator() {
            return {
                async evaluate() {
                    observerReads += 1;
                    return { fingerprint: "139:92:246" };
                },
            };
        },
    };
    const committed = await waitForBoardConvergence({
        sourcePage,
        observerPage,
        playerNumber: 2,
        previousFingerprint: "empty",
    });
    assert.equal(committed, "139:92:246");
    assert.equal(sourceReads, 1);
    assert.equal(observerReads, 1);
});
