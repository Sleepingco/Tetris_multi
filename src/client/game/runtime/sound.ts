const SOUND_KEY = "tetrisSoundEnabled"

const lobbyMusic = createAudio(new URL("../../assets/sound/tetris_lobby_music.mp3", import.meta.url).href, { loop: true, volume: 0.1 })
const gameMusic = createAudio(new URL("../../assets/sound/tetris_game_music.mp3", import.meta.url).href, { loop: true, volume: 0.1 })
const lineClearSfx = createAudio(new URL("../../assets/sound/tetris_lineclear_sfx.mp3", import.meta.url).href, { loop: false, volume: 0.2 })

let soundEnabled = loadSoundPref()
let currentMusic: HTMLAudioElement | null = null
const toggleButtons = new Set<HTMLButtonElement>()
const toggleButtonHandlers = new WeakMap<HTMLButtonElement, () => void>()

/**
  * 로비 페이지에서 BGM과 토글 버튼을 초기화한다.
  *
  * @param {HTMLButtonElement|null} toggleBtn - 온/오프 토글 버튼
  * @returns {Function} 등록한 토글 버튼 리스너를 제거하는 정리 함수
  */
export function initLobbySound(toggleBtn: HTMLButtonElement | null): () => void {
    pause(gameMusic)
    currentMusic = lobbyMusic
    const cleanupToggle = registerToggle(toggleBtn)
    applySoundSetting(soundEnabled, { initial: true })
    const cleanupAutoplayRetry = registerAutoplayRetry()
    return () => {
        cleanupAutoplayRetry()
        cleanupToggle()
    }
}

/**
  * 게임 페이지에서 BGM과 토글 버튼, 효과음을 초기화한다.
  *
  * @param {HTMLButtonElement|null} toggleBtn - 온/오프 토글 버튼
  * @returns {Function} 등록한 토글 버튼 리스너를 제거하는 정리 함수
  */
export function initGameSound(toggleBtn: HTMLButtonElement | null): () => void {
    pause(lobbyMusic)
    currentMusic = gameMusic
    const cleanupToggle = registerToggle(toggleBtn)
    applySoundSetting(soundEnabled, { initial: true })
    const cleanupAutoplayRetry = registerAutoplayRetry({ includeKeyboard: false })
    return () => {
        cleanupAutoplayRetry()
        cleanupToggle()
    }
}

/**
  * 현재 BGM 재생을 시도한다(자동재생 차단 시 무시).
  *
  * @returns {void}
  */
export function tryPlayMusic() {
    void attemptMusicPlayback()
}

/**
  * 자동재생이 차단된 경우 사용자 상호작용에서 BGM을 다시 시도한다.
  * 실제 재생에 성공한 뒤에만 리스너를 제거한다.
  *
  * @param {{includeKeyboard?: boolean}} [options={}] - keydown 재시도 포함 여부
  * @returns {Function} 등록한 사용자 상호작용 리스너를 제거하는 정리 함수
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
        if (!event.isTrusted) return
        void attemptMusicPlayback().then(playing => {
            if (playing) cleanup()
        })
    }

    document.addEventListener("click", retry)
    if (includeKeyboard) document.addEventListener("keydown", retry)
    return cleanup
}

async function attemptMusicPlayback(): Promise<boolean> {
    if (!soundEnabled || !currentMusic) return false
    if (!currentMusic.paused) return true

    try {
        await currentMusic.play()
        return true
    } catch {
        return false
    }
}

/**
  * 라인 삭제 효과음을 재생한다.
  *
  * @returns {void}
  */
export function playLineClearSfx() {
    if (!soundEnabled) return
    lineClearSfx.currentTime = 0
    lineClearSfx.play().catch(() => {})
}

/**
  * 공통 오디오 옵션이 적용된 HTMLAudioElement를 만든다.
  *
  * @param {string} src - 로드할 오디오 파일 경로
  * @param {{loop?: boolean, volume?: number}} options - 반복 재생 여부와 기본 볼륨
  * @returns {HTMLAudioElement} 설정이 적용된 오디오 객체
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
  *
  * @returns {boolean} 사운드 활성화 여부
  */
function loadSoundPref(): boolean {
    const saved = localStorage.getItem(SOUND_KEY)
    return saved === null ? true : saved === "true"
}

/**
  * 사운드 토글 버튼을 등록하고 클릭 시 전역 사운드 상태를 반전시킨다.
  *
  * @param {HTMLButtonElement|null} toggleBtn - 등록할 토글 버튼
  * @returns {Function} 등록한 토글 버튼 리스너를 제거하는 정리 함수
  */
function registerToggle(toggleBtn: HTMLButtonElement | null): () => void {
    if (!toggleBtn) return () => {}
    if (toggleButtonHandlers.has(toggleBtn)) {
        return () => unregisterToggle(toggleBtn)
    }

    cleanupDetachedToggleButtons()
    toggleButtons.add(toggleBtn)
    const onClick = () => {
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

/**
  * 사운드 설정을 메모리, localStorage, 버튼 UI, 현재 BGM에 동시에 반영한다.
  *
  * @param {boolean} enabled - 적용할 사운드 활성화 여부
  * @param {{initial?: boolean}} [options={}] - 초기 로드 여부
  * @returns {void}
  */
function applySoundSetting(
    enabled: boolean,
    { initial = false }: { initial?: boolean } = {},
): void {
    cleanupDetachedToggleButtons()
    soundEnabled = enabled
    if (!initial) {
        localStorage.setItem(SOUND_KEY, String(enabled))
    }

    toggleButtons.forEach(btn => {
        btn.textContent = enabled ? "사운드 끄기" : "사운드 켜기"
        btn.setAttribute("aria-pressed", String(enabled))
    })

    if (!currentMusic) return
    if (enabled) {
        tryPlayMusic()
    } else {
        pause(currentMusic)
        currentMusic.currentTime = 0
    }
}

/**
  * 전달된 오디오를 현재 위치에서 일시정지한다.
  *
  * @param {HTMLAudioElement} audio - 일시정지할 오디오 객체
  * @returns {void}
  */
function pause(audio: HTMLAudioElement): void {
    audio.pause()
}
