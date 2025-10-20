const express = require("express")
// Express 모듈을 가져와서 사용
const http = require("http")
// HTTP 서버 생성 (Express 앱을 기반으로)
const app = express();
// Express 애플리케이션 생성
const path = require("path")
// 파일 경로를 다루기 위한 path 모듈 불러오기
const server = http.createServer(app);
const socketIO = require("socket.io")
// 실시간 양방향 통신을 위한 Socket.IO 불러오기
const moment = require("moment")
// 날짜 및 시간 포맷을 위한 moment 라이브러리 불러오기

const io = socketIO(server);
// HTTP 서버에 Socket.IO 연결

app.use(express.static(path.join(__dirname, "src")));
// 정적 파일 제공 (src 폴더 내의 파일을 클라이언트가 접근 가능하도록 설정)
const PORT = process.env.PORT || 5000;
// 서버가 실행될 포트 설정 (환경 변수에 설정된 포트가 없으면 기본값 5000 사용)

// 데이터 받는 부분
// emit은 보내는 명령어 이름
// on은 받는 명령어 이름
// 
io.on("connection", (socket)=>{
    // 클라이언트가 서버에 연결될 때 실행
    console.log("a user connected")
    // 새로운 사용자가 접속하면 로그 출력
    socket.on('chatting',(data)=>{
        // 클라이언트로부터 'chatting' 이벤트 수신
        console.log('server received data: ', data)
        // 수신된 데이터 콘솔에 출력

        // console.log("server received data: " + JSON.stringify(data));
        // 결과: "server received data: {"name":"John","msg":"Hello"}"
        const {name, msg} =data;
        // 전달받은 데이터에서 이름(name)과 메시지(msg) 추출
        io.emit('chatting',{
            name: name,
            msg: msg,
            time: moment(new Date()).format("H:mm A")
        })
        // 모든 클라이언트에게 채팅 메시지 전송
    })
})

server.listen(PORT, ()=>console.log(`server is running ${PORT}`))
// 서버 실행 및 지정된 포트에서 대기