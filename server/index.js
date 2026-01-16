require("dotenv").config();
const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const KakaoStrategy = require("passport-kakao").Strategy;

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

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// CORS 설정 (세션 쿠키 포함)
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 사용자 직렬화 (세션에 저장)
passport.serializeUser((user, done) => {
  done(null, user);
});

// 사용자 역직렬화 (세션에서 복원)
passport.deserializeUser((user, done) => {
  done(null, user);
});

// 구글 OAuth 전략
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback",
      },
      (accessToken, refreshToken, profile, done) => {
        const user = {
          id: profile.id,
          provider: "google",
          name: profile.displayName,
          email: profile.emails?.[0]?.value,
          photo: profile.photos?.[0]?.value,
        };
        return done(null, user);
      }
    )
  );
}

// 카카오 OAuth 전략
if (process.env.KAKAO_CLIENT_ID) {
  passport.use(
    "kakao",
    new KakaoStrategy(
      {
        clientID: process.env.KAKAO_CLIENT_ID,
        callbackURL: "/auth/kakao/callback",
      },
      (accessToken, refreshToken, profile, done) => {
        const user = {
          id: profile.id,
          provider: "kakao",
          name: profile.displayName || profile.username || profile._json?.properties?.nickname,
          email: profile._json?.kakao_account?.email,
          photo: profile._json?.properties?.profile_image,
        };
        return done(null, user);
      }
    )
  );
  console.log("✅ 카카오 OAuth 전략이 등록되었습니다.");
} else {
  console.warn("⚠️  KAKAO_CLIENT_ID가 설정되지 않아 카카오 로그인이 비활성화됩니다.");
}

// 인증 라우트
app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: `${CLIENT_URL}/login?error=google` }),
  (req, res) => {
    res.redirect(`${CLIENT_URL}/auth/success`);
  }
);

app.get("/auth/kakao", (req, res, next) => {
  if (!process.env.KAKAO_CLIENT_ID) {
    return res.redirect(`${CLIENT_URL}/login?error=kakao_config`);
  }
  passport.authenticate("kakao")(req, res, next);
});

app.get(
  "/auth/kakao/callback",
  (req, res, next) => {
    if (!process.env.KAKAO_CLIENT_ID) {
      return res.redirect(`${CLIENT_URL}/login?error=kakao_config`);
    }
    passport.authenticate("kakao", { failureRedirect: `${CLIENT_URL}/login?error=kakao` })(req, res, next);
  },
  (req, res) => {
    res.redirect(`${CLIENT_URL}/auth/success`);
  }
);

// 로그아웃
app.get("/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "로그아웃 실패" });
    }
    res.json({ success: true });
  });
});

// 현재 사용자 정보 조회
app.get("/auth/user", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: req.user, authenticated: true });
  } else {
    res.json({ user: null, authenticated: false });
  }
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Socket.IO 미들웨어: 세션 정보 가져오기
// 주의: Socket.IO에서 세션 접근은 복잡하므로, 클라이언트에서 사용자 정보를 전송받는 방식 사용

// 방 관리 데이터 구조
const rooms = new Map(); // roomId -> { id, name, players: [], maxPlayers: 4, status: 'waiting' | 'playing' }

// 방 목록 조회
function getRoomList() {
  return Array.from(rooms.values()).map((room) => ({
    id: room.id,
    name: room.name,
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    status: room.status,
  }));
}

io.on("connection", (socket) => {
  let user = null;
  
  // 클라이언트에서 사용자 정보 전송 받기
  socket.on("setUser", (userData) => {
    user = userData;
    console.log(`유저 접속됨: ${socket.id}`, user ? `(${user.name})` : "(비로그인)");
  });
  
  console.log(`소켓 연결됨: ${socket.id}`);

  // 방 목록 조회
  socket.on("getRoomList", () => {
    socket.emit("roomList", getRoomList());
  });

  // 방 생성
  socket.on("createRoom", ({ roomName, maxPlayers = 4 }) => {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const currentUser = user || null;
    const playerName = currentUser ? currentUser.name : `플레이어 ${socket.id.substring(0, 6)}`;
    const newRoom = {
      id: roomId,
      name: roomName || `방 ${rooms.size + 1}`,
      players: [{ 
        id: socket.id, 
        name: playerName,
        userId: currentUser?.id || null,
        provider: currentUser?.provider || null,
        photo: currentUser?.photo || null,
      }],
      maxPlayers: maxPlayers || 4,
      status: "waiting",
    };

    rooms.set(roomId, newRoom);
    socket.join(roomId);
    socket.emit("roomCreated", newRoom);
    io.emit("roomList", getRoomList()); // 모든 클라이언트에 방 목록 업데이트
    console.log(`방 생성됨: ${roomId} by ${socket.id}`);
  });

  // 방 입장
  socket.on("joinRoom", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("joinRoomError", { message: "방을 찾을 수 없습니다." });
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit("joinRoomError", { message: "방이 가득 찼습니다." });
      return;
    }

    if (room.status === "playing") {
      socket.emit("joinRoomError", { message: "이미 게임이 진행 중인 방입니다." });
      return;
    }

    // 이미 방에 있는지 확인
    const existingPlayer = room.players.find((p) => p.id === socket.id);
    if (existingPlayer) {
      socket.emit("joinRoomError", { message: "이미 방에 있습니다." });
      return;
    }

    const currentUser = user || null;
    const playerName = currentUser ? currentUser.name : `플레이어 ${socket.id.substring(0, 6)}`;
    room.players.push({ 
      id: socket.id, 
      name: playerName,
      userId: currentUser?.id || null,
      provider: currentUser?.provider || null,
      photo: currentUser?.photo || null,
    });
    socket.join(roomId);
    socket.emit("joinedRoom", room);
    io.to(roomId).emit("roomUpdated", room); // 방의 모든 플레이어에게 업데이트
    io.emit("roomList", getRoomList()); // 모든 클라이언트에 방 목록 업데이트
    console.log(`${socket.id}가 방 ${roomId}에 입장했습니다.`);
  });

  // 방 나가기
  socket.on("leaveRoom", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.players = room.players.filter((p) => p.id !== socket.id);
      socket.leave(roomId);

      // 방에 플레이어가 없으면 방 삭제
      if (room.players.length === 0) {
        rooms.delete(roomId);
        console.log(`방 삭제됨: ${roomId}`);
      } else {
        io.to(roomId).emit("roomUpdated", room);
      }

      io.emit("roomList", getRoomList());
      socket.emit("leftRoom");
      console.log(`${socket.id}가 방 ${roomId}에서 나갔습니다.`);
    }
  });

  // 게임 시작
  socket.on("startGame", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.players.length > 0) {
      // 방장만 게임 시작 가능 (첫 번째 플레이어)
      if (room.players[0].id === socket.id) {
        room.status = "playing";
        io.to(roomId).emit("gameStarted", room);
        io.emit("roomList", getRoomList());
        console.log(`게임 시작: ${roomId}`);
      }
    }
  });

  // 플레이어 이름 변경
  socket.on("updatePlayerName", ({ roomId, playerName }) => {
    const room = rooms.get(roomId);
    if (room) {
      const player = room.players.find((p) => p.id === socket.id);
      if (player) {
        player.name = playerName || `플레이어 ${socket.id.substring(0, 6)}`;
        io.to(roomId).emit("roomUpdated", room);
      }
    }
  });

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
        } else {
          io.to(roomId).emit("roomUpdated", room);
        }

        io.emit("roomList", getRoomList());
      }
    });
  });
});

server.listen(4000, "0.0.0.0", () => {
  console.log("서버가 4000번 포트에서 돌아가고 있어요!");
});