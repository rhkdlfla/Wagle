class NumberRush {
    constructor(io, gameState, room) {
      this.io = io;
      this.gameState = gameState;
      this.room = room;
    }
  
    // 1. 게임 초기화 (필수)
    initialize() {
      // 플레이어별 초기 상태 설정
      this.room.players.forEach((player) => {
        this.gameState.scores[player.id] = 0;
      });
      
      // 이어달리기 모드 초기화 (팀전 모드일 때만)
      if (this.gameState.relayMode && this.room.teamMode && this.room.teams) {
        this.gameState.teamActivePlayers = {};
        this.room.teams.forEach((team) => {
          const teamPlayers = this.room.players.filter((p) => p.teamId === team.id);
          if (teamPlayers.length > 0) {
            this.gameState.teamActivePlayers[team.id] = teamPlayers[0].id;
          }
        });
      }
    }
  
    // 2. 주기적 업데이트 루프 (필수)
    startUpdateLoop(endGameCallback) {
      const updateInterval = setInterval(() => {
        const elapsed = Date.now() - this.gameState.startTime;
        const remaining = Math.max(0, this.gameState.duration - elapsed);
        
        if (remaining <= 0) {
          clearInterval(updateInterval);
          endGameCallback();
          return;
        }
        
        // 게임 상태를 모든 클라이언트에게 전송
        this.io.to(this.room.id).emit("yourGameUpdate", {
          scores: scoreUpdates,
          teamScores: this.room.teamMode ? teamScores : null,
          timeRemaining: remaining,
          // 기타 게임 상태 데이터...
        });
      }, 1000); // 1초마다 업데이트
      
      return updateInterval;
    }
  
    // 3. 플레이어 액션 처리 (필수)
    handlePlayerAction(socketId, actionData) {
      // 이어달리기 모드 체크 (팀전일 때)
      if (this.gameState.relayMode && this.room.teamMode) {
        const player = this.room.players.find((p) => p.id === socketId);
        if (!player || !player.teamId) return false;
        
        const activePlayerId = this.gameState.teamActivePlayers?.[player.teamId];
        if (activePlayerId !== socketId) return false;
      }
      
      // 게임 로직 처리
      // 점수 업데이트, 상태 변경 등
      
      // 업데이트 전송
      this.io.to(this.room.id).emit("yourGameUpdate", {
        // 업데이트된 게임 상태
      });
      
      return true;
    }
  
    // 4. 이어달리기 모드: 순서 넘기기 (선택, 팀전 모드 지원 시)
    passTurn(socketId) {
      if (!this.gameState.relayMode || !this.room.teamMode) {
        return false;
      }
      
      // 다음 팀원으로 순서 넘기기 로직
      // ... (ClickBattle이나 AppleBattle 참고)
      
      return true;
    }
  
    // 5. 게임 결과 계산 (필수)
    calculateResults() {
      const isTeamMode = this.room.teamMode && this.room.teams && this.room.teams.length > 0;
      
      // 팀전 모드인 경우
      if (isTeamMode) {
        // 팀별 점수 계산 및 승자 결정
        // ...
        return { results, winners: winningTeams, teamScores };
      }
      
      // 개인전 모드
      // 개인 점수로 승자 결정
      // ...
      return { results, winners };
    }
  
    // 6. 게임 상태 반환 (재연결 시 사용, 필수)
    getGameStateData() {
      const elapsed = Date.now() - this.gameState.startTime;
      const remaining = Math.max(0, this.gameState.duration - elapsed);
      
      return {
        duration: this.gameState.duration,
        startTime: this.gameState.startTime,
        gameType: this.gameState.gameType,
        timeRemaining: remaining,
        // 기타 필요한 게임 상태...
      };
    }
  }
  
  module.exports = NumberRush;