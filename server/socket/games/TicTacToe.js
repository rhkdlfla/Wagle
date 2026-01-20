class TicTacToe {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
    this.endGameCallback = null;
  }

  initialize() {
    if (!this.room.players || this.room.players.length !== 2) {
      throw new Error("2인만 플레이할 수 있습니다.");
    }

    const shuffledPlayers = [...this.room.players];
    const firstIndex = Math.random() < 0.5 ? 0 : 1;
    if (firstIndex === 1) {
      shuffledPlayers.reverse();
    }
    const [playerX, playerO] = shuffledPlayers;
    this.gameState.board = Array(9).fill(null);
    this.gameState.playerOrder = [playerX.id, playerO.id];
    this.gameState.symbols = {
      [playerX.id]: "X",
      [playerO.id]: "O",
    };
    this.gameState.currentTurn = playerX.id;
    this.gameState.winner = null;
    this.gameState.isDraw = false;
  }

  startUpdateLoop(endGameCallback) {
    this.endGameCallback = endGameCallback;
    return null;
  }

  handleAction(socketId, action, data) {
    if (action === "placeMark") {
      return this.placeMark(socketId, data?.index);
    }
    return false;
  }

  placeMark(socketId, index) {
    if (this.gameState.winner || this.gameState.isDraw) {
      return false;
    }

    if (!this.gameState.playerOrder.includes(socketId)) {
      return false;
    }

    if (this.gameState.currentTurn !== socketId) {
      return false;
    }

    const position = Number(index);
    if (!Number.isInteger(position) || position < 0 || position > 8) {
      return false;
    }

    if (this.gameState.board[position]) {
      return false;
    }

    const symbol = this.gameState.symbols[socketId];
    if (!symbol) {
      return false;
    }

    this.gameState.board[position] = symbol;

    if (this.checkWinner(symbol)) {
      this.gameState.winner = socketId;
      this.sendUpdate();
      if (this.endGameCallback) {
        this.endGameCallback();
      }
      return true;
    }

    if (this.gameState.board.every((cell) => cell !== null)) {
      this.gameState.isDraw = true;
      this.sendUpdate();
      if (this.endGameCallback) {
        this.endGameCallback();
      }
      return true;
    }

    const [playerX, playerO] = this.gameState.playerOrder;
    this.gameState.currentTurn = socketId === playerX ? playerO : playerX;
    this.sendUpdate();
    return true;
  }

  checkWinner(symbol) {
    const b = this.gameState.board;
    const wins = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];

    return wins.some((line) => line.every((idx) => b[idx] === symbol));
  }

  calculateResults() {
    const winnerId = this.gameState.winner;
    const winners = winnerId ? [winnerId] : [];

    const results = (this.room.players || []).map((player) => ({
      id: player.id,
      name: player.name,
      photo: player.photo,
      score: winnerId && player.id === winnerId ? 1 : 0,
      isWinner: winnerId ? player.id === winnerId : false,
    }));

    return { results, winners };
  }

  getGameStateData() {
    const players = (this.room.players || []).map((player) => ({
      id: player.id,
      name: player.name,
      photo: player.photo,
      symbol: this.gameState.symbols?.[player.id] || null,
    }));

    return {
      gameType: this.gameState.gameType,
      board: this.gameState.board || Array(9).fill(null),
      currentTurn: this.gameState.currentTurn || null,
      players,
      winner: this.gameState.winner,
      isDraw: this.gameState.isDraw,
    };
  }

  getGameStartedPayload() {
    return this.getGameStateData();
  }

  getUpdateEventName() {
    return "ticTacToeUpdate";
  }

  shouldUseGlobalTimer() {
    return false;
  }

  sendUpdate() {
    this.io.to(this.room.id).emit(this.getUpdateEventName(), this.getGameStateData());
  }
}

module.exports = TicTacToe;
