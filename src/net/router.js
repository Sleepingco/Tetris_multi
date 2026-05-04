import { renderHomePage, mountHomePage } from "../game/entry/homePage.js"
import { renderSingleGamePage, mountSingleGame } from "../game/entry/singleGamePage.js"
import { renderLobbyPage, mountLobbyPage } from "../game/entry/lobbyPage.js"
import { renderMultiGamePage, mountMultiGame } from "../game/entry/multiGamePage.js"

const APP_ROOT_SELECTOR = "#app-content"

const ROUTES = {
  "/": {
    title: "Tetris multi",
    render: renderHomePage,
    mount: mountHomePage,
  },
  "/single": {
    title: "테트리스",
    render: renderSingleGamePage,
    mount: mountSingleGame,
  },
  "/lobby": {
    title: "멀티플레이 로비 - Tetris Multi",
    render: renderLobbyPage,
    mount: mountLobbyPage,
  },
  "/multi": {
    title: "멀티 테트리스",
    render: renderMultiGamePage,
    mount: mountMultiGame,
  },
}

let currentUnmount = null
let gameStylesheet = null

function normalizeRoute(hash) {
  const [route] = (hash.replace(/^#/, "") || "/").split("?")
  return ROUTES[route] ? route : "/"
}

function syncRouteStyles(routeKey) {
  const needsGameStyles = routeKey === "/single" || routeKey === "/multi"
  if (needsGameStyles) {
    if (gameStylesheet) return
    gameStylesheet = document.createElement("link")
    gameStylesheet.rel = "stylesheet"
    gameStylesheet.href = "../styles/tetris.css"
    gameStylesheet.dataset.routeStyles = "tetris"
    document.head.appendChild(gameStylesheet)
    return
  }

  if (gameStylesheet) {
    gameStylesheet.remove()
    gameStylesheet = null
  }
}

function renderCurrentRoute() {
  const root = document.querySelector(APP_ROOT_SELECTOR)
  if (!root) return

  const routeKey = normalizeRoute(window.location.hash)
  const route = ROUTES[routeKey]

  try {
    currentUnmount?.()
  } catch (error) {
    console.error("Failed to unmount current route", error)
  } finally {
    currentUnmount = null
  }

  try {
    syncRouteStyles(routeKey)
    root.innerHTML = route.render()
    document.title = route.title
    currentUnmount = route.mount?.(root) ?? null
    window.scrollTo(0, 0)
  } catch (error) {
    console.error(`Failed to render route "${routeKey}"`, error)
    root.innerHTML = `
      <div class="container">
        <main class="main">
          <section class="hero">
            <h2 class="hero-title">페이지를 불러오지 못했습니다.</h2>
            <p class="hero-desc">콘솔 로그를 확인한 뒤 다시 시도해주세요.</p>
            <div class="cta">
              <a class="btn primary" href="#/">홈으로</a>
            </div>
          </section>
        </main>
      </div>
    `
  }
}

/**
 * 해시 기반 SPA 라우터를 한 번만 초기화한다.
 * - 이전 화면 cleanup -> 새 화면 render -> 새 화면 mount 순서를 고정한다.
 *
 * @returns {void}
 */
export function initRouter() {
  if (window.__tetrisSpaInitialized) return
  window.__tetrisSpaInitialized = true

  window.addEventListener("hashchange", renderCurrentRoute)
  renderCurrentRoute()
}

initRouter()
