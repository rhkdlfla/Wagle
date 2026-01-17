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

// 방 목록 조회 (공개 방만)
function getRoomList(rooms) {
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

function setupRoomHandlers(socket, io, rooms, user) {
  // 방 목록 조회
  socket.on("getRoomList", () => {
    socket.emit("roomList", getRoomList(rooms));
  });

  // 방 생성
  socket.on("createRoom", ({ roomName, maxPlayers = 4, isPublic = true }) => {
    // 이전 방에서 나가기 (다른 방에 있으면 먼저 나감)
    rooms.forEach((room, existingRoomId) => {
      const existingPlayer = room.players.find((p) => p.id === socket.id);
      if (existingPlayer) {
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
    io.emit("roomList", getRoomList(rooms)); // 모든 클라이언트에 방 목록 업데이트
    console.log(`방 생성됨: ${roomId} by ${socket.id}`);
  });

  // 방 입장
  socket.on("joinRoom", ({ roomId }) => {
    // 이전 방에서 나가기 (다른 방에 있으면 먼저 나감)
    rooms.forEach((existingRoom, existingRoomId) => {
      if (existingRoomId !== roomId) {
        const existingPlayer = existingRoom.players.find((p) => p.id === socket.id);
        if (existingPlayer) {
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
      // 이미 방에 있으면 에러 대신 현재 방 정보 반환 (중복 입장 허용)
      socket.join(roomId);
      socket.emit("joinedRoom", room);
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
    io.emit("roomList", getRoomList(rooms)); // 모든 클라이언트에 방 목록 업데이트
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

      io.emit("roomList", getRoomList(rooms));
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
}

module.exports = { setupRoomHandlers, getRoomList };
