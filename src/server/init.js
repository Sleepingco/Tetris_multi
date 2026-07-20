const express = require("express")
const http = require("http")
const path = require("path")
const socketIO = require("socket.io")
const { registerSocketHandlers } = require("./sockets/index.js")
const { createSocketServerOptions } = require("./socketSecurity.js")

const app = express()
const server = http.createServer(app)
const socketServer = socketIO(server, createSocketServerOptions())
const PORT = process.env.PORT || 5500
const STATIC_ROOT = path.join(__dirname, "..", "..", "client")

app.use(express.static(STATIC_ROOT))
app.get("/", (_, res) => {
    res.sendFile("pages/index.html", { root: STATIC_ROOT })
})

registerSocketHandlers(socketServer)

server.listen(PORT, () => console.log(`server is running ${PORT}`))
