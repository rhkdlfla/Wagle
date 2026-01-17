require("dotenv").config();
const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const session = require("express-session");
const passport = require("passport");

// 설정 및 모델 import
require("./config/database"); // MongoDB 연결
require("./config/passport"); // Passport 인증 설정
const authRoutes = require("./routes/auth");

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

// 라우트 설정
app.use("/auth", authRoutes);

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

  // 연결 해제 처리
  socket.on("disconnect", () => {
    console.log("유저 접속 끊김", socket.id);
    
    // 모든 방에서 플레이어 제거
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
  });
});

// 서버 시작
server.listen(PORT, "0.0.0.0", () => {
  console.log(`서버가 ${PORT}번 포트에서 돌아가고 있어요!`);
});
