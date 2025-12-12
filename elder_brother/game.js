const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const messageElement = document.getElementById('message');

// 设置画布大小
function resizeCanvas() {
    canvas.width = 800;
    canvas.height = 600;
}
resizeCanvas();

// 游戏状态
let score = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragCurrentX = 0;
let dragCurrentY = 0;

// 物理常量
const GRAVITY = 0.42; // 减小重力 (从 0.5 -> 0.4)，让球感觉轻盈一点
const AIR_RESISTANCE = 0.992; // 稍微减小空气阻力 (从 0.99 -> 0.992)，让球飞得更远一点
const BOUNCE_FACTOR = 0.85; // 增加弹性 (从 0.7 -> 0.8)


// 图像资源
const playerImage = new Image();
// 添加时间戳避免缓存
playerImage.src = 'player.png?' + new Date().getTime(); 
let playerImageLoaded = false;

playerImage.onload = () => { playerImageLoaded = true; };

// 新增：双状态图片
const playerIdleImage = new Image();
playerIdleImage.src = 'player_idle.png?' + new Date().getTime(); // 准备姿势
let playerIdleImageLoaded = false;
playerIdleImage.onload = () => { playerIdleImageLoaded = true; };

const playerShootImage = new Image();
playerShootImage.src = 'player_shoot.png?' + new Date().getTime(); // 投篮姿势
let playerShootImageLoaded = false;
playerShootImage.onload = () => { playerShootImageLoaded = true; };

// 新增变量：控制投篮动作保持时间
let shootPoseTimer = 0;
// 新增变量：控制篮网动画
let netAnimationTimer = 0;

const ballImage = new Image();
ballImage.src = 'ball.png?' + new Date().getTime();
let ballImageLoaded = false;

ballImage.onload = () => {
    ballImageLoaded = true;
}

// 地板对象
const floor = {
    y: 550, // 地板下移 (之前是 550)
    color: "#D2B48C", // 浅木色
    lineColor: "#8B4513" // 深木色线条
};

// 球员对象 (科比形象)
const player = {
    x: 50, // 图片位置可能需要调整
    // 调整 player.y 让人物看起来站在 floor.y 上
    // 人物高度300，其中大部分是图片内容，假设脚底在图片底部附近
    // 之前是 y: 250, floor 是 550， 250+300 = 550，正好。
    // 现在 floor 下移 30， player.y 也要下移 30 -> 280
    y: 280, 
    width: 200, // 图片宽度
    height: 300, // 图片高度，保持合理的全身比例
    colorSkin: "#6F4E37",
    colorJersey: "#552583", // Lakers Purple
    colorJerseyTrim: "#FDB927", // Lakers Gold
};

// 篮球对象
const ball = {
    x: 185,
    y: 420, // 也要跟着下移 30 (之前是 390)
    radius: 25,
    vx: 0,
    vy: 0,
    isMoving: false,
    reset: function() {
        this.x = 185;
        this.y = 420; // 也要跟着下移 30
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        isDragging = false;
        messageElement.textContent = "按住鼠标左键蓄力，松开发射！";
    }
};

// 篮筐对象
const hoop = {
    x: 650,
    y: 250,
    width: 90, // 调整宽度：现实中篮筐直径(45cm)约是篮球直径(24.6cm)的 1.83 倍。球半径25(直径50) -> 篮筐 50 * 1.83 ≈ 91.5
    height: 10, // 篮圈厚度
    boardWidth: 10,
    boardHeight: 100
};

// 支柱对象 (Stand/Pole)
const stand = {
    width: 15,
    // x 和 y 会在 draw 中动态计算，但为了物理碰撞，这里定义好相对关系
    // 我们在 update 中统一使用，draw 中也引用这个
    // x: hoop.x + hoop.width + 20
    // topY: hoop.y - hoop.boardHeight
    // bottomY: floor.y
};

   // 输入事件监听
   canvas.addEventListener('mousedown', (e) => {
       // 允许音频播放 (浏览器策略)
       if (scoreSound.context && scoreSound.context.state === 'suspended') {
            scoreSound.context.resume();
       }
   
       if (ball.isMoving) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 简单的判定：只要没在飞，点哪里都可以开始蓄力，或者限制在球周围
    // 这里为了手感好，全屏拖拽
    isDragging = true;
    dragStartX = mouseX;
    dragStartY = mouseY;
    dragCurrentX = mouseX;
    dragCurrentY = mouseY;
    messageElement.textContent = "调整角度和力度...";
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = canvas.getBoundingClientRect();
    dragCurrentX = e.clientX - rect.left;
    dragCurrentY = e.clientY - rect.top;
});

    canvas.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    
    // 计算发射速度 (反向拖拽)
    const forceX = (dragStartX - dragCurrentX) * 0.15;
    const forceY = (dragStartY - dragCurrentY) * 0.15;

    ball.vx = forceX;
    ball.vy = forceY;
    ball.isMoving = true;
    
    // 开始投篮动作计时，设置一个持续时间（例如 30 帧，约 0.5 秒）
    shootPoseTimer = 30; 

    messageElement.textContent = "球飞出去了！";
});

// 音效系统
const scoreSound = new Audio('sounds/score.mp3');
const rimSound = new Audio('sounds/rim.mp3');
const boardSound = new Audio('sounds/board.mp3');
const floorSound = new Audio('sounds/floor.mp3'); // 也可以用于地板和墙壁

// 预加载
scoreSound.load();
rimSound.load();
boardSound.load();
floorSound.load();

function playSound(audio, volume = 1.0) {
    // 克隆节点以支持重叠播放（并发音效）
    const sound = audio.cloneNode();
    sound.volume = Math.min(Math.max(volume, 0), 1); // 限制在 0-1
    sound.play().catch(e => console.log("Audio play failed:", e));
}

function playScoreSound() {
    // 播放得分音效
    playSound(scoreSound, 0.8);
}

function playBounceSound(intensity, type = 'default') {
    // 根据力度计算音量
    let volume = Math.min(intensity / 15, 1.0); 
    if (volume < 0.1) return; // 太轻就不播放了

    if (type === 'rim') {
        playSound(rimSound, volume);
    } else if (type === 'board') {
        playSound(boardSound, volume);
    } else if (type === 'pole') {
        playSound(rimSound, volume * 0.8); // 支柱暂时用 rim 声音代替，或者加个 pole.mp3
    } else {
        // default, wall, wood, floor
        playSound(floorSound, volume);
    }
}

function update() {
    // 更新投篮动作计时器
    if (shootPoseTimer > 0) {
        shootPoseTimer--;
    }

    // 更新篮网动画计时器
    if (netAnimationTimer > 0) {
        netAnimationTimer--;
    }

    if (ball.isMoving) {
        ball.vy += GRAVITY;
        ball.vx *= AIR_RESISTANCE;
        ball.vy *= AIR_RESISTANCE;

        ball.x += ball.vx;
        ball.y += ball.vy;

        // 地面碰撞 (改为 floor.y)
        if (ball.y + ball.radius > floor.y) {
            ball.y = floor.y - ball.radius;
            
            // 撞击速度
            const impactSpeed = Math.abs(ball.vy);
            if (impactSpeed > 1) {
                playBounceSound(impactSpeed, 'floor'); // 传入 'floor'
            }

            ball.vy = -ball.vy * BOUNCE_FACTOR;
            
            // 摩擦力
            ball.vx *= 0.8;

            // 如果速度很小，停止
            if (Math.abs(ball.vy) < 2 && Math.abs(ball.vx) < 0.5) {
                ball.isMoving = false;
                setTimeout(() => ball.reset(), 1000);
            }
        }

        // 墙壁碰撞
        if (ball.x - ball.radius < 0) {
            ball.x = ball.radius;
            playBounceSound(Math.abs(ball.vx), 'wall'); // 传入 'wall'
            ball.vx = -ball.vx * BOUNCE_FACTOR;
        }
        if (ball.x + ball.radius > canvas.width) {
            ball.x = canvas.width - ball.radius;
            playBounceSound(Math.abs(ball.vx), 'wall'); // 传入 'wall'
            ball.vx = -ball.vx * BOUNCE_FACTOR;
        }

        checkHoopCollision();
    }
}

function checkHoopCollision() {
    // 简单的篮筐检测
    // 篮筐中心点
    const hoopCenterX = hoop.x + hoop.width / 2;
    const hoopY = hoop.y;

    // 检测是否进球 (从上往下穿过篮筐平面)
    // 这里做一个简化判定：球心在篮筐范围内，且从上往下穿过 y 轴
    if (ball.vy > 0 && 
        ball.x > hoop.x && ball.x < hoop.x + hoop.width &&
        ball.y - ball.vy < hoopY && ball.y >= hoopY) {
            score++;
            scoreElement.textContent = "得分: " + score;
            messageElement.textContent = "空心入网！漂亮！";
            
            // 触发篮网动画 (持续 20 帧)
            netAnimationTimer = 20;
            
            // 播放庆祝音效
            playScoreSound();
    }
    
    // 篮板碰撞 (细化：双面+上边缘)
    const boardX = hoop.x + hoop.width;
    const boardY = hoop.y - hoop.boardHeight + 10;
    const boardW = hoop.boardWidth;
    const boardH = hoop.boardHeight;

    // 1. 篮板左侧面 (Facing Player)
    if (ball.x + ball.radius > boardX && ball.x < boardX && 
        ball.y > boardY && ball.y < boardY + boardH) {
            // 只有当球从左边过来撞击时才反弹
            if (ball.vx > 0) {
                playBounceSound(Math.abs(ball.vx) + 2, 'board'); // 木板声
                ball.vx = -ball.vx * BOUNCE_FACTOR;
                ball.x = boardX - ball.radius - 1;
            }
    }
    // 2. 篮板右侧面 (Back Side)
    else if (ball.x - ball.radius < boardX + boardW && ball.x > boardX + boardW &&
             ball.y > boardY && ball.y < boardY + boardH) {
            // 只有当球从右边过来撞击时才反弹
            if (ball.vx < 0) {
                playBounceSound(Math.abs(ball.vx) + 2, 'board'); // 木板声
                ball.vx = -ball.vx * BOUNCE_FACTOR;
                ball.x = boardX + boardW + ball.radius + 1;
            }
    }
    // 3. 篮板整体内部检测 (防止穿透)
    // 如果球心已经进去了，根据它离哪个面近弹出去
    else if (ball.x > boardX && ball.x < boardX + boardW &&
             ball.y > boardY && ball.y < boardY + boardH) {
         
         const distToLeft = ball.x - boardX;
         const distToRight = (boardX + boardW) - ball.x;
         
         playBounceSound(Math.abs(ball.vx) + 2, 'board'); // 木板声

         if (distToLeft < distToRight) {
             ball.vx = -Math.abs(ball.vx) * BOUNCE_FACTOR;
             ball.x = boardX - ball.radius - 1;
         } else {
             ball.vx = Math.abs(ball.vx) * BOUNCE_FACTOR;
             ball.x = boardX + boardW + ball.radius + 1;
         }
    }

    // 4. 篮板上边缘 (Top Edge) - 简化为矩形上部反弹
    if (ball.x > boardX - ball.radius && ball.x < boardX + boardW + ball.radius &&
        ball.y + ball.radius > boardY && ball.y + ball.radius < boardY + 10) { // 10px 深度
        if (ball.vy > 0) {
            playBounceSound(Math.abs(ball.vy) + 1, 'board'); // 木板声
            ball.vy = -ball.vy * BOUNCE_FACTOR;
            ball.y = boardY - ball.radius - 1;
        }
    }
    
    // 支柱碰撞 (Stand Collision)
    const poleX = hoop.x + hoop.width + 20; // 根据 draw 中的逻辑
    const poleTopY = hoop.y - hoop.boardHeight + 30; // 降低支柱高度，使其低于篮板上沿
    const poleBottomY = floor.y;
    const poleW = stand.width;

    // 支柱左侧面
    if (ball.x + ball.radius > poleX && ball.x < poleX &&
        ball.y > poleTopY && ball.y < poleBottomY) {
         if (ball.vx > 0) {
            playBounceSound(Math.abs(ball.vx) + 1, 'pole'); // 支柱声 (默认/金属)
            ball.vx = -ball.vx * BOUNCE_FACTOR;
            ball.x = poleX - ball.radius - 1;
         }
    }
    // 支柱右侧面
    else if (ball.x - ball.radius < poleX + poleW && ball.x > poleX + poleW &&
             ball.y > poleTopY && ball.y < poleBottomY) {
         if (ball.vx < 0) {
            playBounceSound(Math.abs(ball.vx) + 1, 'pole'); // 支柱声
            ball.vx = -ball.vx * BOUNCE_FACTOR;
            ball.x = poleX + poleW + ball.radius + 1;
         }
    }
    // 支柱内部防穿透
    else if (ball.x > poleX && ball.x < poleX + poleW &&
             ball.y > poleTopY && ball.y < poleBottomY) {
         
         const distToLeft = ball.x - poleX;
         const distToRight = (poleX + poleW) - ball.x;
         
         playBounceSound(Math.abs(ball.vx) + 1, 'pole'); // 支柱声

         if (distToLeft < distToRight) {
             ball.vx = -Math.abs(ball.vx) * BOUNCE_FACTOR;
             ball.x = poleX - ball.radius - 1;
         } else {
             ball.vx = Math.abs(ball.vx) * BOUNCE_FACTOR;
             ball.x = poleX + poleW + ball.radius + 1;
         }
    }

    // 篮筐左边缘检测 (圆形碰撞)
    const rimLeftX = hoop.x;
    const rimY = hoop.y;
    const distLeft = Math.sqrt((ball.x - rimLeftX) ** 2 + (ball.y - rimY) ** 2);
    if (distLeft < ball.radius + 5) { // 假设篮筐边缘半径为 5
        // 计算反弹法线
        const nx = (ball.x - rimLeftX) / distLeft;
        const ny = (ball.y - rimY) / distLeft;
        
        // 简单的速度反射
        const vDotN = ball.vx * nx + ball.vy * ny;
        
        // 播放撞击声 (根据法向速度)
        playBounceSound(Math.abs(vDotN), 'rim'); // 金属声

        ball.vx = (ball.vx - 2 * vDotN * nx) * BOUNCE_FACTOR;
        ball.vy = (ball.vy - 2 * vDotN * ny) * BOUNCE_FACTOR;
        
        // 稍微推开防止粘连
        ball.x += nx * 2;
        ball.y += ny * 2;
    }

    // 篮筐右边缘检测
    const rimRightX = hoop.x + hoop.width;
    const distRight = Math.sqrt((ball.x - rimRightX) ** 2 + (ball.y - rimY) ** 2);
    if (distRight < ball.radius + 5) {
        const nx = (ball.x - rimRightX) / distRight;
        const ny = (ball.y - rimY) / distRight;
        
        const vDotN = ball.vx * nx + ball.vy * ny;
        
        // 播放撞击声
        playBounceSound(Math.abs(vDotN), 'rim'); // 金属声

        ball.vx = (ball.vx - 2 * vDotN * nx) * BOUNCE_FACTOR;
        ball.vy = (ball.vy - 2 * vDotN * ny) * BOUNCE_FACTOR;
        
        ball.x += nx * 2;
        ball.y += ny * 2;
    }
}

function draw() {
    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 画地板
    ctx.fillStyle = floor.color;
    ctx.fillRect(0, floor.y, canvas.width, canvas.height - floor.y);
    // 画地板纹路
    ctx.strokeStyle = floor.lineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, floor.y);
    ctx.lineTo(canvas.width, floor.y);
    ctx.stroke();
    // 一些透视线或纹理
    ctx.beginPath();
    for(let i = 0; i < canvas.width; i+=100) {
         ctx.moveTo(i, floor.y);
         ctx.lineTo(i - 50, canvas.height); // 斜线模拟透视
    }
    ctx.globalAlpha = 0.3; // 半透明线条
    ctx.stroke();
    ctx.globalAlpha = 1.0; // 恢复

    // 画球员
    drawPlayer();

    // 画篮球架支柱 (Pole)
    ctx.fillStyle = "#2F4F4F"; // 深灰色支柱
    const poleWidth = stand.width;
    const poleX = hoop.x + hoop.width + 20; // 支柱在篮板后面一点
    const poleBaseY = floor.y;
    const poleTopY = hoop.y - hoop.boardHeight + 30; // 降低支柱高度
    
    // 主支柱
    ctx.fillRect(poleX, poleTopY, poleWidth, poleBaseY - poleTopY);
    
    // 支柱底座 (Base)
    ctx.fillStyle = "#2F4F4F";
    ctx.beginPath();
    ctx.moveTo(poleX - 20, poleBaseY);
    ctx.lineTo(poleX + poleWidth + 20, poleBaseY);
    ctx.lineTo(poleX + poleWidth + 10, poleBaseY - 20);
    ctx.lineTo(poleX - 10, poleBaseY - 20);
    ctx.fill();

    // 连接杆 (Arm - 连接支柱和篮板)
    ctx.strokeStyle = "#2F4F4F";
    ctx.lineWidth = 8;
    ctx.beginPath();
    // 从支柱顶部连到篮板背面
    ctx.moveTo(poleX, hoop.y - hoop.boardHeight + 50);
    ctx.lineTo(hoop.x + hoop.width + hoop.boardWidth, hoop.y - hoop.boardHeight + 50);
    // 下方支撑杆
    ctx.moveTo(poleX, hoop.y - hoop.boardHeight + 80);
    ctx.lineTo(hoop.x + hoop.width + hoop.boardWidth, hoop.y - hoop.boardHeight + 80);
    ctx.stroke();

    // 画篮板
    ctx.fillStyle = "#A0522D";
    ctx.fillRect(hoop.x + hoop.width, hoop.y - hoop.boardHeight + 10, hoop.boardWidth, hoop.boardHeight);
    
    // 画篮筐 (前部分)
    ctx.beginPath();
    ctx.moveTo(hoop.x, hoop.y);
    ctx.lineTo(hoop.x + hoop.width, hoop.y);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 5;
    ctx.stroke();

    // 画网 (动态效果)
    ctx.beginPath();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    
    // 篮网参数
    const netWidth = hoop.width;
    const netHeight = 30;
    const segments = 10; // 横向段数
    
    for(let i=0; i<=netWidth; i+=segments) {
        ctx.moveTo(hoop.x + i, hoop.y);
        
        let endX = hoop.x + i + 5; // 默认向右下收缩
        let endY = hoop.y + netHeight;
        
        // 如果正在播放进球动画，改变网的形状 (简单的收缩/摆动)
        if (netAnimationTimer > 0) {
            // 使用 sin 函数模拟摆动，产生波浪效果
            const swing = Math.sin(netAnimationTimer * 0.5 + i * 0.1) * 5;
            const shrink = Math.sin(netAnimationTimer * 0.3) * 5; // 上下伸缩
            endX += swing; 
            endY -= shrink; // 进球时网会稍微上缩一下
        }

        ctx.lineTo(endX, endY);
    }
    ctx.stroke();

    // 画网的横线 (让网看起来更像网)
    ctx.beginPath();
    if (netAnimationTimer > 0) {
         // 动画时横线也跟着动
         const shrink = Math.sin(netAnimationTimer * 0.3) * 5;
         ctx.moveTo(hoop.x + 5, hoop.y + 15 - shrink/2);
         ctx.lineTo(hoop.x + netWidth + 5, hoop.y + 15 - shrink/2);
    } else {
         ctx.moveTo(hoop.x + 5, hoop.y + 15);
         ctx.lineTo(hoop.x + netWidth + 5, hoop.y + 15);
    }
    ctx.stroke();

    // 画球
    if (ballImageLoaded) {
        ctx.drawImage(ballImage, ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);
    } else {
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = "orange";
        ctx.fill();
        ctx.strokeStyle = "#8B4500"; // 深一点的橙色描边
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // 画球上的纹路
        ctx.beginPath();
        ctx.moveTo(ball.x - ball.radius, ball.y);
        ctx.lineTo(ball.x + ball.radius, ball.y);
        ctx.moveTo(ball.x, ball.y - ball.radius);
        ctx.lineTo(ball.x, ball.y + ball.radius);
        ctx.stroke();
    }

    // 画拖拽指示线
    if (isDragging) {
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        // 反向画线，模拟拉弓的感觉
        const lineEndX = ball.x + (dragStartX - dragCurrentX);
        const lineEndY = ball.y + (dragStartY - dragCurrentY);
        
        ctx.lineTo(lineEndX, lineEndY);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

function drawPlayer() {
    let imgToDraw = null;

    // 逻辑修改：只有当 shootPoseTimer > 0 时才显示投篮动作，否则显示 Idle
    if (shootPoseTimer > 0 && playerShootImageLoaded) {
        imgToDraw = playerShootImage;
    } else if (playerIdleImageLoaded) {
        imgToDraw = playerIdleImage;
    } else if (playerImageLoaded) {
        // 如果没有分状态的图，降级使用 player.png
        imgToDraw = playerImage;
    }

    if (imgToDraw) {
        // 如果有图片，画图片
        let renderWidth = player.width;
        let renderHeight = player.height;

        // 针对 idle 状态进行特殊调整 (缩小)
        if (imgToDraw === playerIdleImage) {
             renderWidth = player.width * 0.72; // 宽度从 0.76 缩小到 0.72
             renderHeight = player.height * 0.77; // 高度从 0.81 缩小到 0.77
             // 为了保持底部对齐或中心对齐，可能需要调整渲染坐标
             // 这里简单处理：渲染位置稍微往右下移一点，保持脚部位置大概不变
             // 但简单缩放通常左上角不动。如果觉得位置偏了，可以加偏移量：
             // x: player.x + (player.width - renderWidth) / 2
             // y: player.y + (player.height - renderHeight)
        }

        // 保持 shoot 使用默认的大尺寸 (或者根据您的需求不缩放)
        // 之前的 shoot 放大逻辑我先去掉了，因为您说要把 stand 调小

        // 修正渲染位置，让缩小后的人物底部居中对齐（看起来像站在原地）
        const renderX = player.x + (player.width - renderWidth) / 2;
        const renderY = player.y + (player.height - renderHeight);

        ctx.drawImage(imgToDraw, renderX, renderY, renderWidth, renderHeight);
    } else {
        // 如果没有任何图片，画原来的简易方块人
        drawSimplePlayer();
    }
}

function drawSimplePlayer() {
    const px = 100; // Fallback 位置
    const py = 450; // Fallback 位置

    // 1. 腿
    ctx.fillStyle = player.colorSkin;
    ctx.fillRect(px + 15, py - 40, 10, 40); // 左腿
    ctx.fillRect(px + 35, py - 40, 10, 40); // 右腿

    // 2. 鞋子 (简单的黑鞋)
    ctx.fillStyle = "black";
    ctx.fillRect(px + 10, py - 5, 20, 10);
    ctx.fillRect(px + 35, py - 5, 20, 10);

    // 3. 身体 (球衣)
    ctx.fillStyle = player.colorJersey;
    // 简单的梯形或矩形身体
    ctx.beginPath();
    ctx.moveTo(px + 10, py - 40);
    ctx.lineTo(px + 50, py - 40);
    ctx.lineTo(px + 55, py - 110); // 肩膀宽一点
    ctx.lineTo(px + 5, py - 110);
    ctx.fill();

    // 球衣边缘
    ctx.strokeStyle = player.colorJerseyTrim;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 号码 24
    ctx.fillStyle = player.colorJerseyTrim;
    ctx.font = "bold 30px Arial";
    ctx.fillText("24", px + 12, py - 60);

    // 4. 头部
    ctx.fillStyle = player.colorSkin;
    ctx.beginPath();
    ctx.arc(px + 30, py - 125, 18, 0, Math.PI * 2);
    ctx.fill();

    // 胡子 (山羊胡)
    ctx.fillStyle = "black";
    ctx.beginPath();
    ctx.arc(px + 30, py - 120, 18, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.fill();
    
    // 5. 手臂
    ctx.fillStyle = player.colorSkin;
    ctx.save();
    // 设置旋转中心为肩膀
    ctx.translate(px + 45, py - 105);
    
    // 如果正在拖拽，或者是初始状态，手指向球
    let armAngle = -45 * Math.PI / 180; // 默认举手动作
    
    // 简单的动态手臂：如果球在飞，手放下；如果在准备，手举着
    if (ball.isMoving) {
         // 慢慢放下
         armAngle = 0;
    }

    ctx.rotate(armAngle);
    ctx.fillRect(0, 0, 35, 10); // 手臂长35
    ctx.restore();
    
    // 左手臂 (稍微被身体挡住一点，画在后面? 其实画在前面也可以，简易版)
    ctx.save();
    ctx.translate(px + 15, py - 105);
    ctx.rotate(armAngle - 0.2); // 稍微错开
    ctx.fillRect(0, 0, 35, 10);
    ctx.restore();
}

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

loop();

