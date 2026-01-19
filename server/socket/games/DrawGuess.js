const fs = require("fs");
const path = require("path");

function loadWordList() {
  try {
    const wordPath = path.join(__dirname, "../../../vocab_list.csv");
    const raw = fs.readFileSync(wordPath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    console.warn("[DrawGuess] 단어 목록 로드 실패:", error.message);
    return ["사과", "자동차", "고양이", "학교", "비행기"];
  }
}

const WORD_LIST = loadWordList();
const ALLOW_SOLO_DRAWER_GUESS =
  process.env.ALLOW_SOLO_DRAW_GUESS === "true" ||
  process.env.NODE_ENV === "development";

class DrawGuess {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
    this.usedWords = new Set();
    this.updateInterval = null;
    this.isEndingRound = false;
  }

  initialize() {
    this.gameState.scores = {};
    this.room.players.forEach((player) => {
      this.gameState.scores[player.id] = 0;
    });
    this.gameState.round = 1;
    const roundsPerPlayer = Math.max(1, this.gameState.roundsPerPlayer || 1);
    this.gameState.totalRounds = Math.max(1, this.room.players.length) * roundsPerPlayer;
    this.gameState.drawerIndex = 0;
    this.gameState.strokes = [];
    this.gameState.word = this.getNextWord();
  }

  startUpdateLoop(endGameCallback) {
    this.endGameCallback = endGameCallback;
    this.startRound();

    this.updateInterval = setInterval(() => {
      if (!this.gameState.isActive) {
        return;
      }
      const remaining = this.getTimeRemaining();
      if (remaining <= 0) {
        this.endRound("timeout");
        return;
      }

      this.io.to(this.room.id).emit("drawGuessUpdate", {
        drawerId: this.getDrawerId(),
        round: this.gameState.round,
        totalRounds: this.gameState.totalRounds,
        timeRemaining: remaining,
        scores: this.gameState.scores,
        wordLength: this.gameState.word.length,
      });
    }, 1000);

    return this.updateInterval;
  }

  getDrawerId() {
    const drawer = this.room.players[this.gameState.drawerIndex];
    return drawer ? drawer.id : null;
  }

  getNextWord() {
    if (!WORD_LIST.length) return "사과";
    if (this.usedWords.size >= WORD_LIST.length) {
      this.usedWords.clear();
    }
    let word = null;
    for (let i = 0; i < 20; i += 1) {
      const candidate = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
      if (!this.usedWords.has(candidate)) {
        word = candidate;
        break;
      }
    }
    if (!word) {
      word = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
    }
    this.usedWords.add(word);
    return word;
  }

  startRound() {
    this.isEndingRound = false;
    this.gameState.isActive = true;
    this.gameState.startTime = Date.now();
    this.gameState.strokes = [];
    this.gameState.word = this.getNextWord();
    this.guessedPlayers = new Set();

    const drawerId = this.getDrawerId();
    this.io.to(this.room.id).emit("drawGuessRoundStarted", {
      drawerId,
      round: this.gameState.round,
      totalRounds: this.gameState.totalRounds,
      duration: this.gameState.duration,
      startTime: this.gameState.startTime,
      scores: this.gameState.scores,
      wordLength: this.gameState.word.length,
    });

    if (drawerId) {
      this.io.to(drawerId).emit("drawGuessWord", { word: this.gameState.word });
    }
  }

  getTimeRemaining() {
    const elapsed = Date.now() - this.gameState.startTime;
    return Math.max(0, this.gameState.duration - elapsed);
  }

  handleStroke(socketId, stroke) {
    if (socketId !== this.getDrawerId()) {
      return;
    }
    if (!stroke) return;
    this.gameState.strokes.push(stroke);
    this.io.to(this.room.id).emit("drawGuessStroke", { stroke });
  }

  handleClear(socketId) {
    if (socketId !== this.getDrawerId()) {
      return;
    }
    this.gameState.strokes = [];
    this.io.to(this.room.id).emit("drawGuessClear");
  }

  handleGuess(socketId, guess) {
    const drawerId = this.getDrawerId();
    if (!guess) {
      return false;
    }
    if (socketId === drawerId) {
      if (!ALLOW_SOLO_DRAWER_GUESS || this.room.players.length > 1) {
        return false;
      }
    }
    if (this.guessedPlayers?.has(socketId)) {
      return false;
    }
    const normalizedGuess = guess
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
    if (!normalizedGuess) return false;

    const normalizedAnswer = this.gameState.word
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
    if (normalizedGuess !== normalizedAnswer) {
      return false;
    }

    const remaining = this.getTimeRemaining();
    const guessPoints = Math.max(10, Math.ceil(remaining / 1000));
    const drawerPoints = 5;

    this.gameState.scores[socketId] =
      (this.gameState.scores[socketId] || 0) + guessPoints;
    if (drawerId && drawerId !== socketId) {
      this.gameState.scores[drawerId] =
        (this.gameState.scores[drawerId] || 0) + drawerPoints;
    }

    this.guessedPlayers.add(socketId);

    const player = this.room.players.find((p) => p.id === socketId);
    this.io.to(this.room.id).emit("drawGuessCorrect", {
      playerId: socketId,
      playerName: player?.name || "플레이어",
      points: guessPoints,
      drawerPoints,
      scores: this.gameState.scores,
    });

    const nonDrawerCount = Math.max(0, this.room.players.length - 1);
    if (this.guessedPlayers.size >= nonDrawerCount) {
      this.endRound("allGuessed");
    }

    return true;
  }

  calculateResults() {
    let winners = [];
    let maxScore = 0;

    Object.entries(this.gameState.scores).forEach(([playerId, score]) => {
      if (score > maxScore) {
        maxScore = score;
        winners = [playerId];
      } else if (score === maxScore && maxScore > 0) {
        winners.push(playerId);
      }
    });

    const results = this.room.players.map((player) => ({
      id: player.id,
      name: player.name,
      photo: player.photo,
      score: this.gameState.scores[player.id] || 0,
      isWinner: winners.includes(player.id),
    }));

    results.sort((a, b) => b.score - a.score);

    return { results, winners };
  }

  endRound(reason) {
    if (this.isEndingRound) return;
    this.isEndingRound = true;

    this.io.to(this.room.id).emit("drawGuessRoundEnded", {
      word: this.gameState.word,
      reason,
      drawerId: this.getDrawerId(),
      round: this.gameState.round,
      totalRounds: this.gameState.totalRounds,
      scores: this.gameState.scores,
    });

    if (this.gameState.round >= this.gameState.totalRounds) {
      if (this.endGameCallback) {
        this.endGameCallback();
      }
      return;
    }

    this.gameState.round += 1;
    this.gameState.drawerIndex =
      (this.gameState.drawerIndex + 1) % this.room.players.length;
    this.startRound();
  }

  getGameStateData(socketId) {
    const drawerId = this.getDrawerId();
    const remaining = this.getTimeRemaining();
    return {
      duration: this.gameState.duration,
      startTime: this.gameState.startTime,
      gameType: this.gameState.gameType,
      drawerId,
      round: this.gameState.round,
      totalRounds: this.gameState.totalRounds,
      scores: this.gameState.scores,
      strokes: this.gameState.strokes,
      wordLength: this.gameState.word.length,
      timeRemaining: remaining,
      isDrawer: socketId === drawerId,
    };
  }

  // ===== Refactor hooks (gameHandler에서 하드코딩 제거용) =====
  getUpdateEventName() {
    // 재연결 시에는 전체 상태를 보내야 하므로 State 이벤트 사용
    return "drawGuessState";
  }

  getClientUpdateData(socketId) {
    const state = this.getGameStateData(socketId);
    return {
      strokes: state.strokes || [],
      scores: state.scores || {},
      timeRemaining: state.timeRemaining ?? null,
      drawerId: state.drawerId,
      round: state.round,
      totalRounds: state.totalRounds,
      wordLength: state.wordLength,
      isDrawer: state.isDrawer,
    };
  }

  getGameStartedPayload(socketId) {
    const state = this.getGameStateData(socketId);
    return {
      duration: state.duration,
      startTime: state.startTime,
      gameType: state.gameType,
      drawerId: state.drawerId,
      round: state.round,
      totalRounds: state.totalRounds,
    };
  }

  emitPrivateState(socket) {
    const state = this.getGameStateData(socket.id);
    if (state.isDrawer) {
      socket.emit("drawGuessWord", { word: this.gameState.word });
    }
  }

  shouldUseGlobalTimer() {
    // 라운드 진행/종료를 게임 내부에서 제어
    return false;
  }
}

module.exports = DrawGuess;
