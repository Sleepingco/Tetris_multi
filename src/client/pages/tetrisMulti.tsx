import {
    StrictMode,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ServerToClientParsedPayload } from "../../shared/socketContractTypes";
import { roomPublicSchema } from "../../shared/socketContracts.mjs";
import { startMultiplayerGame } from "../game/entry/multiplayerGameSession.js";
import { applySavedTheme, toggleTheme } from "../game/entry/theme";
import { initGameSound, tryPlayMusic } from "../game/runtime/sound.js";
import BLOCKS from "../game/state/blocks.js";
import { onPlacementDecisionLogResult } from "../net/logClient.js";
import {
    getPlayerSession,
    leaveGame,
    onGameJoinResult,
    onGameOpponentLeft,
    onMatchFinish,
    onPveAiPolicy,
    onSessionDisconnected,
    onSessionError,
    onSessionReady,
    requestJoinGameRoom,
    requestLeaveRoom,
} from "../net/roomClient.js";

type PublicRoom = ServerToClientParsedPayload<"room:updated">;
type SessionReady = ServerToClientParsedPayload<"session:ready">;
type GameJoinResult = ServerToClientParsedPayload<"game:join:result">;
type PveAiPolicy = ServerToClientParsedPayload<"pve:ai-policy">;
type MatchFinish = ServerToClientParsedPayload<"match:finish">;
type OpponentLeft = ServerToClientParsedPayload<"game:opponent-left">;
type PlacementLogResult = ServerToClientParsedPayload<"game:log:result">;
type SessionError = { code: string; terminal: boolean };
type SessionDisconnect = { reason: string; terminal: boolean };
type Disposer = () => void;
type PlayerNumber = 1 | 2;
type DisplaySnapshot = {
    score: number;
    lines: number;
    holdPieceType: string | null;
    nextPieceTypes: [string | null, string | null];
    pendingGarbageLines: number;
    phase: "playing" | "lineClearing" | "gameOver";
};
type DisplayHandle = {
    getDisplaySnapshot: () => DisplaySnapshot;
    subscribeDisplay: (callback: () => void) => () => void;
};
type DisplaySource = Pick<DisplayHandle, "getDisplaySnapshot" | "subscribeDisplay">;
type GameSession = {
    myGame: DisplaySource;
    opponentGame: DisplaySource;
    destroy: () => void;
};
type DisplayHandles = {
    player1: DisplayHandle;
    player2: DisplayHandle;
};
type Badge = { text: string; title?: string };
type Overlay = { text: string; showLobby: boolean } | null;
type PageInfo = {
    roomId: string | null;
    player1Name: string;
    player2Name: string;
    player1Badge: Badge;
    player2Badge: Badge;
    mine: PlayerNumber | null;
};

const EMPTY_PAGE_INFO: PageInfo = {
    roomId: null,
    player1Name: "Player 1",
    player2Name: "Player 2",
    player1Badge: { text: "-" },
    player2Badge: { text: "-" },
    mine: null,
};
const WAITING_OVERLAYS: [Overlay, Overlay] = [
    { text: "대기중", showLobby: false },
    { text: "대기중", showLobby: false },
];

function createDisplayHandle(game: DisplaySource): DisplayHandle {
    return {
        getDisplaySnapshot: () => game.getDisplaySnapshot(),
        subscribeDisplay: callback => game.subscribeDisplay(callback),
    };
}

function clearRoomSession() {
    sessionStorage.removeItem("tetris:roomId");
    sessionStorage.removeItem("room");
}

function readStoredRoom(): PublicRoom | null {
    const roomJson = sessionStorage.getItem("room");
    if (!roomJson) return null;

    try {
        const parsed = roomPublicSchema.safeParse(JSON.parse(roomJson));
        if (parsed.success) return parsed.data;
    } catch {
        // 아래에서 기존 room routing 값만 정리한다.
    }
    clearRoomSession();
    return null;
}

function storeRoom(room: PublicRoom) {
    sessionStorage.setItem("tetris:roomId", room.roomId);
    sessionStorage.setItem("room", JSON.stringify(room));
}

function PiecePreview({ pieceType }: { pieceType: string | null }) {
    const offsets = pieceType
        ? BLOCKS[pieceType as keyof typeof BLOCKS]?.[0]
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

function PlayerHud({
    handle,
    playerNumber,
    statsRoot,
    holdRoot,
    nextRoot,
}: {
    handle: DisplayHandle;
    playerNumber: PlayerNumber;
    statsRoot: HTMLDivElement;
    holdRoot: HTMLDivElement;
    nextRoot: HTMLDivElement;
}) {
    const snapshot = useSyncExternalStore(
        handle.subscribeDisplay,
        handle.getDisplaySnapshot,
    );

    return (
        <>
            {createPortal(
                <>
                    <div className="stat">
                        <span className="label">Score</span>
                        <span className="score">{snapshot.score}</span>
                    </div>
                    <div className="stat">
                        <span className="label">Lines</span>
                        <span className="lines">{snapshot.lines}</span>
                    </div>
                    <div
                        className={`stat stat--incoming${snapshot.pendingGarbageLines > 0
                            ? " is-danger"
                            : ""}`}
                    >
                        <span className="label">Incoming</span>
                        <span className="pending-garbage" data-player={playerNumber}>
                            {snapshot.pendingGarbageLines}
                        </span>
                    </div>
                </>,
                statsRoot,
                "stats",
            )}
            {createPortal(
                <PiecePreview pieceType={snapshot.holdPieceType} />,
                holdRoot,
                "hold",
            )}
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
        </>
    );
}

function PlayerColumn({
    playerNumber,
    name,
    badge,
    isMine,
    handle,
    canvasRef,
    overlay,
    onReturnToLobby,
}: {
    playerNumber: PlayerNumber;
    name: string;
    badge: Badge;
    isMine: boolean;
    handle: DisplayHandle | null;
    canvasRef: RefObject<HTMLCanvasElement | null>;
    overlay: Overlay;
    onReturnToLobby: () => void;
}) {
    const statsRootRef = useRef<HTMLDivElement>(null);
    const holdRootRef = useRef<HTMLDivElement>(null);
    const nextRootRef = useRef<HTMLDivElement>(null);
    const hudRoots = handle
        && statsRootRef.current
        && holdRootRef.current
        && nextRootRef.current;

    return (
        <section
            className={`player-column${isMine ? " is-mine" : ""}`}
            data-player={playerNumber}
        >
            <div className="player-header">
                <div className="player-id-wrap">
                    <div className="player-id" id={`player${playerNumber}Name`}>{name}</div>
                    <span
                        id={`player${playerNumber}RoleBadge`}
                        title={badge.title}
                    >
                        {badge.text}
                    </span>
                </div>
                <div className="player-stats" ref={statsRootRef}>
                    {!handle && (
                        <>
                            <div className="stat">
                                <span className="label">Score</span>
                                <span className="score">0</span>
                            </div>
                            <div className="stat">
                                <span className="label">Lines</span>
                                <span className="lines">0</span>
                            </div>
                            <div className="stat stat--incoming">
                                <span className="label">Incoming</span>
                                <span className="pending-garbage" data-player={playerNumber}>0</span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="player-panels">
                <aside className="panel panel--left">
                    <div className="panel-section">
                        <h2>Hold</h2>
                        <div className="hold-preview" data-player={playerNumber} ref={holdRootRef} />
                    </div>
                    <div className="panel-section">
                        <h2>Next Up</h2>
                        <div className="next-preview" data-player={playerNumber} ref={nextRootRef} />
                    </div>
                </aside>

                <section className="playfield playfield--multi">
                    <div
                        className="game-text"
                        data-player={playerNumber}
                        style={{ display: overlay ? "flex" : "none" }}
                        aria-live={isMine ? "polite" : undefined}
                        aria-atomic={isMine ? true : undefined}
                    >
                        <span>{overlay?.text ?? ""}</span>
                        {overlay?.showLobby && (
                            <button className="match-lobby-btn" type="button" onClick={onReturnToLobby}>
                                로비로
                            </button>
                        )}
                    </div>
                    <div className="playground" data-player={playerNumber}>
                        <canvas
                            ref={canvasRef}
                            className="tetrisBoardCanvas"
                            width="300"
                            height="600"
                        />
                    </div>
                </section>
            </div>

            {hudRoots && (
                <PlayerHud
                    handle={handle}
                    playerNumber={playerNumber}
                    statsRoot={statsRootRef.current!}
                    holdRoot={holdRootRef.current!}
                    nextRoot={nextRootRef.current!}
                />
            )}
        </section>
    );
}

function MultiplayerGamePage() {
    const player1CanvasRef = useRef<HTMLCanvasElement>(null);
    const player2CanvasRef = useRef<HTMLCanvasElement>(null);
    const soundToggleRef = useRef<HTMLButtonElement>(null);
    const themeToggleRef = useRef<HTMLButtonElement>(null);
    const homeButtonRef = useRef<HTMLAnchorElement>(null);
    const [pageInfo, setPageInfo] = useState<PageInfo>(EMPTY_PAGE_INFO);
    const [displayHandles, setDisplayHandles] = useState<DisplayHandles | null>(null);
    const [overlays, setOverlays] = useState<[Overlay, Overlay]>(WAITING_OVERLAYS);
    const [homeDisabled, setHomeDisabled] = useState(true);

    useEffect(() => {
        const player1Canvas = player1CanvasRef.current;
        const player2Canvas = player2CanvasRef.current;
        const soundToggle = soundToggleRef.current;
        const themeToggle = themeToggleRef.current;
        const homeButton = homeButtonRef.current;
        if (!player1Canvas || !player2Canvas) return;

        applySavedTheme(themeToggle);
        const room = readStoredRoom();
        const playerId = (getPlayerSession() as SessionReady | null)?.playerId;
        if (
            !room
            || !playerId
            || !room.players.some(player => player.playerId === playerId)
        ) {
            clearRoomSession();
            window.location.replace("./multiLobby.html");
            return;
        }

        const roomId = room.roomId;
        const hostPlayer = room.players.find(player => player.playerId === room.hostPlayerId);
        const guestPlayer = room.players.find(player => player.playerId !== room.hostPlayerId);
        const myRole = playerId === room.hostPlayerId ? "host" : "guest";
        const isPveMode = room.mode === "pve";
        if (!hostPlayer || !guestPlayer) {
            clearRoomSession();
            window.location.replace("./multiLobby.html");
            return;
        }

        const initialPlayer2Badge = myRole === "guest"
            ? { text: "내 보드" }
            : isPveMode
                ? room.aiPolicy === "placement_v4"
                    ? { text: "실험 AI · 준비 중" }
                    : { text: "AI 상대 · 휴리스틱" }
                : { text: "상대 보드" };
        setPageInfo({
            roomId,
            player1Name: hostPlayer.nickname || "Host",
            player2Name: guestPlayer.nickname || "Guest",
            player1Badge: { text: myRole === "host" ? "내 보드" : "상대 보드" },
            player2Badge: initialPlayer2Badge,
            mine: myRole === "host" ? 1 : 2,
        });

        let disposed = false;
        let terminal = false;
        let matchFinished = false;
        let joinPending = false;
        let isSessionReady = false;
        let activeGameSession: GameSession | null = null;
        let navigationTimer: number | null = null;
        const disposers: Disposer[] = [];
        const cleanupSound = initGameSound(soundToggle);

        const updatePveAiPolicyBadge = (policy: PveAiPolicy) => {
            if (!isPveMode || policy.roomId !== roomId || policy.playerId !== guestPlayer.playerId) {
                return;
            }
            const badge: Badge = policy.policyUsed === "placement_v4"
                ? { text: "실험 AI · 동작 중" }
                : {
                    text: policy.policyRequested === "placement_v4"
                        ? "실험 AI · 휴리스틱 전환"
                        : "AI 상대 · 휴리스틱",
                    ...(policy.fallbackReason
                        ? { title: `모델 전환 사유: ${policy.fallbackReason}` }
                        : {}),
                };
            setPageInfo(current => ({ ...current, player2Badge: badge }));
        };

        const destroyGameSession = () => {
            activeGameSession?.destroy();
            activeGameSession = null;
        };
        const disposePageEffects = () => {
            if (disposed) return;
            disposed = true;
            joinPending = false;
            if (navigationTimer !== null) window.clearTimeout(navigationTimer);
            navigationTimer = null;
            disposers.splice(0).forEach(dispose => dispose());
            themeToggle?.removeEventListener("click", handleThemeToggle);
            homeButton?.removeEventListener("click", handleHomeClick);
            cleanupSound?.();
            destroyGameSession();
        };
        const redirectToLobby = () => {
            disposePageEffects();
            clearRoomSession();
            window.location.replace("./multiLobby.html");
        };

        function handleThemeToggle() {
            toggleTheme(themeToggle);
        }
        function handleHomeClick(event: MouseEvent) {
            event.preventDefault();
            if (disposed || !isSessionReady) return;
            terminal = true;
            joinPending = false;
            isSessionReady = false;
            if (matchFinished) {
                requestLeaveRoom(roomId, playerId);
            } else {
                leaveGame(roomId, playerId);
            }
            destroyGameSession();
            clearRoomSession();
            navigationTimer = window.setTimeout(() => {
                window.location.replace("./index.html");
            }, 50);
        }
        themeToggle?.addEventListener("click", handleThemeToggle);
        homeButton?.addEventListener("click", handleHomeClick);

        disposers.push(onPlacementDecisionLogResult((result: PlacementLogResult) => {
            if (!result.ok) {
                console.warn("placement_decision log save failed:", result.reason);
            }
        }));
        disposers.push(onGameJoinResult((result: GameJoinResult) => {
            if (disposed || !joinPending) return;
            joinPending = false;
            if (
                !result.ok
                || result.room?.roomId !== roomId
                || result.match?.roomId !== roomId
            ) {
                redirectToLobby();
                return;
            }

            storeRoom(result.room);
            if (isPveMode && result.match.aiPolicyRuntime) {
                updatePveAiPolicyBadge(result.match.aiPolicyRuntime);
            }
            const opponentPlayerId = myRole === "host"
                ? guestPlayer.playerId
                : hostPlayer.playerId;
            const session = startMultiplayerGame({
                roomId,
                playerId,
                opponentPlayerId,
                mode: isPveMode ? "pve" : "multi",
                match: result.match,
                myCanvas: myRole === "host" ? player1Canvas : player2Canvas,
                opponentCanvas: myRole === "host" ? player2Canvas : player1Canvas,
                onUserInteract: tryPlayMusic,
            }) as GameSession;
            activeGameSession = session;
            setDisplayHandles(myRole === "host"
                ? {
                    player1: createDisplayHandle(session.myGame),
                    player2: createDisplayHandle(session.opponentGame),
                }
                : {
                    player1: createDisplayHandle(session.opponentGame),
                    player2: createDisplayHandle(session.myGame),
                });
            setOverlays([null, null]);
            setHomeDisabled(false);
        }));
        disposers.push(onPveAiPolicy(updatePveAiPolicyBadge));
        disposers.push(onMatchFinish((result: MatchFinish) => {
            if (disposed || matchFinished || result.room.roomId !== roomId) return;
            matchFinished = true;
            joinPending = false;
            destroyGameSession();
            storeRoom(result.room);
            setOverlays([
                {
                    text: result.winnerPlayerId === hostPlayer.playerId ? "승리" : "패배",
                    showLobby: myRole === "host",
                },
                {
                    text: result.winnerPlayerId === guestPlayer.playerId ? "승리" : "패배",
                    showLobby: myRole === "guest",
                },
            ]);
        }));
        disposers.push(onGameOpponentLeft(({ room: updatedRoom }: OpponentLeft) => {
            if (disposed) return;
            joinPending = false;
            destroyGameSession();
            if (updatedRoom) storeRoom(updatedRoom);
            window.location.replace("./multiLobby.html");
        }));
        disposers.push(onSessionReady((session: SessionReady) => {
            if (
                disposed
                || terminal
                || matchFinished
                || joinPending
                || activeGameSession
            ) {
                return;
            }
            if (session.playerId !== playerId) {
                redirectToLobby();
                return;
            }
            isSessionReady = true;
            joinPending = true;
            setHomeDisabled(false);
            requestJoinGameRoom(roomId, playerId);
        }));
        disposers.push(onSessionError(({ terminal: isTerminal }: SessionError) => {
            if (disposed || !isTerminal) return;
            terminal = true;
            joinPending = false;
            isSessionReady = false;
            setHomeDisabled(true);
            destroyGameSession();
            redirectToLobby();
        }));
        disposers.push(onSessionDisconnected(({ terminal: isTerminal }: SessionDisconnect) => {
            if (disposed) return;
            terminal = isTerminal;
            joinPending = false;
            isSessionReady = false;
            setHomeDisabled(true);
            destroyGameSession();
            if (matchFinished) return;
            const message = isTerminal
                ? "세션이 만료되었거나 다른 탭으로 이동했습니다. 새로고침해 주세요."
                : "재연결 중";
            setOverlays([
                { text: message, showLobby: false },
                { text: message, showLobby: false },
            ]);
        }));

        const handlePageHide = () => disposePageEffects();
        const handlePageShow = (event: PageTransitionEvent) => {
            if (event.persisted) window.location.reload();
        };
        window.addEventListener("pagehide", handlePageHide, { once: true });
        window.addEventListener("pageshow", handlePageShow);
        return () => {
            window.removeEventListener("pagehide", handlePageHide);
            window.removeEventListener("pageshow", handlePageShow);
            disposePageEffects();
        };
    }, []);

    const returnToLobby = () => window.location.replace("./multiLobby.html");

    return (
        <div className="multi-wrapper">
            <header className="multi-header">
                <div className="multi-title">
                    <h1>Multiplayer Tetris</h1>
                    <div
                        className="room-info-badge"
                        id="multiRoomBadge"
                        style={{ display: pageInfo.roomId ? "inline-flex" : "none" }}
                    >
                        <span className="room-dot" />
                        <span id="roomCodeText">방 코드: {pageInfo.roomId ?? "-"}</span>
                    </div>
                    <p>2인 멀티 MVP</p>
                </div>
                <div className="multi-actions">
                    <button
                        ref={soundToggleRef}
                        id="soundToggle"
                        className="sound-toggle"
                        type="button"
                        aria-pressed="false"
                    >
                        사운드 켜기
                    </button>
                    <button
                        ref={themeToggleRef}
                        id="themeToggle"
                        className="sound-toggle"
                        type="button"
                        aria-pressed="false"
                    >
                        다크 모드
                    </button>
                    <a
                        ref={homeButtonRef}
                        className="home-btn"
                        href="./index.html"
                        aria-disabled={homeDisabled}
                    >
                        홈으로
                    </a>
                </div>
            </header>

            <main className="multi-grid">
                <PlayerColumn
                    playerNumber={1}
                    name={pageInfo.player1Name}
                    badge={pageInfo.player1Badge}
                    isMine={pageInfo.mine === 1}
                    handle={displayHandles?.player1 ?? null}
                    canvasRef={player1CanvasRef}
                    overlay={overlays[0]}
                    onReturnToLobby={returnToLobby}
                />
                <PlayerColumn
                    playerNumber={2}
                    name={pageInfo.player2Name}
                    badge={pageInfo.player2Badge}
                    isMine={pageInfo.mine === 2}
                    handle={displayHandles?.player2 ?? null}
                    canvasRef={player2CanvasRef}
                    overlay={overlays[1]}
                    onReturnToLobby={returnToLobby}
                />
            </main>
        </div>
    );
}

const root = document.getElementById("multiplayerRoot");
if (!root) throw new Error("Missing #multiplayerRoot");
createRoot(root).render(<StrictMode><MultiplayerGamePage /></StrictMode>);
