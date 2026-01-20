import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import GameScoreboard from "./GameScoreboard";
import GameResults from "./GameResults";
import { handleLeaveGame as leaveGame, handleEndGame as endGame } from "../utils/gameUtils";
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
  const navigate = useNavigate();
  const [grid, setGrid] = useState([]);
  const [scores, setScores] = useState({});
  const [teamScores, setTeamScores] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [results, setResults] = useState(null);
  const [myScore, setMyScore] = useState(0);
  const [teamActivePlayers, setTeamActivePlayers] = useState(null); // 이어달리기 모드: 각 팀의 현재 활성 플레이어
  const [relayMode, setRelayMode] = useState(false); // 이어달리기 모드 여부
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd, setDragEnd] = useState(null);
  const [selectedSum, setSelectedSum] = useState(0);
  const [maxSum, setMaxSum] = useState(10); // 최대 숫자 (기본값 10)
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
      const receivedMaxSum = gameState.maxSum || 10;
      setMaxSum(receivedMaxSum);
      console.log("사과배틀 게임 시작 - maxSum:", receivedMaxSum, "gameState:", gameState);
      
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
    socket.on("appleBattleUpdate", ({ scores: scoreUpdates, teamScores: teamScoresData, timeRemaining: remaining, grid: updatedGrid, teamActivePlayers: activePlayers, maxSum: maxSumValue }) => {
      if (maxSumValue !== undefined) {
        console.log("사과배틀 업데이트 - maxSum:", maxSumValue);
        setMaxSum(maxSumValue);
      }
      if (scoreUpdates && Array.isArray(scoreUpdates)) {
        setScores(prev => {
          const newScores = {};
          scoreUpdates.forEach(({ id, score }) => {
            newScores[id] = score;
          });
          return newScores;
        });
        
        // 내 점수 업데이트
        const myScoreUpdate = scoreUpdates.find(({ id }) => id === socket.id);
        if (myScoreUpdate) {
          setMyScore(myScoreUpdate.score);
        }
      }
      
      setTeamScores(teamScoresData || null);
      if (remaining !== undefined) {
        setTimeRemaining(remaining);
      }
      setTeamActivePlayers(activePlayers || null);
      if (updatedGrid && Array.isArray(updatedGrid)) {
        // 그리드를 깊은 복사하여 React가 변경을 감지하도록 함
        setGrid(JSON.parse(JSON.stringify(updatedGrid)));
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
  
  // 이어달리기 모드 감지 (팀전 모드이고 teamActivePlayers가 있으면 이어달리기 모드)
  useEffect(() => {
    setRelayMode(room?.teamMode && teamActivePlayers !== null);
  }, [room?.teamMode, teamActivePlayers]);

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
    
    // 우클릭: 이어달리기 모드에서 다음 팀원에게 순서 넘기기
    if (e.button === 2 || (e.type === "contextmenu")) {
      e.preventDefault();
      if (relayMode && room.teamMode) {
        const myTeamId = room.players.find((p) => p.id === socket.id)?.teamId;
        if (myTeamId && teamActivePlayers?.[myTeamId] === socket.id) {
          socket.emit("passTurn", { roomId: room.id });
        }
      }
      return;
    }
    
    // 이어달리기 모드에서 현재 차례가 아니면 드래그 불가
    if (relayMode && room.teamMode) {
      const myTeamId = room.players.find((p) => p.id === socket.id)?.teamId;
      if (!myTeamId || teamActivePlayers?.[myTeamId] !== socket.id) {
        return; // 현재 차례가 아님
      }
    }
    
    const pos = getGridPosition(e);
    if (pos) {
      setIsDragging(true);
      setDragStart(pos);
      setDragEnd(pos);
      setSelectedSum(calculateSelectedSum(pos.row, pos.col, pos.row, pos.col));
    }
  };
  
  // 현재 클릭 가능한지 확인 (이어달리기 모드일 때)
  const canPlay = () => {
    if (!relayMode || !room.teamMode) {
      return true; // 이어달리기 모드가 아니면 항상 플레이 가능
    }
    
    const myTeamId = room.players.find((p) => p.id === socket.id)?.teamId;
    if (!myTeamId) {
      return false; // 팀이 없으면 플레이 불가
    }
    
    return teamActivePlayers?.[myTeamId] === socket.id;
  };
  
  // 현재 활성 플레이어 이름 가져오기
  const getActivePlayerName = () => {
    if (!relayMode || !room.teamMode || !teamActivePlayers) {
      return null;
    }
    
    const myTeamId = room.players.find((p) => p.id === socket.id)?.teamId;
    if (!myTeamId) {
      return null;
    }
    
    const activePlayerId = teamActivePlayers[myTeamId];
    const activePlayer = room.players.find((p) => p.id === activePlayerId);
    return activePlayer ? activePlayer.name : null;
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
    
    // 합이 10이면 사과 제거 및 땅따먹기 (합은 항상 10으로 고정)
    const targetSum = 10;
    console.log("사과 선택 - 합:", sum, "목표 합:", targetSum, "일치:", sum === targetSum);
    if (sum === targetSum) {
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
  const isHost = room?.players?.[0]?.id === socket.id;

  const handleLeaveGame = () => leaveGame(socket, room, navigate);

  const handleEndGame = () => endGame(socket, room, { isHost });

  if (results) {
    return (
      <div className="apple-battle-container">
        <div className="results-screen">
          <h1>🎮 게임 종료!</h1>
          
          <GameResults
            results={results}
            teams={room.teamMode ? room.teams : []}
            myPlayerId={socket.id}
            teamMode={room.teamMode}
            scoreUnit="칸"
          />
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
        <div className="game-header-content">
          <div>
            <h1>🍎 사과배틀</h1>
            <div className="timer">⏱️ {formatTime(timeRemaining)}</div>
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

      <div className="apple-battle-content">
        <div className="game-grid-container">
          <div
            ref={gridRef}
            className={`game-grid ${relayMode && !canPlay() ? "disabled" : ""}`}
            onMouseDown={handleMouseDown}
            onContextMenu={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              width: GRID_COLS * CELL_SIZE,
              height: GRID_ROWS * CELL_SIZE,
            }}
          >
            {grid && Array.isArray(grid) && grid.length > 0 ? grid.map((row, rowIndex) =>
              row && Array.isArray(row) ? row.map((cell, colIndex) => {
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
              }) : null
            ) : null}
            
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
          <GameScoreboard
            teams={room.teamMode ? room.teams : []}
            teamScores={teamScores}
            players={room.players}
            scores={scores}
            myPlayerId={socket.id}
            teamMode={room.teamMode}
            scoreUnit="칸"
          />
          {relayMode && room.teamMode && (
            <div className="relay-mode-info">
              <p className="active-player-text">
                현재 차례: <strong>{getActivePlayerName() || "대기 중"}</strong>
              </p>
              <p className="relay-instruction">
                💡 우클릭으로 다음 팀원에게 순서 넘기기
              </p>
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
