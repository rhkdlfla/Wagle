import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import GameScoreboard from "./GameScoreboard";
import GameResults from "./GameResults";
import { handleLeaveGame as leaveGame, handleEndGame as endGame } from "../utils/gameUtils";
import "./MemoryGame.css";

function MemoryGame({ socket, room, onBackToLobby }) {
  const navigate = useNavigate();
  const [gameState, setGameState] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [results, setResults] = useState(null);
  const [myInput, setMyInput] = useState([]);

  useEffect(() => {
    // 게임 상태 요청 (이미 진행 중인 게임이 있을 수 있음)
    if (room?.id) {
      socket.emit("getGameState", { roomId: room.id });
    }

    // 게임 시작 수신
    const handleGameStarted = ({ gameState: gs, room: gameRoom }) => {
      if (!gs || gs.gameType !== "memoryGame") return;
      
      console.log("MemoryGame: 게임 시작 이벤트 수신", gs);
      setIsActive(true);
      // gameState는 memoryGameUpdate에서 설정되므로 여기서는 null로 설정하지 않음
      setResults(null);
      setMyInput([]);
    };
    
    socket.on("gameStarted", handleGameStarted);

    // 게임 업데이트 수신
    socket.on("memoryGameUpdate", (data) => {
      setGameState(data);
      // 게임 상태가 있으면 게임이 활성화된 것으로 간주
      if (data && (data.phase === 'showing' || data.phase === 'inputting' || data.phase === 'result' || data.phase === 'waiting')) {
        setIsActive(true);
      }
      if (data.playerInputs && data.playerInputs[socket.id]) {
        setMyInput(data.playerInputs[socket.id]);
      } else {
        setMyInput([]);
      }
    });

    // 게임 종료 수신
    socket.on("gameEnded", ({ results: gameResults }) => {
      console.log("MemoryGame: 게임 종료 이벤트 수신", gameResults);
      setIsActive(false);
      setResults(gameResults);
    });

    return () => {
      socket.off("gameStarted", handleGameStarted);
      socket.off("memoryGameUpdate");
      socket.off("gameEnded");
    };
  }, [socket]);

  const handleOptionClick = (option) => {
    if (!gameState || gameState.phase !== 'inputting') return;
    if (myInput.length >= gameState.sequenceLength) return; // 이미 입력 완료
    
    socket.emit("gameAction", {
      roomId: room.id,
      action: "input",
      data: { number: option }
    });
  };

  // 모드에 따른 옵션 생성
  const getOptions = () => {
    if (!gameState) return [];
    
    const mode = gameState.memoryMode || "number";
    const optionCount = gameState.memoryOptionCount || 4;
    
    if (mode === "number") {
      // 숫자 모드: 고정된 순서
      return Array.from({ length: optionCount }, (_, i) => i + 1);
    } else if (mode === "korean" || mode === "emoji") {
      // 한글/이모지 모드: 서버에서 전달된 availableOptions 사용 (문제에 나온 것들만)
      if (gameState.availableOptions && gameState.availableOptions.length > 0) {
        return gameState.availableOptions;
      }
      // fallback: 옵션이 없으면 빈 배열 반환
      return [];
    }
    return [];
  };

  if (results) {
    return (
      <div className="memory-game-container">
        <div className="game-header">
          <div className="game-header-content">
            <div>
              <h1>🧠 기억력 게임</h1>
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
          scoreUnit="라운드"
        />
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="memory-game-container">
        <div className="waiting-message">게임 시작을 기다리는 중...</div>
      </div>
    );
  }
  
  if (!gameState) {
    return (
      <div className="memory-game-container">
        <div className="waiting-message">게임 상태를 불러오는 중...</div>
      </div>
    );
  }

  const myScore = gameState.playerScores?.find(p => p.id === socket.id)?.score || 0;
  const myFailed = gameState.playerScores?.find(p => p.id === socket.id)?.failed || false;
  const isHost = room?.players?.[0]?.id === socket.id;

  const handleLeaveGame = () => leaveGame(socket, room, navigate);

  const handleEndGame = () => endGame(socket, room, { isHost });

  // 점수 데이터 변환 (GameScoreboard 형식에 맞춤)
  const scoreData = {};
  if (gameState.playerScores) {
    gameState.playerScores.forEach(p => {
      scoreData[p.id] = p.score;
    });
  }

  return (
    <div className="memory-game-container">
      <div className="game-header">
        <div className="game-header-content">
          <div>
            <h1>🧠 기억력 게임</h1>
            <p>패턴을 기억하고 순서대로 입력하세요!</p>
          </div>
          <div className="game-header-actions">
            {isHost && isActive && (
              <button onClick={handleEndGame} className="end-game-button" title="게임 종료">
                🛑 게임 종료
              </button>
            )}
            <button onClick={handleLeaveGame} className="leave-game-button" title="게임 나가기">
              🚪 나가기
            </button>
          </div>
        </div>
      </div>

      {!isActive && !results && (
        <div className="waiting-screen">
          <h2>게임 준비 중...</h2>
          <p>곧 시작됩니다!</p>
        </div>
      )}

      {isActive && (
        <div className="game-screen">
          {/* 왼쪽: 게임 영역 */}
          <div className="game-main-area">
            {/* 패턴 표시 영역 */}
            {gameState.phase === 'showing' && (
            <div className="sequence-display">
              <div className="sequence-label">기억하세요!</div>
            <div className="sequence-single-item">
              {gameState.currentShowingNumber !== null ? (
                <div className={`sequence-item active ${gameState.memoryMode || 'number'}`}>
                  {gameState.currentShowingNumber}
                </div>
              ) : (
                <div className="sequence-item empty">
                  {gameState.currentShowingIndex >= 0 ? '...' : ''}
                </div>
              )}
            </div>
              <div className="sequence-progress">
                {gameState.currentShowingIndex >= 0 && (
                  <div className="progress-text">
                    {gameState.currentShowingIndex + 1} / {gameState.sequenceLength}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 입력 영역 */}
          {gameState.phase === 'inputting' && (
            <div className="input-area">
              {myFailed ? (
                <div className="failed-message">
                  ❌ 실패했습니다. 다음 라운드를 기다려주세요.
                </div>
              ) : (
                <>
                  <div className="input-label">패턴을 입력하세요!</div>
                  {gameState.inputTimeRemaining > 0 && (
                    <div className="input-time">
                      남은 시간: <strong>{Math.ceil(gameState.inputTimeRemaining / 1000)}</strong>초
                    </div>
                  )}
                  <div className="current-input">
                    입력: {myInput.length > 0 ? myInput.join(' → ') : '(입력 대기 중)'}
                  </div>
                  <div className={`number-buttons option-${gameState.memoryOptionCount || 4}`}>
                    {getOptions().map((option, index) => (
                      <button
                        key={index}
                        className={`number-button ${gameState.memoryMode || 'number'}`}
                        onClick={() => handleOptionClick(option)}
                        disabled={myInput.length >= gameState.sequenceLength}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  {myInput.length >= gameState.sequenceLength && (
                    <div className="input-complete">
                      ✓ 입력 완료! 결과를 기다리는 중...
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 결과 표시 */}
          {gameState.phase === 'result' && (
            <div className="round-complete-message">
              <h2>라운드 {gameState.currentRound - 1} 완료! 🎉</h2>
              <p>활성 플레이어: {gameState.activePlayersCount}명</p>
              {gameState.currentRound <= gameState.maxRounds && (
                <p>다음 라운드 시작 중...</p>
              )}
            </div>
          )}

          {/* 대기 중 */}
          {gameState.phase === 'waiting' && (
            <div className="waiting-area">
              <div className="waiting-message">라운드 준비 중...</div>
            </div>
          )}
          </div>

          {/* 오른쪽: 라운드 정보 및 스코어보드 */}
          <div className="game-sidebar">
            {/* 라운드 정보 */}
            <div className="round-info">
              <div className="round-badge">
                라운드 {gameState.currentRound} / {gameState.maxRounds}
              </div>
              <div className="round-progress">
                {Array.from({ length: gameState.maxRounds }).map((_, index) => (
                  <div
                    key={index}
                    className={`round-dot ${
                      index < gameState.currentRound - 1 ? "completed" : ""
                    } ${
                      index === gameState.currentRound - 1 ? "current" : ""
                    }`}
                  >
                    {index < gameState.currentRound - 1 && "✓"}
                  </div>
                ))}
              </div>
            </div>

            <GameScoreboard 
              players={room.players}
              scores={scoreData}
              myPlayerId={socket.id}
              teamMode={room.teamMode}
              teams={room.teams}
              scoreUnit="라운드"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default MemoryGame;
