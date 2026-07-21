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

export function createSocketServerOptions(
    environment: Environment = process.env,
): SocketServerOptions {
    const allowedOrigins = readAllowedOrigins(environment);
    const isProduction = environment.NODE_ENV === "production";
    const isAllowed = (origin: string | undefined): boolean => {
        return Boolean(origin && allowedOrigins.has(origin));
    };

    return {
        maxHttpBufferSize: 512 * 1024,
        cors: {
            origin(origin, callback) {
                if ((!origin && !isProduction) || isAllowed(origin)) {
                    callback(null, true);
                    return;
                }
                callback(new Error("ORIGIN_NOT_ALLOWED"));
            },
        },
        allowRequest(request, callback) {
            const origin = request.headers.origin;
            callback(null, (!origin && !isProduction) || isAllowed(origin));
        },
    };
}
