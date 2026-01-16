import React, { useEffect, useState } from "react";
import io from "socket.io-client";

// 서버 주소 (아까 만든 Node.js 서버 포트)
const socket = io.connect("http://localhost:4000");

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);

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

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h1>🎮 Wagle 미니게임 사이트 </h1>
      <div style={{ padding: "20px", border: "1px solid #ccc", display: "inline-block" }}>
        <h3>서버 연결 상태: {isConnected ? "🟢 연결됨" : "🔴 연결 안 됨"}</h3>
        <p>나의 고유 소켓 ID: {socket.id || "연결 중..."}</p>
      </div>
      <p>이제 여기서 방을 만들고 사람들을 초대할 거예요!</p>
    </div>
  );
}

export default App;