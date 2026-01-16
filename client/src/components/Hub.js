import React, { useEffect, useState } from "react";
import "./Hub.css";

function Hub({ socket, onJoinRoom, user }) {
  const [roomList, setRoomList] = useState([]);
  const [roomName, setRoomName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    // 방 목록 조회
    socket.emit("getRoomList");

    // 방 목록 업데이트 수신
    socket.on("roomList", (rooms) => {
      setRoomList(rooms);
    });

    // 방 생성 성공
    socket.on("roomCreated", (room) => {
      setIsCreating(false);
      onJoinRoom(room);
    });

    return () => {
      socket.off("roomList");
      socket.off("roomCreated");
    };
  }, [socket, onJoinRoom]);

  const handleCreateRoom = () => {
    if (roomName.trim() === "") {
      alert("방 이름을 입력해주세요!");
      return;
    }
    setIsCreating(true);
    socket.emit("createRoom", { roomName: roomName.trim(), maxPlayers });
  };

  const handleJoinRoom = (roomId) => {
    socket.emit("joinRoom", { roomId });
  };

  useEffect(() => {
    // 방 입장 성공
    socket.on("joinedRoom", (room) => {
      onJoinRoom(room);
    });

    // 방 입장 실패
    socket.on("joinRoomError", ({ message }) => {
      alert(message);
    });

    return () => {
      socket.off("joinedRoom");
      socket.off("joinRoomError");
    };
  }, [socket, onJoinRoom]);

  return (
    <div className="hub-container">
      <div className="hub-header">
        <h1>🎮 Wagle 게임 허브</h1>
        <p>방을 만들거나 입장하여 게임을 시작하세요!</p>
      </div>

      <div className="hub-content">
        <div className="create-room-section">
          <h2>방 만들기</h2>
          <div className="create-room-form">
            <input
              type="text"
              placeholder="방 이름을 입력하세요"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              maxLength={20}
            />
            <div className="max-players-input">
              <label>최대 인원:</label>
              <select
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
              >
                <option value={2}>2명</option>
                <option value={3}>3명</option>
                <option value={4}>4명</option>
              </select>
            </div>
            <button
              onClick={handleCreateRoom}
              disabled={isCreating}
              className="create-button"
            >
              {isCreating ? "생성 중..." : "방 만들기"}
            </button>
          </div>
        </div>

        <div className="room-list-section">
          <h2>방 목록</h2>
          <div className="room-list">
            {roomList.length === 0 ? (
              <div className="no-rooms">생성된 방이 없습니다.</div>
            ) : (
              roomList.map((room) => (
                <div key={room.id} className="room-item">
                  <div className="room-info">
                    <div className="room-name">{room.name}</div>
                    <div className="room-details">
                      <span>
                        👥 {room.playerCount}/{room.maxPlayers}
                      </span>
                      <span className={`room-status ${room.status}`}>
                        {room.status === "waiting" ? "대기 중" : "게임 중"}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleJoinRoom(room.id)}
                    disabled={
                      room.playerCount >= room.maxPlayers ||
                      room.status === "playing"
                    }
                    className="join-button"
                  >
                    {room.playerCount >= room.maxPlayers
                      ? "만원"
                      : room.status === "playing"
                      ? "게임 중"
                      : "입장"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Hub;
