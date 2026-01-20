import React, { useEffect, useRef, useState } from "react";
import GameScoreboard from "./GameScoreboard";
import GameResults from "./GameResults";
import "./DrawGuess.css";

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 420;
const DEFAULT_COLOR = "#222222";
const DEFAULT_SIZE = 4;
const COLOR_OPTIONS = ["#222222", "#e74c3c", "#3498db", "#2ecc71", "#f1c40f"];

function DrawGuess({ socket, room, onBackToLobby }) {
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const strokesRef = useRef([]);

  const [timeRemaining, setTimeRemaining] = useState(0);
  const [drawerId, setDrawerId] = useState(null);
  const [scores, setScores] = useState({});
  const [round, setRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(1);
  const [word, setWord] = useState(null);
  const [wordLength, setWordLength] = useState(0);
  const [roundAnswer, setRoundAnswer] = useState(null);
  const [results, setResults] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [brushColor, setBrushColor] = useState(DEFAULT_COLOR);
  const [brushSize, setBrushSize] = useState(DEFAULT_SIZE);
  const [isEraser, setIsEraser] = useState(false);
  const chatMessagesRef = useRef(null);
  const userScrolledUpRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);

  const resizeCanvasToDisplaySize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const getCanvasRect = () => {
    if (!canvasRef.current) return null;
    return canvasRef.current.getBoundingClientRect();
  };

  const isDrawer = drawerId === socket.id;

  const getCanvasPoint = (event) => {
    const rect = getCanvasRect();
    if (!rect) return null;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y };
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
  };

  const drawSegment = (stroke) => {
    const canvas = canvasRef.current;
    if (!canvas || !stroke?.from || !stroke?.to) return;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = stroke.color || DEFAULT_COLOR;
    ctx.lineWidth = stroke.size || DEFAULT_SIZE;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(stroke.from.x, stroke.from.y);
    ctx.lineTo(stroke.to.x, stroke.to.y);
    ctx.stroke();
  };

  const redrawAll = (strokes) => {
    clearCanvas();
    strokes.forEach((stroke) => drawSegment(stroke));
  };

  useEffect(() => {
    resizeCanvasToDisplaySize();
    clearCanvas();
    redrawAll(strokesRef.current);

    const handleResize = () => {
      resizeCanvasToDisplaySize();
      clearCanvas();
      redrawAll(strokesRef.current);
    };
    window.addEventListener("resize", handleResize);

    socket.on("gameStarted", ({ gameState }) => {
      if (!gameState || gameState.gameType !== "drawGuess") return;
      setDrawerId(gameState.drawerId || null);
      setRound(gameState.round || 1);
      setTotalRounds(gameState.totalRounds || 1);
      setTimeRemaining(gameState.duration || 0);
      setRoundAnswer(null);
      setWord(null);
    });

    socket.on("drawGuessRoundStarted", (payload) => {
      setDrawerId(payload.drawerId || null);
      setRound(payload.round || 1);
      setTotalRounds(payload.totalRounds || 1);
      setTimeRemaining(payload.duration || 0);
      setScores(payload.scores || {});
      setWordLength(payload.wordLength || 0);
      setRoundAnswer(null);
      setWord(null);
      strokesRef.current = [];
      clearCanvas();
    });

    socket.on("drawGuessUpdate", (payload) => {
      setTimeRemaining(payload.timeRemaining || 0);
      setScores(payload.scores || {});
      setDrawerId(payload.drawerId || null);
      setRound(payload.round || 1);
      setTotalRounds(payload.totalRounds || 1);
      setWordLength(payload.wordLength || 0);
    });

    socket.on("drawGuessState", (payload) => {
      setDrawerId(payload.drawerId || null);
      setRound(payload.round || 1);
      setTotalRounds(payload.totalRounds || 1);
      setScores(payload.scores || {});
      setWordLength(payload.wordLength || 0);
      strokesRef.current = payload.strokes || [];
      redrawAll(strokesRef.current);
      if (payload.timeRemaining !== null && payload.timeRemaining !== undefined) {
        setTimeRemaining(payload.timeRemaining);
      }
      if (payload.isDrawer) {
        setWord((prev) => prev);
      }
    });

    socket.on("drawGuessStroke", ({ stroke }) => {
      if (!stroke) return;
      if (stroke.senderId === socket.id) {
        return;
      }
      strokesRef.current.push(stroke);
      drawSegment(stroke);
    });

    socket.on("drawGuessClear", () => {
      strokesRef.current = [];
      clearCanvas();
    });

    socket.on("drawGuessWord", ({ word: newWord }) => {
      setWord(newWord || null);
    });

    socket.on("drawGuessCorrect", ({ playerName, points, scores: nextScores }) => {
      if (nextScores) {
        setScores(nextScores);
      }
      const message = `${playerName} 님이 정답! (+${points}점)`;
      setMessages((prev) => [
        ...prev,
        {
          id: `system_${Date.now()}`,
          message,
          type: "system",
          timestamp: Date.now(),
        },
      ]);
    });

    socket.on("drawGuessRoundEnded", ({ word: answer }) => {
      setRoundAnswer(answer || null);
    });

    socket.on("gameEnded", ({ results: gameResults }) => {
      setResults(gameResults || []);
    });

    socket.on("messageReceived", (messageData) => {
      setMessages((prev) => [...prev, messageData]);
    });

    socket.on("messageError", ({ message }) => {
      console.error("채팅 에러:", message);
    });

    socket.emit("getGameState", { roomId: room.id });

    return () => {
      window.removeEventListener("resize", handleResize);
      socket.off("gameStarted");
      socket.off("drawGuessRoundStarted");
      socket.off("drawGuessUpdate");
      socket.off("drawGuessState");
      socket.off("drawGuessStroke");
      socket.off("drawGuessClear");
      socket.off("drawGuessWord");
      socket.off("drawGuessCorrect");
      socket.off("drawGuessRoundEnded");
      socket.off("gameEnded");
      socket.off("messageReceived");
      socket.off("messageError");
    };
  }, [socket, room.id]);

  const isScrolledToBottom = (container) => {
    if (!container) return true;
    const threshold = 24;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
  };

  const scrollToBottom = () => {
    const container = chatMessagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    userScrolledUpRef.current = false;
  };

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) return;
    if (!userScrolledUpRef.current) {
      scrollToBottom();
      setShowScrollButton(false);
      setUnseenCount(0);
    } else {
      setShowScrollButton(true);
      setUnseenCount((prev) => prev + 1);
    }
  }, [messages]);

  const handleChatScroll = () => {
    const container = chatMessagesRef.current;
    if (!container) return;
    const atBottom = isScrolledToBottom(container);
    userScrolledUpRef.current = !atBottom;
    if (atBottom) {
      setShowScrollButton(false);
      setUnseenCount(0);
    } else {
      setShowScrollButton(true);
    }
  };

  const handlePointerDown = (event) => {
    if (!isDrawer) return;
    if (event.target && event.target.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId);
    }
    isDrawingRef.current = true;
    lastPointRef.current = getCanvasPoint(event);
  };

  const handlePointerMove = (event) => {
    if (!isDrawer || !isDrawingRef.current) return;
    const currentPoint = getCanvasPoint(event);
    if (!currentPoint || !lastPointRef.current) return;

    const strokeColor = isEraser ? "#ffffff" : brushColor;
    const strokeSize = isEraser ? Math.max(brushSize * 2, 8) : brushSize;
    const stroke = {
      from: lastPointRef.current,
      to: currentPoint,
      color: strokeColor,
      size: strokeSize,
      senderId: socket.id,
    };

    strokesRef.current.push(stroke);
    drawSegment(stroke);
    socket.emit("drawGuessStroke", { roomId: room.id, stroke });

    lastPointRef.current = currentPoint;
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleClear = () => {
    if (!isDrawer) return;
    strokesRef.current = [];
    clearCanvas();
    socket.emit("drawGuessClear", { roomId: room.id });
  };

  const handleSendMessage = () => {
    const trimmed = messageInput.trim();
    if (!trimmed) return;
    socket.emit("drawGuessMessage", { roomId: room.id, message: trimmed });
    setMessageInput("");
  };

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  const handleLeaveGame = () => {
    if (window.confirm("게임을 나가시겠습니까?")) {
      onBackToLobby();
    }
  };

  const handleEndGame = () => {
    if (window.confirm("게임을 종료하시겠습니까?")) {
      socket.emit("endGame", { roomId: room.id });
    }
  };

  if (results) {
    return (
      <div className="draw-guess-container">
        <div className="results-screen">
          <h2>게임 종료! 🎉</h2>
          <GameResults
            results={results}
            myPlayerId={socket.id}
            teamMode={false}
            scoreUnit="점"
          />
          <button onClick={onBackToLobby} className="back-button">
            로비로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="draw-guess-container">
      <div className="draw-guess-header">
        <div className="header-left">
          <h1>🎨 그림 맞히기</h1>
          <p>
            라운드 {round}/{totalRounds}
          </p>
        </div>
        <div className="header-right">
          <div className="timer">⏱️ {formatTime(timeRemaining)}</div>
          <div className="header-actions">
            {room?.players?.[0]?.id === socket.id && (
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

      <div className="draw-guess-body">
        <div className="canvas-panel">
          <div className="word-panel">
            {isDrawer ? (
              <span className="word-reveal">제시어: {word || "..."}</span>
            ) : (
              <span className="word-hidden">
                제시어: {"•".repeat(wordLength || 0)}
              </span>
            )}
            {roundAnswer && (
              <span className="word-answer">정답: {roundAnswer}</span>
            )}
          </div>
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className={`draw-canvas ${!isDrawer ? "readonly" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
          <div className="canvas-actions">
            {isDrawer ? (
              <>
                <div className="tool-group">
                  {COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-button ${brushColor === color && !isEraser ? "active" : ""}`}
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        setBrushColor(color);
                        setIsEraser(false);
                      }}
                      title="색상 선택"
                    />
                  ))}
                </div>
                <div className="tool-group">
                  <label className="size-label" htmlFor="brush-size">
                    굵기
                  </label>
                  <input
                    id="brush-size"
                    type="range"
                    min="2"
                    max="12"
                    step="1"
                    value={brushSize}
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  />
                </div>
                <button
                  onClick={() => setIsEraser((prev) => !prev)}
                  className={`eraser-button ${isEraser ? "active" : ""}`}
                >
                  🧽 지우개
                </button>
                <button onClick={handleClear} className="clear-button">
                  🧼 전체 지우기
                </button>
              </>
            ) : (
              <span className="guess-hint">정답을 입력해보세요!</span>
            )}
          </div>
        </div>

        <div className="side-panel">
          <GameScoreboard
            players={room.players}
            scores={scores}
            myPlayerId={socket.id}
            teamMode={false}
            scoreUnit="점"
          />

          <div className="chat-section">
            <div className="chat-header">
              <h3>채팅</h3>
            </div>
            <div className="chat-messages" ref={chatMessagesRef} onScroll={handleChatScroll}>
              {messages.length === 0 ? (
                <div className="chat-empty">아직 메시지가 없습니다.</div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`chat-message ${msg.type === "system" ? "system" : ""}`}
                  >
                    {msg.type === "system" ? (
                      <span className="system-message">{msg.message}</span>
                    ) : (
                      <>
                        <span className="chat-name">{msg.playerName}</span>
                        <span className="chat-text">{msg.message}</span>
                      </>
                    )}
                  </div>
                ))
              )}
              {showScrollButton && (
                <button
                  type="button"
                  className="chat-scroll-button"
                  onClick={scrollToBottom}
                >
                  아래로{unseenCount > 0 ? ` (${unseenCount})` : ""}
                </button>
              )}
            </div>
            <div className="chat-input">
              <input
                type="text"
                placeholder="정답을 입력하세요..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    handleSendMessage();
                  }
                }}
              />
              <button onClick={handleSendMessage} disabled={!messageInput.trim()}>
                전송
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DrawGuess;
