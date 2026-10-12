import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { applySavedTheme, toggleTheme } from "../game/entry/theme";
import { initLobbySound } from "../game/runtime/sound.ts";

// =============================
// 시작 페이지 React shell
// 모드별 진입, 멀티 nickname, theme/sound 수명주기만 소유하며 게임 규칙은 실행하지 않는다.
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
    return (
        <div className="container home-page">
            <header className="header">
                <h1 className="brand">
                    <svg className="brand-mark" viewBox="0 0 40 56" aria-hidden="true">
                        <rect x="20" y="2" width="15" height="15" rx="1.5" />
                        <rect x="20" y="19" width="15" height="15" rx="1.5" />
                        <rect x="20" y="36" width="15" height="15" rx="1.5" />
                        <rect x="3" y="36" width="15" height="15" rx="1.5" />
                    </svg>
                    <span>Tetra Arena</span>
                </h1>
                <nav className="nav">
                    <button ref={themeToggleRef} id="themeToggle" type="button" className="btn ghost"
                        aria-pressed="false" onClick={() => toggleTheme(themeToggleRef.current)}>
                        다크 모드
                    </button>
                    <button ref={soundToggleRef} id="soundToggle" type="button" className="btn ghost"
                        aria-pressed="false">사운드 켜기</button>
                </nav>
            </header>

            <main className="main home-main">
                <section className="home-modes" aria-labelledby="homeTitle">
                    <svg className="home-side-art home-side-art-left" viewBox="0 0 192 128" aria-hidden="true">
                        <g className="piece-yellow">
                            <rect x="64" y="0" width="31" height="31" />
                            <rect x="64" y="32" width="31" height="31" />
                            <rect x="96" y="0" width="31" height="31" />
                            <rect x="96" y="32" width="31" height="31" />
                        </g>
                        <g className="piece-green">
                            <rect x="128" y="0" width="31" height="31" />
                            <rect x="128" y="32" width="31" height="31" />
                            <rect x="160" y="32" width="31" height="31" />
                            <rect x="160" y="64" width="31" height="31" />
                        </g>
                        <g className="piece-purple">
                            <rect x="0" y="64" width="31" height="31" />
                            <rect x="32" y="32" width="31" height="31" />
                            <rect x="32" y="64" width="31" height="31" />
                            <rect x="64" y="64" width="31" height="31" />
                        </g>
                        <g className="piece-red">
                            <rect x="96" y="64" width="31" height="31" />
                            <rect x="128" y="64" width="31" height="31" />
                            <rect x="128" y="96" width="31" height="31" />
                            <rect x="160" y="96" width="31" height="31" />
                        </g>
                        <g className="piece-cyan">
                            <rect x="0" y="96" width="31" height="31" />
                            <rect x="32" y="96" width="31" height="31" />
                            <rect x="64" y="96" width="31" height="31" />
                            <rect x="96" y="96" width="31" height="31" />
                        </g>
                    </svg>
                    <div className="home-heading">
                        <p className="home-eyebrow">한 판의 몰입, 한 줄의 역전.</p>
                        <h2 id="homeTitle" className="hero-title">TETRA <span>ARENA</span></h2>
                        <p className="home-intro">혼자 연습하거나, 상대와 한 판.</p>
                    </div>
                    <div className="mode-grid">
                        <article className="mode-option">
                            <div>
                                <span className="mode-caption">01 / SOLO</span>
                                <h3>싱글 플레이</h3>
                                <p>혼자 연습하기</p>
                            </div>
                            <a id="btnSingle" className="btn mode-button" href="./tetrisSingle.html">
                                바로 시작 <span aria-hidden="true">↗</span>
                            </a>
                        </article>

                        <article className="mode-option mode-option-multi">
                            <div>
                                <span className="mode-caption">02 / VERSUS</span>
                                <h3>멀티 플레이</h3>
                                <p>사람 또는 AI와 대전</p>
                            </div>
                            <form id="nicknameEntryForm" onSubmit={enterMultiLobby}>
                                <label htmlFor="nicknameInput">닉네임 <span>(선택)</span></label>
                                <input id="nicknameInput" className="input-box" type="text" maxLength={16}
                                    placeholder="비우면 Guest로 입장" autoComplete="nickname"
                                    value={nickname} onChange={event => setNickname(event.target.value)} />
                                <button type="submit" id="btnMulti" className="btn primary mode-button">
                                    로비 입장 <span aria-hidden="true">↗</span>
                                </button>
                            </form>
                        </article>
                    </div>
                    <p className="home-data-note">플레이 기록은 AI 학습에 사용될 수 있습니다.</p>
                    <svg className="home-side-art home-side-art-right" viewBox="0 0 192 96" aria-hidden="true">
                        <g className="piece-blue">
                            <rect x="0" y="32" width="31" height="31" />
                            <rect x="0" y="64" width="31" height="31" />
                            <rect x="32" y="64" width="31" height="31" />
                            <rect x="64" y="64" width="31" height="31" />
                        </g>
                        <g className="piece-orange">
                            <rect x="96" y="32" width="31" height="31" />
                            <rect x="96" y="64" width="31" height="31" />
                            <rect x="128" y="64" width="31" height="31" />
                            <rect x="160" y="64" width="31" height="31" />
                        </g>
                    </svg>
                </section>

                <section className="home-guide">
                    <details id="guide" className="guide-disclosure">
                        <summary>조작법 보기</summary>
                        <ul>
                            <li><kbd>←</kbd><span>왼쪽 이동</span></li>
                            <li><kbd>→</kbd><span>오른쪽 이동</span></li>
                            <li><kbd>↑ / X</kbd><span>시계방향 회전</span></li>
                            <li><kbd>Z</kbd><span>반시계방향 회전</span></li>
                            <li><kbd>↓</kbd><span>한 칸 하강(소프트 드롭)</span></li>
                            <li><kbd>Space</kbd><span>하드 드롭</span></li>
                            <li><kbd>C</kbd><span>홀드 / 교체</span></li>
                        </ul>
                    </details>
                </section>
            </main>

            <footer className="footer">
                <span>© <span id="year">{new Date().getFullYear()}</span> Tetra Arena</span>
                <span className="dot">•</span>
                <a href="https://github.com/Sleepingco/Tetris_multi" target="_blank" rel="noreferrer">GitHub</a>
            </footer>
        </div>
    );
}

const root = document.getElementById("indexRoot");
if (!root) throw new Error("Missing #indexRoot");
createRoot(root).render(<StrictMode><IndexPage /></StrictMode>);
