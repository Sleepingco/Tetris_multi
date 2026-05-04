const moment = require("moment")

function registerChatSocket(io) {
    io.on("connection", (socket) => {
        console.log("a user connected")

        socket.on("chatting", (data) => {
            console.log("server received data: ", data)
            const { name, msg } = data
            io.emit("chatting", {
                name,
                msg,
                time: moment(new Date()).format("H:mm A"),
            })
        })
    })
}

module.exports = {
    registerChatSocket,
}
