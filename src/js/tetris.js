import BLOCKS from "./blocks.js"

//DOM
const playground = document.querySelector(".playground > ul");
const gameText = document.querySelector(".game-text");
const scoreDisplay = document.querySelector(".score");
const restartButton = document.querySelector(".game-text > button");

//Setting
const GAME_ROWS = 20;
const GAME_COLS = 10;

// variables
let score = 0;
let duration = 500;
let downInterval;
let tempMovingItem;



const movingItem = {
    type: "",
    direction: 0,
    top:0,
    left:3,
}

init()

// functions
function init(){
    
    tempMovingItem = {...movingItem};
    for (let i =0; i<20; i++) {
        prependNewLine()
    }
    // renderBlocks();
    generateNewBlock();
}


function prependNewLine(){
    const li = document.createElement("li");
    const ul = document.createElement("ul");
    for(let j =0; j<10;j++){
        const matrix = document.createElement("li");
        ul.prepend(matrix);
    }
    li.prepend(ul);
    playground.prepend(li);
}

function renderBlocks(moveType=""){
    const {type, direction,top,left} = tempMovingItem;
    // 아래와 같이 여러개로 선언할 수 있지만 위와 같이 디스트럭쳐링(destructuring) 할 수 있다.
    // tempMovingItem.type;
    // tempMovingItem.direction;
    // tempMovingItem.top;
    // tempMovingItem.left;
    const movingBlocks = document.querySelectorAll(".moving");
    movingBlocks.forEach(moving => {
        // console.log(moving);
        moving.classList.remove(type,"moving")
    }) 
    
    
    BLOCKS[type][direction].some(block=>{
        const x = block[0] + left;
        const y = block[1] + top;
        // console.log({playground})
        // cosnt 변수 = 삼항연산자? 참일경우:거짓일경우;
        // console.log(target);
        // console.log(playground.childNodes[y])
        const target = playground.childNodes[y]? playground.childNodes[y].childNodes[0].childNodes[x]:null;
        const isAvailable = checkEmpty(target);
        if(isAvailable){
            target.classList.add(type, "moving");
        }else {
            tempMovingItem = {...movingItem};
            if(moveType === "retry"){
                clearInterval(downInterval);
                showGameOver();
            }
            setTimeout(()=>{
                renderBlocks('retry');
                if(moveType === "top"){
                    seizeBlock();
                }

            },0)
            // renderBlocks(); 재귀함수 맥시멈 콜 스택 사이즈 방지를 위해 setTimeout 사용
            return true;
        }
        
       
    })
    movingItem.left = left;
    movingItem.top = top;
    movingItem.direction = direction;
}

function seizeBlock(){
    // console.log("sizeBlcok");
    const movingBlocks = document.querySelectorAll(".moving");
    movingBlocks.forEach(moving => {
        // console.log(moving);
        moving.classList.remove("moving");
        moving.classList.add("sized");
    })
    checkMatch();
    
}

function checkMatch(){
    const childNodes = playground.childNodes;
    childNodes.forEach(child=>{
        let matched = true;
        child.children[0].childNodes.forEach(li=>{
            if(!li.classList.contains("sized")){
                matched = false;
            }
        })
        if(matched){
            child.remove();
            prependNewLine();
            score += 10;
            scoreDisplay.innerText = score;
        }
    })
    generateNewBlock();
}

function generateNewBlock(){

    clearInterval(downInterval);
    downInterval = setInterval(() =>{
        moveBlock('top',1)
    }, duration)
    const blockArray = Object.entries(BLOCKS);
    const randomIndex = Math.floor(Math.random() * blockArray.length)
    // console.log(blockArray[randomIndex][0])
    // console.log(blockArray)
    // blockArray.forEach(block=>{
    //     console.log(block[0])
    // })
    movingItem.type = blockArray[randomIndex][0];
    // console.log(movingItem.type)
    movingItem.top = 0;
    movingItem.left = 3; 
    movingItem.direction = 0;
    tempMovingItem = {...movingItem};
    renderBlocks();
}
function checkEmpty(target){
    if(!target || target.classList.contains("sized")){
        return false;
    }
    return true;
}
function moveBlock(moveType, amount){
    tempMovingItem[moveType] += amount;
    renderBlocks(moveType);

}

function changeDirection(){
    const direction = tempMovingItem.direction;
    direction === 3 ? tempMovingItem.direction = 0 : tempMovingItem.direction += 1;
    renderBlocks();
    // tempMovingItem.direction += 1
    // if(tempMovingItem.direction ===4){
    //     tempMovingDirection = 0;
    // }
}

function dropBlock(){
    clearInterval(downInterval);
    downInterval = setInterval(() =>{
        moveBlock('top',1)
    }, 10)
}
// event handling
document.addEventListener("keydown", e=>{
    console.log(e.key)
    switch(e.key){
        case "ArrowRight":
            moveBlock("left",1);
            break;
        case "ArrowLeft":
            moveBlock("left", -1);
            break;
        case "ArrowDown":
            moveBlock("top", 1);
            break
        case "ArrowUp":
            changeDirection();
            break;
        case " ":
            dropBlock();
            break;
        default:
            break;
    }
})

function showGameOver(){
    gameText.style.display = "flex" 
}

restartButton.addEventListener("click",()=>{
    playground.innerHTML = "";
    gameText.style.display = "none";
    init()
})