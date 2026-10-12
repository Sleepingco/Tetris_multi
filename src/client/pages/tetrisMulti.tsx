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
import { startMultiplayerGame } from "../game/entry/multiplayerGameSession.ts";
import type { MultiplayerGameSession } from "../game/entry/multiplayerGameSession.ts";
import { applySavedTheme, toggleTheme } from "../game/entry/theme";
import type {
    RuntimeDisplayHandle,
    RuntimeDisplaySnapshot,
} from "../game/runtime/displayBridge.ts";
import { initGameSound, tryPlayMusic } from "../game/runtime/sound.ts";
import BLOCKS from "../game/state/blocks.ts";
import type { PieceType } from "../game/state/blocks.ts";
import { onPlacementDecisionLogResult } from "../net/logClient.ts";
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
} from "../net/roomClient.ts";
import type {
    PlayerSession,
    SessionDisconnect,
    SessionError,
} from "../net/roomClient.ts";

/**
 * multiplayer game의 React page shell이다.
 *
 * React는 player 이름, badge, overlay와 HUD mount 위치를 관리한다. 실제 board, 입력,
 * gravity와 snapshot 보정은 startMultiplayerGame이 만든 Canvas runtime이 소유한다.
 * 따라서 React state를 gameplay의 두 번째 원천으로 사용하지 않는다.
 *
 * 페이지 시작 흐름:
 * 저장된 공개 room 확인 → session:ready → game:join
 * → 최신 authoritative match 수신 → 두 Canvas runtime 생성 → HUD 구독
 */
type PublicRoom = ServerToClientParsedPayload<"room:updated">;
type SessionReady = PlayerSession;
type GameJoinResult = ServerToClientParsedPayload<"game:join:result">;
type PveAiPolicy = ServerToClientParsedPayload<"pve:ai-policy">;
type MatchFinish = ServerToClientParsedPayload<"match:finish">;
type OpponentLeft = ServerToClientParsedPayload<"game:opponent-left">;
type PlacementLogResult = ServerToClientParsedPayload<"game:log:result">;
type Disposer = () => void;
type PlayerNumber = 1 | 2;
type DisplayHandle = Pick<RuntimeDisplayHandle, "getDisplaySnapshot" | "subscribeDisplay">;
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

function createDisplayHandle(game: DisplayHandle): DisplayHandle {
    return {
        getDisplaySnapshot: () => game.getDisplaySnapshot(),
        subscribeDisplay: callback => game.subscribeDisplay(callback),
    };
}

function clearRoomSession() {
    sessionStorage.removeItem("tetris:roomId");
    sessionStorage.removeItem("room");
}

/**
 * 로비가 남긴 공개 room DTO를 game page routing 정보로 읽는다.
 *
 * Zod 검증에 실패하면 손상된 값을 제거한다. 성공하더라도 이 값만으로 게임을 시작하지
 * 않고, 현재 session으로 game:join을 보내 서버의 최신 membership과 match를 다시 받는다.
 *
 * @returns 검증된 공개 room 또는 사용할 수 없으면 null
 */
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
 * Canvas runtime의 파생 display snapshot을 React HUD portal로 보여 준다.
 *
 * runtime 표시 값의 변경은 publish 알림을 통해 React에 전달된다. score와 next/hold를
 * React가 별도 gameplay state로 복사하지 않으므로 runtime이 계속 단일 원천으로 남는다.
 */
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
    const snapshot: RuntimeDisplaySnapshot = useSyncExternalStore(
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
                        aria-live="polite"
                        aria-atomic="true"
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
                        <PiecePreview pieceType={pieceType} shapeOnly />
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
                        aria-live={playerNumber === 2 ? "polite" : undefined}
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
                            <div className="stat stat--incoming" aria-live="polite" aria-atomic="true">
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
                    <section className="next-strip panel-section" aria-label="다음 조각">
                        <h2>NEXT</h2>
                        <div className="next-preview" data-player={playerNumber} ref={nextRootRef} />
                    </section>
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

/**
 * 저장 room 검증, session 재연결, game join과 multiplayer runtime 생명주기를 조율한다.
 *
 * 이 컴포넌트의 boolean flag는 같은 effect 안에서 중복 join과 늦은 event를 막기 위한
 * 생명주기 상태다. board나 승패를 직접 판정하지 않으며 서버 event를 화면 상태로 옮긴다.
 */
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

    // =============================
    // 멀티플레이 페이지 생명주기
    // session 인증과 game:join 성공 뒤 runtime을 만들고, disconnect/pagehide에서 모두 해제한다.
    // =============================

    useEffect(() => {
        const player1Canvas = player1CanvasRef.current;
        const player2Canvas = player2CanvasRef.current;
        const soundToggle = soundToggleRef.current;
        const themeToggle = themeToggleRef.current;
        const homeButton = homeButtonRef.current;
        if (!player1Canvas || !player2Canvas) return;

        applySavedTheme(themeToggle);
        // 저장 room은 이동을 위한 힌트다. 아래 game:join 응답이 실제 match 시작 기준이다.
        const room = readStoredRoom();
        const playerId = getPlayerSession()?.playerId ?? null;
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
        let activeGameSession: MultiplayerGameSession | null = null;
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
            // listener → DOM event → sound → runtime 순서로 이 page가 만든 부수효과를 정리한다.
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
            // 저장값이 아니라 서버가 돌려준 최신 room/match가 두 runtime의 초기 상태다.
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
            });
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
            // reconnect 때도 새 socket을 room에 다시 join시키고 최신 match를 받는다.
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
            // BFCache가 닫힌 socket/runtime을 복원하지 않도록 현재 서버 상태에서 다시 시작한다.
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
