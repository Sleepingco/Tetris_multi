// =============================
// Socket.IO 전송 계층 보안
// handshake가 애플리케이션 인증에 도달하기 전에 허용된 browser origin인지 검사한다.
// =============================
type Environment = NodeJS.ProcessEnv;
import type { ServerOptions } from "socket.io";

type SocketServerOptions = Partial<ServerOptions>;

export const DEFAULT_DEVELOPMENT_ORIGINS = Object.freeze([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5510",
    "http://localhost:5510",
]);

/**
 * 실행 환경에서 정확히 일치해야 하는 origin allowlist를 읽는다.
 * production은 설정 누락을 허용하지 않고, 개발 환경에서만 로컬 기본값을 사용한다.
 */
export function readAllowedOrigins(environment: Environment = process.env): Set<string> {
    const configured = environment.SOCKET_ALLOWED_ORIGINS
        ?.split(",")
        .map(origin => origin.trim())
        .filter(Boolean) || [];

    if (environment.NODE_ENV === "production" && configured.length === 0) {
        throw new Error("SOCKET_ALLOWED_ORIGINS is required in production");
    }

    return new Set(configured.length > 0 ? configured : DEFAULT_DEVELOPMENT_ORIGINS);
}

/**
 * CORS 응답과 실제 Engine.IO 요청을 같은 allowlist로 제한한다.
 * origin이 없는 요청은 개발 환경이거나, allowlist host에서 온 same-origin browser 요청일 때만 허용한다.
 */
export function createSocketServerOptions(
    environment: Environment = process.env,
): SocketServerOptions {
    const allowedOrigins = readAllowedOrigins(environment);
    const isProduction = environment.NODE_ENV === "production";
    const allowedHosts = new Set([...allowedOrigins].flatMap((origin) => {
        try {
            return [new URL(origin).host];
        } catch {
            return [];
        }
    }));
    const isAllowed = (origin: string | undefined): boolean => {
        return Boolean(origin && allowedOrigins.has(origin));
    };

    return {
        maxHttpBufferSize: 512 * 1024,
        cors: {
            origin(origin, callback) {
                if (!origin || isAllowed(origin)) {
                    callback(null, true);
                    return;
                }
                callback(new Error("ORIGIN_NOT_ALLOWED"));
            },
        },
        allowRequest(request, callback) {
            const origin = request.headers.origin;
            const isSameOriginBrowserRequest = !origin
                && request.headers["sec-fetch-site"] === "same-origin"
                && typeof request.headers.host === "string"
                && allowedHosts.has(request.headers.host);
            callback(null, (!origin && !isProduction) || isAllowed(origin) || isSameOriginBrowserRequest);
        },
    };
}
