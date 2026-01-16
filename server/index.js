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
const mongoose = require("mongoose");

// MongoDB 연결 설정
const MONGO_URI = process.env.MONGO_URI;

// 환경 변수 검증
if (!MONGO_URI) {
  console.error("❌ MONGO_URI 환경 변수가 설정되지 않았습니다!");
  console.error("   .env 파일에 MONGO_URI를 추가해주세요.");
  console.error("   예: MONGO_URI=mongodb://localhost:27017/wagle");
  process.exit(1);
}

// MongoDB 연결 옵션 (최신 mongoose 버전에 맞게 수정)
const mongooseOptions = {
  // MongoDB Atlas (mongodb+srv://)를 사용하는 경우 family 옵션은 제외
  // 로컬 MongoDB (mongodb://)를 사용하는 경우에만 IPv4 강제 사용
  ...(MONGO_URI.startsWith('mongodb://') && !MONGO_URI.startsWith('mongodb+srv://') 
    ? { family: 4 } 
    : {}),
  // 연결 풀 설정
  maxPoolSize: 10,
  // 서버 선택 타임아웃
  serverSelectionTimeoutMS: 5000,
  // 소켓 타임아웃
  socketTimeoutMS: 45000,
};

// MongoDB 연결
mongoose
  .connect(MONGO_URI, mongooseOptions)
  .then(() => {
    console.log("✅ MongoDB 연결 성공!");
    console.log(`   연결 URI: ${MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`); // 비밀번호 마스킹
  })
  .catch((err) => {
    console.error("❌ MongoDB 연결 실패!");
    console.error("   원인:", err.message);
    
    // 구체적인 에러 메시지 제공
    if (err.name === 'MongoServerSelectionError') {
      console.error("   → MongoDB 서버에 연결할 수 없습니다.");
      console.error("   → MongoDB가 실행 중인지 확인해주세요.");
      console.error("   → 연결 URI가 올바른지 확인해주세요.");
    } else if (err.name === 'MongoParseError') {
      console.error("   → MongoDB URI 형식이 잘못되었습니다.");
      console.error("   → 올바른 형식: mongodb://[username:password@]host[:port][/database]");
    } else if (err.name === 'MongoAuthenticationError') {
      console.error("   → MongoDB 인증에 실패했습니다.");
      console.error("   → 사용자 이름과 비밀번호를 확인해주세요.");
    } else {
      console.error("   → 전체 에러:", err);
    }
    
    // 연결 실패 시 앱 종료 (선택사항 - 필요시 주석 처리)
    // process.exit(1);
  });

// MongoDB 연결 이벤트 리스너
mongoose.connection.on('connected', () => {
  console.log('📡 Mongoose가 MongoDB에 연결되었습니다.');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose 연결 에러:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ Mongoose가 MongoDB에서 연결이 끊어졌습니다.');
});

// 앱 종료 시 MongoDB 연결 종료
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB 연결이 종료되었습니다.');
  process.exit(0);
});

// 유저 스키마 정의: DB에 저장할 사용자 정보 구조
const userSchema = new mongoose.Schema({
  provider: { type: String, required: true }, // google, kakao
  providerId: { type: String, required: true }, // 플랫폼별 고유 ID
  name: { type: String, required: true },
  email: { type: String },
  photo: { type: String },
  createdAt: { type: Date, default: Date.now },
});

// 중복 가입 방지
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });

// User 모델 생성
const User = mongoose.model("User", userSchema);

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
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 사용자 직렬화 (세션에 저장)
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// 사용자 역직렬화 (세션에서 복원)
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
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
      // [수정] 구글 로그인 시 DB 조회 및 저장 로직 적용
      async (accessToken, refreshToken, profile, done) => {
        try {
          // DB에 이미 있는 유저인지 확인
          let existingUser = await User.findOne({ 
            provider: "google", 
            providerId: profile.id 
          });

          if (existingUser) {
            return done(null, existingUser);
          }

          // 없으면 DB에 새로 생성
          const newUser = await User.create({
            provider: "google",
            providerId: profile.id,
            name: profile.displayName,
            email: profile.emails?.[0]?.value,
            photo: profile.photos?.[0]?.value,
          });
          
          return done(null, newUser);
        } catch (err) {
          console.error("구글 로그인 에러:", err);
          return done(err, null);
        }
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
      // [수정] 카카오 로그인 시 DB 조회 및 저장 로직 적용
      async (accessToken, refreshToken, profile, done) => {
        try {
          let existingUser = await User.findOne({ 
            provider: "kakao", 
            providerId: profile.id.toString() 
          });

          if (existingUser) {
            return done(null, existingUser);
          }

          const newUser = await User.create({
            provider: "kakao",
            providerId: profile.id.toString(),
            name: profile.displayName || profile.username || profile._json?.properties?.nickname,
            email: profile._json?.kakao_account?.email,
            photo: profile._json?.properties?.profile_image,
          });

          return done(null, newUser);
        } catch (err) {
          console.error("카카오 로그인 에러:", err);
          return done(err, null);
        }
      }
    )
  );
} else {
  console.warn("⚠️ KAKAO_CLIENT_ID 미설정");
}

// 인증 라우트
app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "http://localhost:3000/login?error=google" }),
  (req, res) => {
    res.redirect("http://localhost:3000/auth/success");
  }
);

app.get("/auth/kakao", (req, res, next) => {
  if (!process.env.KAKAO_CLIENT_ID) {
    return res.redirect("http://localhost:3000/login?error=kakao_config");
  }
  passport.authenticate("kakao")(req, res, next);
});

app.get(
  "/auth/kakao/callback",
  (req, res, next) => {
    if (!process.env.KAKAO_CLIENT_ID) {
      return res.redirect("http://localhost:3000/login?error=kakao_config");
    }
    passport.authenticate("kakao", { failureRedirect: "http://localhost:3000/login?error=kakao" })(req, res, next);
  },
  (req, res) => {
    res.redirect("http://localhost:3000/auth/success");
  }
);

// 로그아웃
app.get("/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "로그아웃 실패" });
    }
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
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
    origin: "http://localhost:3000", // 리액트 주소
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
    const dbUserId = currentUser && currentUser._id ? currentUser._id : (currentUser?.id || null);
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
    const dbUserId = currentUser && currentUser._id ? currentUser._id : (currentUser?.id || null);

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

server.listen(4000, () => {
  console.log("서버가 4000번 포트에서 돌아가고 있어요!");
});