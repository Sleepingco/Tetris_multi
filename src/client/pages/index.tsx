import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { applySavedTheme, toggleTheme } from "../game/entry/theme";
import { initLobbySound } from "../game/runtime/sound.ts";

// =============================
// 시작 페이지 React shell
// nickname 입력과 페이지 이동, theme/sound 수명주기만 소유하며 게임 규칙은 실행하지 않는다.
// 멀티 lobby가 읽을 nickname은 이동 직전에 sessionStorage에 저장한다.
// =============================

/** nickname을 비워 둔 사용자가 멀티 lobby에 들어갈 때 사용할 짧은 임시 이름을 만든다. */
function createGuestNickname(): string {
    return `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * 시작 페이지 UI와 브라우저 부수효과의 수명주기를 연결한다.
 * - mount 시 저장 theme과 lobby BGM을 적용한다.
 * - unmount/pagehide 시 sound listener를 한 번만 정리한다.
 * - bfcache에서 돌아오면 오래된 effect 상태를 재사용하지 않도록 페이지를 새로 읽는다.
 */
function IndexPage() {
    const [nickname, setNickname] = useState("");
    const themeToggleRef = useRef<HTMLButtonElement>(null);
    const soundToggleRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        applySavedTheme(themeToggleRef.current);
        const cleanupSound = initLobbySound(soundToggleRef.current);
        let disposed = false;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
            cleanupSound?.();
        };
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) window.location.reload();
        };
        window.addEventListener("pagehide", dispose, { once: true });
        window.addEventListener("pageshow", onPageShow);
        return () => {
            window.removeEventListener("pagehide", dispose);
            window.removeEventListener("pageshow", onPageShow);
            dispose();
        };
    }, []);

    // 아래 navigation handler는 nickname 전달만 담당하고 실제 room/session 생성은 lobby가 소유한다.
    const enterMultiLobby = (event: React.SyntheticEvent) => {
        event.preventDefault();
        sessionStorage.setItem(
            "tetris:nickname",
            nickname.trim() || createGuestNickname(),
        );
        window.location.href = "./multiLobby.html";
    };
    const enterSingleGame = () => {
        if (nickname.trim()) {
            sessionStorage.setItem("tetris:nickname", nickname.trim());
        }
    };

    return (
        <div className="container">
            <header className="header">
                <h1 className="brand">Tetris Multi</h1>
                <nav className="nav">
                    <button ref={themeToggleRef} id="themeToggle" type="button" className="btn ghost"
                        aria-pressed="false" onClick={() => toggleTheme(themeToggleRef.current)}>
                        다크 모드
                    </button>
                    <button ref={soundToggleRef} id="soundToggle" type="button" className="btn ghost"
                        aria-pressed="false">사운드 켜기</button>
                </nav>
            </header>

            <main className="main">
                <section className="hero">
                    <h2 className="hero-title">Welcome to Tetris Multi</h2>
                    <p className="hero-desc">이 게임은 다양한 사람들이 함께 테트리스를 하는 게임입니다.<br />많이 즐겨 주셨으면 좋겠습니다.</p>
                    <div className="setup-container">
                        <form className="nickname-form" id="nicknameEntryForm" onSubmit={enterMultiLobby}>
                            <div className="input-wrapper">
                                <span className="input-icon">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        strokeWidth="2" stroke="currentColor" width="20" height="20">
                                        <path strokeLinecap="round" strokeLinejoin="round"
                                            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                                    </svg>
                                </span>
                                <input id="nicknameInput" className="input-box" type="text" maxLength={16}
                                    placeholder="닉네임 입력 (미입력 시 Guest)" autoComplete="nickname"
                                    value={nickname} onChange={event => setNickname(event.target.value)} />
                            </div>
                            <div className="cta-group">
                                <a id="btnSingle" className="btn" href="./tetrisSingle.html"
                                    onClick={enterSingleGame}>싱글 게임</a>
                                <button type="submit" id="btnMulti" className="btn primary">멀티 게임</button>
                            </div>
                        </form>
                    </div>
                </section>

                <section className="cards">
                    <a className="card" href="./tetrisSingle.html">
                        <div className="card-title">Single</div>
                        <div className="card-desc">혼자 연습하기 — 현재 구현된 싱글 플레이로 바로 시작</div>
                        <div className="card-cta">시작하기 →</div>
                    </a>
                    <a className="card" href="./multiLobby.html" data-multi-lobby-link
                        onClick={enterMultiLobby}>
                        <div className="card-title">Online</div>
                        <div className="card-desc">웹소켓 멀티 대전 — 게임 로그는 AI 학습에 사용될 수 있습니다.</div>
                        <div className="card-cta">입장하기 →</div>
                    </a>
                </section>

                <section id="guide" className="guide">
                    <h3>키 가이드</h3>
                    <ul>
                        <li><kbd>←</kbd><span>왼쪽 이동</span></li>
                        <li><kbd>→</kbd><span>오른쪽 이동</span></li>
                        <li><kbd>↓</kbd><span>한 칸 하강(소프트 드롭)</span></li>
                        <li><kbd>↑</kbd><span>회전</span></li>
                        <li><kbd>Space</kbd><span>하드 드롭</span></li>
                    </ul>
                </section>
            </main>

            <footer className="footer">
                <span>© <span id="year">{new Date().getFullYear()}</span> Tetris Multi</span>
                <span className="dot">•</span>
                <a href="https://github.com/Sleepingco/Tetris_multi" target="_blank" rel="noreferrer">GitHub</a>
            </footer>
        </div>
    );
}

const root = document.getElementById("indexRoot");
if (!root) throw new Error("Missing #indexRoot");
createRoot(root).render(<StrictMode><IndexPage /></StrictMode>);
