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
const toggleButtons = new Set<HTMLButtonElement>()
const toggleButtonHandlers = new WeakMap<HTMLButtonElement, () => void>()

/**
  * 현재 음악을 로비 BGM으로 바꾸고 저장된 설정, 토글 버튼, autoplay 재시도를 연결한다.
  * 반환한 cleanup은 React effect 정리나 pagehide에서 호출한다.
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
  * 현재 음악을 게임 BGM으로 바꾸고 저장된 설정과 토글 버튼을 연결한다.
  * 게임 키 입력은 별도 input listener가 처리하므로 autoplay 재시도는 click만 등록한다.
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
  * 현재 BGM 재생을 비동기로 요청한다.
  * 브라우저가 사용자 상호작용 전 재생을 막아도 게임 실행을 실패시키지 않는다.
  */
export function tryPlayMusic() {
    void attemptMusicPlayback()
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
  * 라인 삭제 효과음을 처음부터 재생한다.
  * 재생 실패는 gameplay와 무관한 presentation 실패이므로 호출자에게 전파하지 않는다.
  */
export function playLineClearSfx() {
    if (!soundEnabled) return
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
  * 하나의 `soundEnabled` 값을 메모리, localStorage, 연결된 버튼, 현재 BGM에 함께 반영한다.
  * 초기 로드에서는 이미 저장된 값을 다시 쓰지 않고 화면과 음악만 동기화한다.
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

// 오디오 정지와 button 해제 함수는 위 수명주기에서 재사용하는 작은 부수효과 helper다.
function pause(audio: HTMLAudioElement): void {
    audio.pause()
}
