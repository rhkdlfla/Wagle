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
    
    // 이어달리기 모드 초기화 (팀전 모드일 때만)
    if (this.gameState.relayMode && this.room.teamMode && this.room.teams) {
      this.gameState.teamActivePlayers = {};
      this.room.teams.forEach((team) => {
        const teamPlayers = this.room.players.filter((p) => p.teamId === team.id);
        if (teamPlayers.length > 0) {
          // 각 팀의 첫 번째 플레이어를 활성 플레이어로 설정
          this.gameState.teamActivePlayers[team.id] = teamPlayers[0].id;
        }
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
      
      // 클라이언트 업데이트 데이터 사용 (일관성 유지)
      const clientUpdateData = this.getClientUpdateData();
      clientUpdateData.timeRemaining = remaining; // 시간은 실시간으로 업데이트
      
      this.io.to(this.room.id).emit(this.getUpdateEventName(), clientUpdateData);
    }, 1000);
    
    return updateInterval;
  }

  // 클릭 처리
  handleClick(socketId) {
    // 이어달리기 모드일 때 현재 플레이어가 활성 플레이어인지 확인
    if (this.gameState.relayMode && this.room.teamMode) {
      const player = this.room.players.find((p) => p.id === socketId);
      if (!player || !player.teamId) {
        return false; // 팀이 없는 플레이어는 클릭 불가
      }
      
      const activePlayerId = this.gameState.teamActivePlayers?.[player.teamId];
      if (activePlayerId !== socketId) {
        return false; // 현재 차례가 아닌 플레이어는 클릭 불가
      }
    }
    
    if (!this.gameState.clicks[socketId]) {
      this.gameState.clicks[socketId] = 0;
    }
    this.gameState.clicks[socketId]++;
    
    // 클라이언트 업데이트 데이터 사용 (일관성 유지)
    const clientUpdateData = this.getClientUpdateData();
    clientUpdateData.timeRemaining = Math.max(0, this.gameState.duration - (Date.now() - this.gameState.startTime));
    
    this.io.to(this.room.id).emit(this.getUpdateEventName(), clientUpdateData);
  }
  
  // 이어달리기 모드: 다음 팀원에게 순서 넘기기
  passTurn(socketId) {
    if (!this.gameState.relayMode || !this.room.teamMode) {
      return false;
    }
    
    const player = this.room.players.find((p) => p.id === socketId);
    if (!player || !player.teamId) {
      return false;
    }
    
    const activePlayerId = this.gameState.teamActivePlayers?.[player.teamId];
    if (activePlayerId !== socketId) {
      return false; // 현재 차례가 아닌 플레이어는 순서 넘기기 불가
    }
    
    const teamPlayers = this.room.players
      .filter((p) => p.teamId === player.teamId)
      .sort((a, b) => {
        // 플레이어 ID로 정렬 (순서 일관성 유지)
        return a.id.localeCompare(b.id);
      });
    
    const currentIndex = teamPlayers.findIndex((p) => p.id === socketId);
    if (currentIndex === -1) {
      return false;
    }
    
    // 다음 플레이어로 순서 넘기기 (순환)
    const nextIndex = (currentIndex + 1) % teamPlayers.length;
    this.gameState.teamActivePlayers[player.teamId] = teamPlayers[nextIndex].id;
    
    // 업데이트 전송 (클라이언트 형식 사용)
    const clientUpdateData = this.getClientUpdateData();
    clientUpdateData.timeRemaining = Math.max(0, this.gameState.duration - (Date.now() - this.gameState.startTime));
    clientUpdateData.teamActivePlayers = this.gameState.teamActivePlayers; // 최신 상태 반영
    
    this.io.to(this.room.id).emit(this.getUpdateEventName(), clientUpdateData);
    
    return true;
  }

  // 게임 결과 계산
  calculateResults() {
    console.log(`[ClickBattle] 결과 계산 시작 - roomId: ${this.room.id}`);
    console.log(`[ClickBattle] gameState.clicks:`, this.gameState.clicks);
    console.log(`[ClickBattle] room.players:`, this.room.players.map(p => ({ id: p.id, name: p.name })));
    
    // 팀전 모드인 경우 팀별 점수 계산
    if (this.room.teamMode && this.room.teams && this.room.teams.length > 0) {
      const teamScores = {};
      this.room.teams.forEach((team) => {
        teamScores[team.id] = 0;
      });
      
      Object.entries(this.gameState.clicks).forEach(([playerId, clicks]) => {
        const player = this.room.players.find((p) => p.id === playerId);
        if (player && player.teamId) {
          teamScores[player.teamId] = (teamScores[player.teamId] || 0) + clicks;
        }
      });
      
      // 팀 승자 결정
      let winningTeams = [];
      let maxTeamScore = 0;
      Object.entries(teamScores).forEach(([teamId, score]) => {
        if (score > maxTeamScore) {
          maxTeamScore = score;
          winningTeams = [Number(teamId)];
        } else if (score === maxTeamScore && maxTeamScore > 0) {
          winningTeams.push(Number(teamId));
        }
      });
      
      // 플레이어 결과 생성 (팀 점수 포함)
      const results = this.room.players.map((player) => {
        const score = this.gameState.clicks[player.id] || 0;
        const isWinner = player.teamId && winningTeams.includes(player.teamId);
        return {
          id: player.id,
          name: player.name,
          photo: player.photo,
          score: score,
          teamId: player.teamId || null,
          teamScore: player.teamId ? teamScores[player.teamId] : null,
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
      
      return { results, winners: winningTeams, teamScores };
    }
    
    // 개인전 모드 (기존 로직)
    let winners = [];
    let maxScore = 0;
    
    Object.entries(this.gameState.clicks).forEach(([playerId, clicks]) => {
      console.log(`[ClickBattle] 플레이어 ${playerId}: ${clicks}회 클릭`);
      if (clicks > maxScore) {
        maxScore = clicks;
        winners.length = 0;
        winners.push(playerId);
      } else if (clicks === maxScore && maxScore > 0) {
        winners.push(playerId);
      }
    });
    
    // 모든 플레이어에 대해 결과 생성 (clicks가 없는 경우 0으로 설정)
    const results = this.room.players.map((player) => {
      const score = this.gameState.clicks[player.id] || 0;
      console.log(`[ClickBattle] 플레이어 ${player.name} (${player.id}): score=${score}`);
      return {
        id: player.id,
        name: player.name,
        photo: player.photo,
        score: score,
        isWinner: winners.includes(player.id),
      };
    });
    
    results.sort((a, b) => b.score - a.score);
    
    console.log(`[ClickBattle] 최종 결과:`, results);
    console.log(`[ClickBattle] 승자:`, winners);
    
    return { results, winners };
  }

  // 게임 상태 반환 (재연결 시)
  getGameStateData() {
    const elapsed = Date.now() - this.gameState.startTime;
    const remaining = Math.max(0, this.gameState.duration - elapsed);
    
    const clickUpdates = (this.room.players || []).map((p) => ({
      id: p.id,
      clicks: this.gameState.clicks?.[p.id] || 0,
      teamId: p.teamId || null,
    }));
    
    // 팀별 점수 계산
    let teamScores = {};
    if (this.room.teamMode && this.room.teams && this.room.teams.length > 0) {
      this.room.teams.forEach((team) => {
        teamScores[team.id] = 0;
      });
      if (this.gameState.clicks) {
        Object.entries(this.gameState.clicks).forEach(([playerId, clicks]) => {
          const player = (this.room.players || []).find((p) => p.id === playerId);
          if (player && player.teamId) {
            teamScores[player.teamId] = (teamScores[player.teamId] || 0) + clicks;
          }
        });
      }
    }
    
    return {
      duration: this.gameState.duration || 0,
      startTime: this.gameState.startTime || Date.now(),
      gameType: this.gameState.gameType,
      clickUpdates: clickUpdates || [],
      teamScores: this.room.teamMode ? teamScores : null,
      timeRemaining: remaining,
      teamActivePlayers: this.gameState.relayMode ? this.gameState.teamActivePlayers : null,
    };
  }

  // 클라이언트 업데이트 데이터 반환 (클라이언트가 기대하는 형식)
  getClientUpdateData() {
    const gameStateData = this.getGameStateData();
    return {
      updates: gameStateData.clickUpdates || [],
      teamScores: gameStateData.teamScores || null,
      timeRemaining: gameStateData.timeRemaining || 0,
      teamActivePlayers: gameStateData.teamActivePlayers || null,
    };
  }

  // 업데이트 이벤트 이름 반환
  getUpdateEventName() {
    return "clickUpdate";
  }
}

module.exports = ClickBattle;
