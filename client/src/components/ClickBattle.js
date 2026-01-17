import React, { useEffect, useState, useRef } from "react";
import "./ClickBattle.css";

function ClickBattle({ socket, room, onBackToLobby }) {
  const [clicks, setClicks] = useState({});
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [results, setResults] = useState(null);
  const [myClicks, setMyClicks] = useState(0);
  const timerIntervalRef = useRef(null);

  useEffect(() => {
    // 게임 시작 수신
    const handleGameStarted = ({ gameState, room: gameRoom }) => {
      console.log("ClickBattle: 게임 시작 이벤트 수신", { gameState, gameRoom });
      if (!gameState) {
        console.error("gameState가 없습니다!");
        return;
      }
      
      setIsActive(true);
      setTimeRemaining(gameState.duration);
      setClicks({});
      setResults(null);
      setMyClicks(0);
      
      // 기존 타이머가 있으면 정리
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      
      // 타이머 시작 (setInterval 사용)
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - gameState.startTime;
        const remaining = Math.max(0, gameState.duration - elapsed);
        setTimeRemaining(remaining);
        
        if (remaining <= 0) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }, 100); // 100ms마다 업데이트
    };
    
    socket.on("gameStarted", handleGameStarted);

    // 클릭 업데이트 수신
    socket.on("clickUpdate", ({ updates, timeRemaining: remaining }) => {
      const newClicks = {};
      updates.forEach((update) => {
        newClicks[update.id] = update.clicks;
      });
      setClicks(newClicks);
      setTimeRemaining(remaining);
      
      // 내 클릭 수 업데이트
      const myUpdate = updates.find((u) => u.id === socket.id);
      if (myUpdate) {
        setMyClicks(myUpdate.clicks);
      }
    });

    // 게임 종료 수신
    socket.on("gameEnded", ({ results: gameResults }) => {
      console.log("ClickBattle: 게임 종료 이벤트 수신", gameResults);
      setIsActive(false);
      setResults(gameResults);
      // 타이머 정리
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    });

    return () => {
      socket.off("gameStarted");
      socket.off("clickUpdate");
      socket.off("gameEnded");
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [socket]);

  // 컴포넌트 마운트 시 게임 상태 확인
  useEffect(() => {
    console.log("ClickBattle 컴포넌트 마운트됨, room:", room);
    // 컴포넌트가 마운트될 때 게임이 이미 시작되었을 수 있으므로
    // 서버에 현재 게임 상태 요청
    if (room && room.id) {
      console.log("게임 상태 요청:", room.id);
      socket.emit("getGameState", { roomId: room.id });
    }
  }, [room, socket]);

  const handleClick = () => {
    if (isActive && timeRemaining > 0) {
      socket.emit("gameClick", { roomId: room.id });
    }
  };

  const getPlayerClicks = (playerId) => {
    return clicks[playerId] || 0;
  };

  const formatTime = (ms) => {
    return (ms / 1000).toFixed(1);
  };

  return (
    <div className="click-battle-container">
      <div className="game-header">
        <h1>🎯 클릭 대결!</h1>
        <p>일정 시간 동안 최대한 많이 클릭하세요!</p>
      </div>

      {!isActive && !results && (
        <div className="waiting-screen">
          <h2>게임 준비 중...</h2>
          <p>곧 시작됩니다!</p>
        </div>
      )}

      {isActive && (
        <div className="game-screen">
          <div className="timer">
            <div className="timer-circle">
              <span className="timer-text">{formatTime(timeRemaining)}</span>
            </div>
          </div>

          <div className="click-area" onClick={handleClick}>
            <div className="click-button">
              <span className="click-icon">👆</span>
              <span className="click-text">클릭!</span>
              <span className="click-count">{myClicks}</span>
            </div>
          </div>

          <div className="leaderboard">
            <h3>순위</h3>
            <div className="player-scores">
              {room.players
                .map((player) => ({
                  ...player,
                  clicks: getPlayerClicks(player.id),
                }))
                .sort((a, b) => b.clicks - a.clicks)
                .map((player, index) => (
                  <div
                    key={player.id}
                    className={`player-score ${player.id === socket.id ? "me" : ""} ${
                      index === 0 ? "first" : ""
                    }`}
                  >
                    <div className="rank">{index + 1}</div>
                    {player.photo && (
                      <img
                        src={player.photo}
                        alt={player.name}
                        className="player-avatar"
                      />
                    )}
                    <div className="player-info">
                      <div className="player-name">
                        {player.name}
                        {player.id === socket.id && <span className="me-badge">나</span>}
                      </div>
                      <div className="player-clicks">{player.clicks}회</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {results && (
        <div className="results-screen">
          <h2>게임 종료! 🎉</h2>
          <div className="results-list">
            {results.map((result, index) => (
              <div
                key={result.id}
                className={`result-item ${result.isWinner ? "winner" : ""} ${
                  result.id === socket.id ? "me" : ""
                }`}
              >
                <div className="result-rank">
                  {index === 0 && result.isWinner ? "👑" : index + 1}
                </div>
                {result.photo && (
                  <img
                    src={result.photo}
                    alt={result.name}
                    className="result-avatar"
                  />
                )}
                <div className="result-info">
                  <div className="result-name">
                    {result.name}
                    {result.isWinner && <span className="winner-badge">승자!</span>}
                    {result.id === socket.id && <span className="me-badge">나</span>}
                  </div>
                  <div className="result-clicks">{result.score || 0}회 클릭</div>
                </div>
              </div>
            ))}
          </div>
          <div className="result-actions">
            <button onClick={onBackToLobby} className="back-button">
              로비로 돌아가기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClickBattle;
