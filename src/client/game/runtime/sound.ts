// =============================
// 페이지 공용 사운드 수명주기
// 모듈에 BGM/SFX 객체와 사용자 설정을 한 번만 보관하고, 현재 페이지에 맞는 음악과 버튼을 연결한다.
// 브라우저 autoplay 제한 때문에 첫 사용자 상호작용에서 재생을 다시 시도하며 cleanup으로 listener를 해제한다.
// =============================

const SOUND_KEY = "tetrisSoundEnabled"

const lobbyMusic = createAudio(new URL("../../assets/sound/tetris_lobby_music.mp3", import.meta.url).href, { loop: true, volume: 0.1 })
const gameMusic = createAudio(new URL("../../assets/sound/tetris_game_music.mp3", import.meta.url).href, { loop: true, volume: 0.1 })
const lineClearSfx = createAudio(new URL("../../assets/sound/tetris_lineclear_sfx.mp3", import.meta.url).href, { loop: false, volume: 0.2 })

let soundEnabled = loadSoundPref()
let currentMusic: HTMLAudioElement | null = null
let musicPlaying = false
let impactContext: AudioContext | null = null;
type SynthChannel = "landing" | "combat";
const synthVoices = new Map<SynthChannel, { oscillator: OscillatorNode; gain: GainNode }>();
const toggleButtons = new Set<HTMLButtonElement>()
const toggleButtonHandlers = new WeakMap<HTMLButtonElement, (event: MouseEvent) => void>()

/**
  * 현재 음악을 로비 BGM으로 바꾸고 저장된 설정, 토글 버튼, autoplay 재시도를 연결한다.
  * 반환한 cleanup은 React effect 정리나 pagehide에서 호출한다.
  */
export function initLobbySound(toggleBtn: HTMLButtonElement | null): () => void {
    pause(gameMusic)
    currentMusic = lobbyMusic
    musicPlaying = !currentMusic.paused
    const cleanupToggle = registerToggle(toggleBtn)
    applySoundSetting(soundEnabled, { initial: true })
    const cleanupAutoplayRetry = registerAutoplayRetry()
    return () => {
        cleanupAutoplayRetry()
        cleanupToggle()
    }
}

/**
  * 현재 음악을 게임 BGM으로 바꾸고 저장된 설정과 토글 버튼을 연결한다.
  * 게임 키 입력은 별도 input listener가 처리하므로 autoplay 재시도는 click만 등록한다.
  */
export function initGameSound(toggleBtn: HTMLButtonElement | null): () => void {
    pause(lobbyMusic)
    currentMusic = gameMusic
    musicPlaying = !currentMusic.paused
    const cleanupToggle = registerToggle(toggleBtn)
    applySoundSetting(soundEnabled, { initial: true })
    const cleanupAutoplayRetry = registerAutoplayRetry({ includeKeyboard: false })
    return () => {
        cleanupAutoplayRetry()
        cleanupToggle()
        stopSoundEffects();
        if (impactContext) void impactContext.close().catch(() => {});
        impactContext = null;
    }
}

/**
  * 현재 BGM 재생을 비동기로 요청한다.
  * 브라우저가 사용자 상호작용 전 재생을 막아도 게임 실행을 실패시키지 않는다.
  */
export function tryPlayMusic() {
    void attemptMusicPlayback()
    if (soundEnabled) unlockImpactAudio();
}

function unlockImpactAudio(): void {
    if (typeof AudioContext === "undefined") return;
    try {
        impactContext ??= new AudioContext();
        if (impactContext.state === "suspended") void impactContext.resume().catch(() => {});
    } catch {
        impactContext = null;
    }
}

/** 새 착지 음원 준비 전 사용하며, 이전 타격음을 끊어 연속 입력의 음량 누적을 막는다. */
export function playHardDropSfx(): void {
    playSynthSfx("landing", "triangle", 180, 55, 0.12, 0.12);
}

/** 전용 공격 음원 준비 전 사용하는 짧은 전송·수신·적용 합성음이다. */
export function playCombatSfx(kind: "send" | "receive" | "impact"): void {
    if (kind === "send") playSynthSfx("combat", "triangle", 650, 1600, 0.22, 0.196);
    if (kind === "receive") playSynthSfx("combat", "triangle", 1000, 420, 0.18, 0.168);
    if (kind === "impact") playSynthSfx("combat", "triangle", 320, 100, 0.22, 0.224);
}

function playSynthSfx(
    channel: SynthChannel,
    waveform: OscillatorType,
    startFrequency: number,
    endFrequency: number,
    duration: number,
    volume: number,
): void {
    if (!soundEnabled) return;
    unlockImpactAudio();
    const context = impactContext;
    if (!context || context.state !== "running") return;
    stopSynthVoice(channel);
    try {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        oscillator.type = waveform;
        oscillator.frequency.setValueAtTime(startFrequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(volume, now + 0.005);
        // 전투음은 짧게 음량을 유지해 BGM과 착지음에 묻히지 않게 한다.
        if (channel === "combat") gain.gain.setValueAtTime(volume, now + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        const voice = { oscillator, gain };
        synthVoices.set(channel, voice);
        oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
            if (synthVoices.get(channel) === voice) synthVoices.delete(channel);
        };
        oscillator.start(now);
        oscillator.stop(now + duration + 0.01);
    } catch {
        stopSynthVoice(channel);
    }
}

function stopSynthVoice(channel: SynthChannel): void {
    const voice = synthVoices.get(channel);
    if (!voice) return;
    synthVoices.delete(channel);
    try { voice.oscillator.stop(); } catch {}
    voice.oscillator.disconnect();
    voice.gain.disconnect();
}

function stopSoundEffects(): void {
    pause(lineClearSfx);
    lineClearSfx.currentTime = 0;
    for (const channel of synthVoices.keys()) stopSynthVoice(channel);
}

/**
  * 자동재생이 차단된 경우 사용자 상호작용에서 BGM을 다시 시도한다.
  * 실제 재생에 성공한 뒤에만 리스너를 제거한다.
  */
function registerAutoplayRetry(
    { includeKeyboard = true }: { includeKeyboard?: boolean } = {},
): () => void {
    if (!soundEnabled) return () => {}

    let listening = true
    const cleanup = () => {
        if (!listening) return
        listening = false
        document.removeEventListener("click", retry)
        if (includeKeyboard) document.removeEventListener("keydown", retry)
    }
    const retry = (event: Event) => {
        if (!event.isTrusted || !soundEnabled) return
        unlockImpactAudio();
        void attemptMusicPlayback().then(playing => {
            if (playing) cleanup()
        })
    }

    document.addEventListener("click", retry)
    if (includeKeyboard) document.addEventListener("keydown", retry)
    return cleanup
}

async function attemptMusicPlayback(): Promise<boolean> {
    const music = currentMusic
    if (!soundEnabled || !music) return false
    if (!music.paused) {
        musicPlaying = true
        updateToggleButtons()
        return true
    }

    try {
        await music.play()
        if (music !== currentMusic || !soundEnabled) {
            pause(music)
            return false
        }
        musicPlaying = true
        updateToggleButtons()
        return true
    } catch {
        if (music === currentMusic && !musicPlaying) {
            musicPlaying = false
            updateToggleButtons()
        }
        return false
    }
}

/**
  * 라인 삭제 효과음을 처음부터 재생한다.
  * 재생 실패는 gameplay와 무관한 presentation 실패이므로 호출자에게 전파하지 않는다.
  */
export function playLineClearSfx(lines = 1) {
    if (!soundEnabled) return
    const strength = Math.max(1, Math.min(4, Number.isFinite(lines) ? lines : 1));
    lineClearSfx.volume = (0.14 + strength * 0.035) * 0.9;
    lineClearSfx.playbackRate = 1 + (strength - 1) * 0.035;
    lineClearSfx.currentTime = 0
    lineClearSfx.play().catch(() => {})
}

/**
  * 모듈이 공유할 HTMLAudioElement에 반복과 볼륨 기본값을 적용한다.
  */
function createAudio(
    src: string,
    { loop = false, volume = 1 }: { loop?: boolean; volume?: number },
): HTMLAudioElement {
    const audio = new Audio(src)
    audio.loop = loop
    audio.volume = volume
    return audio
}

/**
  * localStorage에서 사운드 활성화 여부를 읽는다.
  * - 저장값이 없으면 기본값으로 `true`를 사용한다.
  */
function loadSoundPref(): boolean {
    const saved = localStorage.getItem(SOUND_KEY)
    return saved === null ? true : saved === "true"
}

/**
  * 한 페이지의 토글 버튼을 전역 사운드 설정에 연결한다.
  * 같은 버튼을 다시 등록해도 listener를 중복 추가하지 않으며 cleanup은 여러 번 호출해도 안전하다.
  */
function registerToggle(toggleBtn: HTMLButtonElement | null): () => void {
    if (!toggleBtn) return () => {}
    if (toggleButtonHandlers.has(toggleBtn)) {
        return () => unregisterToggle(toggleBtn)
    }

    cleanupDetachedToggleButtons()
    toggleButtons.add(toggleBtn)
    const onClick = (event: MouseEvent) => {
        event.stopPropagation()
        if (soundEnabled && !musicPlaying) {
            tryPlayMusic()
            return
        }
        applySoundSetting(!soundEnabled)
    }
    toggleButtonHandlers.set(toggleBtn, onClick)
    toggleBtn.addEventListener("click", onClick)
    return () => unregisterToggle(toggleBtn)
}

function unregisterToggle(toggleBtn: HTMLButtonElement): void {
    const handler = toggleButtonHandlers.get(toggleBtn)
    if (!handler) return

    toggleBtn.removeEventListener("click", handler)
    toggleButtonHandlers.delete(toggleBtn)
    toggleButtons.delete(toggleBtn)
}

function cleanupDetachedToggleButtons(): void {
    toggleButtons.forEach((btn) => {
        if (!btn.isConnected) unregisterToggle(btn)
    })
}

function updateToggleButtons(): void {
    const playing = soundEnabled && musicPlaying
    toggleButtons.forEach(btn => {
        btn.textContent = playing ? "사운드 끄기" : "사운드 켜기"
        btn.setAttribute("aria-pressed", String(playing))
    })
}

/**
  * `soundEnabled`를 메모리와 localStorage에 반영하고 현재 BGM 재생을 동기화한다.
  * 버튼은 저장 설정이 아니라 실제 재생 성공 여부를 표시한다.
  */
function applySoundSetting(
    enabled: boolean,
    { initial = false }: { initial?: boolean } = {},
): void {
    cleanupDetachedToggleButtons()
    soundEnabled = enabled
    if (!enabled) stopSoundEffects();
    if (!initial) {
        localStorage.setItem(SOUND_KEY, String(enabled))
    }

    if (!currentMusic) {
        musicPlaying = false
        updateToggleButtons()
        return
    }
    if (enabled) {
        musicPlaying = !currentMusic.paused
        updateToggleButtons()
        tryPlayMusic()
    } else {
        pause(currentMusic)
        currentMusic.currentTime = 0
        musicPlaying = false
        updateToggleButtons()
    }
}

// 오디오 정지와 button 해제 함수는 위 수명주기에서 재사용하는 작은 부수효과 helper다.
function pause(audio: HTMLAudioElement): void {
    audio.pause()
}
