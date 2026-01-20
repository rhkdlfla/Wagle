import React, { useEffect, useState, useRef } from "react";
import GameScoreboard from "./GameScoreboard";
import GameResults from "./GameResults";
import "./TypingRacing.css";

function TypingRacing({ socket, room, onBackToLobby }) {
  const [gameState, setGameState] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [results, setResults] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const canvasRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const isHost = room?.players?.[0]?.id === socket.id;

  // 8자 루프 경로 계산 (Lemniscate of Bernoulli)
  const getEightLoopPosition = (progress, width, height) => {
    // progress는 0~1 사이
    const t = progress * 2 * Math.PI;
    const scale = Math.min(width, height) * 0.3;
    const x = scale * Math.cos(t) / (1 + Math.sin(t) * Math.sin(t));
    const y = scale * Math.sin(t) * Math.cos(t) / (1 + Math.sin(t) * Math.sin(t));
    return {
      x: x + width / 2,
      y: y + height / 2
    };
  };

  // 미니맵 그리기
  const drawMinimap = () => {
    const canvas = canvasRef.current;
    if (!canvas || !gameState) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // 캔버스 초기화
    ctx.clearRect(0, 0, width, height);

    // 8자 루프 경로 그리기
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let t = 0; t <= 2 * Math.PI; t += 0.1) {
      const pos = getEightLoopPosition(t / (2 * Math.PI), width, height);
      if (t === 0) {
        ctx.moveTo(pos.x, pos.y);
      } else {
        ctx.lineTo(pos.x, pos.y);
      }
    }
    ctx.stroke();

    // 아이템 박스 표시
    if (gameState.itemBoxes) {
      ctx.fillStyle = '#fbbf24';
      gameState.itemBoxes.forEach((boxPos) => {
        const pos = getEightLoopPosition(boxPos, width, height);
        ctx.fillRect(pos.x - 5, pos.y - 5, 10, 10);
      });
    }

    // 플레이어 위치 표시
    if (gameState.playerProgress && room?.players) {
      room.players.forEach((player, index) => {
        const progress = gameState.playerProgress[player.id] || 0;
        const pos = getEightLoopPosition(progress, width, height);
        
        // 플레이어 색상
        const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
        const color = colors[index % colors.length];
        
        ctx.fillStyle = player.id === socket.id ? '#ffffff' : color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 8, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // 플레이어 이름 표시
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.name.substring(0, 3), pos.x, pos.y - 12);
      });
    }
  };

  useEffect(() => {
    // 미니맵 그리기
    if (gameState) {
      drawMinimap();
    }
  }, [gameState]);

  useEffect(() => {
    // 게임 시작 수신
    const handleGameStarted = ({ gameState: gs, room: gameRoom }) => {
      if (!gs || gs.gameType !== "typingRacing") return;
      
      setIsActive(true);
      setGameState(null);
      setResults(null);
      
      // 타이머 시작
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - gs.startTime;
        const remaining = Math.max(0, (gs.duration || 120000) - elapsed);
        setTimeRemaining(remaining);
        
        if (remaining <= 0) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }, 100);
    };
    
    socket.on("gameStarted", handleGameStarted);

    // 게임 업데이트 수신
    socket.on("typingRacingUpdate", (data) => {
      setGameState(data);
    });

    // 아이템 획득 알림
    socket.on("itemReceived", ({ item }) => {
      console.log("아이템 획득:", item);
    });

    // 플레이어 완주 알림
    socket.on("playerFinished", ({ playerId, playerName, rank }) => {
      console.log(`${playerName}이(가) ${rank}등으로 완주했습니다!`);
    });

    // 게임 종료 수신
    socket.on("gameEnded", ({ results: gameResults }) => {
      setIsActive(false);
      setResults(gameResults);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    });

    return () => {
      socket.off("gameStarted", handleGameStarted);
      socket.off("typingRacingUpdate");
      socket.off("itemReceived");
      socket.off("playerFinished");
      socket.off("gameEnded");
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [socket]);

  // 키보드 입력 직접 감지
  useEffect(() => {
    if (!isActive || !gameState || results) return;

    const handleKeyDown = (e) => {
      // 입력 필드에 포커스가 있으면 무시 (다른 입력 방지)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      const char = e.key;
      
      // 특수 키는 무시
      if (char.length > 1 && char !== 'Backspace') {
        return;
      }

      // 백스페이스는 무시 (타이핑 게임에서는 필요 없음)
      if (char === 'Backspace') {
        e.preventDefault();
        return;
      }

      // 한 글자만 처리
      if (char.length === 1) {
        e.preventDefault();
        
        // 아이템 활성화 모드가 아닌 경우
        if (!gameState.activeItems || !gameState.activeItems[socket.id]) {
          socket.emit("gameAction", {
            roomId: room.id,
            action: "typing",
            data: { char }
          });
        } else {
          // 아이템 단어 타이핑 모드
          socket.emit("gameAction", {
            roomId: room.id,
            action: "typing",
            data: { char }
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, gameState, results, socket, room]);

  // 아이템 활성화
  const activateItem = (itemType) => {
    socket.emit("gameAction", {
      roomId: room.id,
      action: "activateItem",
      data: { itemType }
    });
  };

  const handleEndGame = () => {
    if (isHost) {
      socket.emit("endGame", { roomId: room.id });
    }
  };

  const handleLeaveGame = () => {
    socket.emit("leaveRoom", { roomId: room.id });
    onBackToLobby();
  };

  if (results) {
    return (
      <div className="typing-racing-container">
        <div className="game-header">
          <div className="game-header-content">
            <div>
              <h1>⌨️ 타이핑 레이싱</h1>
              <p>게임 결과</p>
            </div>
            <div className="game-header-actions">
              <button onClick={onBackToLobby} className="leave-game-button">
                🚪 로비로
              </button>
            </div>
          </div>
        </div>
        <GameResults 
          results={results} 
          teams={room.teams}
          myPlayerId={socket.id}
          teamMode={room.teamMode}
        />
      </div>
    );
  }

  if (!isActive || !gameState) {
    return (
      <div className="typing-racing-container">
        <div className="waiting-message">게임 시작을 기다리는 중...</div>
      </div>
    );
  }

  const myProgress = gameState.playerProgress?.[socket.id] || 0;
  const myPosition = gameState.playerPosition?.[socket.id] || 0;
  const myItems = gameState.playerItems?.[socket.id] || [];
  const activeItem = gameState.activeItems?.[socket.id];
  const activeItemWord = activeItem ? gameState.itemWords?.[activeItem] : null;
  const itemTyping = gameState.playerItemTyping?.[socket.id] || '';

  return (
    <div className="typing-racing-container">
      <div className="game-header">
        <div className="game-header-content">
          <div>
            <h1>⌨️ 타이핑 레이싱</h1>
            <p>빠르고 정확하게 타이핑해서 1등에 도달하세요!</p>
          </div>
          <div className="game-header-actions">
            {isHost && isActive && (
              <button onClick={handleEndGame} className="end-game-button">
                🛑 게임 종료
              </button>
            )}
            <button onClick={handleLeaveGame} className="leave-game-button">
              🚪 나가기
            </button>
          </div>
        </div>
      </div>

      <div className="typing-racing-main">
        {/* 왼쪽: 타이핑 영역 */}
        <div className="typing-area">
          <div className="text-display">
            {gameState.text?.split('').map((char, index) => {
              let className = 'char';
              if (index < myPosition) {
                className += ' completed';
              } else if (index === myPosition) {
                className += ' current';
              }
              return <span key={index} className={className}>{char}</span>;
            })}
          </div>

          {/* 아이템 단어 입력 모드 */}
          {activeItem && activeItemWord && (
            <div className="item-typing-mode">
              <div className="item-typing-label">
                아이템 사용: {activeItem} - "{activeItemWord}" 입력
              </div>
              <div className="item-word-display">
                {activeItemWord.split('').map((char, index) => {
                  let className = 'char';
                  if (index < itemTyping.length) {
                    className += ' completed';
                  } else if (index === itemTyping.length) {
                    className += ' current';
                  }
                  return <span key={index} className={className}>{char}</span>;
                })}
              </div>
            </div>
          )}

          <div className="typing-hint">
            키보드를 눌러서 타이핑하세요
          </div>

          {/* 진행도 표시 */}
          <div className="progress-info">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${myProgress * 100}%` }}
              />
            </div>
            <div className="progress-text">
              {myPosition} / {gameState.text?.length || 0} 글자
            </div>
          </div>

          {/* 아이템 인벤토리 */}
          <div className="items-inventory">
            <div className="items-label">보유 아이템:</div>
            <div className="items-list">
              {myItems.map((item, index) => (
                <button
                  key={index}
                  onClick={() => activateItem(item)}
                  className="item-button"
                  title={gameState.itemWords?.[item] || item}
                >
                  {getItemIcon(item)}
                </button>
              ))}
              {myItems.length === 0 && (
                <span className="no-items">아이템 없음</span>
              )}
            </div>
          </div>
        </div>

        {/* 오른쪽: 미니맵 및 순위 */}
        <div className="racing-sidebar">
          {/* 미니맵 */}
          <div className="minimap-container">
            <h3>레이스 트랙</h3>
            <canvas
              ref={canvasRef}
              width={400}
              height={300}
              className="minimap-canvas"
            />
          </div>

          {/* 순위표 */}
          <div className="rankings-container">
            <h3>순위</h3>
            <div className="rankings-list">
              {gameState.rankings?.map((player, index) => (
                <div
                  key={player.id}
                  className={`ranking-item ${player.id === socket.id ? 'me' : ''}`}
                >
                  <span className="rank-number">{index + 1}</span>
                  <span className="rank-name">{player.name}</span>
                  <span className="rank-progress">
                    {Math.floor(player.progress * 100)}%
                  </span>
                </div>
              ))}
              {gameState.finishedRankings?.map((player) => (
                <div
                  key={player.id}
                  className={`ranking-item finished ${player.id === socket.id ? 'me' : ''}`}
                >
                  <span className="rank-number">🏁 {player.rank}</span>
                  <span className="rank-name">{player.name}</span>
                  <span className="rank-progress">완주</span>
                </div>
              ))}
            </div>
          </div>

          {/* 스코어보드 */}
          <GameScoreboard
            players={room.players}
            scores={gameState.rankings?.reduce((acc, p, idx) => {
              acc[p.id] = (gameState.rankings.length - idx) * 100;
              return acc;
            }, {})}
            teams={room.teams}
            teamMode={room.teamMode}
            myPlayerId={socket.id}
          />
        </div>
      </div>
    </div>
  );
}

// 아이템 아이콘
function getItemIcon(itemType) {
  const icons = {
    'boost': '⚡',
    'slow': '🐌',
    'shield': '🛡️',
    'teleport': '✨'
  };
  return icons[itemType] || '❓';
}

export default TypingRacing;
