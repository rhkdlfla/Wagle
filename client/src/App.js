import React, { useEffect, useState, useRef } from "react";
import { Routes, Route, useParams, useNavigate } from "react-router-dom";
import io from "socket.io-client";
import Hub from "./components/Hub";
import Lobby from "./components/Lobby";
import Login from "./components/Login";
import { getGameComponent } from "./games";
import "./App.css";

// 서버 주소 (nginx를 통해 /api 경로로 접근)
const SERVER_URL = process.env.REACT_APP_SERVER_URL || "/api";
const socket = io.connect("", {
  path: "/socket.io/",
  withCredentials: true,
});

async function updateGameResult() {
  return Promise.resolve();
}

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
    socket.off("sessionRestored");

    let sessionRestoreTimeout = null;


    socket.on("joinedRoom", (roomData) => {
      setRoom(roomData);
      setIsLoading(false);
      // 방 입장 시 세션 스토리지에 방 ID 저장
      sessionStorage.setItem("currentRoomId", roomData.id);
      // 세션 복원 플래그 제거
      sessionStorage.removeItem("waitingForSessionRestore");
    });

    socket.on("joinRoomError", ({ message }) => {
      alert(message);
      navigate("/");
    });

    // 서버측 소켓 이벤트 예시
    socket.on("game_finished", async (data) => {
      const { winnerId, loserId } = data;

      // 여기서 위에서 만든 함수를 호출
      await updateGameResult(winnerId, true);  // 승리 처리
      await updateGameResult(loserId, false);  // 패배 처리

      // 변경된 점수를 모든 클라이언트에게 알림
      io.emit("update_leaderboard");
    });

    socket.on("roomUpdated", (updatedRoom) => {
      setRoom(updatedRoom);
    });

    socket.on("gameStarted", ({ room: gameRoom }) => {
      setRoom(gameRoom);
      onStartGame(gameRoom);
    });

    socket.on("leftRoom", () => {
      // 방 나갈 때 세션 스토리지에서 방 ID 제거
      sessionStorage.removeItem("currentRoomId");
      onLeaveRoom();
    });

    // 세션 복원 확인
    socket.on("sessionRestored", ({ success, restoredRooms }) => {
      const waitingForRestore = sessionStorage.getItem("waitingForSessionRestore");
      if (waitingForRestore && success && restoredRooms && restoredRooms.includes(roomId)) {
        // 복원된 방이 현재 방이면 joinRoom 호출하지 않음 (서버에서 이미 joinedRoom 전송됨)
        hasJoinedRef.current = true;
        console.log("세션 복원으로 인해 방 입장이 처리되었습니다.");
      }
      // 타임아웃 제거
      if (sessionRestoreTimeout) {
        clearTimeout(sessionRestoreTimeout);
        sessionRestoreTimeout = null;
      }
    });

    // roomId가 변경되면 리셋하고 입장 시도
    if (currentRoomIdRef.current !== roomId) {
      hasJoinedRef.current = false;
      currentRoomIdRef.current = roomId;
      setIsLoading(true);
    }

    // 이미 입장 시도를 했다면 다시 호출하지 않음
    if (!hasJoinedRef.current) {
      // 세션 복원 대기 (500ms) - 복원이 실패하면 joinRoom 호출
      const previousSocketId = sessionStorage.getItem("socketId");
      if (previousSocketId && previousSocketId !== socket.id) {
        sessionStorage.setItem("waitingForSessionRestore", "true");
        sessionRestoreTimeout = setTimeout(() => {
          // 세션 복원 타임아웃 - 일반 입장 시도
          if (!hasJoinedRef.current) {
            hasJoinedRef.current = true;
            socket.emit("joinRoom", { roomId });
            sessionStorage.removeItem("waitingForSessionRestore");
          }
        }, 500);
      } else {
        // 세션 복원이 필요 없으면 바로 입장
        hasJoinedRef.current = true;
        socket.emit("joinRoom", { roomId });
      }
    }

    return () => {
      socket.off("joinedRoom");
      socket.off("joinRoomError");
      socket.off("roomUpdated");
      socket.off("gameStarted");
      socket.off("leftRoom");
      socket.off("sessionRestored");
      if (sessionRestoreTimeout) {
        clearTimeout(sessionRestoreTimeout);
      }
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
      // 방 상태가 waiting으로 변경되면 로비로 이동 (게임 종료된 경우)
      if (updatedRoom.status === "waiting") {
        navigate(`/room/${roomId}`);
      }
    });
    
    socket.on("gameEnded", () => {
      // 게임 종료 시 roomUpdated가 먼저 오므로 여기서는 추가 처리 불필요
      // 하지만 명시적으로 처리하기 위해 roomUpdated에서 처리
    });

    return () => {
      socket.off("gameStarted");
      socket.off("roomUpdated");
      socket.off("gameEnded");
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

  // 게임 타입에 따라 동적으로 컴포넌트 로딩
  const GameComponent = getGameComponent(room.selectedGame);
  
  if (!GameComponent) {
    return (
      <div className="connection-status">
        <h2>게임을 찾을 수 없습니다.</h2>
        <p>알 수 없는 게임 타입: {room.selectedGame}</p>
        <button onClick={handleBackToLobby}>로비로 돌아가기</button>
      </div>
    );
  }

  return (
    <GameComponent
      socket={socket}
      room={room}
      onBackToLobby={handleBackToLobby}
    />
  );
}

function App() {
  const navigate = useNavigate();
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // 사용자 인증 상태 확인
  useEffect(() => {
    const isAuthSuccessRedirect = window.location.pathname === "/auth/success";
    if (isAuthSuccessRedirect) {
      navigate("/", { replace: true });
    }

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
      
      // 세션 스토리지에서 이전 소켓 ID 확인
      const previousSocketId = sessionStorage.getItem("socketId");
      const previousUser = sessionStorage.getItem("userData");
      const previousRoomId = sessionStorage.getItem("currentRoomId");
      
      if (previousSocketId && previousSocketId !== socket.id) {
        console.log("이전 세션 복원 시도:", previousSocketId);
        // 서버에 이전 세션 복원 요청
        socket.emit("restoreSession", { previousSocketId });
      }
      
      // 현재 소켓 ID 저장
      sessionStorage.setItem("socketId", socket.id);
      
      // 사용자 정보가 있으면 저장
      if (user) {
        sessionStorage.setItem("userData", JSON.stringify(user));
        socket.emit("setUser", user);
      }
    });
    
    // 세션 복원 성공 확인
    socket.on("sessionRestored", ({ success, restoredRooms, message }) => {
      if (success) {
        console.log("세션 복원 성공!", message);
        if (restoredRooms && restoredRooms.length > 0) {
          console.log("복원된 방들:", restoredRooms);
          // 복원된 방이 있으면 세션 스토리지에 표시 (중복 입장 방지)
          sessionStorage.setItem("sessionRestored", "true");
        }
      }
    });
    
    socket.on("duplicateLogin", async ({ message }) => {
      if (message) {
        alert(message);
      } else {
        alert("이미 로그인된 계정입니다.");
      }
      
      try {
        if (user && user.provider !== "guest") {
          await fetch(`${SERVER_URL}/auth/logout`, {
            credentials: "include",
          });
        }
      } catch (error) {
        console.error("중복 로그인 처리 중 오류:", error);
      } finally {
        sessionStorage.removeItem("socketId");
        sessionStorage.removeItem("userData");
        sessionStorage.removeItem("currentRoomId");
        setUser(null);
      }
    });

    // 연결이 끊겼을 때 실행
    socket.on("disconnect", () => {
      setIsConnected(false);
      // disconnect 시 세션 스토리지는 유지 (새로고침 복원을 위해)
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("sessionRestored");
      socket.off("duplicateLogin");
    };
  }, [socket, user]);

  // 사용자 정보가 변경되면 소켓에 전송 및 세션 스토리지 저장
  useEffect(() => {
    if (user && socket.connected) {
      socket.emit("setUser", user);
      sessionStorage.setItem("userData", JSON.stringify(user));
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
      // 세션 스토리지 정리
      sessionStorage.removeItem("socketId");
      sessionStorage.removeItem("userData");
      sessionStorage.removeItem("currentRoomId");
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