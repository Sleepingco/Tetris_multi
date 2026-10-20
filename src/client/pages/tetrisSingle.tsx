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

// =============================
// 싱글 플레이 React shell
// React는 페이지 수명주기와 HUD만 소유하고, board 규칙·입력 queue·Canvas drawing은 Tetris runtime이 소유한다.
// runtime 표시 snapshot → useSyncExternalStore → 기존 HTML 위치의 portal 순서로 HUD가 갱신된다.
// =============================

/**
 * 조각의 기본 회전 offset을 4x4 preview 안의 왼쪽 위로 맞춰 표시한다.
 * gameplay queue나 piece 상태를 바꾸지 않는 작은 표시 전용 component다.
 */
function PiecePreview({ pieceType, shapeOnly = false }: { pieceType: PieceType | null; shapeOnly?: boolean }) {
    const offsets = pieceType
        ? BLOCKS[pieceType][0]
        : null;
    const occupied = new Set<string>();
    let columns = 4;
    if (offsets) {
        const minX = Math.min(...offsets.map(([x]) => x));
        const minY = Math.min(...offsets.map(([, y]) => y));
        columns = Math.max(...offsets.map(([x]) => x)) - minX + 1;
        offsets.forEach(([x, y]) => occupied.add(`${y - minY}:${x - minX}`));
    }

    return (
        <ul className={shapeOnly ? "next-grid piece-shape" : "next-grid"}
            style={shapeOnly ? { gridTemplateColumns: `repeat(${columns}, 20px)` } : undefined}>
            {Array.from({ length: 16 }, (_, index) => {
                const active = occupied.has(`${Math.floor(index / 4)}:${index % 4}`);
                const className = active && pieceType
                    ? `next-cell ${pieceType} preview`
                    : "next-cell";
                return <li className={className} key={index}
                    style={shapeOnly ? { gridColumn: index % 4 + 1, gridRow: Math.floor(index / 4) + 1 } : undefined} />;
            })}
        </ul>
    );
}

/**
 * runtime 외부 store를 구독해 점수, next, hold, game-over UI를 갱신한다.
 * portal은 React 상태 관리를 유지하면서 기존 HTML layout의 각 자리에 결과를 그리기 위해 사용한다.
 * board 이동처럼 HUD 값이 그대로인 변경은 display bridge가 알리지 않으므로 불필요하게 다시 렌더하지 않는다.
 */
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
                        <PiecePreview pieceType={pieceType} shapeOnly />
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

/**
 * 한 페이지에 Tetris runtime 하나를 만들고 React mount/unmount와 수명을 맞춘다.
 * - Canvas ref가 준비된 effect 안에서 runtime, sound, keyboard를 차례로 연결한다.
 * - runtime이 gameplay와 Canvas를 소유하고 React state에는 HUD 구독 handle만 둔다.
 * - cleanup은 StrictMode 재실행, 일반 unmount, pagehide 어느 경로에서도 한 번만 실제 자원을 해제한다.
 */
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

    // 아래 handler는 외부 runtime API만 호출하며 React가 gameState를 따로 복제하지 않는다.
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
                <aside className="next-strip" aria-label="다음 조각">
                    <h2>NEXT</h2>
                    <div ref={nextRootRef} className="next-preview" />
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
                            <li><kbd>↑ / X</kbd><span>시계방향 회전</span></li>
                            <li><kbd>Z</kbd><span>반시계방향 회전</span></li>
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
