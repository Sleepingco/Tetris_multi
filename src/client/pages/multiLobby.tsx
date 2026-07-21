import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ServerToClientParsedPayload } from "../../shared/socketContractTypes";
import { applySavedTheme, toggleTheme } from "../game/entry/theme";
import { initLobbySound } from "../game/runtime/sound.js";
import {
    onChatResult,
    onGlobalMessage,
    onRoomMessage,
    onRoomResult,
    onRoomUpdated,
    onSessionDisconnected,
    onSessionError,
    onSessionReady,
    requestCreateRoom,
    requestJoinRoom,
    requestLeaveRoom,
    requestRouteLeave,
    requestRoomSync,
    requestStartGame,
    sendGlobalChat,
    sendRoomChat,
} from "../net/roomClient.js";
import { navigate, registerRouteExit } from "./spaNavigation";

type Room = ServerToClientParsedPayload<"room:updated">;
type RoomResult = ServerToClientParsedPayload<"room:result">;
type RoomMessage = ServerToClientParsedPayload<"room:message">;
type GlobalMessage = ServerToClientParsedPayload<"global:message">;
type ChatResult = ServerToClientParsedPayload<"chat:result">;
type Session = ServerToClientParsedPayload<"session:ready">;
type RequestType = "create" | "join" | "leave" | "start" | "sync" | null;
type View = "join" | "create" | "pve" | "room";
type DisplayMessage = {
    id: number;
    sender: string;
    text: string;
    scope: "global" | "room" | null;
};

function createGuestNickname(): string {
    return `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

function getSavedNickname(): string {
    const savedNickname = sessionStorage.getItem("tetris:nickname")?.trim();
    if (savedNickname) return savedNickname;

    const guestNickname = createGuestNickname();
    sessionStorage.setItem("tetris:nickname", guestNickname);
    return guestNickname;
}

function saveRoomSession(room: Room): void {
    sessionStorage.setItem("tetris:roomId", room.roomId);
    sessionStorage.setItem("room", JSON.stringify(room));
}

function clearRoomSession(): void {
    sessionStorage.removeItem("tetris:roomId");
    sessionStorage.removeItem("room");
}

const initialNickname = getSavedNickname();

export function MultiLobbyPage() {
    const [playerId, setPlayerId] = useState<string | null>(null);
    const [nickname, setNickname] = useState(initialNickname);
    const [room, setRoom] = useState<Room | null>(null);
    const [view, setView] = useState<View>("join");
    const [sessionReady, setSessionReady] = useState(false);
    const [chatScope, setChatScope] = useState<"global" | "room">("global");
    const [chatInput, setChatInput] = useState("");
    const [roomCodeInput, setRoomCodeInput] = useState("");
    const [aiPolicy, setAiPolicy] = useState<"heuristic" | "placement_v4">("heuristic");
    const [aiDifficulty, setAiDifficulty] = useState<"normal" | "hard">("normal");
    const [messages, setMessages] = useState<DisplayMessage[]>([{
        id: 0,
        sender: "system",
        text: "전체 채팅 또는 방 채팅을 선택해서 메시지를 보낼 수 있습니다.",
        scope: null,
    }]);
    const nextMessageId = useRef(1);
    const messagesRef = useRef<HTMLDivElement>(null);
    const themeToggleRef = useRef<HTMLButtonElement>(null);
    const soundToggleRef = useRef<HTMLButtonElement>(null);

    const appendMessage = useCallback((
        sender: string,
        text: string,
        scope: "global" | "room" | null = null,
    ) => {
        const message = { id: nextMessageId.current, sender, text, scope };
        nextMessageId.current += 1;
        setMessages(current => [...current, message]);
    }, []);

    const renderRoom = useCallback((nextRoom: Room) => {
        saveRoomSession(nextRoom);
        setRoom(nextRoom);
        setView("room");
    }, []);

    const clearRoom = useCallback(() => {
        clearRoomSession();
        setRoom(null);
        setView("join");
    }, []);

    useEffect(() => {
        messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
    }, [messages]);

    useEffect(() => {
        applySavedTheme(themeToggleRef.current);
        const cleanupSound = initLobbySound(soundToggleRef.current);
        const disposers = [
            registerRouteExit((nextUrl) => {
                if (nextUrl.pathname === "/pages/tetrisMulti.html") return;
                const roomId = sessionStorage.getItem("tetris:roomId");
                if (!roomId) return;
                requestRouteLeave(roomId, "room");
                clearRoomSession();
            }),
            onRoomUpdated((nextRoom: Room) => {
                if (nextRoom.status === "playing") {
                    saveRoomSession(nextRoom);
                    navigate(`/pages/tetrisMulti.html?roomId=${nextRoom.roomId}`);
                    return;
                }
                renderRoom(nextRoom);
            }),
            onRoomMessage((message: RoomMessage) => {
                if (message.type === "chat") {
                    appendMessage(message.nickname || "Guest", message.text || "", "room");
                    return;
                }
                appendMessage("system", message.text || "");
            }),
            onRoomResult((result: RoomResult, requestType: RequestType) => {
                if (!result.ok) {
                    if (
                        requestType === "sync"
                        || (requestType === "join" && result.reason === "ROOM_NOT_FOUND")
                    ) {
                        clearRoom();
                    }
                    appendMessage("system", result.reason || "ROOM_ERROR");
                    return;
                }
                if (requestType === "leave") {
                    appendMessage("system", "방에서 퇴장했습니다.");
                    clearRoom();
                    return;
                }
                if (!result.room) return;
                renderRoom(result.room);
                if (requestType === "create") {
                    appendMessage("system", `방이 생성되었습니다. 코드: ${result.room.roomId}`);
                }
                if (requestType === "join") {
                    appendMessage("system", `방에 입장했습니다. 코드: ${result.room.roomId}`);
                }
            }),
            onGlobalMessage((message: GlobalMessage) => {
                appendMessage(message.nickname || "Guest", message.text || "", "global");
            }),
            onChatResult((result: ChatResult) => {
                if (!result.ok) appendMessage("system", result.reason || "CHAT_ERROR");
            }),
            onSessionReady((session: Session) => {
                const { playerId: readyPlayerId, nickname: readyNickname } = session;
                setPlayerId(readyPlayerId);
                setNickname(readyNickname);
                setSessionReady(true);
                const savedRoomId = sessionStorage.getItem("tetris:roomId");
                if (savedRoomId) requestRoomSync(savedRoomId, readyPlayerId);
            }),
            onSessionError(({ terminal }: { terminal: boolean }) => {
                if (terminal) clearRoom();
            }),
            onSessionDisconnected(({ terminal }: { terminal: boolean }) => {
                setSessionReady(false);
                appendMessage("system", terminal
                    ? "세션이 만료되었거나 다른 탭으로 이동했습니다. 새로고침해 주세요."
                    : "서버 연결이 끊겨 재연결 중입니다.");
            }),
        ];
        let disposed = false;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
            disposers.forEach(detach => detach());
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
    }, [appendMessage, clearRoom, renderRoom]);

    const submitChat = (event: FormEvent) => {
        event.preventDefault();
        const text = chatInput.trim();
        if (!text) return;
        if (chatScope === "room") {
            if (!room) {
                appendMessage("system", "방에 입장한 뒤 방 채팅을 사용할 수 있습니다.");
                return;
            }
            sendRoomChat(room.roomId, playerId, text);
        } else {
            sendGlobalChat({ playerId, nickname }, text);
        }
        setChatInput("");
    };

    const copyRoomCode = async () => {
        if (!room) {
            appendMessage("system", "복사할 방 코드가 없습니다.");
            return;
        }
        try {
            await navigator.clipboard.writeText(room.roomId);
            appendMessage("system", `방 코드 ${room.roomId}를 복사했습니다.`);
        } catch {
            appendMessage("system", `복사에 실패했습니다. 방 코드: ${room.roomId}`);
        }
    };

    let primaryTitle = "Quick Match";
    let primaryDescription = "방을 만들거나 코드로 참가하면 게임 시작 상태를 확인할 수 있습니다.";
    let primaryText = "방 대기 중";
    let primaryDisabled = true;
    const isHost = room?.hostPlayerId === playerId;
    if (!sessionReady) {
        primaryTitle = "서버 연결";
        primaryDescription = "연결이 준비될 때까지 잠시 기다려주세요.";
        primaryText = "연결 중";
    } else if (room) {
        primaryTitle = "Game Start";
        primaryText = "게임 시작";
        if (room.status === "finished") {
            primaryDescription = "상대가 로비로 돌아오면 다시 시작할 수 있습니다.";
            primaryText = "상대 로비 대기중";
        } else if (!isHost) {
            primaryDescription = "방장이 게임을 시작할 수 있습니다.";
            primaryText = "방장 대기중";
        } else if (room.status !== "waiting" || room.players.length !== 2) {
            primaryDescription = "상대가 입장하면 게임을 시작할 수 있습니다.";
        } else {
            primaryDescription = room.mode === "pve"
                ? room.aiPolicy === "placement_v4"
                    ? "내 배치 선택을 학습한 실험 AI와 게임을 시작할 수 있습니다."
                    : "휴리스틱 AI 상대와 게임을 시작할 수 있습니다."
                : "두 명이 모였습니다. 게임 시작 준비가 가능합니다.";
            primaryDisabled = false;
        }
    }

    return (
        <div className="container">
            <header className="header">
                <h1 className="brand">Multi Lobby</h1>
                <nav className="nav">
                    <button ref={soundToggleRef} id="soundToggle" type="button" className="btn ghost"
                        aria-pressed="false">사운드 켜기</button>
                    <button ref={themeToggleRef} id="themeToggle" type="button" className="btn ghost"
                        aria-pressed="false" onClick={() => toggleTheme(themeToggleRef.current)}>
                        다크 모드
                    </button>
                    <a href="./index.html" className="btn ghost">← 홈으로</a>
                </nav>
            </header>

            <main className="main" style={{ paddingTop: 10 }}>
                <div className="lobby-grid">
                    <section className="card chat-panel">
                        <h2 className="card-title" style={{ marginBottom: 4 }}>Chat</h2>
                        <div ref={messagesRef} className="chat-messages" id="chatMessages">
                            {messages.map(message => {
                                const scopeLabel = message.scope === "global"
                                    ? "전체 "
                                    : message.scope === "room" ? "방 " : "";
                                return (
                                    <div className="chat-msg" key={message.id}>
                                        <span className={message.sender === "system" ? "system" : "user"}>
                                            {message.sender === "system"
                                                ? "[System]"
                                                : `[${scopeLabel}${message.sender}]`}
                                        </span>{" "}{message.text}
                                    </div>
                                );
                            })}
                        </div>
                        <form className="chat-input-group" id="chatForm" onSubmit={submitChat}>
                            <select id="chatScope" className="input-box chat-scope" aria-label="채팅 범위"
                                value={chatScope} disabled={!sessionReady}
                                onChange={event => setChatScope(event.target.value as "global" | "room")}>
                                <option value="global">전체</option>
                                <option value="room">방</option>
                            </select>
                            <input type="text" id="chatInput" className="input-box"
                                placeholder="메시지를 입력하세요..." autoComplete="off" value={chatInput}
                                disabled={!sessionReady} onChange={event => setChatInput(event.target.value)} />
                            <button type="submit" className="btn primary" disabled={!sessionReady}>전송</button>
                        </form>
                    </section>

                    <section className="action-panel">
                        <div className="action-box profile-box">
                            <div className="avatar"><span id="playerAvatarChar">{nickname.charAt(0).toUpperCase()}</span></div>
                            <div className="profile-details">
                                <span className="profile-meta">My Profile</span>
                                <div className="profile-name-row">
                                    <span className="profile-name" id="playerNicknameText">{nickname}</span>
                                    <span className="host-badge" id="playerHostBadge" hidden={!isHost}>방장</span>
                                </div>
                                <div className={`room-badge${room ? " active" : ""}`} id="lobbyRoomBadge">
                                    <span className="room-badge-dot"></span>
                                    <span className="room-badge-text" id="lobbyRoomBadgeText">
                                        {room ? `방 코드: ${room.roomId}` : "로비 대기 중"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="action-box">
                            <h3 id="primaryActionTitle">{primaryTitle}</h3>
                            <p id="primaryActionDesc">{primaryDescription}</p>
                            <button id="btnPrimaryAction" className="btn primary btn-match" type="button"
                                disabled={primaryDisabled} onClick={() => {
                                    if (!room) return;
                                    appendMessage("system", "게임 시작을 요청했습니다.");
                                    requestStartGame(room.roomId, playerId);
                                }}>{primaryText}</button>
                        </div>

                        <div className="action-box">
                            <h3>Join by Code</h3>
                            <p>상대가 만든 방 코드로 참가할 수 있습니다.</p>
                            <div id="joinByCodeControls" className="join-group" hidden={view !== "join"}>
                                <input type="text" id="roomCodeInput" className="input-box input-code"
                                    placeholder="ENTER CODE" maxLength={8} value={roomCodeInput}
                                    disabled={!sessionReady} onChange={event => setRoomCodeInput(event.target.value)} />
                                <button id="btnJoinCode" className="btn" type="button" disabled={!sessionReady}
                                    onClick={() => {
                                        const roomId = roomCodeInput.trim().toUpperCase();
                                        if (!roomId) {
                                            appendMessage("system", "방 코드를 입력해주세요.");
                                            return;
                                        }
                                        requestJoinRoom(roomId, { playerId, nickname });
                                    }}>방 입장</button>
                                <button id="btnOpenCreateRoom" className="btn ghost" type="button"
                                    disabled={!sessionReady} onClick={() => setView("create")}>방 생성</button>
                            </div>
                            <div id="createRoomControls" className="join-group"
                                hidden={view !== "create" && view !== "pve"}>
                                <button id="btnBackToJoin" className="room-mode-back" type="button"
                                    aria-label="방 입장으로 돌아가기" title="방 입장으로 돌아가기"
                                    onClick={() => setView("join")}>&larr;</button>
                                <button id="btnCreateRoom" className="btn ghost" type="button"
                                    disabled={!sessionReady}
                                    onClick={() => requestCreateRoom({ playerId, nickname }, "pvp")}>
                                    PVP 방 생성
                                </button>
                                <button id="btnOpenPveCreate" className="btn" type="button"
                                    disabled={!sessionReady} onClick={() => setView("pve")}>AI PVE</button>
                                <div id="pveCreateControls" className="join-group" hidden={view !== "pve"}>
                                    <fieldset id="aiPolicySelector" className="difficulty-selector">
                                        <legend>AI 정책</legend>
                                        <div className="difficulty-options">
                                            <label className="difficulty-option">
                                                <input type="radio" name="aiPolicy" value="heuristic"
                                                    checked={aiPolicy === "heuristic"}
                                                    onChange={() => setAiPolicy("heuristic")} />
                                                <span>휴리스틱 AI (기본)</span>
                                            </label>
                                            <label className="difficulty-option">
                                                <input type="radio" name="aiPolicy" value="placement_v4"
                                                    checked={aiPolicy === "placement_v4"}
                                                    onChange={() => setAiPolicy("placement_v4")} />
                                                <span>내 선택 모방 AI (실험)</span>
                                            </label>
                                        </div>
                                    </fieldset>
                                    <fieldset id="aiDifficultySelector" className="difficulty-selector">
                                        <legend>AI 난이도</legend>
                                        <div className="difficulty-options">
                                            <label className="difficulty-option">
                                                <input type="radio" name="aiDifficulty" value="normal"
                                                    checked={aiDifficulty === "normal"}
                                                    onChange={() => setAiDifficulty("normal")} />
                                                <span>보통</span>
                                            </label>
                                            <label className="difficulty-option">
                                                <input type="radio" name="aiDifficulty" value="hard"
                                                    checked={aiDifficulty === "hard"}
                                                    onChange={() => setAiDifficulty("hard")} />
                                                <span>어려움</span>
                                            </label>
                                        </div>
                                    </fieldset>
                                    <p role="note">실험 AI는 강한 AI가 아니며, 모델 오류 시 휴리스틱으로 전환됩니다.</p>
                                    <button id="btnCreatePveRoom" className="btn" type="button"
                                        disabled={!sessionReady}
                                        onClick={() => requestCreateRoom(
                                            { playerId, nickname },
                                            "pve",
                                            aiDifficulty,
                                            aiPolicy,
                                        )}>PVE 방 생성</button>
                                </div>
                            </div>
                            <div id="roomStatus" className="room-status" hidden={view !== "room" || !room}>
                                <div className="room-status-row">
                                    <span>방 코드</span>
                                    <div className="room-code-group">
                                        <strong id="roomCodeText">{room?.roomId || "-"}</strong>
                                        <button id="btnCopyRoomCode" className="room-copy-btn" type="button"
                                            onClick={copyRoomCode}>복사</button>
                                    </div>
                                </div>
                                <div className="room-status-row">
                                    <span>상태</span><strong id="roomStateText">{room?.status || "-"}</strong>
                                </div>
                                <div className="room-status-row">
                                    <span>플레이어</span>
                                    <strong><span id="roomPlayerCountText">{room?.players.length || 0}</span> / 2</strong>
                                </div>
                                <button id="btnLeaveRoom" className="btn ghost" type="button"
                                    disabled={!sessionReady} onClick={() => {
                                        if (!room) {
                                            appendMessage("system", "존재하지 않는 방입니다.");
                                            return;
                                        }
                                        requestLeaveRoom(room.roomId, playerId);
                                    }}>방 나가기</button>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}
