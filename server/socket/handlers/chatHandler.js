function setupChatHandlers(socket, io, rooms) {
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
}

module.exports = { setupChatHandlers };
