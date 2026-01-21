import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { handleLeaveGame as leaveGame, handleEndGame as endGame } from "../utils/gameUtils";
import "./LiarGame.css";

function LiarGame({ socket, room, onBackToLobby }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState("discussion");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [turnIndex, setTurnIndex] = useState(0);
  const [totalTurns, setTotalTurns] = useState(0);
  const [currentPlayerId, setCurrentPlayerId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [roleInfo, setRoleInfo] = useState({
    role: null,
    word: null,
    category: null,
    liarsCount: 0,
  });
  const [activeCategory, setActiveCategory] = useState(null);
  const [votesCount, setVotesCount] = useState(0);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteCandidates, setVoteCandidates] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [results, setResults] = useState(null);
  const [showRevealModal, setShowRevealModal] = useState(false);
  const [guessOptions, setGuessOptions] = useState([]);
  const [guessCategory, setGuessCategory] = useState(null);
  const [guessWord, setGuessWord] = useState("");
  const [guessSubmitted, setGuessSubmitted] = useState(false);
  const [guessFeedback, setGuessFeedback] = useState(null);
  const messagesEndRef = useRef(null);

  const isHost = room?.players?.[0]?.id === socket.id;
  const isMyTurn = currentPlayerId === socket.id;

  const playerNameMap = useMemo(() => {
    const map = new Map();
    (room?.players || []).forEach((player) => {
      map.set(player.id, player.name);
    });
    return map;
  }, [room?.players]);

  const getPlayerName = (playerId) => playerNameMap.get(playerId) || "플레이어";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleGameStarted = ({ gameState }) => {
      if (!gameState) return;
      setPhase(gameState.phase || "discussion");
      setTimeRemaining(gameState.timeRemaining || 0);
      setTurnIndex(gameState.turnIndex || 0);
      setTotalTurns(gameState.totalTurns || 0);
      setCurrentPlayerId(gameState.currentPlayerId || null);
      setMessages(gameState.messages || []);
      setVotesCount(gameState.votesCount || 0);
      setHasVoted(Boolean(gameState.hasVoted));
      setVoteCandidates(gameState.voteCandidates || null);
      setActiveCategory(gameState.category || null);
      setReveal(null);
      setResults(null);
      setShowRevealModal(false);
      setGuessOptions([]);
      setGuessCategory(null);
      setGuessWord("");
      setGuessSubmitted(Boolean(gameState.hasGuessed));
      setGuessFeedback(null);
    };

    const handleGameState = (state) => {
      setPhase(state.phase || "discussion");
      setTimeRemaining(state.timeRemaining || 0);
      setTurnIndex(state.turnIndex || 0);
      setTotalTurns(state.totalTurns || 0);
      setCurrentPlayerId(state.currentPlayerId || null);
      setMessages(state.messages || []);
      setVotesCount(state.votesCount || 0);
      setHasVoted(Boolean(state.hasVoted));
      setVoteCandidates(state.voteCandidates || null);
      setActiveCategory(state.category || null);
      setGuessSubmitted(Boolean(state.hasGuessed));
    };

    const handleGameUpdate = (update) => {
      setPhase(update.phase || "discussion");
      setTimeRemaining(update.timeRemaining || 0);
      setTurnIndex(update.turnIndex || 0);
      setTotalTurns(update.totalTurns || 0);
      setCurrentPlayerId(update.currentPlayerId || null);
      setVotesCount(update.votesCount || 0);
      setVoteCandidates(update.voteCandidates || null);
    };

    const handleRole = (data) => {
      setRoleInfo({
        role: data?.role || null,
        word: data?.word || null,
        category: data?.category || null,
        liarsCount: data?.liarsCount || 0,
      });
    };

    socket.on("gameStarted", handleGameStarted);
    socket.on("liarGameState", handleGameState);
    socket.on("liarGameUpdate", handleGameUpdate);
    socket.on("liarGameMessage", (message) => {
      setMessages((prev) => [...prev, message]);
    });
    socket.on("liarGameRole", handleRole);
    socket.on("liarGameVotingStarted", (data) => {
      setPhase("voting");
      setHasVoted(false);
      setVoteCandidates(data?.voteCandidates || null);
    });
    socket.on("liarGameGuessStarted", (data) => {
      setPhase("guess");
      setGuessSubmitted(false);
      setGuessFeedback(null);
      setGuessCategory(data?.category || null);
    });
    socket.on("liarGameGuessOptions", (data) => {
      const options = Array.isArray(data?.words) ? data.words : [];
      setGuessOptions(options);
      setGuessCategory(data?.category || null);
      setGuessWord(options[0] || "");
    });
    socket.on("liarGameGuessResult", (data) => {
      setGuessFeedback(data?.correct ? "정답입니다!" : "틀렸습니다.");
    });
    socket.on("liarGameReveal", (data) => {
      setReveal(data);
      setActiveCategory((prev) => data?.category || prev);
      setShowRevealModal(true);
    });
    socket.on("gameEnded", ({ results: gameResults, reason, reveal: revealData }) => {
      setResults(gameResults || []);
      if (revealData) {
        setReveal(revealData);
      } else if (!reveal) {
        setReveal({
          winnerTeam: "villagers",
          reason: reason || "gameEnded",
          word: activeCategory || "알 수 없음",
          category: activeCategory || null,
          liarIds: [],
        });
      }
      setShowRevealModal(true);
    });

    return () => {
      socket.off("gameStarted", handleGameStarted);
      socket.off("liarGameState", handleGameState);
      socket.off("liarGameUpdate", handleGameUpdate);
      socket.off("liarGameMessage");
      socket.off("liarGameRole", handleRole);
      socket.off("liarGameVotingStarted");
      socket.off("liarGameGuessStarted");
      socket.off("liarGameGuessOptions");
      socket.off("liarGameGuessResult");
      socket.off("liarGameReveal");
      socket.off("gameEnded");
    };
  }, [socket]);

  useEffect(() => {
    if (room?.id) {
      socket.emit("getGameState", { roomId: room.id });
    }
  }, [room?.id, socket]);

  const formatTime = (ms) => (ms == null ? "제한 없음" : `${Math.ceil(ms / 1000)}초`);

  const handleSendMessage = () => {
    const trimmed = messageInput.trim();
    if (!trimmed || !room?.id) return;
    socket.emit("gameAction", {
      roomId: room.id,
      action: "submitMessage",
      data: { message: trimmed },
    });
    setMessageInput("");
  };

  const handleVote = (targetId) => {
    if (hasVoted || !room?.id) return;
    socket.emit("gameAction", {
      roomId: room.id,
      action: "submitVote",
      data: { targetId },
    });
    setHasVoted(true);
  };

  const handleSubmitGuess = () => {
    if (!room?.id || !guessWord || guessSubmitted) return;
    socket.emit("gameAction", {
      roomId: room.id,
      action: "submitGuess",
      data: { word: guessWord },
    });
    setGuessSubmitted(true);
  };

  const handleLeaveGame = () => leaveGame(socket, room, navigate);

  const handleEndGame = () => endGame(socket, room, { isHost });

  const handleReplay = () => {
    if (!isHost) return;
    const category = activeCategory || reveal?.category || roleInfo.category || null;
    socket.emit("startGame", {
      roomId: room.id,
      gameType: "liarGame",
      liarCategory: category,
    });
  };

  const getRevealReason = (reason) => {
    switch (reason) {
      case "wrongAccusation":
        return "라이어가 아닌 사람을 지목했습니다.";
      case "liarGuessed":
        return "라이어가 단어를 맞혔습니다.";
      case "liarFailedGuess":
        return "라이어가 단어를 맞히지 못했습니다.";
      case "guessTimeout":
        return "라이어 추측 시간이 종료되었습니다.";
      default:
        return null;
    }
  };

  return (
    <div className="liar-game-container">
      <div className="game-header">
        <div className="game-header-content">
          <div className="liar-header-role">
            <div className={`role-card ${roleInfo.role || ""}`}>
              <div className="role-label">내 역할</div>
              <div className="role-value">
                {roleInfo.role === "liar"
                  ? "라이어"
                  : roleInfo.role === "villager"
                  ? "시민"
                  : "확인 중"}
              </div>
              <div className="role-word">
                {roleInfo.role === "liar" ? "제시어 없음" : roleInfo.word || "제시어 확인 중"}
              </div>
              {roleInfo.role !== "liar" && (
                <div className="role-category">{roleInfo.category || "카테고리 확인 중"}</div>
              )}
              <div className="role-subtext">라이어 {roleInfo.liarsCount}명</div>
            </div>
          </div>
          <div className="liar-header-text">
            <h2 className="liar-title">라이어 게임</h2>
            <p>차례가 되면 단어를 힌트로 설명하세요.</p>
          </div>
          <div className="game-header-actions">
            {isHost && !results && (
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

      <div className="liar-game-main">
        <div className="liar-chat-section">
          <div className="liar-time-text">
            남은 시간: {phase === "discussion" ? formatTime(timeRemaining) : "제한 없음"}
          </div>
          {phase === "discussion" && currentPlayerId && (
            <div className="liar-current-turn">
              <span className="turn-label">현재 차례:</span>
              <span className={`turn-player ${isMyTurn ? "my-turn" : ""}`}>
                {getPlayerName(currentPlayerId)}
                {isMyTurn && " (나)"}
              </span>
            </div>
          )}
          <div className="liar-chat-header">
            <h2>🗨️ 발언 기록</h2>
            <span>{messages.length}개</span>
          </div>
          <div className="liar-chat-messages">
            {messages.length === 0 ? (
              <div className="liar-chat-empty">아직 발언이 없습니다.</div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`liar-chat-message ${msg.playerId === socket.id ? "mine" : ""}`}
                >
                  <div className="liar-chat-name">{msg.playerName}</div>
                  <div className="liar-chat-text">{msg.message}</div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="liar-chat-input">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder={
                phase !== "discussion"
                  ? "발언 시간이 끝났습니다."
                  : isMyTurn
                  ? "힌트를 입력하세요"
                  : "내 차례가 아닙니다"
              }
              maxLength={200}
              disabled={phase !== "discussion" || !isMyTurn}
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={phase !== "discussion" || !isMyTurn || !messageInput.trim()}
            >
              전송
            </button>
          </div>
        </div>

        <div className="liar-vote-section">
          {phase !== "guess" && (
            <>
              <h2>🗳️ 라이어 지목</h2>
              {phase === "voting" ? (
                <div className="vote-grid">
                  {(voteCandidates && voteCandidates.length > 0
                    ? room.players.filter((player) => voteCandidates.includes(player.id))
                    : room.players
                  ).map((player) => (
                    <button
                      key={player.id}
                      className={`vote-button ${hasVoted ? "disabled" : ""}`}
                      onClick={() => handleVote(player.id)}
                      disabled={hasVoted}
                    >
                      {player.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="vote-wait">투표 단계에서 지목할 수 있습니다.</div>
              )}
              {hasVoted && <div className="vote-status">투표 완료!</div>}
            </>
          )}

          {phase === "guess" && (
            <>
              <h2>🧩 라이어 추측</h2>
              {roleInfo.role === "liar" ? (
                <div className="guess-panel">
                  <div className="guess-category">
                    카테고리: {guessCategory || "확인 중"}
                  </div>
                  {guessOptions.length === 0 ? (
                    <div className="vote-wait">선택지를 불러오는 중...</div>
                  ) : (
                    <>
                      <select
                        value={guessWord}
                        onChange={(e) => setGuessWord(e.target.value)}
                        disabled={guessSubmitted}
                      >
                        {guessOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleSubmitGuess}
                        disabled={guessSubmitted || !guessWord}
                      >
                        {guessSubmitted ? "제출 완료" : "정답 제출"}
                      </button>
                    </>
                  )}
                  {guessFeedback && <div className="guess-feedback">{guessFeedback}</div>}
                </div>
              ) : (
                <div className="vote-wait">라이어가 단어를 추측하고 있습니다.</div>
              )}
            </>
          )}
        </div>
      </div>

      {(reveal || results) && showRevealModal && (
        <div className="liar-modal-backdrop">
          <div className="liar-modal">
            {reveal ? (
              <>
                <h2>{reveal.winnerTeam === "villagers" ? "시민 승리!" : "라이어 승리!"}</h2>
                {getRevealReason(reveal.reason) && (
                  <p>{getRevealReason(reveal.reason)}</p>
                )}
                <p>제시어: {reveal.word}</p>
                <p>카테고리: {reveal.category || "알 수 없음"}</p>
                <p>라이어: {reveal.liarIds.map(getPlayerName).join(", ") || "없음"}</p>
              </>
            ) : (
              <>
                <h2>게임 종료</h2>
                <p>게임이 종료되었습니다.</p>
              </>
            )}
            <div className="liar-modal-actions">
              <button onClick={onBackToLobby}>로비로 나가기</button>
              {reveal && (
                <button onClick={handleReplay} disabled={!isHost}>
                  다시 플레이
                </button>
              )}
            </div>
            {reveal && !isHost && <p className="liar-modal-note">방장만 다시 플레이할 수 있어요.</p>}
          </div>
        </div>
      )}

    </div>
  );
}

export default LiarGame;
