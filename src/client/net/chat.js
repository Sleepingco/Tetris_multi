// 엄격 모드 사용 (더 안전한 코드 작성)
"use strict";
// 서버와의 실시간 통신을 위한 Socket.IO 초기화
const chatConnection = io();
// 닉네임 입력 필드 선택
const nickName = document.querySelector("#nickname");;
// 채팅 메시지가 표시될 리스트 선택
const chatList = document.querySelector(".chatting-list");
// 채팅 입력창 선택
const chatInput = document.querySelector(".chatting-input");
// 전송 버튼 선택
const sendButton = document.querySelector(".send-button");
// 채팅창 스크롤 처리를 위한 컨테이너 선택
const displayContainer = document.querySelector(".display-container");
// console.log(nickName, chatInput);
// console.log(nickName.value, chatInput.value);

// Enter 키 입력 시 메시지를 전송
chatInput.addEventListener("keypress", (envent) => {
        // 엔터(13) 키가 눌리면 send 함수 호출 후 입력창 초기화
        if (event.keyCode === 13) {
                send();
                chatInput.value = "";
        }
})
// 메시지 전송 함수
function send() {
        // 전송할 데이터 객체 생성
        const param = {
                name: nickName.value,
                msg: chatInput.value
        }

        // 서버로 "chatting" 이벤트와 함께 메시지 데이터 전송
        chatConnection.emit("chatting", param)
}
// 전송 버튼 클릭 시 메시지 전송
sendButton.addEventListener("click", send);


// 서버에서 "chatting" 이벤트를 수신하면 실행
chatConnection.on("chatting", (data) => {
        // console.log("Nickname:", nickName.value);
        // console.log("Message:", chatInput.value);
        console.log(data);
        // 서버에서 받은 데이터 구조 분해 할당
        const { name, msg, time } = data;
        // 새로운 채팅 메시지 객체 생성
        const item = new LiModel(name, msg, time);
        // 채팅 메시지를 화면에 추가
        item.makeLi();
        // 새 메시지가 추가될 때 채팅창을 아래로 스크롤
        displayContainer.scrollTo(0, displayContainer.scrollHeight);
})
// console.log(chatConnection);

// 채팅 메시지 모델 (메시지 데이터 저장 및 리스트 아이템 생성)
function LiModel(name, msg, time) {
        this.name = name;
        // 메시지 보낸 사람의 닉네임 저장
        this.msg = msg;
        // 메시지 내용 저장
        this.time = time;
        console.log(this);
        // 채팅 메시지를 리스트에 추가하는 함수
        this.makeLi = () => {
                // 새로운 리스트 아이템(li) 생성
                const li = document.createElement("li");
                // 본인이 보낸 메시지인지 확인하여 클래스 지정
                li.classList.add(nickName.value === this.name ? "sent" : "received");

                const profile = document.createElement("span");
                profile.className = "profile";

                const user = document.createElement("span");
                user.className = "user";
                user.textContent = this.name;

                const image = document.createElement("img");
                image.className = "image";
                image.src = "https://picsum.photos/id/1/200/300";
                image.alt = "profile";

                const message = document.createElement("span");
                message.className = "message";
                message.textContent = this.msg;

                const time = document.createElement("span");
                time.className = "time";
                time.textContent = ` ${this.time || ""}`;

                profile.append(user, image);
                li.append(profile, message, time);
                // 채팅 메시지를 채팅 리스트에 추가
                chatList.appendChild(li);
        }
}
