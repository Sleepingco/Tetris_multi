import express from "express";
import { createServer } from "node:http";
import * as path from "node:path";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./sockets/index.js";
import { createSocketServerOptions } from "./socketSecurity.js";
import { shutdownLogStorage } from "./services/logService.js";

const app = express()
const server = createServer(app)
const socketServer = new Server(server, createSocketServerOptions())
const PORT = process.env.PORT || 5500
const STATIC_ROOT = path.join(__dirname, "..", "..", "client")
const HARD_SHUTDOWN_TIMEOUT_MS = 65_000;

app.use(express.static(STATIC_ROOT))
app.get("/", (_request, response) => {
    response.sendFile("pages/index.html", { root: STATIC_ROOT })
})

registerSocketHandlers(socketServer)

server.listen(PORT, () => console.log(`server is running ${PORT}`))

let shutdownPromise: Promise<void> | null = null;

function shutdownApplication(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    const hardExitTimer = setTimeout(() => {
        console.error("server shutdown deadline exceeded");
        process.exit(1);
    }, HARD_SHUTDOWN_TIMEOUT_MS);
    hardExitTimer.unref();
    shutdownPromise = new Promise<void>((resolve) => {
        socketServer.close(() => resolve());
    }).then(() => shutdownLogStorage()).then(() => {
        clearTimeout(hardExitTimer);
    }).catch(() => {
        console.error("server shutdown failed");
        process.exitCode = 1;
    });
    return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
        void shutdownApplication();
    });
}
