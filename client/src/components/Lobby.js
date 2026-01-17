import React, { useEffect, useState, useRef } from "react";
import { useLocation } from "react-router-dom";
import "./Lobby.css";

// 게임 목록
const GAMES = [
  {
    id: "clickBattle",
    name: "클릭 대결",
    description: "30초 동안 최대한 많이 클릭하세요!",
    icon: "👆",
    minPlayers: 1,
  },
  {
    id: "appleBattle",
    name: "사과배틀",
    description: "합이 10이 되는 사과를 선택해 땅따먹기!",
    icon: "🍎",
    minPlayers: 1,
  },
];

function Lobby({ socket, room, onLeaveRoom, onStartGame, user }) {
  const [playerName, setPlayerName] = useState("");
  const [currentRoom, setCurrentRoom] = useState(room);
  const [selectedGame, setSelectedGame] = useState(
    currentRoom?.selectedGame || GAMES[0].id
  );
  const [gameDuration, setGameDuration] = useState(30); // 클릭 배틀 기본 30초
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const messagesEndRef = useRef(null);
  const location = useLocation();
  const isHost = currentRoom?.players[0]?.id === socket.id;

  useEffect(() => {
    // 방 업데이트 수신
    socket.on("roomUpdated", (updatedRoom) => {
      setCurrentRoom(updatedRoom);
      if (updatedRoom.selectedGame) {
        setSelectedGame(updatedRoom.selectedGame);
      }
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

    // 채팅 메시지 수신
    socket.on("messageReceived", (messageData) => {
      setMessages((prev) => [...prev, messageData]);
    });

    // 메시지 에러 수신
    socket.on("messageError", ({ message }) => {
      console.error("채팅 에러:", message);
    });

    return () => {
      socket.off("roomUpdated");
      socket.off("gameStarted");
      socket.off("leftRoom");
      socket.off("messageReceived");
      socket.off("messageError");
    };
  }, [socket, onLeaveRoom, onStartGame]);

  // 메시지 목록이 업데이트될 때마다 스크롤을 맨 아래로
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleUpdateName = () => {
    if (playerName.trim() !== "") {
      socket.emit("updatePlayerName", {
        roomId: currentRoom.id,
        playerName: playerName.trim(),
      });
      setPlayerName("");
    }
  };

  const handleGameSelect = (gameId) => {
    if (isHost) {
      setSelectedGame(gameId);
      socket.emit("selectGame", {
        roomId: currentRoom.id,
        gameId: gameId,
      });
    }
  };

  const handleStartGame = () => {
    if (isHost && currentRoom.players.length > 0) {
      const duration = selectedGame === "clickBattle" ? gameDuration * 1000 : undefined;
      socket.emit("startGame", {
        roomId: currentRoom.id,
        gameType: selectedGame,
        duration: duration,
      });
    }
  };

  // 시간을 초 단위로 포맷팅
  const formatDuration = (seconds) => {
    if (seconds < 60) {
      return `${seconds}초`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 
      ? `${minutes}분 ${remainingSeconds}초` 
      : `${minutes}분`;
  };

  const handleLeaveRoom = () => {
    socket.emit("leaveRoom", { roomId: currentRoom.id });
  };

  const handleCopyInviteLink = async () => {
    const inviteLink = `${window.location.origin}${location.pathname}`;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // 클립보드 API가 지원되지 않는 경우 대체 방법
      const textArea = document.createElement("textarea");
      textArea.value = inviteLink;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        alert("링크 복사에 실패했습니다. 수동으로 복사해주세요: " + inviteLink);
      }
      document.body.removeChild(textArea);
    }
  };

  const handleSendMessage = () => {
    if (messageInput.trim() && currentRoom) {
      socket.emit("sendMessage", {
        roomId: currentRoom.id,
        message: messageInput.trim(),
      });
      setMessageInput("");
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
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
        <button
          onClick={handleCopyInviteLink}
          className="invite-link-button"
          title="초대 링크 복사"
        >
          {copied ? "✓ 복사됨!" : "🔗 초대 링크 복사"}
        </button>
      </div>

      <div className="lobby-content">
        <div className="chat-section">
          <h2>💬 채팅</h2>
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="chat-empty">아직 메시지가 없습니다.</div>
            ) : (
              messages.map((msg) => {
                const isMyMessage = msg.playerId === socket.id;
                return (
                  <div
                    key={msg.id}
                    className={`chat-message ${isMyMessage ? "my-message" : ""}`}
                  >
                    {!isMyMessage && (
                      <div className="message-sender">
                        {msg.playerPhoto ? (
                          <img
                            src={msg.playerPhoto}
                            alt={msg.playerName}
                            className="message-avatar"
                          />
                        ) : (
                          <div className="message-avatar-placeholder">
                            {msg.playerName.charAt(0)}
                          </div>
                        )}
                        <span className="message-player-name">{msg.playerName}</span>
                      </div>
                    )}
                    <div className="message-content">
                      <p>{msg.message}</p>
                      <span className="message-time">{formatTime(msg.timestamp)}</span>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="chat-input-group">
            <input
              type="text"
              placeholder="메시지를 입력하세요..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              maxLength={500}
            />
            <button onClick={handleSendMessage} disabled={!messageInput.trim()}>
              전송
            </button>
          </div>
        </div>

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

        <div className="game-selection-section">
          <h2>게임 선택</h2>
          <div className="games-list">
            {GAMES.map((game) => (
              <div
                key={game.id}
                className={`game-item ${
                  selectedGame === game.id ? "selected" : ""
                } ${!isHost ? "disabled" : ""}`}
                onClick={() => isHost && handleGameSelect(game.id)}
              >
                <div className="game-icon">{game.icon}</div>
                <div className="game-info">
                  <div className="game-name">{game.name}</div>
                  <div className="game-description">{game.description}</div>
                </div>
                {selectedGame === game.id && (
                  <div className="selected-badge">✓</div>
                )}
              </div>
            ))}
          </div>
          
          {/* 클릭 배틀 시간 조절 UI */}
          {selectedGame === "clickBattle" && isHost && (
            <div className="game-duration-section">
              <h3>⏱️ 게임 시간 설정</h3>
              <div className="duration-controls">
                <label htmlFor="duration-slider">
                  시간: <strong>{formatDuration(gameDuration)}</strong>
                </label>
                <input
                  id="duration-slider"
                  type="range"
                  min="5"
                  max="300"
                  step="5"
                  value={gameDuration}
                  onChange={(e) => setGameDuration(parseInt(e.target.value))}
                  className="duration-slider"
                />
                <div className="duration-presets">
                  <button
                    onClick={() => setGameDuration(10)}
                    className={gameDuration === 10 ? "active" : ""}
                  >
                    10초
                  </button>
                  <button
                    onClick={() => setGameDuration(30)}
                    className={gameDuration === 30 ? "active" : ""}
                  >
                    30초
                  </button>
                  <button
                    onClick={() => setGameDuration(60)}
                    className={gameDuration === 60 ? "active" : ""}
                  >
                    1분
                  </button>
                  <button
                    onClick={() => setGameDuration(120)}
                    className={gameDuration === 120 ? "active" : ""}
                  >
                    2분
                  </button>
                  <button
                    onClick={() => setGameDuration(300)}
                    className={gameDuration === 300 ? "active" : ""}
                  >
                    5분
                  </button>
                </div>
              </div>
            </div>
          )}
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
