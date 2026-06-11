const express = require("express")
const http = require("http")
const path = require("path")
const socketIO = require("socket.io")
const { registerMultiplayerSocket } = require("./sockets/multiplayerSocket.js")

const app = express()
const server = http.createServer(app)
const socketServer = socketIO(server)
const PORT = process.env.PORT || 5500
const STATIC_ROOT = path.join(__dirname, "..", "client")

app.use(express.static(STATIC_ROOT))
app.get("/", (_, res) => {
    res.sendFile(path.join(STATIC_ROOT, "pages", "index.html"))
})

registerMultiplayerSocket(socketServer)

server.listen(PORT, () => console.log(`server is running ${PORT}`))
