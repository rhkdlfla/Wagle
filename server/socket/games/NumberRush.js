class NumberRush {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
  }

  // 게임 초기화
  initialize() {
    // 라운드별 최대 숫자 설정 (라운드가 올라갈수록 증가)
    this.gameState.roundMaxNumbers = [10, 15, 20, 25, 30]; // 5라운드
    this.gameState.currentRound = 0; // 0부터 시작 (0 = 라운드 1)
    this.gameState.roundScores = {}; // 플레이어별 라운드 점수 {playerId: [라운드1점수, 라운드2점수, ...]}
    this.gameState.totalScores = {}; // 플레이어별 총 점수
    this.gameState.balls = []; // 현재 라운드의 공들 [{id, number, x, y, clickedBy, teamId}]
    this.gameState.nextNumber = {}; // 플레이어별 다음에 눌러야 할 숫자 {playerId: number}
    this.gameState.roundWinners = []; // 각 라운드의 승자들
    this.gameState.roundStartTime = null; // 현재 라운드 시작 시간
    this.gameState.roundDuration = 0; // 라운드별 시간 제한 (밀리초)
    this.gameState.roundCompleted = false; // 현재 라운드 완료 여부 (중복 호출 방지)
    
    // 라운드별 시간 제한 계산 (전체 게임 시간을 라운드 수로 나눔)
    const totalRounds = this.gameState.roundMaxNumbers.length;
    const totalGameDuration = this.gameState.duration || 600000; // 기본 10분
    this.gameState.roundDuration = Math.floor(totalGameDuration / totalRounds);
    
    // 플레이어 초기화
    this.room.players.forEach((player) => {
      this.gameState.roundScores[player.id] = [];
      this.gameState.totalScores[player.id] = 0;
      this.gameState.nextNumber[player.id] = 1;
    });
    
    // 첫 라운드 시작
    this.startRound();
  }

  // 라운드 시작
  startRound() {
    const roundIndex = this.gameState.currentRound;
    const maxNumber = this.gameState.roundMaxNumbers[roundIndex];
    
    // 공 세트 개수 결정: 팀전이면 팀 수, 개인전이면 플레이어 수
    let setCount;
    let sets = [];
    
    if (this.room.teamMode && this.room.teams && this.room.teams.length > 0) {
      // 팀전 모드: 팀 수만큼 공 세트 생성
      setCount = this.room.teams.length;
      sets = this.room.teams.map(team => ({ id: team.id, type: 'team', teamId: team.id }));
    } else {
      // 개인전 모드: 플레이어 수만큼 공 세트 생성
      setCount = this.room.players.length;
      sets = this.room.players.map(player => ({ id: player.id, type: 'player', playerId: player.id }));
    }
    
    // 라운드 시작 시간 기록
    this.gameState.roundStartTime = Date.now();
    this.gameState.roundCompleted = false; // 라운드 완료 플래그 리셋
    
    // 공 생성: 1~N까지의 숫자, 세트 개수만큼
    // 겹치지 않도록 위치 생성
    const BALL_SIZE = 50; // 공 크기 (픽셀)
    const GAME_AREA_WIDTH = 1200; // 게임 영역 너비 증가 (800 -> 1200)
    const GAME_AREA_HEIGHT = 600;
    const MIN_DISTANCE = BALL_SIZE + 10; // 최소 거리 (공 크기 + 여유 공간)
    
    this.gameState.balls = [];
    const existingPositions = []; // 이미 배치된 공의 위치들
    
    // 위치가 겹치는지 확인하는 함수
    const isPositionValid = (x, y) => {
      for (const pos of existingPositions) {
        const distance = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
        if (distance < MIN_DISTANCE) {
          return false;
        }
      }
      return true;
    };
    
    // 랜덤 위치 생성 (최대 시도 횟수로 무한 루프 방지)
    const generatePosition = () => {
      let attempts = 0;
      let x, y;
      do {
        x = Math.random() * (GAME_AREA_WIDTH - BALL_SIZE);
        y = Math.random() * (GAME_AREA_HEIGHT - BALL_SIZE);
        attempts++;
        if (attempts > 100) {
          // 너무 많이 시도하면 최소 거리를 줄임
          break;
        }
      } while (!isPositionValid(x, y));
      return { x, y };
    };
    
    // 각 세트마다 1~N까지의 공 생성 (소유권 없음, 누구든지 클릭 가능)
    for (let setIndex = 0; setIndex < setCount; setIndex++) {
      for (let num = 1; num <= maxNumber; num++) {
        const { x, y } = generatePosition();
        existingPositions.push({ x, y });
        
        this.gameState.balls.push({
          id: `ball-${setIndex}-${num}`,
          number: num,
          x: x,
          y: y,
          clickedBy: null, // 누가 클릭했는지만 기록 (소유권 아님)
        });
      }
    }
    
    // 모든 플레이어의 다음 숫자를 1로 리셋
    this.room.players.forEach((player) => {
      this.gameState.nextNumber[player.id] = 1;
    });
    
    console.log(`[NumberRush] 라운드 ${roundIndex + 1} 시작 - 최대 숫자: ${maxNumber}, 공 개수: ${this.gameState.balls.length}, 시간 제한: ${this.gameState.roundDuration / 1000}초`);
    
    // 클라이언트에 라운드 시작 알림
    this.sendUpdate();
  }

  // 공 클릭 처리
  handleBallClick(socketId, ballId) {
    const ball = this.gameState.balls.find((b) => b.id === ballId);
    if (!ball) {
      return false; // 공을 찾을 수 없음
    }
    
    if (ball.clickedBy !== null) {
      return false; // 이미 누른 공
    }
    
    const player = this.room.players.find((p) => p.id === socketId);
    if (!player) {
      return false; // 플레이어를 찾을 수 없음
    }
    
    // 공에는 소유권이 없음 - 누구든지 클릭 가능
    // 단, 순서대로 눌러야 함
    const expectedNumber = this.gameState.nextNumber[socketId];
    if (ball.number !== expectedNumber) {
      return false; // 순서가 맞지 않음
    }
    
    // 공 클릭 처리
    ball.clickedBy = socketId;
    this.gameState.nextNumber[socketId] = expectedNumber + 1;
    
    // 라운드 완료 체크
    const maxNumber = this.gameState.roundMaxNumbers[this.gameState.currentRound];
    if (this.gameState.nextNumber[socketId] > maxNumber) {
      // 라운드 완료!
      this.completeRound(socketId);
    }
    
    // 업데이트 전송
    this.sendUpdate();
    return true;
  }

  // 라운드 완료 처리 (플레이어가 모든 숫자를 완료한 경우)
  completeRound(winnerId) {
    const roundIndex = this.gameState.currentRound;
    const roundNumber = roundIndex + 1;
    
    console.log(`[NumberRush] 라운드 ${roundNumber} 완료! 승자: ${winnerId}`);
    
    // 라운드 점수 부여 (1점)
    if (!this.gameState.roundScores[winnerId]) {
      this.gameState.roundScores[winnerId] = [];
    }
    this.gameState.roundScores[winnerId][roundIndex] = 1;
    this.gameState.totalScores[winnerId] = (this.gameState.totalScores[winnerId] || 0) + 1;
    
    // 라운드 승자 저장
    this.gameState.roundWinners[roundIndex] = winnerId;
    
    // 다음 라운드로 진행
    this.gameState.currentRound++;
    
    // 라운드 완료 이벤트 전송
    this.io.to(this.room.id).emit("numberRushRoundComplete", {
      round: roundNumber,
      winner: winnerId,
      timeout: false, // 정상 완료
      nextRound: this.gameState.currentRound < this.gameState.roundMaxNumbers.length ? this.gameState.currentRound + 1 : null,
    });
    
    // 모든 라운드 완료 체크
    if (this.gameState.currentRound >= this.gameState.roundMaxNumbers.length) {
      // 게임 종료
      console.log(`[NumberRush] 모든 라운드 완료! 게임 종료`);
      // endGameCallback 호출 (2초 후)
      setTimeout(() => {
        if (this.endGameCallback) {
          this.endGameCallback();
        }
      }, 2000);
    } else {
      // 다음 라운드 시작 (2초 후)
      setTimeout(() => {
        this.startRound();
      }, 2000); // 2초 대기
    }
  }

  // 주기적 업데이트 시작
  startUpdateLoop(endGameCallback) {
    // endGameCallback을 클래스 변수로 저장 (라운드 완료 시 호출하기 위해)
    this.endGameCallback = endGameCallback;
    
    const updateInterval = setInterval(() => {
      // 모든 라운드가 완료되었는지 체크
      if (this.gameState.currentRound >= this.gameState.roundMaxNumbers.length) {
        clearInterval(updateInterval);
        if (this.endGameCallback) {
          this.endGameCallback();
        }
        return;
      }
      
      // 라운드별 시간 제한 체크
      if (this.gameState.roundStartTime && this.gameState.roundDuration > 0) {
        const roundElapsed = Date.now() - this.gameState.roundStartTime;
        const roundRemaining = Math.max(0, this.gameState.roundDuration - roundElapsed);
        
        // 라운드 시간 초과 체크
        if (roundRemaining <= 0 && !this.gameState.roundCompleted) {
          // 라운드 시간 초과 - 가장 많이 클릭한 플레이어가 승리
          this.gameState.roundCompleted = true; // 중복 호출 방지
          this.completeRoundByTimeout();
        }
      }
      
      // 정기적인 업데이트 전송
      this.sendUpdate();
    }, 1000);
    
    return updateInterval;
  }

  // 시간 초과로 라운드 완료 처리
  completeRoundByTimeout() {
    const roundIndex = this.gameState.currentRound;
    const roundNumber = roundIndex + 1;
    
    // 각 플레이어의 진행도 계산 (다음 숫자 - 1 = 클릭한 숫자 개수)
    const progress = {};
    this.room.players.forEach((player) => {
      const nextNum = this.gameState.nextNumber[player.id] || 1;
      progress[player.id] = nextNum - 1; // 클릭한 숫자 개수
    });
    
    // 가장 많이 클릭한 플레이어 찾기
    let maxProgress = 0;
    let winners = [];
    
    Object.entries(progress).forEach(([playerId, clicks]) => {
      if (clicks > maxProgress) {
        maxProgress = clicks;
        winners = [playerId];
      } else if (clicks === maxProgress && maxProgress > 0) {
        winners.push(playerId);
      }
    });
    
    // 승자 선택 (가장 많이 클릭한 플레이어, 동점이면 첫 번째 플레이어)
    const winnerId = winners.length > 0 ? winners[0] : null;
    
    if (winnerId) {
      console.log(`[NumberRush] 라운드 ${roundNumber} 시간 초과! 승자: ${winnerId} (${progress[winnerId]}개 클릭)`);
      
      // 라운드 점수 부여 (1점)
      if (!this.gameState.roundScores[winnerId]) {
        this.gameState.roundScores[winnerId] = [];
      }
      this.gameState.roundScores[winnerId][roundIndex] = 1;
      this.gameState.totalScores[winnerId] = (this.gameState.totalScores[winnerId] || 0) + 1;
      
      // 라운드 승자 저장
      this.gameState.roundWinners[roundIndex] = winnerId;
      
      // 라운드 완료 이벤트 전송
      this.io.to(this.room.id).emit("numberRushRoundComplete", {
        round: roundNumber,
        winner: winnerId,
        timeout: true, // 시간 초과로 완료됨을 표시
        nextRound: this.gameState.currentRound < this.gameState.roundMaxNumbers.length ? this.gameState.currentRound + 1 : null,
      });
    } else {
      // 아무도 클릭하지 않은 경우 무승부
      console.log(`[NumberRush] 라운드 ${roundNumber} 시간 초과! 무승부`);
      
      // 라운드 완료 이벤트 전송 (승자 없음)
      this.io.to(this.room.id).emit("numberRushRoundComplete", {
        round: roundNumber,
        winner: null,
        timeout: true,
        nextRound: this.gameState.currentRound < this.gameState.roundMaxNumbers.length ? this.gameState.currentRound + 1 : null,
      });
    }
    
    // 다음 라운드로 진행
    this.gameState.currentRound++;
    
    // 모든 라운드 완료 체크
    if (this.gameState.currentRound >= this.gameState.roundMaxNumbers.length) {
      // 게임 종료
      console.log(`[NumberRush] 모든 라운드 완료! 게임 종료`);
      // endGameCallback 호출 (2초 후)
      setTimeout(() => {
        if (this.endGameCallback) {
          this.endGameCallback();
        }
      }, 2000);
    } else {
      // 다음 라운드 시작 (2초 후)
      setTimeout(() => {
        this.gameState.roundCompleted = false; // 플래그 리셋
        this.startRound();
      }, 2000); // 2초 대기
    }
  }

  // 게임 결과 계산
  calculateResults() {
    const isTeamMode = this.room.teamMode && this.room.teams && this.room.teams.length > 0;
    
    if (isTeamMode) {
      // 팀전 모드: 팀별 총 점수 계산
      const teamScores = {};
      this.room.teams.forEach((team) => {
        teamScores[team.id] = 0;
      });
      
      Object.entries(this.gameState.totalScores).forEach(([playerId, score]) => {
        const player = this.room.players.find((p) => p.id === playerId);
        if (player && player.teamId) {
          teamScores[player.teamId] = (teamScores[player.teamId] || 0) + score;
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
      
      // 플레이어 결과 생성
      const results = this.room.players.map((player) => {
        const score = this.gameState.totalScores[player.id] || 0;
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
        if (a.teamScore !== null && b.teamScore !== null) {
          if (b.teamScore !== a.teamScore) return b.teamScore - a.teamScore;
        }
        return b.score - a.score;
      });
      
      return { results, winners: winningTeams, teamScores };
    }
    
    // 개인전 모드
    let winners = [];
    let maxScore = 0;
    
    Object.entries(this.gameState.totalScores).forEach(([playerId, score]) => {
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
      score: this.gameState.totalScores[player.id] || 0,
      isWinner: winners.includes(player.id),
    }));
    
    results.sort((a, b) => b.score - a.score);
    
    return { results, winners };
  }

  // 게임 상태 반환 (재연결 시)
  getGameStateData() {
    const scoreUpdates = (this.room.players || []).map((p) => ({
      id: p.id,
      score: this.gameState.totalScores?.[p.id] || 0,
      nextNumber: this.gameState.nextNumber?.[p.id] || 1,
      teamId: p.teamId || null,
    }));
    
    // 팀별 점수 계산
    let teamScores = {};
    if (this.room.teamMode && this.room.teams && this.room.teams.length > 0) {
      this.room.teams.forEach((team) => {
        teamScores[team.id] = 0;
      });
      if (this.gameState.totalScores) {
        Object.entries(this.gameState.totalScores).forEach(([playerId, score]) => {
          const player = (this.room.players || []).find((p) => p.id === playerId);
          if (player && player.teamId) {
            teamScores[player.teamId] = (teamScores[player.teamId] || 0) + score;
          }
        });
      }
    }
    
    // 라운드 남은 시간 계산
    let roundTimeRemaining = 0;
    if (this.gameState.roundStartTime && this.gameState.roundDuration > 0) {
      const roundElapsed = Date.now() - this.gameState.roundStartTime;
      roundTimeRemaining = Math.max(0, this.gameState.roundDuration - roundElapsed);
    }
    
    return {
      duration: this.gameState.duration || 0,
      startTime: this.gameState.startTime || Date.now(),
      gameType: this.gameState.gameType,
      currentRound: (this.gameState.currentRound || 0) + 1,
      maxRounds: this.gameState.roundMaxNumbers?.length || 5,
      roundMaxNumbers: this.gameState.roundMaxNumbers || [],
      roundDuration: this.gameState.roundDuration || 0,
      roundTimeRemaining: roundTimeRemaining,
      balls: this.gameState.balls || [],
      scoreUpdates: scoreUpdates || [],
      teamScores: this.room.teamMode ? teamScores : null,
      roundWinners: this.gameState.roundWinners || [],
    };
  }

  // 클라이언트 업데이트 데이터 반환
  getClientUpdateData() {
    const gameStateData = this.getGameStateData();
    const roundIndex = (gameStateData.currentRound || 1) - 1;
    const roundMaxNumbers = gameStateData.roundMaxNumbers || [];
    const roundMaxNumber = roundMaxNumbers[roundIndex] || 0;
    
    return {
      currentRound: gameStateData.currentRound,
      maxRounds: gameStateData.maxRounds,
      roundMaxNumber: roundMaxNumber,
      roundTimeRemaining: gameStateData.roundTimeRemaining || 0,
      balls: gameStateData.balls || [],
      scores: gameStateData.scoreUpdates || [],
      teamScores: gameStateData.teamScores || null,
      roundWinners: gameStateData.roundWinners || [],
    };
  }

  // 업데이트 이벤트 이름 반환
  getUpdateEventName() {
    return "numberRushUpdate";
  }

  // 게임 업데이트 전송 헬퍼
  sendUpdate() {
    const gameStateData = this.getGameStateData();
    const clientUpdateData = this.getClientUpdateData();
    const eventName = this.getUpdateEventName();
    this.io.to(this.room.id).emit(eventName, clientUpdateData);
  }

  // 범용 액션 핸들러
  handleAction(socketId, action, data) {
    if (action === "clickBall") {
      return this.handleBallClick(socketId, data.ballId);
    }
    return false;
  }
}

module.exports = NumberRush;
