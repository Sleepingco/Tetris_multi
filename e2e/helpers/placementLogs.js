/** 실제 전송/commit/저장 응답만 세고 board·credential은 관찰 산출물에 남기지 않는다. */
const { expect } = require("@playwright/test");
const { writeFile } = require("node:fs/promises");

function monitorPlacementLogs(page) {
    const committed = [];
    const sent = [];
    const results = [];
    const listeners = [];
    const read = ({ payload }) => {
        const text = payload.toString();
        return text.startsWith("42[") ? JSON.parse(text.slice(2)) : [];
    };
    const onSocket = socket => {
        const onSent = frame => {
            const [event, payload] = read(frame);
            if (event === "game:log:placement_decision") sent.push(payload.log.pieceIndex);
        };
        const onReceived = frame => {
            const [event, payload] = read(frame);
            if (event === "game:input:result" && payload.ok && payload.placementCommitted) committed.push(payload.pieceIndex);
            if (event === "game:log:result") results.push({ ok: payload.ok, reason: payload.reason });
        };
        socket.on("framesent", onSent);
        socket.on("framereceived", onReceived);
        listeners.push({ socket, onSent, onReceived });
    };
    page.on("websocket", onSocket);
    return {
        async verifyAndWrite(testInfo, mode) {
            expect(committed.length).toBeGreaterThan(0);
            await expect.poll(() => sent.length).toBe(committed.length);
            await expect.poll(() => results.length).toBe(sent.length);
            expect(sent).toEqual(committed);
            const rejected = results.filter(value => !value.ok);
            expect(rejected.filter(value => value.reason !== "RATE_LIMITED")).toEqual([]);
            const report = { schemaVersion: 1, mode, committed: committed.length, sent: sent.length,
                accepted: results.filter(value => value.ok).length, rateLimited: rejected.length };
            await writeFile(testInfo.outputPath("placement-log-cohort.json"), JSON.stringify(report, null, 4));
            return report;
        },
        dispose() {
            page.off("websocket", onSocket);
            for (const { socket, onSent, onReceived } of listeners) {
                socket.off("framesent", onSent);
                socket.off("framereceived", onReceived);
            }
        },
    };
}

module.exports = { monitorPlacementLogs };
