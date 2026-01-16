import React, { useEffect, useState } from "react";
import "./Lobby.css";

function Lobby({ socket, room, onLeaveRoom, onStartGame, user }) {
  const [playerName, setPlayerName] = useState("");
  const [currentRoom, setCurrentRoom] = useState(room);
  const isHost = currentRoom?.players[0]?.id === socket.id;

  useEffect(() => {
    // 방 업데이트 수신
    socket.on("roomUpdated", (updatedRoom) => {
      setCurrentRoom(updatedRoom);
    });

    // 게임 시작 수신
    socket.on("gameStarted", ({ room }) => {
      setCurrentRoom(room);
      onStartGame(room);
    });

    // 방 나가기 성공
    socket.on("leftRoom", () => {
      onLeaveRoom();
    });

    return () => {
      socket.off("roomUpdated");
      socket.off("gameStarted");
      socket.off("leftRoom");
    };
  }, [socket, onLeaveRoom, onStartGame]);

  const handleUpdateName = () => {
    if (playerName.trim() !== "") {
      socket.emit("updatePlayerName", {
        roomId: currentRoom.id,
        playerName: playerName.trim(),
      });
      setPlayerName("");
    }
  };

  const handleStartGame = () => {
    if (isHost && currentRoom.players.length > 0) {
      socket.emit("startGame", { roomId: currentRoom.id });
    }
  };

  const handleLeaveRoom = () => {
    socket.emit("leaveRoom", { roomId: currentRoom.id });
  };

  if (!currentRoom) {
    return null;
  }

  return (
    <div className="lobby-container">
      <div className="lobby-header">
        <h1>🎯 게임 로비</h1>
        <div className="room-info-header">
          <span className="room-name-badge">{currentRoom.name}</span>
          <span className="room-id">방 ID: {currentRoom.id.substring(0, 15)}...</span>
        </div>
      </div>

      <div className="lobby-content">
        <div className="players-section">
          <h2>플레이어 목록 ({currentRoom.players.length}/{currentRoom.maxPlayers})</h2>
          <div className="players-list">
            {currentRoom.players.map((player, index) => (
              <div
                key={player.id}
                className={`player-item ${player.id === socket.id ? "me" : ""} ${
                  index === 0 ? "host" : ""
                }`}
              >
                <div className="player-info">
                  {player.photo ? (
                    <img
                      src={player.photo}
                      alt={player.name}
                      className="player-avatar"
                    />
                  ) : (
                    <span className="player-number">{index + 1}</span>
                  )}
                  <span className="player-name">
                    {player.name}
                    {index === 0 && <span className="host-badge">👑 방장</span>}
                    {player.id === socket.id && (
                      <span className="me-badge">나</span>
                    )}
                  </span>
                </div>
              </div>
            ))}
            {Array.from({
              length: currentRoom.maxPlayers - currentRoom.players.length,
            }).map((_, index) => (
              <div key={`empty-${index}`} className="player-item empty">
                <div className="player-info">
                  <span className="player-number">
                    {currentRoom.players.length + index + 1}
                  </span>
                  <span className="player-name empty-name">대기 중...</span>
                </div>
              </div>
            ))}
          </div>

          <div className="name-input-section">
            <h3>내 이름 변경</h3>
            <div className="name-input-group">
              <input
                type="text"
                placeholder="이름을 입력하세요"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleUpdateName()}
                maxLength={15}
              />
              <button onClick={handleUpdateName}>변경</button>
            </div>
          </div>
        </div>

        <div className="lobby-actions">
          {isHost && (
            <button
              onClick={handleStartGame}
              disabled={currentRoom.players.length < 1}
              className="start-game-button"
            >
              🎮 게임 시작
            </button>
          )}
          {!isHost && (
            <div className="waiting-message">
              <p>방장이 게임을 시작할 때까지 기다려주세요...</p>
            </div>
          )}
          <button onClick={handleLeaveRoom} className="leave-button">
            방 나가기
          </button>
        </div>
      </div>
    </div>
  );
}

export default Lobby;
