class ClickBattle {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
  }

  // 게임 초기화
  initialize() {
    this.room.players.forEach((player) => {
      this.gameState.clicks[player.id] = 0;
    });
  }

  // 주기적 업데이트 시작
  startUpdateLoop(endGameCallback) {
    const updateInterval = setInterval(() => {
      const elapsed = Date.now() - this.gameState.startTime;
      const remaining = Math.max(0, this.gameState.duration - elapsed);
      
      if (remaining <= 0) {
        clearInterval(updateInterval);
        endGameCallback();
        return;
      }
      
      const clickUpdates = this.room.players.map((p) => ({
        id: p.id,
        clicks: this.gameState.clicks[p.id] || 0,
      }));
      
      this.io.to(this.room.id).emit("clickUpdate", {
        updates: clickUpdates,
        timeRemaining: remaining,
      });
    }, 1000);
    
    return updateInterval;
  }

  // 클릭 처리
  handleClick(socketId) {
    if (!this.gameState.clicks[socketId]) {
      this.gameState.clicks[socketId] = 0;
    }
    this.gameState.clicks[socketId]++;
    
    const clickUpdates = this.room.players.map((p) => ({
      id: p.id,
      clicks: this.gameState.clicks[p.id] || 0,
    }));
    
    this.io.to(this.room.id).emit("clickUpdate", {
      updates: clickUpdates,
      timeRemaining: Math.max(0, this.gameState.duration - (Date.now() - this.gameState.startTime)),
    });
  }

  // 게임 결과 계산
  calculateResults() {
    let winners = [];
    let maxScore = 0;
    
    Object.entries(this.gameState.clicks).forEach(([playerId, clicks]) => {
      if (clicks > maxScore) {
        maxScore = clicks;
        winners.length = 0;
        winners.push(playerId);
      } else if (clicks === maxScore && maxScore > 0) {
        winners.push(playerId);
      }
    });
    
    const results = this.room.players.map((player) => ({
      id: player.id,
      name: player.name,
      photo: player.photo,
      score: this.gameState.clicks[player.id] || 0,
      isWinner: winners.includes(player.id),
    }));
    
    results.sort((a, b) => b.score - a.score);
    
    return { results, winners };
  }

  // 게임 상태 반환 (재연결 시)
  getGameStateData() {
    const elapsed = Date.now() - this.gameState.startTime;
    const remaining = Math.max(0, this.gameState.duration - elapsed);
    
    const clickUpdates = this.room.players.map((p) => ({
      id: p.id,
      clicks: this.gameState.clicks[p.id] || 0,
    }));
    
    return {
      duration: this.gameState.duration,
      startTime: this.gameState.startTime,
      gameType: this.gameState.gameType,
      clickUpdates,
      timeRemaining: remaining,
    };
  }
}

module.exports = ClickBattle;
