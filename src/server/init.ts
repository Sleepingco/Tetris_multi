// =============================
// 서버 조립 진입점
// HTTP 보안, 정적 파일, Socket.IO를 조립한다. room이나 게임 상태는 이 파일이 소유하지 않는다.
// =============================
import express from "express";
import type { Request, Response } from "express";
import { createServer } from "node:http";
import * as path from "node:path";
import { Server } from "socket.io";
import { createHttpSecurityHeaders } from "./httpSecurity.js";
import { createServerShutdown } from "./serverShutdown.js";
import {
    createRuntimeEventStorage,
    POSTGRES_RUNTIME_DRAIN_TIMEOUT_MS,
} from "./services/runtimeEventStorage.js";
import { registerSocketHandlers } from "./sockets/index.js";
import { createSocketServerOptions } from "./socketSecurity.js";

const app = express()
app.disable("x-powered-by")
const server = createServer(app)
const socketServer = new Server(server, createSocketServerOptions())
const securityHeaders = createHttpSecurityHeaders()
// Express보다 먼저 실행해 정상 응답과 오류 응답 모두 같은 보안 헤더에서 시작하게 한다.
server.prependListener("request", (_request, response) => {
    Object.entries(securityHeaders).forEach(([name, value]) => response.setHeader(name, value))
})
const PORT = process.env.PORT || 5500
const STATIC_ROOT = path.join(__dirname, "..", "..", "client")

app.use(express.static(STATIC_ROOT, { redirect: false }))
app.get("/", (_request, response) => {
    response.sendFile("pages/index.html", { root: STATIC_ROOT })
})
app.use((_request: Request, response: Response) => {
    response.statusCode = 404
    response.setHeader("Content-Type", "text/plain; charset=utf-8")
    response.end("Not Found")
})
app.use((error: unknown, _request: Request, response: Response, _next: unknown) => {
    const errorStatus = error && typeof error === "object"
        ? ("statusCode" in error ? error.statusCode : "status" in error ? error.status : undefined)
        : undefined
    response.statusCode = typeof errorStatus === "number" && errorStatus >= 400 && errorStatus <= 599
        ? errorStatus
        : 500
    response.removeHeader("Content-Security-Policy")
    response.removeHeader("Content-Security-Policy-Report-Only")
    Object.entries(securityHeaders).forEach(([name, value]) => response.setHeader(name, value))
    response.setHeader("Content-Type", "text/plain; charset=utf-8")
    response.end("Request Failed")
})

async function closeSocketAndHttp(): Promise<void> {
    await socketServer.close()
    if (!server.listening) return
    await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
    })
}

async function startServer(): Promise<void> {
    const eventStorage = await createRuntimeEventStorage()
    const disposeSocketHandlers = registerSocketHandlers(socketServer, {
        saveGameEventLog: eventStorage.saveGameEventLog,
        savePlacementDecisionLog: eventStorage.savePlacementDecisionLog,
    })
    const shutdown = createServerShutdown({
        rejectNewWrites: eventStorage.rejectNewWrites,
        stopEventProducers: disposeSocketHandlers,
        drainWrites: () => eventStorage.drain(POSTGRES_RUNTIME_DRAIN_TIMEOUT_MS),
        closePool: eventStorage.close,
        closeSocketAndHttp,
    })

    process.once("SIGTERM", () => {
        void shutdown()
            .then(() => {
                process.exitCode = 0
            })
            .catch(() => {
                process.exitCode = 1
            })
    })

    server.listen(PORT, () => console.log(`server is running ${PORT}`))
}

void startServer().catch(error => {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "SERVER_STARTUP_FAILED"
    console.error(code)
    process.exitCode = 1
})
