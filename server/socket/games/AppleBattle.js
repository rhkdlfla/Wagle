class AppleBattle {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
  }

  // 게임 초기화
  initialize() {
    // 17×10 그리드 생성 (1~9 숫자)
    const grid = [];
    for (let row = 0; row < 10; row++) {
      grid[row] = [];
      for (let col = 0; col < 17; col++) {
        grid[row][col] = {
          value: Math.floor(Math.random() * 9) + 1, // 1~9
          owner: null, // 칸의 소유자 (플레이어 ID, 팀전 모드에서는 teamId 사용)
          teamId: null, // 칸의 소유 팀 (팀전 모드일 때)
        };
      }
    }
    this.gameState.grid = grid;
    this.gameState.scores = {}; // 플레이어별 점수 (칸 개수)
    this.gameState.teamScores = {}; // 팀별 점수
    this.room.players.forEach((player) => {
      this.gameState.scores[player.id] = 0;
    });
    
    // 팀전 모드인 경우 팀 점수 초기화
    if (this.room.teamMode && this.room.teams) {
      this.room.teams.forEach((team) => {
        this.gameState.teamScores[team.id] = 0;
      });
    }
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
      
      const scoreUpdates = this.room.players.map((p) => ({
        id: p.id,
        score: this.gameState.scores[p.id] || 0,
      }));
      
      this.io.to(this.room.id).emit("appleBattleUpdate", {
        scores: scoreUpdates,
        timeRemaining: remaining,
        grid: this.gameState.grid,
      });
    }, 1000);
    
    return updateInterval;
  }

  // 사과 제거 및 땅따먹기 처리
  handleRemove(socketId, startRow, startCol, endRow, endCol) {
    // 선택된 영역의 사과 합 계산
    let sum = 0;
    const allSelectedCells = []; // 모든 선택된 칸 (덮어쓰기용)
    
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (row >= 0 && row < 10 && col >= 0 && col < 17) {
          const cell = this.gameState.grid[row][col];
          // 모든 칸을 allSelectedCells에 추가 (덮어쓰기용)
          allSelectedCells.push({ row, col });
          
          // 합 계산은 value > 0인 칸만
          if (cell && cell.value && cell.value > 0) {
            sum += cell.value;
          }
        }
      }
    }
    
    // 합이 10이 아니면 무시
    if (sum !== 10) {
      return false;
    }
    
    // 플레이어 정보 가져오기
    const player = this.room.players.find((p) => p.id === socketId);
    const playerTeamId = player && player.teamId ? player.teamId : null;
    const isTeamMode = this.room.teamMode && this.room.teams && this.room.teams.length > 0;
    
    // 사과 제거 및 땅따먹기
    let newScore = this.gameState.scores[socketId] || 0;
    
    // 먼저 기존 소유자의 점수 감소 (덮어쓰기) - 모든 선택된 칸에 대해
    allSelectedCells.forEach(({ row, col }) => {
      const cell = this.gameState.grid[row][col];
      const oldOwner = cell.owner;
      const oldTeamId = cell.teamId;
      const wasOwned = oldOwner && oldOwner !== socketId;
      
      // 개인 점수 감소
      if (wasOwned && this.gameState.scores[oldOwner]) {
        this.gameState.scores[oldOwner] = Math.max(0, this.gameState.scores[oldOwner] - 1);
      }
      
      // 팀 점수 감소 (팀전 모드인 경우)
      if (isTeamMode && oldTeamId && oldTeamId !== playerTeamId && this.gameState.teamScores[oldTeamId]) {
        this.gameState.teamScores[oldTeamId] = Math.max(0, this.gameState.teamScores[oldTeamId] - 1);
      }
    });
    
    // 그 다음 새 소유자로 설정하고 점수 증가
    allSelectedCells.forEach(({ row, col }) => {
      const cell = this.gameState.grid[row][col];
      
      // 사과가 있는 칸(value > 0)만 제거하고, 모든 칸은 땅따먹기
      if (cell.value && cell.value > 0) {
        cell.value = 0;
      }
      // 땅따먹기 (덮어쓰기 가능) - 모든 칸에 대해
      cell.owner = socketId;
      cell.teamId = playerTeamId; // 팀전 모드일 때 팀 ID 저장
      newScore++;
    });
    
    this.gameState.scores[socketId] = newScore;
    
    // 팀 점수 증가 (팀전 모드인 경우)
    if (isTeamMode && playerTeamId) {
      const cellsCount = allSelectedCells.length;
      this.gameState.teamScores[playerTeamId] = (this.gameState.teamScores[playerTeamId] || 0) + cellsCount;
    }
    
    // 모든 플레이어에게 업데이트 전송
    const scoreUpdates = this.room.players.map((p) => ({
      id: p.id,
      score: this.gameState.scores[p.id] || 0,
    }));
    
    this.io.to(this.room.id).emit("appleBattleUpdate", {
      scores: scoreUpdates,
      teamScores: isTeamMode ? this.gameState.teamScores : null,
      timeRemaining: Math.max(0, this.gameState.duration - (Date.now() - this.gameState.startTime)),
      grid: this.gameState.grid,
    });
    
    return true;
  }

  // 게임 결과 계산
  calculateResults() {
    const isTeamMode = this.room.teamMode && this.room.teams && this.room.teams.length > 0;
    
    // 팀전 모드인 경우 팀별 점수 계산
    if (isTeamMode) {
      let winningTeams = [];
      let maxTeamScore = 0;
      
      Object.entries(this.gameState.teamScores).forEach(([teamId, score]) => {
        if (score > maxTeamScore) {
          maxTeamScore = score;
          winningTeams = [Number(teamId)];
        } else if (score === maxTeamScore && maxTeamScore > 0) {
          winningTeams.push(Number(teamId));
        }
      });
      
      const results = this.room.players.map((player) => {
        const score = this.gameState.scores[player.id] || 0;
        const isWinner = player.teamId && winningTeams.includes(player.teamId);
        return {
          id: player.id,
          name: player.name,
          photo: player.photo,
          score: score,
          teamId: player.teamId || null,
          teamScore: player.teamId ? this.gameState.teamScores[player.teamId] : null,
          isWinner: isWinner,
        };
      });
      
      results.sort((a, b) => {
        // 팀 점수로 먼저 정렬, 그 다음 개인 점수
        if (a.teamScore !== null && b.teamScore !== null) {
          if (b.teamScore !== a.teamScore) return b.teamScore - a.teamScore;
        }
        return b.score - a.score;
      });
      
      return { results, winners: winningTeams, teamScores: this.gameState.teamScores };
    }
    
    // 개인전 모드 (기존 로직)
    let winners = [];
    let maxScore = 0;
    
    Object.entries(this.gameState.scores).forEach(([playerId, score]) => {
      if (score > maxScore) {
        maxScore = score;
        winners.length = 0;
        winners.push(playerId);
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

  // 게임 상태 반환 (재연결 시)
  getGameStateData() {
    const elapsed = Date.now() - this.gameState.startTime;
    const remaining = Math.max(0, this.gameState.duration - elapsed);
    
    const scoreUpdates = this.room.players.map((p) => ({
      id: p.id,
      score: this.gameState.scores[p.id] || 0,
    }));
    
    return {
      duration: this.gameState.duration,
      startTime: this.gameState.startTime,
      gameType: this.gameState.gameType,
      grid: this.gameState.grid,
      scoreUpdates,
      timeRemaining: remaining,
    };
  }
}

module.exports = AppleBattle;
