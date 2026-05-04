const express = require("express")
const http = require("http")
const path = require("path")
const socketIO = require("socket.io")
const { registerChatSocket } = require("./chatSocket.js")

const app = express()
const server = http.createServer(app)
const io = socketIO(server)
const PORT = process.env.PORT || 5000
const STATIC_ROOT = path.join(__dirname, "..")

app.use(express.static(STATIC_ROOT))
app.get("/", (_, res) => {
    res.sendFile(path.join(STATIC_ROOT, "pages", "index.html"))
})

registerChatSocket(io)

server.listen(PORT, () => console.log(`server is running ${PORT}`))
