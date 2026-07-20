import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { applySavedTheme, toggleTheme } from "../game/entry/theme";
import { initLobbySound } from "../game/runtime/sound.js";

function createGuestNickname(): string {
    return `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

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
        window.addEventListener("pagehide", dispose, { once: true });
        return () => {
            window.removeEventListener("pagehide", dispose);
            dispose();
        };
    }, []);

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
                        <div className="card-desc">웹소켓 멀티 대전 — 대기실/매칭은 순차 오픈 예정</div>
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
                <a href="https://github.com/" target="_blank" rel="noreferrer">GitHub</a>
            </footer>
        </div>
    );
}

const root = document.getElementById("indexRoot");
if (!root) throw new Error("Missing #indexRoot");
createRoot(root).render(<StrictMode><IndexPage /></StrictMode>);
