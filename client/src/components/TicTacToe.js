import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import GameResults from "./GameResults";
import { handleLeaveGame as leaveGame, handleEndGame as endGame } from "../utils/gameUtils";
import "./TicTacToe.css";

const EMPTY_BOARD = Array(9).fill(null);

function TicTacToe({ socket, room, onBackToLobby }) {
  const navigate = useNavigate();
  const [board, setBoard] = useState(EMPTY_BOARD);
  const [players, setPlayers] = useState([]);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [winner, setWinner] = useState(null);
  const [isDraw, setIsDraw] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [results, setResults] = useState(null);

  const applyGameState = (state) => {
    if (!state) return;
    if (Array.isArray(state.board)) {
      setBoard(state.board);
    }
    if (Array.isArray(state.players)) {
      setPlayers(state.players);
    }
    if (state.currentTurn !== undefined) {
      setCurrentTurn(state.currentTurn);
    }
    if (state.winner !== undefined) {
      setWinner(state.winner);
    }
    if (state.isDraw !== undefined) {
      setIsDraw(state.isDraw);
    }
  };

  useEffect(() => {
    const handleGameStarted = ({ gameState }) => {
      if (!gameState || gameState.gameType !== "ticTacToe") return;
      setIsActive(true);
      setResults(null);
      setWinner(null);
      setIsDraw(false);
      applyGameState(gameState);
    };

    const handleUpdate = (state) => {
      if (!state || state.gameType !== "ticTacToe") return;
      applyGameState(state);
    };

    const handleGameEnded = ({ results: gameResults }) => {
      setIsActive(false);
      setResults(gameResults || []);
    };

    socket.on("gameStarted", handleGameStarted);
    socket.on("ticTacToeUpdate", handleUpdate);
    socket.on("gameEnded", handleGameEnded);

    return () => {
      socket.off("gameStarted", handleGameStarted);
      socket.off("ticTacToeUpdate", handleUpdate);
      socket.off("gameEnded", handleGameEnded);
    };
  }, [socket]);

  useEffect(() => {
    if (room?.id) {
      socket.emit("getGameState", { roomId: room.id });
    }
  }, [room, socket]);

  const myPlayerId = socket.id;
  const myPlayer = players.find((player) => player.id === myPlayerId) || null;
  const mySymbol = myPlayer?.symbol || null;
  const currentPlayer = players.find((player) => player.id === currentTurn) || null;
  const isMyTurn = isActive && !winner && !isDraw && currentTurn === myPlayerId;

  const handleCellClick = (index) => {
    if (!room?.id) return;
    if (!isMyTurn) return;
    if (board[index]) return;
    socket.emit("gameAction", {
      roomId: room.id,
      action: "placeMark",
      data: { index },
    });
  };

  const getStatusText = () => {
    if (!isActive && !results) {
      return "게임 준비 중...";
    }
    if (winner) {
      const winnerPlayer = players.find((player) => player.id === winner);
      return `승리: ${winnerPlayer?.name || "알 수 없음"} (${winnerPlayer?.symbol || "?"})`;
    }
    if (isDraw) {
      return "무승부!";
    }
    if (!currentPlayer) {
      return "플레이어 대기 중...";
    }
    return `현재 차례: ${currentPlayer.name} (${currentPlayer.symbol})`;
  };

  const isHost = room?.players?.[0]?.id === socket.id;

  const handleLeaveGame = () => leaveGame(socket, room, navigate);

  const handleEndGame = () => endGame(socket, room, { isHost });

  const handleReplayGame = () => {
    if (!room?.id) return;
    if (!isHost) {
      alert("방장만 다시 시작할 수 있습니다.");
      return;
    }
    socket.emit("startGame", {
      roomId: room.id,
      gameType: "ticTacToe",
    });
  };

  return (
    <div className="tic-tac-toe-container">
      <div className="game-header">
        <div className="game-header-content">
          <div>
            <h1>❌⭕ 틱택토</h1>
            <p>3줄을 먼저 완성하면 승리!</p>
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

      {!results && (
        <div className="tic-tac-toe-game-area">
          {/* 왼쪽 플레이어 정보 */}
          <div className="tic-tac-toe-player-side">
            {players[0] && (
              <div
                className={`player-card ${players[0].id === currentTurn ? "active" : ""} ${
                  players[0].id === myPlayerId ? "me" : ""
                }`}
              >
                <div className="player-symbol">{players[0].symbol || "?"}</div>
                <div className="player-name">{players[0].name}</div>
                {players[0].id === myPlayerId && <span className="me-badge">나</span>}
                {players[0].id === currentTurn && (
                  <div className="turn-indicator">현재 차례</div>
                )}
              </div>
            )}
          </div>

          {/* 게임판 */}
          <div className="tic-tac-toe-board">
          {board.map((cell, index) => (
            <button
              key={`cell-${index}`}
              className={`tic-tac-toe-cell ${
                cell ? "filled" : isMyTurn ? "clickable" : ""
              } ${cell === "X" ? "mark-x" : cell === "O" ? "mark-o" : ""}`}
              onClick={() => handleCellClick(index)}
              disabled={!isMyTurn || Boolean(cell)}
              type="button"
            >
              {cell ? (
                <span
                  className={`tic-tac-toe-mark ${
                    cell === "X" ? "mark-x" : cell === "O" ? "mark-o" : ""
                  }`}
                >
                  {cell}
                </span>
              ) : (
                ""
              )}
            </button>
          ))}
          </div>

          {/* 오른쪽 플레이어 정보 */}
          <div className="tic-tac-toe-player-side">
            {players[1] && (
              <div
                className={`player-card ${players[1].id === currentTurn ? "active" : ""} ${
                  players[1].id === myPlayerId ? "me" : ""
                }`}
              >
                <div className="player-symbol">{players[1].symbol || "?"}</div>
                <div className="player-name">{players[1].name}</div>
                {players[1].id === myPlayerId && <span className="me-badge">나</span>}
                {players[1].id === currentTurn && (
                  <div className="turn-indicator">현재 차례</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {!results && (
        <div className="tic-tac-toe-status-footer">
          <div className="status-text">{getStatusText()}</div>
          {!mySymbol && (
            <div className="spectator-hint">관전 중입니다.</div>
          )}
        </div>
      )}

      {results && (
        <div className="results-screen">
          <h2>게임 종료! 🎉</h2>
          <GameResults results={results} myPlayerId={socket.id} scoreUnit="승" />
          <div className="result-actions">
            <button onClick={handleReplayGame} className="replay-button">
              바로 재시작(방장만)
            </button>
            <button onClick={onBackToLobby} className="back-button">
              로비로 돌아가기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TicTacToe;
