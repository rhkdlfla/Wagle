import React, { useEffect, useState, useRef } from "react";
import { Routes, Route, useParams, useNavigate } from "react-router-dom";
import io from "socket.io-client";
import Hub from "./components/Hub";
import Lobby from "./components/Lobby";
import Login from "./components/Login";
import ClickBattle from "./components/ClickBattle";
import AppleBattle from "./components/AppleBattle";
import "./App.css";

// 서버 주소 (nginx를 통해 /api 경로로 접근)
const SERVER_URL = process.env.REACT_APP_SERVER_URL || "/api";
const socket = io.connect("", {
  path: "/socket.io/",
  withCredentials: true,
});

// 메인 게임 컴포넌트 (인증 필요)
function GameApp({ socket, user, onLogout }) {
  const navigate = useNavigate();

  const handleJoinRoom = (room) => {
    navigate(`/room/${room.id}`);
  };

  const handleLeaveRoom = () => {
    navigate("/");
  };

  const handleStartGame = (room) => {
    navigate(`/room/${room.id}/game`);
  };

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
        <button onClick={onLogout} className="logout-button">
          로그아웃
        </button>
      </div>

      <Routes>
        <Route
          path="/"
          element={<Hub socket={socket} onJoinRoom={handleJoinRoom} user={user} />}
        />
        <Route
          path="/room/:roomId"
          element={
            <RoomLobby
              socket={socket}
              onLeaveRoom={handleLeaveRoom}
              onStartGame={handleStartGame}
              user={user}
            />
          }
        />
        <Route
          path="/room/:roomId/game"
          element={<RoomGame socket={socket} user={user} />}
        />
      </Routes>
    </div>
  );
}

// 방 로비 컴포넌트
function RoomLobby({ socket, onLeaveRoom, onStartGame, user }) {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasJoinedRef = useRef(false);
  const currentRoomIdRef = useRef(null);

  useEffect(() => {
    // 이벤트 리스너는 항상 등록 (중복 등록 방지를 위해 먼저 제거)
    socket.off("joinedRoom");
    socket.off("joinRoomError");
    socket.off("roomUpdated");
    socket.off("gameStarted");
    socket.off("leftRoom");

    socket.on("joinedRoom", (roomData) => {
      setRoom(roomData);
      setIsLoading(false);
    });

    socket.on("joinRoomError", ({ message }) => {
      alert(message);
      navigate("/");
    });

    socket.on("roomUpdated", (updatedRoom) => {
      setRoom(updatedRoom);
    });

    socket.on("gameStarted", ({ room: gameRoom }) => {
      setRoom(gameRoom);
      onStartGame(gameRoom);
    });

    socket.on("leftRoom", () => {
      onLeaveRoom();
    });

    // roomId가 변경되면 리셋하고 입장 시도
    if (currentRoomIdRef.current !== roomId) {
      hasJoinedRef.current = false;
      currentRoomIdRef.current = roomId;
      setIsLoading(true);
    }

    // 이미 입장 시도를 했다면 다시 호출하지 않음
    if (!hasJoinedRef.current) {
      // 방 입장 시도
      hasJoinedRef.current = true;
      socket.emit("joinRoom", { roomId });
    }

    return () => {
      socket.off("joinedRoom");
      socket.off("joinRoomError");
      socket.off("roomUpdated");
      socket.off("gameStarted");
      socket.off("leftRoom");
    };
  }, [socket, roomId, navigate, onLeaveRoom, onStartGame]);

  if (isLoading) {
    return (
      <div className="connection-status">
        <h2>방 입장 중...</h2>
        <p>잠시만 기다려주세요.</p>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="connection-status">
        <h2>방을 찾을 수 없습니다.</h2>
        <button onClick={() => navigate("/")}>홈으로 돌아가기</button>
      </div>
    );
  }

  return (
    <Lobby
      socket={socket}
      room={room}
      onLeaveRoom={onLeaveRoom}
      onStartGame={onStartGame}
      user={user}
    />
  );
}

// 게임 컴포넌트
function RoomGame({ socket, user }) {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 게임 상태 요청
    if (roomId) {
      socket.emit("getGameState", { roomId });
    }

    socket.on("gameStarted", ({ room: gameRoom }) => {
      setRoom(gameRoom);
      setIsLoading(false);
    });

    socket.on("roomUpdated", (updatedRoom) => {
      setRoom(updatedRoom);
    });

    return () => {
      socket.off("gameStarted");
      socket.off("roomUpdated");
    };
  }, [socket, roomId]);

  if (isLoading || !room) {
    return (
      <div className="connection-status">
        <h2>게임 로딩 중...</h2>
        <p>잠시만 기다려주세요.</p>
      </div>
    );
  }

  const handleBackToLobby = () => {
    navigate(`/room/${roomId}`);
  };

  // 게임 타입에 따라 다른 컴포넌트 렌더링
  if (room.selectedGame === "appleBattle") {
    return (
      <AppleBattle
        socket={socket}
        room={room}
        onBackToLobby={handleBackToLobby}
      />
    );
  }

  return (
    <ClickBattle
      socket={socket}
      room={room}
      onBackToLobby={handleBackToLobby}
    />
  );
}

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
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
    } catch (error) {
      console.error("로그아웃 오류:", error);
    }
  };

  const handleGuestLogin = (guestInfo) => {
    setUser(guestInfo);
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

  return <GameApp socket={socket} user={user} onLogout={handleLogout} />;
}

export default App;