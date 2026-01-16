import React, { useEffect, useState } from "react";
import io from "socket.io-client";
import Hub from "./components/Hub";
import Lobby from "./components/Lobby";
import Login from "./components/Login";
import "./App.css";

// 서버 주소 (nginx를 통해 /api 경로로 접근)
const SERVER_URL = process.env.REACT_APP_SERVER_URL || "/api";
const socket = io.connect("", {
  path: "/socket.io/",
  withCredentials: true,
});

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [currentView, setCurrentView] = useState("hub"); // 'hub' | 'lobby' | 'game'
  const [currentRoom, setCurrentRoom] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // 사용자 인증 상태 확인
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // 먼저 로컬 스토리지에서 게스트 정보 확인
        const guestUser = localStorage.getItem("guestUser");
        if (guestUser) {
          const guestInfo = JSON.parse(guestUser);
          setUser(guestInfo);
          setIsLoading(false);
          return;
        }

        // 게스트가 없으면 서버에서 OAuth 사용자 확인
        const response = await fetch(`${SERVER_URL}/auth/user`, {
          credentials: "include",
        });
        const data = await response.json();
        if (data.authenticated) {
          setUser(data.user);
        }
      } catch (error) {
        console.error("인증 확인 오류:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();

    // 인증 성공 페이지에서 리다이렉트된 경우
    if (window.location.pathname === "/auth/success") {
      window.history.replaceState({}, "", "/");
      checkAuth();
    }
  }, []);

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

  // 사용자 정보가 변경되면 소켓에 전송
  useEffect(() => {
    if (user && socket.connected) {
      socket.emit("setUser", user);
    }
  }, [user, socket]);

  const handleLogout = async () => {
    try {
      // 게스트인 경우 로컬 스토리지에서 삭제
      if (user && user.provider === "guest") {
        localStorage.removeItem("guestUser");
      } else {
        // OAuth 사용자인 경우 서버에 로그아웃 요청
        await fetch(`${SERVER_URL}/auth/logout`, {
          credentials: "include",
        });
      }
      setUser(null);
      setCurrentView("hub");
      setCurrentRoom(null);
    } catch (error) {
      console.error("로그아웃 오류:", error);
    }
  };

  const handleGuestLogin = (guestInfo) => {
    setUser(guestInfo);
  };

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

  if (isLoading) {
    return (
      <div className="connection-status">
        <h2>로딩 중...</h2>
        <p>잠시만 기다려주세요.</p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="connection-status">
        <h2>서버에 연결 중...</h2>
        <p>잠시만 기다려주세요.</p>
      </div>
    );
  }

  // 로그인하지 않은 경우 로그인 화면 표시
  if (!user) {
    return <Login onLoginSuccess={handleGuestLogin} />;
  }

  return (
    <div className="App">
      <div className="user-header">
        <div className="user-info">
          {user.photo && (
            <img src={user.photo} alt={user.name} className="user-avatar" />
          )}
          <span className="user-name">{user.name}</span>
          <span className="user-provider">
            {user.provider === "google" ? "🔵" : user.provider === "kakao" ? "🟡" : "👤"}
          </span>
          {user.provider === "guest" && (
            <span className="guest-badge">게스트</span>
          )}
        </div>
        <button onClick={handleLogout} className="logout-button">
          로그아웃
        </button>
      </div>

      {currentView === "hub" && (
        <Hub socket={socket} onJoinRoom={handleJoinRoom} user={user} />
      )}
      {currentView === "lobby" && currentRoom && (
        <Lobby
          socket={socket}
          room={currentRoom}
          onLeaveRoom={handleLeaveRoom}
          onStartGame={handleStartGame}
          user={user}
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