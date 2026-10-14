const test = require("node:test");
const assert = require("node:assert/strict");

test("착지와 전투음은 서로 끊지 않고 각 채널의 중첩·무음·cleanup을 따른다", async (t) => {
    const originals = Object.fromEntries(["Audio", "AudioContext", "localStorage", "document"].map(key => [key, globalThis[key]]));
    const audio = [];
    const voices = [];
    const contexts = [];
    const values = new Map([["tetrisSoundEnabled", "false"]]);
    globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const documentListeners = new Map();
    globalThis.document = {
        addEventListener: (type, callback) => documentListeners.set(type, callback),
        removeEventListener: type => documentListeners.delete(type),
    };
    let audioAllowed = true;
    globalThis.Audio = class {
        constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.plays = 0; audio.push(this); }
        play() { this.paused = false; this.plays++; return Promise.resolve(); }
        pause() { this.paused = true; }
    };
    const parameter = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
    globalThis.AudioContext = class {
        constructor() { this.state = audioAllowed ? "running" : "suspended"; this.resumeCalls = 0; this.currentTime = 0; this.destination = {}; contexts.push(this); }
        createOscillator() {
            const oscillator = {
                frequency: parameter(), connect() {}, disconnect() {}, start() {},
                immediateStops: 0,
                stop(time) { if (time === undefined) this.immediateStops++; },
            };
            voices.push(oscillator);
            return oscillator;
        }
        createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
        resume() {
            this.resumeCalls++;
            if (audioAllowed) this.state = "running";
            return Promise.resolve();
        }
        close() { this.state = "closed"; return Promise.resolve(); }
    };
    t.after(() => Object.assign(globalThis, originals));
    const { initGameSound, playHardDropSfx, playLineClearSfx, playCombatSfx } = await import("../src/client/game/runtime/sound.ts");
    const listeners = new Map();
    const button = {
        isConnected: true,
        setAttribute() {},
        addEventListener: (type, callback) => listeners.set(type, callback),
        removeEventListener: type => listeners.delete(type),
    };
    const cleanup = initGameSound(button);
    playHardDropSfx();
    ["send", "receive", "impact"].forEach(playCombatSfx);
    playLineClearSfx(4);
    assert.equal(voices.length, 0);
    assert.equal(audio.at(-1).plays, 0);

    listeners.get("click")({ stopPropagation() {} });
    await Promise.resolve();
    playHardDropSfx();
    playHardDropSfx();
    assert.equal(voices.length, 2);
    assert.equal(voices[0].immediateStops, 1);
    ["send", "receive", "impact"].forEach(playCombatSfx);
    assert.equal(voices.length, 5);
    assert.equal(voices[1].immediateStops, 0);
    assert.equal(voices.filter(voice => voice.immediateStops === 0).length, 2);
    playHardDropSfx();
    assert.equal(voices[4].immediateStops, 0);
    assert.equal(voices[1].immediateStops, 1);
    // 교체된 노드의 늦은 종료가 새 voice를 등록 해제하지 않아야 한다.
    voices[1].onended();
    playHardDropSfx();
    assert.equal(voices[5].immediateStops, 1);
    assert.equal(voices.filter(voice => voice.immediateStops === 0).length, 2);
    playLineClearSfx(1);
    const singleVolume = audio.at(-1).volume;
    playLineClearSfx(4);
    assert.ok(audio.at(-1).volume > singleVolume && audio.at(-1).volume < 0.3);

    listeners.get("click")({ stopPropagation() {} });
    assert.equal(voices[4].immediateStops, 1);
    assert.equal(voices[6].immediateStops, 1);
    assert.equal(audio.at(-1).paused, true);
    const playCount = audio.at(-1).plays;
    playHardDropSfx();
    playLineClearSfx();
    playCombatSfx("send");
    assert.equal(voices.length, 7);
    assert.equal(audio.at(-1).plays, playCount);
    listeners.get("click")({ stopPropagation() {} });
    await Promise.resolve();
    playHardDropSfx();
    playCombatSfx("impact");
    cleanup();
    assert.equal(voices[7].immediateStops, 1);
    assert.equal(voices[8].immediateStops, 1);
    assert.equal(contexts[0].state, "closed");
    assert.equal(listeners.size, 0);

    audioAllowed = false;
    const cleanupBlockedSound = initGameSound(button);
    const blockedContext = contexts.at(-1);
    assert.equal(blockedContext.state, "suspended");
    const initialResumeCalls = blockedContext.resumeCalls;
    documentListeners.get("click")({ isTrusted: false });
    assert.equal(blockedContext.resumeCalls, initialResumeCalls);
    audioAllowed = true;
    documentListeners.get("click")({ isTrusted: true });
    assert.equal(blockedContext.state, "running");
    assert.equal(blockedContext.resumeCalls, initialResumeCalls + 1);
    playCombatSfx("receive");
    assert.equal(voices.length, 10);
    cleanupBlockedSound();
    assert.equal(voices[9].immediateStops, 1);
    assert.equal(blockedContext.state, "closed");
});
