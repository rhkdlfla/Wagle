import React, { useEffect, useState, useRef } from "react";
import "./AppleBattle.css";

const GRID_ROWS = 10;
const GRID_COLS = 17;
const CELL_SIZE = 40; // 픽셀

// 플레이어 색상 (최대 4명)
const PLAYER_COLORS = [
  "#4CAF50", // 초록
  "#2196F3", // 파랑
  "#FF9800", // 주황
  "#9C27B0", // 보라
];

function AppleBattle({ socket, room, onBackToLobby }) {
  const [grid, setGrid] = useState([]);
  const [scores, setScores] = useState({});
  const [teamScores, setTeamScores] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [results, setResults] = useState(null);
  const [myScore, setMyScore] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [selectedSum, setSelectedSum] = useState(0);
  const gridRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const playerColorMap = useRef({});

  // 플레이어/팀 색상 매핑
  useEffect(() => {
    if (room && room.players) {
      const colorMap = {};
      
      // 팀전 모드인 경우 팀 색상 사용
      if (room.teamMode && room.teams && room.teams.length > 0) {
        room.teams.forEach((team) => {
          // 팀에 속한 플레이어들에게 팀 색상 할당
          room.players.forEach((player) => {
            if (player.teamId === team.id) {
              colorMap[player.id] = team.color;
            }
          });
        });
        // 팀 없는 플레이어는 기본 색상
        room.players.forEach((player) => {
          if (!player.teamId && !colorMap[player.id]) {
            colorMap[player.id] = PLAYER_COLORS[0];
          }
        });
      } else {
        // 개인전 모드: 기존 방식대로
        room.players.forEach((player, index) => {
          colorMap[player.id] = PLAYER_COLORS[index % PLAYER_COLORS.length];
        });
      }
      
      playerColorMap.current = colorMap;
    }
  }, [room]);

  useEffect(() => {
    // 게임 시작 수신
    const handleGameStarted = ({ gameState, room: gameRoom }) => {
      if (!gameState || gameState.gameType !== "appleBattle") return;
      
      setIsActive(true);
      setTimeRemaining(gameState.duration);
      setGrid(gameState.grid || []);
      setScores({});
      setResults(null);
      setMyScore(0);
      setIsDragging(false);
      setDragStart(null);
      setDragEnd(null);
      setSelectedSum(0);
      
      // 기존 타이머가 있으면 정리
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      
      // 타이머 시작
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - gameState.startTime;
        const remaining = Math.max(0, gameState.duration - elapsed);
        setTimeRemaining(remaining);
        
        if (remaining <= 0) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }, 100);
    };
    
    socket.on("gameStarted", handleGameStarted);

    // 사과배틀 업데이트 수신
    socket.on("appleBattleUpdate", ({ scores: scoreUpdates, teamScores: teamScoresData, timeRemaining: remaining, grid: updatedGrid }) => {
      setScores(prev => {
        const newScores = {};
        scoreUpdates.forEach(({ id, score }) => {
          newScores[id] = score;
        });
        return newScores;
      });
      setTeamScores(teamScoresData || null);
      setTimeRemaining(remaining);
      if (updatedGrid) {
        // 그리드를 깊은 복사하여 React가 변경을 감지하도록 함
        setGrid(JSON.parse(JSON.stringify(updatedGrid)));
      }
      
      // 내 점수 업데이트
      const myScoreUpdate = scoreUpdates.find(({ id }) => id === socket.id);
      if (myScoreUpdate) {
        setMyScore(myScoreUpdate.score);
      }
    });

    // 게임 종료 수신
    socket.on("gameEnded", ({ winners, results: gameResults }) => {
      setIsActive(false);
      setResults(gameResults);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    });

    // 게임 상태 요청
    socket.emit("getGameState", { roomId: room.id });

    return () => {
      socket.off("gameStarted");
      socket.off("appleBattleUpdate");
      socket.off("gameEnded");
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [socket, room]);

  // 그리드 좌표 계산
  const getGridPosition = (e) => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / CELL_SIZE);
    const row = Math.floor(y / CELL_SIZE);
    
    if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
      return { row, col };
    }
    return null;
  };

  // 선택된 영역의 합 계산
  const calculateSelectedSum = (startRow, startCol, endRow, endCol) => {
    if (!grid || grid.length === 0) return 0;
    
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    
    let sum = 0;
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
          const cell = grid[row] && grid[row][col];
          if (cell && cell.value && cell.value > 0) {
            sum += cell.value;
          }
        }
      }
    }
    return sum;
  };

  // 마우스 다운
  const handleMouseDown = (e) => {
    if (!isActive) return;
    
    const pos = getGridPosition(e);
    if (pos) {
      setIsDragging(true);
      setDragStart(pos);
      setDragEnd(pos);
      setSelectedSum(calculateSelectedSum(pos.row, pos.col, pos.row, pos.col));
    }
  };

  // 마우스 이동
  const handleMouseMove = (e) => {
    if (!isDragging || !dragStart) return;
    
    const pos = getGridPosition(e);
    if (pos) {
      setDragEnd(pos);
      setSelectedSum(calculateSelectedSum(dragStart.row, dragStart.col, pos.row, pos.col));
    }
  };

  // 마우스 업
  const handleMouseUp = (e) => {
    if (!isDragging || !dragStart || !dragEnd) {
      setIsDragging(false);
      return;
    }
    
    const sum = calculateSelectedSum(dragStart.row, dragStart.col, dragEnd.row, dragEnd.col);
    
    // 합이 10이면 사과 제거 및 땅따먹기
    if (sum === 10) {
      socket.emit("appleBattleRemove", {
        roomId: room.id,
        startRow: dragStart.row,
        startCol: dragStart.col,
        endRow: dragEnd.row,
        endCol: dragEnd.col,
      });
    }
    
    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
    setSelectedSum(0);
  };

  // 선택된 영역 계산
  const getSelectedArea = () => {
    if (!dragStart || !dragEnd) return null;
    
    const minRow = Math.min(dragStart.row, dragEnd.row);
    const maxRow = Math.max(dragStart.row, dragEnd.row);
    const minCol = Math.min(dragStart.col, dragEnd.col);
    const maxCol = Math.max(dragStart.col, dragEnd.col);
    
    return {
      minRow,
      maxRow,
      minCol,
      maxCol,
      left: minCol * CELL_SIZE,
      top: minRow * CELL_SIZE,
      width: (maxCol - minCol + 1) * CELL_SIZE,
      height: (maxRow - minRow + 1) * CELL_SIZE,
    };
  };

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  const selectedArea = getSelectedArea();

  if (results) {
    return (
      <div className="apple-battle-container">
        <div className="results-screen">
          <h1>🎮 게임 종료!</h1>
          
          {/* 팀전 모드일 때 팀 점수 표시 */}
          {room.teamMode && results[0]?.teamScore !== undefined && room.teams && (
            <div className="results-team-scores">
              <h3>팀 점수</h3>
              <div className="results-team-list">
                {room.teams
                  .map((team) => {
                    const teamResult = results.find((r) => r.teamId === team.id);
                    const teamScore = teamResult?.teamScore || 0;
                    const isWinner = results.some((r) => r.teamId === team.id && r.isWinner);
                    return {
                      ...team,
                      score: teamScore,
                      isWinner,
                    };
                  })
                  .sort((a, b) => b.score - a.score)
                  .map((team, index) => (
                    <div
                      key={team.id}
                      className={`result-team-item ${team.isWinner ? "winner" : ""}`}
                    >
                      <div className="result-team-rank">
                        {index === 0 && team.isWinner ? "👑" : `#${index + 1}`}
                      </div>
                      <div
                        className="result-team-color"
                        style={{ backgroundColor: team.color }}
                      />
                      <div className="result-team-info">
                        <div className="result-team-name">
                          {team.name}
                          {team.isWinner && <span className="winner-badge">승리팀!</span>}
                        </div>
                        <div className="result-team-score">{team.score}칸</div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
          
          {/* 개인 점수 표시 */}
          <div className="results-list">
            <h3>{room.teamMode ? "개인 점수" : "순위"}</h3>
            {results.map((result, index) => {
              const playerTeam = room.teamMode && result.teamId
                ? room.teams?.find((t) => t.id === result.teamId)
                : null;
              return (
                <div
                  key={result.id}
                  className={`result-item ${result.isWinner ? "winner" : ""}`}
                  style={
                    playerTeam
                      ? {
                          borderLeft: `4px solid ${playerTeam.color}`,
                        }
                      : {}
                  }
                >
                  <div className="result-rank">#{index + 1}</div>
                  <div className="result-info">
                    <div className="result-name">{result.name}</div>
                    <div className="result-score">{result.score}칸</div>
                  </div>
                  {result.isWinner && <div className="winner-badge">👑 승리!</div>}
                </div>
              );
            })}
          </div>
          <button onClick={onBackToLobby} className="back-button">
            로비로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="apple-battle-container">
        <div className="waiting-screen">
          <h2>게임 준비 중...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="apple-battle-container">
      <div className="apple-battle-header">
        <h1>🍎 사과배틀</h1>
        <div className="timer">⏱️ {formatTime(timeRemaining)}</div>
      </div>

      <div className="apple-battle-content">
        <div className="game-grid-container">
          <div
            ref={gridRef}
            className="game-grid"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              width: GRID_COLS * CELL_SIZE,
              height: GRID_ROWS * CELL_SIZE,
            }}
          >
            {grid.map((row, rowIndex) =>
              row.map((cell, colIndex) => {
                // 값이 0이거나 없으면 숫자 표시 안 함 (엄격한 체크)
                const hasValue = cell && typeof cell.value === 'number' && cell.value > 0;
                
                const isSelected =
                  selectedArea &&
                  rowIndex >= selectedArea.minRow &&
                  rowIndex <= selectedArea.maxRow &&
                  colIndex >= selectedArea.minCol &&
                  colIndex <= selectedArea.maxCol;
                
                // 팀전 모드일 때는 팀 색상 사용, 개인전일 때는 플레이어 색상 사용
                let ownerColor = null;
                if (cell) {
                  if (room.teamMode && room.teams && cell.teamId) {
                    const team = room.teams.find((t) => t.id === cell.teamId);
                    ownerColor = team ? team.color : null;
                  } else if (cell.owner) {
                    ownerColor = playerColorMap.current[cell.owner];
                  }
                }

                return (
                  <div
                    key={`${rowIndex}-${colIndex}`}
                    className={`grid-cell ${isSelected ? "selected" : ""} ${
                      !hasValue ? "empty" : ""
                    }`}
                    style={{
                      left: colIndex * CELL_SIZE,
                      top: rowIndex * CELL_SIZE,
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      backgroundColor: ownerColor
                        ? `${ownerColor}40`
                        : "transparent",
                      borderColor: ownerColor || "transparent",
                      borderWidth: ownerColor ? "2px" : "1px",
                    }}
                  >
                    {hasValue && (
                      <span className="apple-value">{cell.value}</span>
                    )}
                  </div>
                );
              })
            )}
            
            {/* 선택 박스 */}
            {selectedArea && (
              <div
                className={`selection-box ${selectedSum === 10 ? "valid" : ""}`}
                style={{
                  left: selectedArea.left,
                  top: selectedArea.top,
                  width: selectedArea.width,
                  height: selectedArea.height,
                }}
              >
                {selectedSum === 10 && (
                  <div className="sum-indicator">✓ 합: 10</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="score-panel">
          <h2>점수</h2>
          
          {/* 팀전 모드일 때는 팀 점수만 표시, 개인전 모드일 때는 개인 점수만 표시 */}
          {room.teamMode && room.teams && room.teams.length > 0 ? (
            <div className="team-scores-section">
              <h3>팀 점수</h3>
              <div className="team-scores-list">
                {room.teams
                  .map((team) => ({
                    ...team,
                    score: teamScores && teamScores[team.id] ? teamScores[team.id] : 0,
                  }))
                  .sort((a, b) => b.score - a.score)
                  .map((team) => (
                    <div key={team.id} className="team-score-item">
                      <div
                        className="team-score-color"
                        style={{ backgroundColor: team.color }}
                      />
                      <div className="team-score-info">
                        <div className="team-score-name">{team.name}</div>
                        <div className="team-score-value">{team.score}칸</div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="scores-list">
              {room.players
                .map((player) => {
                  const score = scores[player.id] || 0;
                  const color = playerColorMap.current[player.id];
                  const isMe = player.id === socket.id;
                  
                  return { player, score, color, isMe };
                })
                .sort((a, b) => b.score - a.score)
                .map(({ player, score, color, isMe }) => (
                  <div
                    key={player.id}
                    className={`score-item ${isMe ? "my-score" : ""}`}
                  >
                    <div
                      className="score-color"
                      style={{ backgroundColor: color }}
                    />
                    <div className="score-info">
                      <div className="score-name">
                        {player.name}
                        {isMe && " (나)"}
                      </div>
                      <div className="score-value">{score}칸</div>
                    </div>
                  </div>
                ))}
            </div>
          )}
          <div className="game-instructions">
            <p>📌 드래그로 사과를 선택하세요</p>
            <p>📌 합이 10이 되면 빨간색으로 표시됩니다</p>
            <p>📌 드래그를 놓으면 땅따먹기!</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AppleBattle;
