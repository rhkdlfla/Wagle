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
    origin: "http://localhost:3000", // 리액트 주소
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Socket.IO 미들웨어: 세션 정보 가져오기
// 주의: Socket.IO에서 세션 접근은 복잡하므로, 클라이언트에서 사용자 정보를 전송받는 방식 사용

// 방 관리 데이터 구조
const rooms = new Map(); // roomId -> { id, name, players: [], maxPlayers: 4, status: 'waiting' | 'playing' }

// 게임 상태 관리
const gameStates = new Map(); // roomId -> { startTime, duration, clicks: { socketId: count }, isActive }

// 방 목록 조회 (공개 방만)
function getRoomList() {
  return Array.from(rooms.values())
    .filter((room) => room.isPublic !== false) // 비공개 방 제외
    .map((room) => ({
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

  // 랜덤 방 이름 생성 함수
  function generateRandomRoomName() {
    const adjectives = [
      "멋진", "재미있는", "신나는", "즐거운", "화려한", "빠른", "강한", "똑똑한",
      "용감한", "친절한", "활발한", "차분한", "밝은", "신비로운", "특별한", "멋쟁이",
      "최고의", "대단한", "훌륭한", "완벽한", "놀라운", "인기있는", "유명한", "독특한"
    ];
    const nouns = [
      "게임방", "파티룸", "모임방", "대전방", "경기장", "플레이룸", "배틀존", "챌린지",
      "아레나", "스타디움", "콜로세움", "경기장", "플레이그라운드", "배틀필드", "워존",
      "게임존", "플레이존", "배틀룸", "챌린지룸", "대전장", "경쟁장", "플레이스페이스"
    ];
    
    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNumber = Math.floor(Math.random() * 999) + 1;
    
    return `${randomAdjective} ${randomNoun} ${randomNumber}`;
  }

  // 방 생성
  socket.on("createRoom", ({ roomName, maxPlayers = 4, isPublic = true }) => {
    // 이전 방에서 나가기 (다른 방에 있으면 먼저 나감)
    let previousRooms = [];
    rooms.forEach((room, existingRoomId) => {
      const existingPlayer = room.players.find((p) => p.id === socket.id);
      if (existingPlayer) {
        previousRooms.push(existingRoomId);
        room.players = room.players.filter((p) => p.id !== socket.id);
        socket.leave(existingRoomId);
        
        // 방에 플레이어가 없으면 방 삭제
        if (room.players.length === 0) {
          rooms.delete(existingRoomId);
        } else {
          io.to(existingRoomId).emit("roomUpdated", room);
        }
      }
    });
    
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const currentUser = user || null;
    const playerName = currentUser ? currentUser.name : `플레이어 ${socket.id.substring(0, 6)}`;
    
    // 방 이름이 없으면 랜덤 이름 생성
    const finalRoomName = roomName && roomName.trim() 
      ? roomName.trim() 
      : generateRandomRoomName();
    
    const newRoom = {
      id: roomId,
      name: finalRoomName,
      players: [{ 
        id: socket.id, 
        name: playerName,
        userId: currentUser?.id || null,
        provider: currentUser?.provider || null,
        photo: currentUser?.photo || null,
      }],
      maxPlayers: maxPlayers || 4,
      status: "waiting",
      selectedGame: "clickBattle", // 기본 게임
      isPublic: isPublic !== false, // 기본값은 true (공개)
    };

    rooms.set(roomId, newRoom);
    socket.join(roomId);
    socket.emit("roomCreated", newRoom);
    io.emit("roomList", getRoomList()); // 모든 클라이언트에 방 목록 업데이트
    console.log(`방 생성됨: ${roomId} by ${socket.id}`);
  });

  // 방 입장
  socket.on("joinRoom", ({ roomId }) => {
    // 이전 방에서 나가기 (다른 방에 있으면 먼저 나감)
    let previousRooms = [];
    rooms.forEach((existingRoom, existingRoomId) => {
      if (existingRoomId !== roomId) {
        const existingPlayer = existingRoom.players.find((p) => p.id === socket.id);
        if (existingPlayer) {
          previousRooms.push(existingRoomId);
          existingRoom.players = existingRoom.players.filter((p) => p.id !== socket.id);
          socket.leave(existingRoomId);
          
          // 방에 플레이어가 없으면 방 삭제
          if (existingRoom.players.length === 0) {
            rooms.delete(existingRoomId);
          } else {
            io.to(existingRoomId).emit("roomUpdated", existingRoom);
          }
        }
      }
    });
    
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("joinRoomError", { message: "방을 찾을 수 없습니다." });
      return;
    }

    // 비공개 방인 경우 링크로만 입장 가능 (방 목록에 표시되지 않으므로 링크로만 접근 가능)
    // 추가 검증은 필요 없음 (이미 방 목록에서 필터링됨)

    if (room.players.length >= room.maxPlayers) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/80805081-a969-4bd3-8dce-3883cd4dfc97',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.js:286',message:'방이 가득 참',data:{socketId:socket.id,roomId,playerCount:room.players.length,maxPlayers:room.maxPlayers},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      socket.emit("joinRoomError", { message: "방이 가득 찼습니다." });
      return;
    }

    if (room.status === "playing") {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/80805081-a969-4bd3-8dce-3883cd4dfc97',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.js:292',message:'게임 진행 중',data:{socketId:socket.id,roomId,status:room.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      socket.emit("joinRoomError", { message: "이미 게임이 진행 중인 방입니다." });
      return;
    }

    // 이미 방에 있는지 확인
    const existingPlayer = room.players.find((p) => p.id === socket.id);
    if (existingPlayer) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/80805081-a969-4bd3-8dce-3883cd4dfc97',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.js:299',message:'이미 방에 있음 - 성공 응답 반환',data:{socketId:socket.id,roomId,existingPlayerId:existingPlayer.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      // 이미 방에 있으면 에러 대신 현재 방 정보 반환 (중복 입장 허용)
      socket.join(roomId);
      socket.emit("joinedRoom", room);
      io.to(roomId).emit("roomUpdated", room);
      io.emit("roomList", getRoomList());
      console.log(`${socket.id}가 이미 방 ${roomId}에 있었지만 재입장 처리됨`);
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
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/80805081-a969-4bd3-8dce-3883cd4dfc97',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.js:310',message:'방 입장 완료',data:{socketId:socket.id,roomId,playerCount:room.players.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
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

  // 게임 선택
  socket.on("selectGame", ({ roomId, gameId }) => {
    const room = rooms.get(roomId);
    if (room && room.players[0].id === socket.id) {
      // 방장만 게임 선택 가능
      room.selectedGame = gameId;
      io.to(roomId).emit("roomUpdated", room);
      console.log(`게임 선택: ${roomId} -> ${gameId}`);
    }
  });

  // 게임 시작
  socket.on("startGame", ({ roomId, gameType = "clickBattle" }) => {
    const room = rooms.get(roomId);
    if (room && room.players.length > 0) {
      // 방장만 게임 시작 가능 (첫 번째 플레이어)
      if (room.players[0].id === socket.id) {
        room.status = "playing";
        
        // 선택된 게임 타입 저장
        room.selectedGame = gameType;
        
        // 게임 상태 초기화
        const gameState = {
          gameType: gameType,
          startTime: Date.now(),
          duration: 30000, // 30초
          clicks: {},
          isActive: true,
        };
        
        // 모든 플레이어의 클릭 카운트 초기화
        room.players.forEach((player) => {
          gameState.clicks[player.id] = 0;
        });
        
        gameStates.set(roomId, gameState);
        
        // 게임 시작 이벤트 전송
        io.to(roomId).emit("gameStarted", {
          room: room,
          gameState: {
            duration: gameState.duration,
            startTime: gameState.startTime,
          },
        });
        
        io.emit("roomList", getRoomList());
        console.log(`게임 시작: ${roomId}, 시작 시간: ${new Date(gameState.startTime).toISOString()}`);
        
        // 주기적으로 클릭 업데이트 전송 (1초마다)
        const updateInterval = setInterval(() => {
          const elapsed = Date.now() - gameState.startTime;
          const remaining = Math.max(0, gameState.duration - elapsed);
          
          if (remaining <= 0) {
            clearInterval(updateInterval);
            endGame(roomId);
            return;
          }
          
          const clickUpdates = room.players.map((p) => ({
            id: p.id,
            clicks: gameState.clicks[p.id] || 0,
          }));
          
          io.to(roomId).emit("clickUpdate", {
            updates: clickUpdates,
            timeRemaining: remaining,
          });
        }, 1000); // 1초마다 업데이트
        
        // 게임 종료 타이머
        setTimeout(() => {
          clearInterval(updateInterval);
          endGame(roomId);
        }, gameState.duration);
      }
    }
  });

  // 게임 종료 함수
  function endGame(roomId) {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);
    
    if (!gameState || !room) return;
    
    gameState.isActive = false;
    
    // 승자 결정
    let maxClicks = 0;
    const winners = [];
    
    Object.entries(gameState.clicks).forEach(([playerId, clicks]) => {
      if (clicks > maxClicks) {
        maxClicks = clicks;
        winners.length = 0;
        winners.push(playerId);
      } else if (clicks === maxClicks && maxClicks > 0) {
        winners.push(playerId);
      }
    });
    
    // 최종 결과 생성
    const results = room.players.map((player) => ({
      id: player.id,
      name: player.name,
      photo: player.photo,
      clicks: gameState.clicks[player.id] || 0,
      isWinner: winners.includes(player.id),
    }));
    
    // 결과를 클릭 수로 정렬
    results.sort((a, b) => b.clicks - a.clicks);
    
    // 게임 종료 이벤트 전송
    io.to(roomId).emit("gameEnded", {
      results: results,
      winners: winners,
      maxClicks: maxClicks,
    });
    
    // 게임 상태 삭제
    gameStates.delete(roomId);
    
    // 방 상태를 대기 중으로 변경
    room.status = "waiting";
    io.emit("roomList", getRoomList());
    
    console.log(`게임 종료: ${roomId}, 승자: ${winners.join(", ")}`);
  }

  // 게임 상태 요청
  socket.on("getGameState", ({ roomId }) => {
    console.log(`게임 상태 요청 받음: ${roomId} from ${socket.id}`);
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);
    
    console.log("게임 상태:", { 
      hasGameState: !!gameState, 
      hasRoom: !!room, 
      isActive: gameState?.isActive,
      roomStatus: room?.status 
    });
    
    if (gameState && room && gameState.isActive) {
      // 게임이 진행 중이면 현재 상태 전송
      const clickUpdates = room.players.map((p) => ({
        id: p.id,
        clicks: gameState.clicks[p.id] || 0,
      }));
      
      const elapsed = Date.now() - gameState.startTime;
      const remaining = Math.max(0, gameState.duration - elapsed);
      
      console.log(`게임 상태 전송: ${roomId}, 남은 시간: ${remaining}ms`);
      
      socket.emit("gameStarted", {
        room: room,
        gameState: {
          duration: gameState.duration,
          startTime: gameState.startTime,
        },
      });
      
      // 현재 클릭 상태도 전송
      socket.emit("clickUpdate", {
        updates: clickUpdates,
        timeRemaining: remaining,
      });
    } else {
      console.log(`게임이 진행 중이 아닙니다. roomId: ${roomId}, roomStatus: ${room?.status}`);
    }
  });

  // 클릭 이벤트
  socket.on("gameClick", ({ roomId }) => {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);
    
    if (!gameState || !room) {
      socket.emit("gameError", { message: "게임이 진행 중이 아닙니다." });
      return;
    }
    
    if (!gameState.isActive) {
      return;
    }
    
    // 플레이어가 방에 있는지 확인
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      socket.emit("gameError", { message: "플레이어를 찾을 수 없습니다." });
      return;
    }
    
    // 클릭 카운트 증가
    if (!gameState.clicks[socket.id]) {
      gameState.clicks[socket.id] = 0;
    }
    gameState.clicks[socket.id]++;
    
    // 모든 플레이어에게 클릭 업데이트 전송
    const clickUpdates = room.players.map((p) => ({
      id: p.id,
      clicks: gameState.clicks[p.id] || 0,
    }));
    
    io.to(roomId).emit("clickUpdate", {
      updates: clickUpdates,
      timeRemaining: Math.max(0, gameState.duration - (Date.now() - gameState.startTime)),
    });
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

  // 채팅 메시지 전송
  socket.on("sendMessage", ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("messageError", { message: "방을 찾을 수 없습니다." });
      return;
    }

    // 플레이어가 방에 있는지 확인
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      socket.emit("messageError", { message: "방에 입장하지 않았습니다." });
      return;
    }

    // 메시지가 비어있거나 너무 긴 경우 거부
    const trimmedMessage = message.trim();
    if (!trimmedMessage || trimmedMessage.length === 0) {
      return;
    }
    if (trimmedMessage.length > 500) {
      socket.emit("messageError", { message: "메시지는 500자 이하여야 합니다." });
      return;
    }

    // 방의 모든 플레이어에게 메시지 전송
    const messageData = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      roomId: roomId,
      playerId: socket.id,
      playerName: player.name,
      playerPhoto: player.photo || null,
      message: trimmedMessage,
      timestamp: Date.now(),
    };

    io.to(roomId).emit("messageReceived", messageData);
    console.log(`채팅 메시지: ${roomId} - ${player.name}: ${trimmedMessage}`);
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