const express = require("express")
const http = require("http")
const path = require("path")
const socketIO = require("socket.io")
const { registerMultiplayerSocket } = require("./multiplayerSocket.js")

const app = express()
const server = http.createServer(app)
const io = socketIO(server)
const PORT = process.env.PORT || 5500
const STATIC_ROOT = path.join(__dirname, "..")

app.use(express.static(STATIC_ROOT))
app.get("/", (_, res) => {
    res.redirect("/pages/index.html")
})

registerMultiplayerSocket(io)

server.listen(PORT, () => console.log(`server is running ${PORT}`))
