const SOUND_KEY = "tetrisSoundEnabled"

const lobbyMusic = createAudio("../assets/sound/tetris_lobby_music.mp3", { loop: true, volume: 0.1 })
const gameMusic = createAudio("../assets/sound/tetris_game_music.mp3", { loop: true, volume: 0.1 })
const lineClearSfx = createAudio("../assets/sound/tetris_lineclear_sfx.mp3", { loop: false, volume: 0.2 })

let soundEnabled = loadSoundPref()
let currentMusic = null
const toggleButtons = new Set()

/**
 * 로비 페이지에서 BGM과 토글 버튼을 초기화한다.
 *
 * @param {HTMLButtonElement|null} toggleBtn - 온/오프 토글 버튼
 * @returns {void}
 */
export function initLobbySound(toggleBtn) {
  pause(gameMusic)
  currentMusic = lobbyMusic
  registerToggle(toggleBtn)
  applySoundSetting(soundEnabled, { initial: true })
  tryPlayMusic()
}

/**
 * 게임 페이지에서 BGM과 토글 버튼, 효과음을 초기화한다.
 *
 * @param {HTMLButtonElement|null} toggleBtn - 온/오프 토글 버튼
 * @returns {void}
 */
export function initGameSound(toggleBtn) {
  pause(lobbyMusic)
  currentMusic = gameMusic
  registerToggle(toggleBtn)
  applySoundSetting(soundEnabled, { initial: true })
  tryPlayMusic()
}

/**
 * 현재 BGM 재생을 시도한다(자동재생 차단 시 무시).
 *
 * @returns {void}
 */
export function tryPlayMusic() {
  if (!soundEnabled || !currentMusic) return
  currentMusic.play().catch(() => {
    // 첫 사용자 인터랙션 후 재생 시도됨
  })
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

function createAudio(src, { loop = false, volume = 1 }) {
  const audio = new Audio(src)
  audio.loop = loop
  audio.volume = volume
  return audio
}

function loadSoundPref() {
  const saved = localStorage.getItem(SOUND_KEY)
  return saved === null ? true : saved === "true"
}

function registerToggle(toggleBtn) {
  if (!toggleBtn) return
  toggleButtons.add(toggleBtn)
  toggleBtn.addEventListener("click", () => {
    applySoundSetting(!soundEnabled)
  })
}

function applySoundSetting(enabled, { initial = false } = {}) {
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

function pause(audio) {
  audio.pause()
}
