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
import type { CombatPresentation, MultiplayerGameSession } from "../game/entry/multiplayerGameSession.ts";
import { applySavedTheme, toggleTheme } from "../game/entry/theme";
import type {
    RuntimeDisplayHandle,
    RuntimeDisplaySnapshot,
} from "../game/runtime/displayBridge.ts";
import { initGameSound, playCombatSfx, tryPlayMusic } from "../game/runtime/sound.ts";
import { initEffectToggle, loadReducedEffects } from "../game/runtime/effectPreferences.ts";
import BLOCKS from "../game/state/blocks.ts";
import type { PieceType } from "../game/state/blocks.ts";
import { onPlacementDecisionLogResult } from "../net/logClient.ts";
import {
    getPlayerSession,
    leaveGame,
    onGameJoinResult,
    onGameLeaveResult,
    onGameCountdown,
    onGameOpponentLeft,
    onMatchFinish,
    onPveAiPolicy,
    onRoomResult,
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
type Overlay = { text: string; showLobby: boolean; showRetry?: boolean } | null;
type CombatNotice = { text: string; kind: "send" | "receive" | "impact" | "cancel" | "achievement" };
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

function IncomingMeter({ lines, playerNumber }: { lines: number; playerNumber: PlayerNumber }) {
    const filled = Math.min(lines, 20);
    return (
        <aside className={`incoming-rail${lines > 0 ? " is-danger" : ""}`}>
            <span className="incoming-rail-label" aria-hidden="true">대기<strong>{lines}</strong></span>
            <div className="incoming-meter" role="meter" aria-label={`플레이어 ${playerNumber} 대기 공격량`}
                aria-valuemin={0} aria-valuemax={20} aria-valuenow={filled}
                aria-valuetext={`${lines}줄 대기, 한 칸당 1줄, 표시 최대 20줄`}>
                {Array.from({ length: 20 }, (_, index) => (
                    <span className={`incoming-segment${index >= 20 - filled ? " is-filled" : ""}`}
                        aria-hidden="true" key={index} />
                ))}
            </div>
            {lines > 20 && <span className="incoming-overflow" aria-hidden="true">+{lines - 20}</span>}
        </aside>
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
    incomingRoot,
}: {
    handle: DisplayHandle;
    playerNumber: PlayerNumber;
    statsRoot: HTMLDivElement;
    holdRoot: HTMLDivElement;
    nextRoot: HTMLDivElement;
    incomingRoot: HTMLDivElement;
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
                <IncomingMeter lines={snapshot.pendingGarbageLines} playerNumber={playerNumber} />,
                incomingRoot,
                "incoming",
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
    combatNotice,
    onReturnToLobby,
    onRetryJoin,
    retryPending,
}: {
    playerNumber: PlayerNumber;
    name: string;
    badge: Badge;
    isMine: boolean;
    handle: DisplayHandle | null;
    canvasRef: RefObject<HTMLCanvasElement | null>;
    overlay: Overlay;
    combatNotice: CombatNotice | null;
    onReturnToLobby: () => void;
    onRetryJoin: () => void;
    retryPending: boolean;
}) {
    const statsRootRef = useRef<HTMLDivElement>(null);
    const holdRootRef = useRef<HTMLDivElement>(null);
    const nextRootRef = useRef<HTMLDivElement>(null);
    const incomingRootRef = useRef<HTMLDivElement>(null);
    const hudRoots = handle
        && statsRootRef.current
        && holdRootRef.current
        && nextRootRef.current
        && incomingRootRef.current;

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

            <div className="combat-feedback" role="status" aria-live="polite" aria-atomic="true">
                {combatNotice && <span className={`combat-notice combat-notice--${combatNotice.kind}`}>
                    {combatNotice.text}
                </span>}
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

                <div className="board-with-incoming">
                    <div className="incoming-root" ref={incomingRootRef}>
                        {!handle && <IncomingMeter lines={0} playerNumber={playerNumber} />}
                    </div>
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
                            {isMine && overlay?.showRetry && (
                                <button className="match-lobby-btn" type="button" disabled={retryPending} onClick={onRetryJoin}>
                                    {retryPending ? "참가 요청 중" : "참가 다시 시도"}
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
            </div>

            {hudRoots && (
                <PlayerHud
                    handle={handle}
                    playerNumber={playerNumber}
                    statsRoot={statsRootRef.current!}
                    holdRoot={holdRootRef.current!}
                    nextRoot={nextRootRef.current!}
                    incomingRoot={incomingRootRef.current!}
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
    const effectsToggleRef = useRef<HTMLButtonElement>(null);
    const homeButtonRef = useRef<HTMLAnchorElement>(null);
    const combatLayerRef = useRef<HTMLDivElement>(null);
    const [pageInfo, setPageInfo] = useState<PageInfo>(EMPTY_PAGE_INFO);
    const [displayHandles, setDisplayHandles] = useState<DisplayHandles | null>(null);
    const [overlays, setOverlays] = useState<[Overlay, Overlay]>(WAITING_OVERLAYS);
    const [homeDisabled, setHomeDisabled] = useState(true);
    const [retryPending, setRetryPending] = useState(false);
    const retryJoinRef = useRef<() => void>(() => {});
    const [combatNotices, setCombatNotices] = useState<[CombatNotice | null, CombatNotice | null]>([null, null]);

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
        let leavePending = false;
        let activeGameSession: MultiplayerGameSession | null = null;
        let navigationTimer: number | null = null;
        let countdownTimer: number | null = null;
        let countdownStartsAt: number | null | undefined;
        let activeMatchId: string | null = null;
        const disposers: Disposer[] = [];
        const noticeTimers: [number | null, number | null] = [null, null];
        const achievementElements: [HTMLElement | null, HTMLElement | null] = [null, null];
        const achievementTimers: [number | null, number | null] = [null, null];
        const projectiles = new Map<HTMLElement, Animation>();
        const pulses = new Map<HTMLElement, Animation>();
        let reducedEffects = loadReducedEffects();
        const cleanupSound = initGameSound(soundToggle);
        const cleanupEffects = initEffectToggle(effectsToggleRef.current, reduced => {
            reducedEffects = reduced;
            if (reduced) clearCombatMotion();
            activeGameSession?.myGame.setReducedEffects(reduced);
            activeGameSession?.opponentGame.setReducedEffects(reduced);
        });

        function clearCombatMotion(): void {
            projectiles.forEach((animation, element) => { animation.cancel(); element.remove(); });
            projectiles.clear();
            pulses.forEach(animation => animation.cancel());
            pulses.clear();
            achievementElements.forEach(element => {
                if (element) element.dataset.reduced = "true";
            });
        }

        function clearAchievement(index: 0 | 1): void {
            if (achievementTimers[index] !== null) window.clearTimeout(achievementTimers[index]);
            achievementTimers[index] = null;
            achievementElements[index]?.remove();
            achievementElements[index] = null;
            const canvas = index === 0 ? player1Canvas! : player2Canvas!;
            const feedback = canvas.closest(".player-column")?.querySelector<HTMLElement>(".combat-feedback");
            if (feedback) delete feedback.dataset.achievement;
        }

        function clearAchievements(): void {
            clearAchievement(0);
            clearAchievement(1);
        }
        function handleAchievementResize(): void {
            for (const index of [0, 1] as const) {
                const element = achievementElements[index];
                if (element && element.dataset.viewport !== `${window.innerWidth}:${window.innerHeight}`) clearAchievement(index);
            }
        }
        window.addEventListener("resize", handleAchievementResize);
        disposers.push(() => window.removeEventListener("resize", handleAchievementResize));

        function showAchievement(index: 0 | 1, effect: CombatPresentation["effect"]): void {
            const event = effect.isTSpin ? "tspin" : effect.linesCleared === 4 ? "tetris" : effect.combo > 0 ? "combo" : null;
            const layer = combatLayerRef.current;
            if (!event || !layer) return;
            clearAchievement(index);
            const canvas = index === 0 ? player1Canvas! : player2Canvas!;
            const other = index === 0 ? player2Canvas! : player1Canvas!;
            const board = canvas.getBoundingClientRect();
            const oppositeBoard = other.getBoundingClientRect();
            const playfield = canvas.closest<HTMLElement>(".playfield")!;
            const frame = playfield.getBoundingClientRect();
            const oppositeFrame = other.closest(".playfield")!.getBoundingClientRect();
            const bounds = layer.getBoundingClientRect();
            const leftBoard = board.left < oppositeBoard.left;
            const beside = Math.abs(board.top - oppositeBoard.top) < 30;
            const gap = leftBoard ? oppositeFrame.left - frame.right : frame.left - oppositeFrame.right;
            const feedback = canvas.closest(".player-column")!.querySelector<HTMLElement>(".combat-feedback")!;
            const width = beside ? Math.min(172, gap - 16) : Math.min(220, board.width);
            const element = document.createElement("div");
            element.className = `combat-achievement combat-achievement--${event}`;
            element.setAttribute("aria-hidden", "true");
            element.dataset.player = String(index + 1);
            element.dataset.event = event;
            element.dataset.reduced = String(reducedEffects);
            element.dataset.viewport = `${window.innerWidth}:${window.innerHeight}`;
            if (beside) {
                const x = leftBoard ? frame.right + 8 : frame.left - width - 8;
                element.style.left = `${x - bounds.left}px`;
                element.style.top = `${board.top + board.height * (leftBoard ? 0.75 : 0.88) - bounds.top}px`;
            }
            element.style.width = `${width}px`;
            element.style.fontSize = `${Math.min(34, width / 4.5)}px`;
            const title = document.createElement("strong");
            title.className = "combat-achievement-title";
            title.textContent = event === "tspin" ? "T-SPIN" : event === "tetris" ? "TETRIS" : `COMBO ${effect.combo}`;
            element.append(title);
            if (event !== "combo" && effect.combo > 0) {
                const combo = document.createElement("span");
                combo.className = "combat-achievement-combo";
                combo.textContent = `COMBO ${effect.combo}`;
                element.append(combo);
            }
            if (!reducedEffects) {
                for (let i = 0; i < 4; i++) {
                    const spark = document.createElement("span");
                    spark.className = "achievement-spark";
                    spark.style.left = `${i % 2 === 0 ? 10 : width - 14}px`;
                    spark.style.top = `${i < 2 ? -4 : 28}px`;
                    spark.style.setProperty("--spark-x", `${i % 2 === 0 ? -6 : 6}px`);
                    spark.style.setProperty("--spark-y", `${i < 2 ? -14 : 14}px`);
                    element.append(spark);
                }
            }
            // 세로 배치 문구는 보드에 붙여 앞쪽 레이아웃 변경을 따라간다.
            (beside ? layer : playfield).append(element);
            achievementElements[index] = element;
            if (!beside) feedback.dataset.achievement = "true";
            achievementTimers[index] = window.setTimeout(() => clearAchievement(index), 1200);
        }

        function showNotice(index: 0 | 1, notice: CombatNotice): void {
            if (noticeTimers[index] !== null) window.clearTimeout(noticeTimers[index]);
            setCombatNotices(current => index === 0 ? [notice, current[1]] : [current[0], notice]);
            noticeTimers[index] = window.setTimeout(() => {
                noticeTimers[index] = null;
                setCombatNotices(current => index === 0 ? [null, current[1]] : [current[0], null]);
            }, 650);
        }

        function pulseBoard(canvas: HTMLCanvasElement, danger: boolean, impact = false): void {
            if (reducedEffects) return;
            const frame = canvas.closest<HTMLElement>(".playfield");
            if (!frame?.animate) return;
            pulses.get(frame)?.cancel();
            const color = getComputedStyle(canvas).getPropertyValue(danger ? "--game-danger" : "--game-accent").trim();
            const animation = frame.animate([
                { boxShadow: "0 0 0 0 transparent", transform: "translateY(0)" },
                { boxShadow: `0 0 0 2px ${color}`, transform: impact ? "translateY(2px)" : "translateY(0)", offset: 0.3 },
                { boxShadow: "0 0 0 0 transparent", transform: "translateY(0)" },
            ], { duration: impact ? 120 : 180, easing: "ease-out" });
            pulses.set(frame, animation);
            animation.onfinish = () => { if (pulses.get(frame) === animation) pulses.delete(frame); };
        }

        function launchAttack(source: HTMLCanvasElement, target: HTMLCanvasElement, lines: number): void {
            const layer = combatLayerRef.current;
            if (reducedEffects || !layer || window.innerWidth < 900) return;
            const from = source.getBoundingClientRect();
            const to = target.getBoundingClientRect();
            if (Math.abs(from.top - to.top) > 30) return;
            const bounds = layer.getBoundingClientRect();
            const direction = to.left > from.left ? 1 : -1;
            const startX = (direction === 1 ? from.right + 10 : from.left - 10) - bounds.left;
            const endX = (direction === 1 ? to.left - 10 : to.right + 10) - bounds.left;
            const startY = from.top + from.height * 0.62 - bounds.top;
            const endY = to.top + to.height * 0.38 - bounds.top;
            const duration = Math.min(620, Math.max(440, Math.hypot(endX - startX, endY - startY) * 1.6));
            const count = Math.min(14, 8 + lines * 2);
            for (let i = 0; i < count && projectiles.size < 40; i++) {
                const size = i === 0 ? 13 : [5, 8, 11][i % 3];
                const element = document.createElement("span");
                element.className = "combat-projectile";
                element.style.width = element.style.height = `${size}px`;
                element.style.left = element.style.top = `${-size / 2}px`;
                layer.append(element);
                const spread = i === 0 ? 0 : ((i % 5) - 2) * 5;
                const animation = element.animate([
                    { transform: `translate(${startX}px, ${startY}px) rotate(0deg)`, opacity: 0 },
                    { transform: `translate(${startX + (endX - startX) * 0.12}px, ${startY + (endY - startY) * 0.12 + spread}px) rotate(15deg)`, opacity: 1, offset: 0.12 },
                    { transform: `translate(${(startX + endX) / 2}px, ${(startY + endY) / 2 + spread - 20}px) rotate(70deg)`, opacity: 0.9, offset: 0.5 },
                    { transform: `translate(${endX}px, ${endY}px) rotate(135deg)`, opacity: 0.3 },
                ], { duration, delay: i * 18, easing: "linear", fill: "backwards" });
                projectiles.set(element, animation);
                animation.onfinish = () => {
                    element.remove();
                    projectiles.delete(element);
                    if (i === 0) burstAttack(endX, endY, direction);
                };
            }
        }

        function burstAttack(x: number, y: number, direction: number): void {
            const layer = combatLayerRef.current;
            if (disposed || terminal || matchFinished || reducedEffects || !layer) return;
            for (let i = 0; i < 6 && projectiles.size < 40; i++) {
                const size = 4 + i % 3 * 2;
                const element = document.createElement("span");
                element.className = "combat-projectile combat-projectile--impact";
                element.style.width = element.style.height = `${size}px`;
                element.style.left = element.style.top = `${-size / 2}px`;
                layer.append(element);
                // 파편은 보드 안쪽을 덮지 않도록 대전 화면 사이 공간으로 흩어진다.
                const animation = element.animate([
                    { transform: `translate(${x}px, ${y}px) rotate(0deg) scale(1)`, opacity: 1 },
                    { transform: `translate(${x - direction * (14 + i * 5)}px, ${y + (i - 2.5) * 14}px) rotate(${90 + i * 30}deg) scale(0.3)`, opacity: 0 },
                ], { duration: 220, easing: "ease-out" });
                projectiles.set(element, animation);
                animation.onfinish = () => { element.remove(); projectiles.delete(element); };
            }
        }

        function showCombatEffect({ playerId: actorId, effect }: CombatPresentation): void {
            if (disposed || terminal || matchFinished) return;
            const index = actorId === hostPlayer!.playerId ? 0 : 1;
            const source = index === 0 ? player1Canvas! : player2Canvas!;
            const target = index === 0 ? player2Canvas! : player1Canvas!;
            showAchievement(index, effect);
            const parts: string[] = [];
            if (effect.isTSpin) parts.push("T-SPIN");
            else if (effect.linesCleared === 4) parts.push("TETRIS");
            if (effect.combo > 0) parts.push(`COMBO ${effect.combo}`);
            if (effect.backToBackBonus) parts.push("B2B");
            if (effect.sentLines > 0) parts.push(`${effect.sentLines}줄 전송`);
            if (effect.canceledLines > 0) parts.push(`${effect.canceledLines}줄 상쇄`);
            if (effect.appliedLines > 0) parts.push(`${effect.appliedLines}줄 적용`);
            if (parts.length) showNotice(index, {
                text: parts.join(" · "),
                kind: effect.appliedLines > 0 ? "impact" : effect.sentLines > 0 ? "send"
                    : effect.canceledLines > 0 ? "cancel" : "achievement",
            });
            if (effect.sentLines > 0) {
                showNotice(index === 0 ? 1 : 0, { text: `${effect.sentLines}줄 대기`, kind: "receive" });
                pulseBoard(source, false);
                pulseBoard(target, true);
                launchAttack(source, target, effect.sentLines);
                playCombatSfx(actorId === playerId ? "send" : "receive");
            }
            if (effect.appliedLines > 0) {
                pulseBoard(source, true, true);
                playCombatSfx("impact");
            }
        }

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
            if (countdownTimer !== null) window.clearInterval(countdownTimer);
            countdownTimer = null;
            countdownStartsAt = undefined;
            activeMatchId = null;
            noticeTimers.forEach(timer => { if (timer !== null) window.clearTimeout(timer); });
            noticeTimers.fill(null);
            clearCombatMotion();
            clearAchievements();
            setCombatNotices([null, null]);
            activeGameSession?.destroy();
            activeGameSession = null;
        };

        function showCountdown(startsAt: number | null | undefined, serverNow: number): void {
            if (!activeGameSession || (startsAt !== undefined && countdownStartsAt === startsAt)) return;
            if (countdownTimer !== null) window.clearInterval(countdownTimer);
            countdownTimer = null;
            countdownStartsAt = startsAt;
            if (startsAt === null) {
                setOverlays([
                    { text: "상대 참가 대기 중", showLobby: false },
                    { text: "상대 참가 대기 중", showLobby: false },
                ]);
                return;
            }
            const deadline = performance.now() + Math.max(0, (startsAt ?? serverNow) - serverNow);
            const update = () => {
                if (disposed || !activeGameSession) return;
                const seconds = Math.ceil((deadline - performance.now()) / 1000);
                if (seconds <= 0) {
                    if (countdownTimer !== null) window.clearInterval(countdownTimer);
                    countdownTimer = null;
                    activeGameSession.start();
                    setOverlays([null, null]);
                    return;
                }
                setOverlays([
                    { text: String(seconds), showLobby: false },
                    { text: String(seconds), showLobby: false },
                ]);
            };
            update();
            if (deadline > performance.now()) countdownTimer = window.setInterval(update, 100);
        }

        function requestGameJoin(): void {
            if (!roomId || !playerId || disposed || terminal || matchFinished || joinPending || activeGameSession || !isSessionReady) return;
            joinPending = requestJoinGameRoom(roomId, playerId);
            setRetryPending(joinPending);
        }
        retryJoinRef.current = requestGameJoin;
        const disposePageEffects = () => {
            // listener → DOM event → sound → runtime 순서로 이 page가 만든 부수효과를 정리한다.
            if (disposed) return;
            disposed = true;
            retryJoinRef.current = () => {};
            joinPending = false;
            if (navigationTimer !== null) window.clearTimeout(navigationTimer);
            navigationTimer = null;
            disposers.splice(0).forEach(dispose => dispose());
            themeToggle?.removeEventListener("click", handleThemeToggle);
            homeButton?.removeEventListener("click", handleHomeClick);
            cleanupSound?.();
            cleanupEffects();
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
            if (disposed || !isSessionReady || leavePending) return;
            leavePending = matchFinished
                ? requestLeaveRoom(roomId, playerId)
                : leaveGame(roomId, playerId);
            setHomeDisabled(leavePending);
        }
        function handleLeaveResult(result: ServerToClientParsedPayload<"game:leave:result">): void {
            if (disposed || !leavePending) return;
            leavePending = false;
            if (!result.ok) {
                setHomeDisabled(false);
                setOverlays([
                    { text: result.reason === "RATE_LIMITED" ? "퇴장 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." : result.reason || "퇴장에 실패했습니다.", showLobby: false },
                    { text: result.reason === "RATE_LIMITED" ? "퇴장 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." : result.reason || "퇴장에 실패했습니다.", showLobby: false },
                ]);
                return;
            }
            terminal = true;
            joinPending = false;
            isSessionReady = false;
            destroyGameSession();
            clearRoomSession();
            navigationTimer = window.setTimeout(() => {
                window.location.replace("./index.html");
            }, 50);
        }
        themeToggle?.addEventListener("click", handleThemeToggle);
        homeButton?.addEventListener("click", handleHomeClick);
        disposers.push(onGameLeaveResult(handleLeaveResult));
        disposers.push(onRoomResult((result, type) => {
            if (type === "leave") handleLeaveResult(result);
        }));

        disposers.push(onPlacementDecisionLogResult((result: PlacementLogResult) => {
            if (!result.ok) {
                console.warn("placement_decision log save failed:", result.reason);
            }
        }));
        disposers.push(onGameJoinResult((result: GameJoinResult) => {
            // 저장값이 아니라 서버가 돌려준 최신 room/match가 두 runtime의 초기 상태다.
            if (disposed || !joinPending) return;
            joinPending = false;
            setRetryPending(false);
            if (!result.ok && result.reason === "RATE_LIMITED") {
                setOverlays([
                    { text: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.", showLobby: false, showRetry: true },
                    { text: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.", showLobby: false, showRetry: true },
                ]);
                return;
            }
            if (!result.ok && result.reason === "GAME_NOT_PLAYING" && result.room) {
                storeRoom(result.room);
                disposePageEffects();
                window.location.replace("./multiLobby.html");
                return;
            }
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
                onCombatEffect: showCombatEffect,
                deferStart: true,
            });
            activeGameSession = session;
            activeMatchId = result.match.gameId ?? null;
            setDisplayHandles(myRole === "host"
                ? {
                    player1: createDisplayHandle(session.myGame),
                    player2: createDisplayHandle(session.opponentGame),
                }
                : {
                    player1: createDisplayHandle(session.opponentGame),
                    player2: createDisplayHandle(session.myGame),
                });
            showCountdown(result.match.startsAt, result.serverNow ?? Date.now());
            setHomeDisabled(false);
        }));
        disposers.push(onGameCountdown((countdown) => {
            if (disposed || countdown.roomId !== roomId || countdown.gameId !== activeMatchId) return;
            showCountdown(countdown.startsAt, countdown.serverNow);
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
            setHomeDisabled(false);
            // reconnect 때도 새 socket을 room에 다시 join시키고 최신 match를 받는다.
            requestGameJoin();
        }));
        disposers.push(onSessionError(({ terminal: isTerminal }: SessionError) => {
            if (disposed || !isTerminal) return;
            terminal = true;
            joinPending = false;
            setRetryPending(false);
            isSessionReady = false;
            setHomeDisabled(true);
            destroyGameSession();
            redirectToLobby();
        }));
        disposers.push(onSessionDisconnected(({ terminal: isTerminal }: SessionDisconnect) => {
            if (disposed) return;
            terminal = isTerminal;
            joinPending = false;
            leavePending = false;
            setRetryPending(false);
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
                    <button ref={effectsToggleRef} id="effectsToggle" className="sound-toggle"
                        type="button" aria-pressed="false" title="잔상과 흔들림을 줄입니다">
                        효과 축소
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
                    combatNotice={combatNotices[0]}
                    onReturnToLobby={returnToLobby}
                    onRetryJoin={() => retryJoinRef.current()}
                    retryPending={retryPending}
                />
                <PlayerColumn
                    playerNumber={2}
                    name={pageInfo.player2Name}
                    badge={pageInfo.player2Badge}
                    isMine={pageInfo.mine === 2}
                    handle={displayHandles?.player2 ?? null}
                    canvasRef={player2CanvasRef}
                    overlay={overlays[1]}
                    combatNotice={combatNotices[1]}
                    onReturnToLobby={returnToLobby}
                    onRetryJoin={() => retryJoinRef.current()}
                    retryPending={retryPending}
                />
            </main>
            <div ref={combatLayerRef} className="combat-layer" aria-hidden="true" />
        </div>
    );
}

const root = document.getElementById("multiplayerRoot");
if (!root) throw new Error("Missing #multiplayerRoot");
createRoot(root).render(<StrictMode><MultiplayerGamePage /></StrictMode>);
