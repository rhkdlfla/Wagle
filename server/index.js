require("dotenv").config();
const express = require("express");
const app = express();
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const cors = require("cors");
const session = require("express-session");
const passport = require("passport");

// 설정 및 모델 import
require("./config/database"); // MongoDB 연결
require("./config/passport"); // Passport 인증 설정
const authRoutes = require("./routes/auth");
const quizRoutes = require("./routes/quiz");
const uploadRoutes = require("./routes/upload");

// 환경 변수
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const PORT = process.env.PORT || 4000;

// 세션 설정
app.use(
  session({
    secret: process.env.SESSION_SECRET || "wagle-secret-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // HTTPS 사용 시 true로 변경
      maxAge: 24 * 60 * 60 * 1000, // 24시간
    },
  })
);

// Passport 초기화
app.use(passport.initialize());
app.use(passport.session());

// CORS 설정 (세션 쿠키 포함)
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 서빙 (업로드된 파일)
app.use("/api/uploads", express.static(path.join(__dirname, "uploads")));

// 라우트 설정
app.use("/auth", authRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/upload", uploadRoutes);

// HTTP 서버 및 Socket.IO 설정
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Socket.IO 핸들러 import
const { setupRoomHandlers, getRoomList } = require("./socket/handlers/roomHandler");
const { setupGameHandlers } = require("./socket/handlers/gameHandler");
const { setupChatHandlers } = require("./socket/handlers/chatHandler");

// 방 관리 및 게임 상태
const rooms = new Map(); // roomId -> { id, name, players: [], maxPlayers: 4, status: 'waiting' | 'playing' }
const gameStates = new Map(); // roomId -> { startTime, duration, clicks: { socketId: count }, isActive, gameType, grid, scores }

// Socket.IO 연결 처리
io.on("connection", (socket) => {
  let user = null;
  let restoredFromPreviousSession = false;
  
  // 이전 세션 복원 처리
  socket.on("restoreSession", ({ previousSocketId }) => {
    if (!previousSocketId) return;
    
    console.log(`이전 세션 복원 시도: ${previousSocketId} -> ${socket.id}`);
    
    const restoredRooms = [];
    
    // 모든 방에서 이전 소켓 ID로 플레이어 찾기
    rooms.forEach((room, roomId) => {
      const playerIndex = room.players.findIndex((p) => p.id === previousSocketId);
      if (playerIndex !== -1) {
        // 이전 소켓 ID를 새 소켓 ID로 업데이트
        room.players[playerIndex].id = socket.id;
        restoredFromPreviousSession = true;
        restoredRooms.push(roomId);
        
        // 방에 다시 조인
        socket.join(roomId);
        
        // 게임 상태의 클릭 데이터도 업데이트 (클릭 대결 게임인 경우)
        const gameState = gameStates.get(roomId);
        if (gameState && gameState.clicks && gameState.clicks[previousSocketId] !== undefined) {
          gameState.clicks[socket.id] = gameState.clicks[previousSocketId];
          delete gameState.clicks[previousSocketId];
        }
        
        // 게임 상태의 점수 데이터도 업데이트 (사과배틀 게임인 경우)
        if (gameState && gameState.scores && gameState.scores[previousSocketId] !== undefined) {
          gameState.scores[socket.id] = gameState.scores[previousSocketId];
          delete gameState.scores[previousSocketId];
        }
        
        // 방의 모든 플레이어에게 업데이트 전송
        io.to(roomId).emit("roomUpdated", room);
        console.log(`세션 복원 성공: 방 ${roomId}, 플레이어 ${room.players[playerIndex].name}`);
        
        // 복원된 방 정보를 클라이언트에 전송 (joinRoom 이벤트 대신)
        socket.emit("joinedRoom", room);
      }
    });
    
    if (restoredFromPreviousSession) {
      socket.emit("sessionRestored", { 
        success: true, 
        restoredRooms: restoredRooms,
        message: restoredRooms.length > 0 ? `${restoredRooms.length}개 방에서 세션이 복원되었습니다.` : "세션이 복원되었습니다."
      });
    }
  });
  
  // 클라이언트에서 사용자 정보 전송 받기
  socket.on("setUser", (userData) => {
    user = userData;
    console.log(`유저 접속됨: ${socket.id}`, user ? `(${user.name})` : "(비로그인)");
  });
  
  console.log(`소켓 연결됨: ${socket.id}`);

  // 핸들러 설정
  setupRoomHandlers(socket, io, rooms, user);
  setupGameHandlers(socket, io, rooms, gameStates, getRoomList);
  setupChatHandlers(socket, io, rooms);

  // 연결 해제 처리 (단, 페이지 새로고침이 아닌 경우에만)
  socket.on("disconnect", () => {
    console.log("유저 접속 끊김", socket.id);
    
    // 복원된 세션이 아니고 일정 시간 내에 재연결되지 않으면 플레이어 제거
    // (새로고침의 경우 restoreSession이 먼저 호출되므로 플레이어가 이미 업데이트됨)
    setTimeout(() => {
      // 여전히 연결이 끊어진 상태인지 확인
      if (!socket.connected) {
        rooms.forEach((room, roomId) => {
          const playerIndex = room.players.findIndex((p) => p.id === socket.id);
          if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
            socket.leave(roomId);

            // 방에 플레이어가 없으면 방 삭제
            if (room.players.length === 0) {
              rooms.delete(roomId);
              // 게임 상태도 함께 삭제
              gameStates.delete(roomId);
            } else {
              io.to(roomId).emit("roomUpdated", room);
            }

            io.emit("roomList", getRoomList(rooms));
          }
        });
      }
    }, 2000); // 2초 대기 (새로고침 재연결 시간 고려)
  });
});

// 서버 시작
server.listen(PORT, "0.0.0.0", () => {
  console.log(`서버가 ${PORT}번 포트에서 돌아가고 있어요!`);
});
