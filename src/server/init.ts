import express from "express";
import type { Request, Response } from "express";
import { createServer } from "node:http";
import * as path from "node:path";
import { Server } from "socket.io";
import { createHttpSecurityHeaders } from "./httpSecurity.js";
import { registerSocketHandlers } from "./sockets/index.js";
import { createSocketServerOptions } from "./socketSecurity.js";

const app = express()
app.disable("x-powered-by")
const server = createServer(app)
const socketServer = new Server(server, createSocketServerOptions())
const securityHeaders = createHttpSecurityHeaders()
server.prependListener("request", (_request, response) => {
    Object.entries(securityHeaders).forEach(([name, value]) => response.setHeader(name, value))
})
const PORT = process.env.PORT || 5500
const STATIC_ROOT = path.join(__dirname, "..", "..", "client")

app.use(express.static(STATIC_ROOT))
app.get("/", (_request, response) => {
    response.sendFile("pages/index.html", { root: STATIC_ROOT })
})
app.use((_request: Request, response: Response) => {
    response.statusCode = 404
    response.setHeader("Content-Type", "text/plain; charset=utf-8")
    response.end("Not Found")
})

registerSocketHandlers(socketServer)

server.listen(PORT, () => console.log(`server is running ${PORT}`))
