function setupChatHandlers(socket, io, rooms) {
  // 채팅 메시지 전송 (전체 채팅)
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
      type: "room", // 전체 채팅
    };

    io.to(roomId).emit("messageReceived", messageData);
    console.log(`채팅 메시지: ${roomId} - ${player.name}: ${trimmedMessage}`);
  });

  // 팀 채팅 메시지 전송
  socket.on("sendTeamMessage", ({ roomId, message, teamId }) => {
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

    // 팀전 모드가 아니거나 팀이 없는 경우 거부
    if (!room.teamMode || !room.teams || room.teams.length === 0) {
      socket.emit("messageError", { message: "팀전 모드가 아닙니다." });
      return;
    }

    // 플레이어가 해당 팀에 속해있는지 확인
    if (player.teamId !== teamId) {
      socket.emit("messageError", { message: "해당 팀의 멤버가 아닙니다." });
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

    // 해당 팀의 플레이어들만 찾기
    const teamPlayers = room.players.filter((p) => p.teamId === teamId);
    const teamPlayerIds = teamPlayers.map((p) => p.id);

    // 메시지 데이터 생성
    const team = room.teams.find((t) => t.id === teamId);
    const messageData = {
      id: `team_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      roomId: roomId,
      playerId: socket.id,
      playerName: player.name,
      playerPhoto: player.photo || null,
      message: trimmedMessage,
      timestamp: Date.now(),
      type: "team", // 팀 채팅
      teamId: teamId,
      teamName: team ? team.name : null,
      teamColor: team ? team.color : null,
    };

    // 해당 팀의 플레이어들에게만 메시지 전송
    teamPlayerIds.forEach((playerId) => {
      io.to(playerId).emit("messageReceived", messageData);
    });

    console.log(`팀 채팅 메시지: ${roomId} - 팀 ${teamId} - ${player.name}: ${trimmedMessage}`);
  });
}

module.exports = { setupChatHandlers };
