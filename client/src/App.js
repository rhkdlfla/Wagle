import React, { useEffect, useState } from "react";
import io from "socket.io-client";
import Hub from "./components/Hub";
import Lobby from "./components/Lobby";
import "./App.css";

// 서버 주소 (아까 만든 Node.js 서버 포트)
const socket = io.connect("http://localhost:4000");

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [currentView, setCurrentView] = useState("hub"); // 'hub' | 'lobby' | 'game'
  const [currentRoom, setCurrentRoom] = useState(null);

  useEffect(() => {
    // 서버와 연결되었을 때 실행
    socket.on("connect", () => {
      setIsConnected(true);
      console.log("서버와 연결됨! 소켓 ID:", socket.id);
    });

    // 연결이 끊겼을 때 실행
    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
    };
  }, []);

  const handleJoinRoom = (room) => {
    setCurrentRoom(room);
    setCurrentView("lobby");
  };

  const handleLeaveRoom = () => {
    setCurrentRoom(null);
    setCurrentView("hub");
  };

  const handleStartGame = (room) => {
    setCurrentRoom(room);
    setCurrentView("game");
    // 여기서 실제 게임 화면으로 전환
    // 지금은 로비에 머물도록 함 (게임 로직은 나중에 구현)
    console.log("게임 시작!", room);
  };

  if (!isConnected) {
    return (
      <div className="connection-status">
        <h2>서버에 연결 중...</h2>
        <p>잠시만 기다려주세요.</p>
      </div>
    );
  }

  return (
    <div className="App">
      {currentView === "hub" && (
        <Hub socket={socket} onJoinRoom={handleJoinRoom} />
      )}
      {currentView === "lobby" && currentRoom && (
        <Lobby
          socket={socket}
          room={currentRoom}
          onLeaveRoom={handleLeaveRoom}
          onStartGame={handleStartGame}
        />
      )}
      {currentView === "game" && currentRoom && (
        <div className="game-container">
          <h1>🎮 게임 화면</h1>
          <p>게임 로직은 여기에 구현하세요!</p>
          <button onClick={() => setCurrentView("lobby")}>
            로비로 돌아가기
          </button>
        </div>
      )}
    </div>
  );
}

export default App;