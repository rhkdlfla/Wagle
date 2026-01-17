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

function getUserFromSocket(socket) {
  const currentUser = socket?.data?.user || null;
  const provider = currentUser?.provider || null;
  const providerId = currentUser?.providerId || null;
  const userId = currentUser?.id || currentUser?._id || null;
  const userKey = provider
    ? providerId
      ? `${provider}:${providerId}`
      : userId
        ? `${provider}:${userId}`
        : null
    : null;

  return { currentUser, userKey, userId, providerId };
}

function setupRoomHandlers(socket, io, rooms) {
  // 방 목록 조회
  socket.on("getRoomList", () => {
    socket.emit("roomList", getRoomList(rooms));
  });

  // 방 생성
  socket.on("createRoom", ({ roomName, maxPlayers = 20, isPublic = true }) => {
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
    const { currentUser, userKey, userId, providerId } = getUserFromSocket(socket);
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
        userId: userId,
        userKey: userKey,
        provider: currentUser?.provider || null,
        providerId: providerId,
        photo: currentUser?.photo || null,
        teamId: null, // 팀 ID (null이면 팀 없음)
      }],
      maxPlayers: maxPlayers || 20,
      status: "waiting",
      selectedGame: "clickBattle", // 기본 게임
      isPublic: isPublic !== false, // 기본값은 true (공개)
      teams: [], // 팀 목록: [{ id: 1, name: "팀 1", color: "#FF5733" }, ...]
      teamMode: false, // 팀전 모드 활성화 여부
      relayMode: false, // 이어달리기 모드 (클릭 대결 전용)
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

    const { currentUser, userKey, userId, providerId } = getUserFromSocket(socket);
    
    // 이미 방에 있는지 확인 (socket.id로 먼저 확인)
    const existingPlayerBySocket = room.players.find((p) => p.id === socket.id);
    if (existingPlayerBySocket) {
      // 이미 방에 있으면 에러 대신 현재 방 정보 반환 (중복 입장 허용)
      socket.join(roomId);
      socket.emit("joinedRoom", room);
      return;
    }
    
    // OAuth 사용자의 경우: 같은 계정이 이미 방에 있는지 확인 (userKey 우선)
    if (userKey) {
      const existingPlayerByUserKey = room.players.find((p) => p.userKey === userKey);
      if (existingPlayerByUserKey) {
        existingPlayerByUserKey.id = socket.id;
        existingPlayerByUserKey.userId = userId || existingPlayerByUserKey.userId;
        existingPlayerByUserKey.provider = currentUser?.provider || existingPlayerByUserKey.provider;
        existingPlayerByUserKey.providerId = providerId || existingPlayerByUserKey.providerId;
        existingPlayerByUserKey.photo = currentUser?.photo || existingPlayerByUserKey.photo;
        existingPlayerByUserKey.name = currentUser?.name || existingPlayerByUserKey.name;
        socket.join(roomId);
        socket.emit("joinedRoom", room);
        io.to(roomId).emit("roomUpdated", room);
        console.log(`${socket.id}가 기존 플레이어의 소켓 ID를 업데이트했습니다. (userKey: ${userKey})`);
        return;
      }
    } else if (userId) {
      const existingPlayerByUserId = room.players.find((p) => p.userId && p.userId.toString() === userId.toString());
      if (existingPlayerByUserId) {
        existingPlayerByUserId.id = socket.id;
        socket.join(roomId);
        socket.emit("joinedRoom", room);
        io.to(roomId).emit("roomUpdated", room);
        console.log(`${socket.id}가 기존 플레이어의 소켓 ID를 업데이트했습니다. (userId: ${userId})`);
        return;
      }
    }

    const playerName = currentUser ? currentUser.name : `플레이어 ${socket.id.substring(0, 6)}`;

    room.players.push({ 
      id: socket.id, 
      name: playerName,
      userId: userId,
      userKey: userKey,
      provider: currentUser?.provider || null,
      providerId: providerId,
      photo: currentUser?.photo || null,
      teamId: null, // 팀 ID (null이면 팀 없음)
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
      // 클릭 대결이 아니거나 팀전 모드가 아니면 이어달리기 모드 해제
      if (gameId !== "clickBattle" || !room.teamMode) {
        room.relayMode = false;
      }
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

  // 팀 설정 (방장만 가능)
  socket.on("setTeams", ({ roomId, teamCount, teamNames, teamColors }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("setTeamsError", { message: "방을 찾을 수 없습니다." });
      return;
    }

    // 방장만 팀 설정 가능 (첫 번째 플레이어)
    if (room.players[0].id !== socket.id) {
      socket.emit("setTeamsError", { message: "방장만 팀을 설정할 수 있습니다." });
      return;
    }

    // 팀 개수 검증 (2~8개)
    const finalTeamCount = Math.max(2, Math.min(8, teamCount || 2));
    
    // 팀 생성
    const teamColorsList = [
      "#FF5733", // 빨간색
      "#33C3F0", // 파란색
      "#33FF57", // 초록색
      "#FFD933", // 노란색
      "#9D33FF", // 보라색
      "#FF33A1", // 분홍색
      "#33FFF0", // 청록색
      "#FF8C33", // 주황색
    ];

    room.teams = [];
    for (let i = 0; i < finalTeamCount; i++) {
      room.teams.push({
        id: i + 1,
        name: teamNames && teamNames[i] ? teamNames[i] : `팀 ${i + 1}`,
        color: teamColors && teamColors[i] ? teamColors[i] : teamColorsList[i % teamColorsList.length],
      });
    }

    // 모든 플레이어의 팀 초기화
    room.players.forEach((player) => {
      player.teamId = null;
    });

    room.teamMode = true;
    io.to(roomId).emit("roomUpdated", room);
    console.log(`방 ${roomId}의 팀 설정됨: ${finalTeamCount}개 팀`);
  });

  // 팀 모드 해제 (방장만 가능)
  socket.on("disableTeamMode", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("setTeamsError", { message: "방을 찾을 수 없습니다." });
      return;
    }

    if (room.players[0].id !== socket.id) {
      socket.emit("setTeamsError", { message: "방장만 팀 모드를 해제할 수 있습니다." });
      return;
    }

    room.teamMode = false;
    room.teams = [];
    room.relayMode = false; // 팀 모드 해제 시 이어달리기 모드도 해제
    room.players.forEach((player) => {
      player.teamId = null;
    });

    io.to(roomId).emit("roomUpdated", room);
    console.log(`방 ${roomId}의 팀 모드 해제됨`);
  });

  // 팀 추가 (방장만 가능)
  socket.on("addTeam", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("setTeamsError", { message: "방을 찾을 수 없습니다." });
      return;
    }

    // 방장만 팀 추가 가능
    if (room.players[0].id !== socket.id) {
      socket.emit("setTeamsError", { message: "방장만 팀을 추가할 수 있습니다." });
      return;
    }

    if (!room.teamMode) {
      socket.emit("setTeamsError", { message: "팀전 모드가 활성화되지 않았습니다." });
      return;
    }

    // 최대 8개 팀
    if (room.teams && room.teams.length >= 8) {
      socket.emit("setTeamsError", { message: "최대 8개 팀까지 추가할 수 있습니다." });
      return;
    }

    const teamColorsList = [
      "#FF5733", // 빨간색
      "#33C3F0", // 파란색
      "#33FF57", // 초록색
      "#FFD933", // 노란색
      "#9D33FF", // 보라색
      "#FF33A1", // 분홍색
      "#33FFF0", // 청록색
      "#FF8C33", // 주황색
    ];

    // 새 팀 ID 계산
    const maxId = room.teams.length > 0 
      ? Math.max(...room.teams.map(t => t.id)) 
      : 0;
    const newTeamId = maxId + 1;
    
    // 새 팀 추가
    room.teams.push({
      id: newTeamId,
      name: `팀 ${newTeamId}`,
      color: teamColorsList[(newTeamId - 1) % teamColorsList.length],
    });

    io.to(roomId).emit("roomUpdated", room);
    console.log(`방 ${roomId}에 팀 추가됨: 팀 ${newTeamId}`);
  });

  // 팀 삭제 (방장만 가능)
  socket.on("removeTeam", ({ roomId, teamId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("setTeamsError", { message: "방을 찾을 수 없습니다." });
      return;
    }

    // 방장만 팀 삭제 가능
    if (room.players[0].id !== socket.id) {
      socket.emit("setTeamsError", { message: "방장만 팀을 삭제할 수 있습니다." });
      return;
    }

    if (!room.teamMode) {
      socket.emit("setTeamsError", { message: "팀전 모드가 활성화되지 않았습니다." });
      return;
    }

    // 최소 2개 팀 유지
    if (room.teams && room.teams.length <= 2) {
      socket.emit("setTeamsError", { message: "최소 2개 팀은 유지해야 합니다." });
      return;
    }

    // 팀 삭제
    const teamIndex = room.teams.findIndex(t => t.id === teamId);
    if (teamIndex === -1) {
      socket.emit("setTeamsError", { message: "팀을 찾을 수 없습니다." });
      return;
    }

    // 해당 팀에 속한 플레이어들의 팀 배치 해제
    room.players.forEach((player) => {
      if (player.teamId === teamId) {
        player.teamId = null;
      }
    });

    room.teams.splice(teamIndex, 1);

    io.to(roomId).emit("roomUpdated", room);
    console.log(`방 ${roomId}에서 팀 삭제됨: 팀 ${teamId}`);
  });

  // 이어달리기 모드 설정 (방장만 가능)
  socket.on("setRelayMode", ({ roomId, relayMode }) => {
    const room = rooms.get(roomId);
    if (!room || room.players[0].id !== socket.id) {
      socket.emit("relayModeError", { message: "권한이 없거나 방을 찾을 수 없습니다." });
      return;
    }
    
    // 클릭 대결 또는 사과배틀이고 팀전 모드일 때만 설정 가능
    if ((room.selectedGame !== "clickBattle" && room.selectedGame !== "appleBattle") || !room.teamMode) {
      socket.emit("relayModeError", { message: "이어달리기 모드는 팀전 모드에서만 사용 가능합니다." });
      return;
    }
    
    room.relayMode = relayMode === true;
    io.to(roomId).emit("roomUpdated", room);
    console.log(`방 ${roomId}의 이어달리기 모드: ${room.relayMode ? "활성화" : "비활성화"}`);
  });

  // 플레이어 팀 배치/변경
  socket.on("assignPlayerToTeam", ({ roomId, playerId, teamId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("assignTeamError", { message: "방을 찾을 수 없습니다." });
      return;
    }

    if (!room.teamMode) {
      socket.emit("assignTeamError", { message: "팀 모드가 활성화되지 않았습니다." });
      return;
    }

    // 방장이거나 본인만 팀 배치 가능
    const isHost = room.players[0].id === socket.id;
    const isSelf = playerId === socket.id;
    
    if (!isHost && !isSelf) {
      socket.emit("assignTeamError", { message: "자신의 팀만 변경할 수 있습니다." });
      return;
    }

    const player = room.players.find((p) => p.id === playerId);
    if (!player) {
      socket.emit("assignTeamError", { message: "플레이어를 찾을 수 없습니다." });
      return;
    }

    // teamId가 null이거나 유효한 팀 ID인지 확인
    if (teamId !== null && !room.teams.find((t) => t.id === teamId)) {
      socket.emit("assignTeamError", { message: "유효하지 않은 팀입니다." });
      return;
    }

    player.teamId = teamId;
    io.to(roomId).emit("roomUpdated", room);
    console.log(`플레이어 ${playerId}를 팀 ${teamId || "없음"}에 배치함 (방 ${roomId})`);
  });
}

module.exports = { setupRoomHandlers, getRoomList };
