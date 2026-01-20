import React, { useEffect, useState, useRef } from "react";
import "./GameChat.css";

function GameChat({ socket, room }) {
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [chatMode, setChatMode] = useState("room"); // "room" or "team"
  const chatMessagesRef = useRef(null);
  const myTeamId = room?.players?.find((p) => p.id === socket.id)?.teamId;

  useEffect(() => {
    // 채팅 메시지 수신
    socket.on("messageReceived", (messageData) => {
      setMessages((prev) => [...prev, messageData]);
    });

    socket.on("messageError", ({ message }) => {
      console.error("채팅 에러:", message);
    });

    return () => {
      socket.off("messageReceived");
      socket.off("messageError");
    };
  }, [socket]);

  // 메시지 목록이 업데이트될 때마다 맨 아래로 스크롤
  useEffect(() => {
    if (chatMessagesRef.current) {
      const el = chatMessagesRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = () => {
    if (messageInput.trim() && room) {
      if (chatMode === "team" && room.teamMode && myTeamId) {
        // 팀 채팅 전송
        socket.emit("sendTeamMessage", {
          roomId: room.id,
          message: messageInput.trim(),
          teamId: myTeamId,
        });
      } else {
        // 전체 채팅 전송
        socket.emit("sendMessage", {
          roomId: room.id,
          message: messageInput.trim(),
        });
      }
      setMessageInput("");
    }
  };

  // 표시할 메시지 필터링 (현재 채팅 모드에 따라)
  const getDisplayedMessages = () => {
    if (!room?.teamMode || chatMode === "room") {
      // 전체 채팅 모드: 모든 메시지 표시
      return messages;
    } else {
      // 팀 채팅 모드: 팀 채팅만 표시
      return messages.filter((msg) => msg.type === "team" && msg.teamId === myTeamId);
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  const displayedMessages = getDisplayedMessages();
  const myTeamName = room?.teams?.find((t) => t.id === myTeamId)?.name || "팀";

  return (
    <div className="game-chat">
      <div className="game-chat-header">
        <h3>💬 채팅</h3>
        {room?.teamMode && myTeamId && (
          <div className="chat-mode-toggle">
            <button
              className={`chat-mode-button ${chatMode === "room" ? "active" : ""}`}
              onClick={() => setChatMode("room")}
            >
              전체
            </button>
            <button
              className={`chat-mode-button ${chatMode === "team" ? "active" : ""}`}
              onClick={() => setChatMode("team")}
            >
              {myTeamName}
            </button>
          </div>
        )}
      </div>

      <div className="game-chat-messages" ref={chatMessagesRef}>
        {displayedMessages.length === 0 ? (
          <div className="chat-empty">아직 메시지가 없습니다.</div>
        ) : (
          displayedMessages.map((msg) => {
            const isMyMessage = msg.playerId === socket.id;
            const isTeamMessage = msg.type === "team";
            return (
              <div
                key={msg.id}
                className={`chat-message ${isMyMessage ? "my-message" : ""} ${
                  isTeamMessage ? "team-message" : ""
                }`}
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
                    <span className="message-player-name">
                      {msg.playerName}
                      {isTeamMessage && msg.teamName && (
                        <span className="team-badge" style={{ color: msg.teamColor }}>
                          [{msg.teamName}]
                        </span>
                      )}
                    </span>
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
      </div>

      <div className="game-chat-input-group">
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
  );
}

export default GameChat;
