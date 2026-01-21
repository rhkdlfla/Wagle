const { getLiarVocab } = require("../../utils/liarVocab");

function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

class LiarGame {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
    this.updateInterval = null;
    this.vocab = null;
    this.categoryWords = [];
  }

  initialize() {
    const players = this.room.players || [];
    const playerIds = players.map((player) => player.id);
    const turnOrder = shuffleArray(playerIds);
    const liarCount = players.length <= 5 ? 1 : 2;
    const shuffledForLiar = shuffleArray(playerIds);
    this.vocab = getLiarVocab();
    const { category, word, wordsInCategory } = this.getNextWord(this.gameState.liarCategory);
    this.categoryWords = Array.from(new Set(wordsInCategory || []));

    this.gameState.turnDuration =
      this.gameState.liarTurnDuration === null
        ? null
        : this.gameState.liarTurnDuration || 30000;
    this.gameState.votingDuration = null;
    this.gameState.guessDuration = null;
    this.gameState.phase = "discussion";
    this.gameState.turnOrder = [...turnOrder, ...turnOrder];
    this.gameState.turnIndex = 0;
    this.gameState.turnStartTime = Date.now();
    this.gameState.messages = [];
    this.gameState.votes = {};
    this.gameState.guessAttempts = {};
    this.gameState.liarIds = shuffledForLiar.slice(0, liarCount);
    this.gameState.word = word;
    this.gameState.category = category;
    this.gameState.reveal = null;
  }

  startUpdateLoop(endGameCallback) {
    this.endGameCallback = endGameCallback;
    this.broadcastRoles();
    this.sendUpdate();

    this.updateInterval = setInterval(() => {
      if (!this.gameState.isActive) {
        return;
      }

      if (this.gameState.phase === "discussion") {
        const remaining = this.getTurnTimeRemaining();
        if (remaining !== null && remaining <= 0) {
          this.advanceTurn("timeout");
          return;
        }
      } else if (this.gameState.phase === "voting") {
        const remaining = this.getVotingTimeRemaining();
        if (remaining !== null && remaining <= 0) {
          this.finishVoting("timeout");
          return;
        }
      } else if (this.gameState.phase === "guess") {
        const remaining = this.getGuessTimeRemaining();
        if (remaining !== null && remaining <= 0) {
          this.finalizeGame({
            winnerTeam: "villagers",
            reason: "guessTimeout",
            accusedIds: this.gameState.accusedIds || [],
          });
          return;
        }
      }

      this.sendUpdate();
    }, 500);

    return this.updateInterval;
  }

  broadcastRoles() {
    this.room.players.forEach((player) => {
      const isLiar = this.gameState.liarIds?.includes(player.id);
      this.io.to(player.id).emit("liarGameRole", {
        role: isLiar ? "liar" : "villager",
        word: isLiar ? null : this.gameState.word,
        category: isLiar ? null : this.gameState.category,
        liarsCount: this.gameState.liarIds?.length || 0,
      });
    });
  }

  getNextWord(selectedCategory) {
    const vocab = this.vocab || getLiarVocab();
    const hasCategory =
      selectedCategory && vocab.wordsByCategory && vocab.wordsByCategory[selectedCategory];
    const entries = hasCategory
      ? vocab.entries.filter((entry) => entry.category === selectedCategory)
      : vocab.entries;

    if (!entries || entries.length === 0) {
      return { category: "음식", word: "사과", wordsInCategory: ["사과"] };
    }

    const picked = entries[Math.floor(Math.random() * entries.length)];
    const wordsInCategory =
      vocab.wordsByCategory?.[picked.category] || [picked.word];

    return {
      category: picked.category,
      word: picked.word,
      wordsInCategory: wordsInCategory,
    };
  }

  getCurrentPlayerId() {
    const currentId = this.gameState.turnOrder?.[this.gameState.turnIndex];
    return currentId || null;
  }

  getTurnTimeRemaining() {
    if (this.gameState.turnDuration == null) return null;
    const elapsed = Date.now() - this.gameState.turnStartTime;
    return Math.max(0, this.gameState.turnDuration - elapsed);
  }

  getVotingTimeRemaining() {
    if (this.gameState.votingDuration == null) return null;
    if (!this.gameState.votingStartTime) return this.gameState.votingDuration;
    const elapsed = Date.now() - this.gameState.votingStartTime;
    return Math.max(0, this.gameState.votingDuration - elapsed);
  }

  getGuessTimeRemaining() {
    if (this.gameState.guessDuration == null) return null;
    if (!this.gameState.guessStartTime) return this.gameState.guessDuration;
    const elapsed = Date.now() - this.gameState.guessStartTime;
    return Math.max(0, this.gameState.guessDuration - elapsed);
  }

  sendUpdate() {
    this.io.to(this.room.id).emit("liarGameUpdate", {
      phase: this.gameState.phase,
      currentPlayerId: this.getCurrentPlayerId(),
      turnIndex: this.gameState.turnIndex,
      totalTurns: this.gameState.turnOrder?.length || 0,
      timeRemaining:
        this.gameState.phase === "voting"
          ? this.getVotingTimeRemaining()
          : this.gameState.phase === "guess"
          ? this.getGuessTimeRemaining()
          : this.getTurnTimeRemaining(),
      votesCount: Object.keys(this.gameState.votes || {}).length,
      voteCandidates: this.gameState.voteCandidates || null,
    });
  }

  handleAction(socketId, action, data) {
    if (action === "submitMessage") {
      return this.submitMessage(socketId, data?.message);
    }
    if (action === "submitVote") {
      return this.submitVote(socketId, data?.targetId);
    }
    if (action === "submitGuess") {
      return this.submitGuess(socketId, data?.word);
    }
    return false;
  }

  submitMessage(socketId, message) {
    if (this.gameState.phase !== "discussion") return false;
    if (socketId !== this.getCurrentPlayerId()) return false;

    const trimmedMessage = (message || "").trim();
    if (!trimmedMessage) return false;
    if (trimmedMessage.length > 200) return false;

    const player = this.room.players.find((p) => p.id === socketId);
    const messageData = {
      id: `liar_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      playerId: socketId,
      playerName: player?.name || "플레이어",
      playerPhoto: player?.photo || null,
      message: trimmedMessage,
      timestamp: Date.now(),
    };

    this.gameState.messages.push(messageData);
    this.io.to(this.room.id).emit("liarGameMessage", messageData);
    this.advanceTurn("message");
    return true;
  }

  emitSystemMessage(text) {
    const messageData = {
      id: `liar_sys_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      playerId: "system",
      playerName: "시스템",
      playerPhoto: null,
      message: text,
      timestamp: Date.now(),
    };
    this.gameState.messages.push(messageData);
    this.io.to(this.room.id).emit("liarGameMessage", messageData);
  }

  advanceTurn(reason) {
    if (this.gameState.phase !== "discussion") return;
    const totalTurns = this.gameState.turnOrder?.length || 0;
    if (totalTurns <= 0) {
      this.startVoting(reason);
      return;
    }

    if (this.gameState.turnIndex >= totalTurns - 1) {
      this.startVoting(reason);
      return;
    }

    this.gameState.turnIndex += 1;
    this.gameState.turnStartTime = Date.now();
    this.sendUpdate();
  }

  startVoting(reason, voteCandidates = null) {
    this.gameState.phase = "voting";
    this.gameState.votingStartTime = Date.now();
    this.gameState.votes = {};
    this.gameState.voteCandidates = voteCandidates;
    this.io.to(this.room.id).emit("liarGameVotingStarted", {
      reason,
      voteCandidates,
    });
    this.sendUpdate();
  }

  submitVote(socketId, targetId) {
    if (this.gameState.phase !== "voting") return false;
    if (this.gameState.votes[socketId]) return false;

    const target = this.room.players.find((p) => p.id === targetId);
    if (!target) return false;

    this.gameState.votes[socketId] = targetId;

    if (Object.keys(this.gameState.votes).length >= this.room.players.length) {
      this.finishVoting("allVoted");
    } else {
      this.sendUpdate();
    }
    return true;
  }

  finishVoting(reason) {
    if (this.gameState.phase !== "voting") return;

    const voteCounts = {};
    Object.values(this.gameState.votes).forEach((targetId) => {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    });

    let maxVotes = 0;
    Object.values(voteCounts).forEach((count) => {
      if (count > maxVotes) maxVotes = count;
    });

    const accusedIds =
      maxVotes > 0
        ? Object.entries(voteCounts)
            .filter(([, count]) => count === maxVotes)
            .map(([targetId]) => targetId)
        : [];

    this.emitSystemMessage("투표가 종료되었습니다!");

    if (accusedIds.length > 1) {
      this.emitSystemMessage("투표 결과 동점으로 투표를 재실시합니다.");
      this.startVoting("tie", accusedIds);
      return;
    }

    const liars = this.gameState.liarIds || [];
    const caughtLiar = accusedIds.some((id) => liars.includes(id));

    if (!caughtLiar) {
      this.finalizeGame({
        winnerTeam: "liars",
        reason: "wrongAccusation",
        accusedIds,
        voteCounts,
      });
      return;
    }

    this.startGuessPhase({ accusedIds, voteCounts, reason });
  }

  startGuessPhase({ accusedIds, voteCounts, reason }) {
    this.gameState.phase = "guess";
    this.gameState.guessStartTime = Date.now();
    this.gameState.guessAttempts = {};
    this.gameState.accusedIds = accusedIds;
    this.gameState.voteCounts = voteCounts;
    this.gameState.voteReason = reason;

    this.io.to(this.room.id).emit("liarGameGuessStarted", {
      accusedIds,
      category: this.gameState.category,
      timeRemaining: this.getGuessTimeRemaining(),
    });

    this.room.players.forEach((player) => {
      if (this.gameState.liarIds?.includes(player.id)) {
        this.io.to(player.id).emit("liarGameGuessOptions", {
          category: this.gameState.category,
          words: this.categoryWords || [],
        });
      }
    });

    this.sendUpdate();
  }

  submitGuess(socketId, word) {
    if (this.gameState.phase !== "guess") return false;
    if (!this.gameState.liarIds?.includes(socketId)) return false;
    if (this.gameState.guessAttempts?.[socketId]) return false;

    const trimmedWord = String(word || "").trim();
    if (!trimmedWord) return false;

    this.gameState.guessAttempts[socketId] = trimmedWord;
    const isCorrect = trimmedWord === this.gameState.word;

    this.io.to(socketId).emit("liarGameGuessResult", {
      correct: isCorrect,
    });

    if (isCorrect) {
      this.finalizeGame({
        winnerTeam: "liars",
        reason: "liarGuessed",
        accusedIds: this.gameState.accusedIds || [],
      });
      return true;
    }

    const liarCount = this.gameState.liarIds?.length || 0;
    const guesses = Object.keys(this.gameState.guessAttempts || {}).length;
    if (guesses >= liarCount) {
      this.finalizeGame({
        winnerTeam: "villagers",
        reason: "liarFailedGuess",
        accusedIds: this.gameState.accusedIds || [],
      });
    } else {
      this.sendUpdate();
    }

    return true;
  }

  finalizeGame({ winnerTeam, reason, accusedIds, voteCounts } = {}) {
    const liars = this.gameState.liarIds || [];
    this.gameState.reveal = {
      winnerTeam,
      accusedIds: accusedIds || [],
      voteCounts: voteCounts || this.gameState.voteCounts || {},
      liarIds: liars,
      word: this.gameState.word,
      category: this.gameState.category,
      reason,
    };

    this.io.to(this.room.id).emit("liarGameReveal", this.gameState.reveal);

    if (this.endGameCallback) {
      this.endGameCallback();
    }
  }

  calculateResults() {
    const liars = this.gameState.liarIds || [];
    const winnerTeam = this.gameState.reveal?.winnerTeam || "liars";
    const winnerIds =
      winnerTeam === "liars"
        ? liars
        : this.room.players.map((player) => player.id).filter((id) => !liars.includes(id));

    const results = this.room.players.map((player) => ({
      id: player.id,
      name: player.name,
      photo: player.photo,
      score: winnerIds.includes(player.id) ? 1 : 0,
      isWinner: winnerIds.includes(player.id),
    }));

    return { results, winners: winnerIds };
  }

  getGameStateData(socketId) {
    const currentPlayerId = this.getCurrentPlayerId();
    return {
      duration: this.gameState.duration,
      startTime: this.gameState.startTime,
      gameType: this.gameState.gameType,
      phase: this.gameState.phase,
      turnIndex: this.gameState.turnIndex,
      totalTurns: this.gameState.turnOrder?.length || 0,
      currentPlayerId,
      timeRemaining:
        this.gameState.phase === "voting"
          ? this.getVotingTimeRemaining()
          : this.gameState.phase === "guess"
          ? this.getGuessTimeRemaining()
          : this.getTurnTimeRemaining(),
      turnDuration: this.gameState.turnDuration,
      votingDuration: this.gameState.votingDuration,
      guessDuration: this.gameState.guessDuration,
      messages: this.gameState.messages || [],
      votesCount: Object.keys(this.gameState.votes || {}).length,
      hasVoted: Boolean(this.gameState.votes?.[socketId]),
      voteCandidates: this.gameState.voteCandidates || null,
      hasGuessed: Boolean(this.gameState.guessAttempts?.[socketId]),
      category: this.gameState.category,
    };
  }

  getUpdateEventName() {
    return "liarGameState";
  }

  getClientUpdateData(socketId) {
    return this.getGameStateData(socketId);
  }

  getGameStartedPayload(socketId) {
    return this.getGameStateData(socketId);
  }

  getRevealData() {
    return this.gameState.reveal || null;
  }

  emitPrivateState(socket) {
    const isLiar = this.gameState.liarIds?.includes(socket.id);
    socket.emit("liarGameRole", {
      role: isLiar ? "liar" : "villager",
      word: isLiar ? null : this.gameState.word,
      category: isLiar ? null : this.gameState.category,
      liarsCount: this.gameState.liarIds?.length || 0,
    });

    if (this.gameState.phase === "guess" && isLiar) {
      socket.emit("liarGameGuessOptions", {
        category: this.gameState.category,
        words: this.categoryWords || [],
      });
    }
  }

  shouldUseGlobalTimer() {
    return false;
  }
}

module.exports = LiarGame;
