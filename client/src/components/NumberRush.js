import React, { useEffect, useState, useRef } from "react";
import GameScoreboard from "./GameScoreboard";
import GameResults from "./GameResults";
import "./NumberRush.css";

function NumberRush({ socket, room, onBackToLobby }) {
  const [balls, setBalls] = useState([]);
  const [scores, setScores] = useState({});
  const [teamScores, setTeamScores] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [results, setResults] = useState(null);
  const [currentRound, setCurrentRound] = useState(1);
  const [maxRounds, setMaxRounds] = useState(5);
  const [roundMaxNumber, setRoundMaxNumber] = useState(0);
  const [nextNumber, setNextNumber] = useState(1);
  const [roundWinners, setRoundWinners] = useState([]);
  const [roundComplete, setRoundComplete] = useState(false);
  const [roundTimeRemaining, setRoundTimeRemaining] = useState(0);
  const gameAreaRef = useRef(null);
  const timerIntervalRef = useRef(null);

  useEffect(() => {
    // 게임 시작 수신
    const handleGameStarted = ({ gameState, room: gameRoom }) => {
      if (!gameState || gameState.gameType !== "numberRush") return;
      
      setIsActive(true);
      setBalls([]);
      setScores({});
      setResults(null);
      setCurrentRound(1);
      setRoundComplete(false);
      setRoundWinners([]);
      setNextNumber(1);
    };
    
    socket.on("gameStarted", handleGameStarted);

    // 게임 업데이트 수신
    socket.on("numberRushUpdate", ({ 
      currentRound: round, 
      maxRounds: maxR, 
      roundMaxNumber: maxNum,
      roundTimeRemaining: timeRemaining,
      balls: gameBalls,
      scores: scoreUpdates,
      teamScores: teamS,
      roundWinners: winners
    }) => {
      if (round !== undefined) setCurrentRound(round);
      if (maxR !== undefined) setMaxRounds(maxR);
      if (maxNum !== undefined) setRoundMaxNumber(maxNum);
      if (timeRemaining !== undefined) setRoundTimeRemaining(timeRemaining);
      if (gameBalls) setBalls(gameBalls);
      if (scoreUpdates) {
        const newScores = {};
        scoreUpdates.forEach((update) => {
          newScores[update.id] = update.score;
          if (update.id === socket.id) {
            setNextNumber(update.nextNumber || 1);
          }
        });
        setScores(newScores);
      }
      if (teamS !== undefined) setTeamScores(teamS);
      if (winners) setRoundWinners(winners);
    });

    // 라운드 완료 수신
    socket.on("numberRushRoundComplete", ({ round, winner, timeout, nextRound }) => {
      setRoundComplete(true);
      setRoundTimeRemaining(0);
      const winnerPlayer = winner ? room.players.find((p) => p.id === winner) : null;
      if (timeout) {
        console.log(`라운드 ${round} 시간 초과! ${winner ? `승자: ${winnerPlayer?.name || winner}` : '무승부'}`);
      } else {
        console.log(`라운드 ${round} 완료! 승자: ${winnerPlayer?.name || winner}`);
      }
      
      // 타이머 정리
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      
      // 2초 후 다음 라운드 시작
      setTimeout(() => {
        setRoundComplete(false);
        if (nextRound) {
          setCurrentRound(nextRound);
          setNextNumber(1);
        }
      }, 2000);
    });

    // 게임 종료 수신
    socket.on("gameEnded", ({ results: gameResults }) => {
      console.log("NumberRush: 게임 종료 이벤트 수신", gameResults);
      setIsActive(false);
      setResults(gameResults);
    });

    return () => {
      socket.off("gameStarted");
      socket.off("numberRushUpdate");
      socket.off("numberRushRoundComplete");
      socket.off("gameEnded");
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [socket, room]);

  // 라운드 시간 타이머 (클라이언트 측에서도 실시간 업데이트)
  useEffect(() => {
    if (!isActive || roundComplete) {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      return;
    }

    // 서버에서 받은 시간을 기반으로 클라이언트에서도 100ms마다 업데이트
    timerIntervalRef.current = setInterval(() => {
      setRoundTimeRemaining((prev) => {
        const newTime = Math.max(0, prev - 100);
        return newTime;
      });
    }, 100);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [isActive, roundComplete]);

  // 컴포넌트 마운트 시 게임 상태 확인
  useEffect(() => {
    if (room && room.id) {
      socket.emit("getGameState", { roomId: room.id });
    }
  }, [room, socket]);

  // 공 클릭 처리
  const handleBallClick = (ballId) => {
    if (!isActive || roundComplete) return;
    
    // 내 다음 숫자 확인
    const myNextNum = nextNumber;
    const ball = balls.find((b) => b.id === ballId);
    if (!ball || ball.clickedBy !== null) return; // 이미 누른 공은 클릭 불가
    
    // 공에는 소유권이 없음 - 누구든지 클릭 가능
    // 단, 순서 확인
    if (ball.number !== myNextNum) {
      // 잘못된 순서 - 피드백 표시
      return;
    }
    
    // 공 클릭 이벤트 전송
    socket.emit("gameAction", {
      roomId: room.id,
      action: "clickBall",
      data: { ballId },
    });
  };

  // 내 점수 가져오기
  const getMyScore = () => {
    return scores[socket.id] || 0;
  };

  // 플레이어 점수 가져오기
  const getPlayerScore = (playerId) => {
    return scores[playerId] || 0;
  };

  // 공이 클릭 가능한지 확인
  const isBallClickable = (ball) => {
    if (ball.clickedBy !== null) return false; // 이미 누른 공은 클릭 불가
    if (roundComplete) return false;
    
    // 공에는 소유권이 없음 - 누구든지 클릭 가능
    // 단, 순서 확인
    return ball.number === nextNumber;
  };

  // 라운드 승자 이름 가져오기
  const getRoundWinnerName = (roundIndex) => {
    if (roundIndex < 0 || roundIndex >= roundWinners.length) return null;
    const winnerId = roundWinners[roundIndex];
    const winner = room.players.find((p) => p.id === winnerId);
    return winner ? winner.name : null;
  };

  const isHost = room?.players?.[0]?.id === socket.id;

  const handleLeaveGame = () => {
    if (window.confirm("게임을 나가시겠습니까?")) {
      onBackToLobby();
    }
  };

  const handleEndGame = () => {
    if (window.confirm("게임을 종료하시겠습니까? 모든 플레이어가 로비로 돌아갑니다.")) {
      socket.emit("endGame", { roomId: room.id });
    }
  };

  return (
    <div className="number-rush-container">
      <div className="game-header">
        <div className="game-header-content">
          <div>
            <h1>🔢 넘버 러시!</h1>
            <p>1부터 {roundMaxNumber}까지 순서대로 공을 클릭하세요!</p>
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
          {/* 라운드 정보 */}
          <div className="round-info">
            <div className="round-badge">
              라운드 {currentRound} / {maxRounds}
            </div>
            {!roundComplete && roundTimeRemaining > 0 && (
              <div className="round-timer-circle">
                <span className="round-timer-text">{(roundTimeRemaining / 1000).toFixed(1)}초</span>
              </div>
            )}
            <div className="round-progress">
              {Array.from({ length: maxRounds }).map((_, index) => (
                <div
                  key={index}
                  className={`round-dot ${index < currentRound - 1 ? "completed" : ""} ${
                    index === currentRound - 1 ? "current" : ""
                  }`}
                  title={
                    index < roundWinners.length
                      ? `라운드 ${index + 1}: ${getRoundWinnerName(index) || "미완료"}`
                      : `라운드 ${index + 1}`
                  }
                >
                  {index < roundWinners.length && "✓"}
                </div>
              ))}
            </div>
          </div>

          {/* 라운드 완료 메시지 */}
          {roundComplete && (
            <div className="round-complete-message">
              <h2>라운드 {currentRound - 1} 완료! 🎉</h2>
              {roundWinners[currentRound - 2] && (
                <p>
                  승자: {getRoundWinnerName(currentRound - 2) || "알 수 없음"}
                </p>
              )}
              {currentRound <= maxRounds && (
                <p>다음 라운드 시작 중...</p>
              )}
            </div>
          )}

          {/* 게임 힌트 정보 (게임 영역 밖) */}
          {!roundComplete && (
            <div className="game-hints">
              <div className="round-time-hint">
                라운드 시간: <strong>{(roundTimeRemaining / 1000).toFixed(1)}</strong>초
              </div>
              <div className="next-number-hint">
                다음 숫자: <strong>{nextNumber}</strong> / {roundMaxNumber}
              </div>
            </div>
          )}

          {/* 게임 영역 */}
          {!roundComplete && (
            <div className="game-area" ref={gameAreaRef}>
              {balls.map((ball) => {
                const isClickable = isBallClickable(ball);
                const isClicked = ball.clickedBy !== null;
                
                // 공 색상 (소유권 없으므로 기본 색상 사용)
                let ballColor = "#4CAF50";
                
                return (
                  <div
                    key={ball.id}
                    className={`ball ${isClicked ? "clicked" : ""}`}
                    style={{
                      left: `${ball.x}px`,
                      top: `${ball.y}px`,
                      backgroundColor: isClicked ? "#666" : ballColor,
                    }}
                    onClick={() => !isClicked && handleBallClick(ball.id)}
                    title={isClicked ? `이미 클릭됨` : `숫자 ${ball.number}`}
                  >
                    {!isClicked && <span className="ball-number">{ball.number}</span>}
                    {isClicked && <span className="ball-check">✓</span>}
                  </div>
                );
              })}
            </div>
          )}

          <GameScoreboard
            teams={room.teamMode ? room.teams : []}
            teamScores={teamScores}
            players={room.players}
            scores={scores}
            myPlayerId={socket.id}
            teamMode={room.teamMode}
            scoreUnit="점"
            getPlayerScore={getPlayerScore}
          />
        </div>
      )}

      {results && (
        <div className="results-screen">
          <h2>게임 종료! 🎉</h2>
          <p className="final-round-info">총 {maxRounds}라운드 완료</p>
          
          <GameResults
            results={results}
            teams={room.teamMode ? room.teams : []}
            myPlayerId={socket.id}
            teamMode={room.teamMode}
            scoreUnit="점"
          />
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

export default NumberRush;
