import { StrictMode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import BLOCKS from "../game/state/blocks.ts";
import type { PieceType } from "../game/state/blocks.ts";
import { applySavedTheme, toggleTheme } from "../game/entry/theme";
import { attachKeyboardInput } from "../game/runtime/input.ts";
import { initGameSound, tryPlayMusic } from "../game/runtime/sound.ts";
import { createTetrisRuntime } from "../game/runtime/tetris.ts";
import type { TetrisRuntime } from "../game/runtime/tetris.ts";
import type { RuntimeDisplayHandle, RuntimeDisplaySnapshot } from "../game/runtime/displayBridge.ts";

function PiecePreview({ pieceType }: { pieceType: PieceType | null }) {
    const offsets = pieceType
        ? BLOCKS[pieceType][0]
        : null;
    const occupied = new Set<string>();
    if (offsets) {
        const minX = Math.min(...offsets.map(([x]) => x));
        const minY = Math.min(...offsets.map(([, y]) => y));
        offsets.forEach(([x, y]) => occupied.add(`${y - minY}:${x - minX}`));
    }

    return (
        <ul className="next-grid">
            {Array.from({ length: 16 }, (_, index) => {
                const active = occupied.has(`${Math.floor(index / 4)}:${index % 4}`);
                const className = active && pieceType
                    ? `next-cell ${pieceType} preview`
                    : "next-cell";
                return <li className={className} key={index} />;
            })}
        </ul>
    );
}

function SingleHud({
    handle,
    scoreRoot,
    nextRoot,
    holdRoot,
    gameOverRoot,
    onRestart,
}: {
    handle: Pick<RuntimeDisplayHandle, "getDisplaySnapshot" | "subscribeDisplay">;
    scoreRoot: HTMLElement;
    nextRoot: HTMLElement;
    holdRoot: HTMLElement;
    gameOverRoot: HTMLElement;
    onRestart: () => void;
}) {
    const snapshot: RuntimeDisplaySnapshot = useSyncExternalStore(
        handle.subscribeDisplay,
        handle.getDisplaySnapshot,
    );

    return (
        <>
            {createPortal(String(snapshot.score), scoreRoot, "score")}
            {createPortal(
                snapshot.nextPieceTypes.map((pieceType, index) => (
                    <div className="next-slot" key={index}>
                        <span className="slot-label">Next {index + 1}</span>
                        <PiecePreview pieceType={pieceType} />
                    </div>
                )),
                nextRoot,
                "next",
            )}
            {createPortal(
                <PiecePreview pieceType={snapshot.holdPieceType} />,
                holdRoot,
                "hold",
            )}
            {createPortal(
                <div
                    className="game-text"
                    style={{ display: snapshot.phase === "gameOver" ? "flex" : "none" }}
                >
                    <span>게임 종료</span>
                    <button type="button" onClick={onRestart}>다시 시작</button>
                </div>,
                gameOverRoot,
                "game-over",
            )}
        </>
    );
}

function SingleGamePage() {
    const boardCanvasRef = useRef<HTMLCanvasElement>(null);
    const scoreRootRef = useRef<HTMLSpanElement>(null);
    const nextRootRef = useRef<HTMLDivElement>(null);
    const holdRootRef = useRef<HTMLDivElement>(null);
    const gameOverRootRef = useRef<HTMLDivElement>(null);
    const soundToggleRef = useRef<HTMLButtonElement>(null);
    const themeToggleRef = useRef<HTMLButtonElement>(null);
    const runtimeRef = useRef<TetrisRuntime | null>(null);
    const [displayHandle, setDisplayHandle] = useState<TetrisRuntime | null>(null);

    useEffect(() => {
        const boardCanvasEl = boardCanvasRef.current;
        if (!boardCanvasEl) return;

        applySavedTheme(themeToggleRef.current);
        const game = createTetrisRuntime({ boardCanvasEl });
        const cleanupSound = initGameSound(soundToggleRef.current);
        game.runtime.detachKeyboard = attachKeyboardInput({
            enqueueAction: game.enqueueInput,
            onUserInteract: tryPlayMusic,
        });
        runtimeRef.current = game;
        game.init();
        setDisplayHandle(game);

        let disposed = false;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
            cleanupSound?.();
            game.destroy();
            if (runtimeRef.current === game) runtimeRef.current = null;
            setDisplayHandle(current => current === game ? null : current);
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

    const restart = () => runtimeRef.current?.init();
    const toggleGameTheme = () => {
        toggleTheme(themeToggleRef.current);
        runtimeRef.current?.render();
    };
    const hudRoots = displayHandle
        && scoreRootRef.current
        && nextRootRef.current
        && holdRootRef.current
        && gameOverRootRef.current;

    return (
        <div className="single-wrapper">
            <header className="single-header">
                <h1 className="page-title">Single Player Tetris</h1>
                <div className="scoreboard">
                    <span className="score-label">Score</span>
                    <span ref={scoreRootRef} className="score" />
                </div>
                <div className="header-actions">
                    <button ref={soundToggleRef} id="soundToggle" className="sound-toggle"
                        type="button" aria-pressed="false">사운드 켜기</button>
                    <button ref={themeToggleRef} id="themeToggle" className="sound-toggle"
                        type="button" aria-pressed="false" onClick={toggleGameTheme}>다크 모드</button>
                    <a className="home-btn" href="./index.html">홈으로</a>
                </div>
            </header>

            <main className="single-layout">
                <aside className="panel panel--left">
                    <div className="panel-section">
                        <h2>Next Up</h2>
                        <div ref={nextRootRef} className="next-preview" />
                    </div>
                </aside>

                <section className="playfield">
                    <div ref={gameOverRootRef} />
                    <div className="playground">
                        <canvas ref={boardCanvasRef} id="tetrisBoardCanvas" width="300" height="600" />
                    </div>
                </section>

                <aside className="panel panel--right">
                    <div className="panel-section">
                        <h2>Hold</h2>
                        <div ref={holdRootRef} className="hold-preview" />
                    </div>
                    <div className="panel-section">
                        <h2>Controls</h2>
                        <ul className="controls-list">
                            <li><kbd>←</kbd><span>왼쪽 이동</span></li>
                            <li><kbd>→</kbd><span>오른쪽 이동</span></li>
                            <li><kbd>↑</kbd><span>회전</span></li>
                            <li><kbd>↓</kbd><span>소프트 드롭</span></li>
                            <li><kbd>Space</kbd><span>하드 드롭</span></li>
                            <li><kbd>C</kbd><span>홀드 / 교체</span></li>
                        </ul>
                    </div>
                </aside>
            </main>

            {hudRoots && (
                <SingleHud
                    handle={displayHandle}
                    scoreRoot={scoreRootRef.current!}
                    nextRoot={nextRootRef.current!}
                    holdRoot={holdRootRef.current!}
                    gameOverRoot={gameOverRootRef.current!}
                    onRestart={restart}
                />
            )}
        </div>
    );
}

const root = document.getElementById("singleRoot");
if (!root) throw new Error("Missing #singleRoot");
createRoot(root).render(<StrictMode><SingleGamePage /></StrictMode>);
