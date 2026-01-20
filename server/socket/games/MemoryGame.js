class MemoryGame {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
  }

  initialize() {
    // 게임 상태 초기화
    this.gameState.currentRound = 0;
    this.gameState.maxRounds = 10; // 최대 라운드 수
    this.gameState.sequence = []; // 현재 라운드의 패턴
    this.gameState.sequenceLength = 3; // 시작 패턴 길이
    this.gameState.phase = 'waiting'; // waiting, showing, inputting, result
    this.gameState.playerInputs = {}; // 플레이어별 입력 {playerId: [1, 3, 2]}
    this.gameState.playerScores = {}; // 플레이어별 점수 (맞힌 라운드 수)
    this.gameState.playerFailed = {}; // 플레이어별 실패 여부
    this.gameState.currentShowingIndex = -1; // 현재 표시 중인 숫자 인덱스
    this.gameState.currentShowingNumber = null; // 현재 표시 중인 숫자/글자/이모지
    this.gameState.inputDuration = 10000; // 입력 시간 제한 (10초)
    this.gameState.inputStartTime = null; // 입력 시작 시간
    this.gameState.roundStartTime = null; // 라운드 시작 시간
    // 모드 설정은 gameState에 이미 저장되어 있음 (gameHandler에서 설정됨)
    
    // 플레이어 초기화
    this.room.players.forEach((player) => {
      this.gameState.playerScores[player.id] = 0;
      this.gameState.playerInputs[player.id] = [];
      this.gameState.playerFailed[player.id] = false;
    });
    
    // 초기 상태 전송
    this.sendUpdate();
    
    // 첫 라운드 시작
    setTimeout(() => {
      this.startRound();
    }, 1000);
  }

  startRound() {
    const round = this.gameState.currentRound;
    const sequenceLength = this.gameState.sequenceLength + round; // 라운드마다 길이 증가
    const mode = this.gameState.memoryMode || "number";
    const optionCount = this.gameState.memoryOptionCount || 4;
    
    // 모드에 따라 패턴 생성
    this.gameState.sequence = [];
    this.gameState.availableOptions = []; // 이 라운드에서 사용 가능한 옵션들
    
    if (mode === "number") {
      // 숫자 모드: 1부터 optionCount까지 (고정)
      this.gameState.availableOptions = Array.from({ length: optionCount }, (_, i) => i + 1);
      for (let i = 0; i < sequenceLength; i++) {
        this.gameState.sequence.push(Math.floor(Math.random() * optionCount) + 1);
      }
    } else if (mode === "korean") {
      // 한글 모드: 먼저 옵션 풀을 정하고, 그 안에서 인덱스로 시퀀스 생성
      const koreanChars = [
        "가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하",
        "거", "너", "더", "러", "머", "버", "서", "어", "저", "처", "커", "터", "퍼", "허",
        "고", "노", "도", "로", "모", "보", "소", "오", "조", "초", "코", "토", "포", "호"
      ];
      
      // 1. 먼저 옵션 풀을 정함 (전체 풀에서 optionCount만큼 랜덤 선택)
      const shuffledChars = [...koreanChars].sort(() => Math.random() - 0.5);
      this.gameState.availableOptions = shuffledChars.slice(0, optionCount);
      
      // 2. 옵션 풀 안에서 인덱스로 시퀀스 생성
      for (let i = 0; i < sequenceLength; i++) {
        const randomIndex = Math.floor(Math.random() * this.gameState.availableOptions.length);
        this.gameState.sequence.push(this.gameState.availableOptions[randomIndex]);
      }
    } else if (mode === "emoji") {
      // 이모지 모드: 먼저 옵션 풀을 정하고, 그 안에서 인덱스로 시퀀스 생성
      const emojis = [
        "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰",
        "😍", "🤩", "😘", "😗", "😚", "😙", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭",
        "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔",
        "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵", "🥶", "😶‍🌫️", "😵", "😵‍💫"
      ];
      
      // 1. 먼저 옵션 풀을 정함 (전체 풀에서 optionCount만큼 랜덤 선택)
      const shuffledEmojis = [...emojis].sort(() => Math.random() - 0.5);
      this.gameState.availableOptions = shuffledEmojis.slice(0, optionCount);
      
      // 2. 옵션 풀 안에서 인덱스로 시퀀스 생성
      for (let i = 0; i < sequenceLength; i++) {
        const randomIndex = Math.floor(Math.random() * this.gameState.availableOptions.length);
        this.gameState.sequence.push(this.gameState.availableOptions[randomIndex]);
      }
    }
    
    // 플레이어 입력 초기화
    this.room.players.forEach((player) => {
      if (!this.gameState.playerFailed[player.id]) {
        this.gameState.playerInputs[player.id] = [];
      }
    });
    
    // 패턴 표시 단계 시작
    this.gameState.phase = 'showing';
    this.gameState.currentShowingIndex = -1;
    this.gameState.currentShowingNumber = null;
    this.gameState.roundStartTime = Date.now();
    
    console.log(`[MemoryGame] 라운드 ${round + 1} 시작 - 패턴: ${this.gameState.sequence.join(', ')}`);
    
    // 숫자를 하나씩 순차적으로 표시
    this.showNextNumber(0);
  }

  // 다음 숫자 표시
  showNextNumber(index) {
    if (index >= this.gameState.sequence.length) {
      // 모든 숫자 표시 완료 - 입력 단계로 전환
      this.gameState.phase = 'inputting';
      this.gameState.currentShowingIndex = -1;
      this.gameState.currentShowingNumber = null;
      this.gameState.inputStartTime = Date.now();
      this.sendUpdate();
      return;
    }

    // 현재 숫자 표시
    this.gameState.currentShowingIndex = index;
    this.gameState.currentShowingNumber = this.gameState.sequence[index];
    this.sendUpdate();

    // 숫자 개수에 따라 표시 시간 조정
    // 짧은 패턴(3-5개): 각 숫자당 1초
    // 중간 패턴(6-8개): 각 숫자당 0.8초
    // 긴 패턴(9개 이상): 각 숫자당 0.6초
    const sequenceLength = this.gameState.sequence.length;
    let showTimePerNumber;
    if (sequenceLength <= 5) {
      showTimePerNumber = 1000; // 1초
    } else if (sequenceLength <= 8) {
      showTimePerNumber = 800; // 0.8초
    } else {
      showTimePerNumber = 600; // 0.6초
    }

    // 다음 숫자 표시
    setTimeout(() => {
      this.gameState.currentShowingNumber = null;
      this.sendUpdate();
      
      // 다음 숫자로 이동 (간격 0.2초)
      setTimeout(() => {
        this.showNextNumber(index + 1);
      }, 200);
    }, showTimePerNumber);
  }

  // 플레이어 입력 처리
  handleInput(socketId, number) {
    if (this.gameState.phase !== 'inputting') {
      return false; // 입력 단계가 아님
    }
    
    const player = this.room.players.find((p) => p.id === socketId);
    if (!player) {
      return false;
    }
    
    // 이미 실패한 플레이어는 입력 불가
    if (this.gameState.playerFailed[socketId]) {
      return false;
    }
    
    // 입력 추가
    if (!this.gameState.playerInputs[socketId]) {
      this.gameState.playerInputs[socketId] = [];
    }
    
    this.gameState.playerInputs[socketId].push(number);
    
    // 패턴 길이 확인
    const expectedLength = this.gameState.sequence.length;
    const inputLength = this.gameState.playerInputs[socketId].length;
    
    // 입력이 완료되었는지 확인
    if (inputLength >= expectedLength) {
      this.checkAnswer(socketId);
    }
    
    this.sendUpdate();
    return true;
  }

  // 정답 확인
  checkAnswer(socketId) {
    const playerInput = this.gameState.playerInputs[socketId];
    const correctSequence = this.gameState.sequence;
    
    // 정답 확인 (숫자, 한글, 이모지 모두 문자열 비교)
    let isCorrect = true;
    for (let i = 0; i < correctSequence.length; i++) {
      // 문자열로 변환하여 비교 (숫자도 문자열로 비교)
      if (String(playerInput[i]) !== String(correctSequence[i])) {
        isCorrect = false;
        break;
      }
    }
    
    if (isCorrect) {
      // 정답! 점수 증가
      this.gameState.playerScores[socketId] = (this.gameState.playerScores[socketId] || 0) + 1;
      console.log(`[MemoryGame] 플레이어 ${socketId} 정답! 현재 점수: ${this.gameState.playerScores[socketId]}`);
    } else {
      // 오답 - 실패 처리
      this.gameState.playerFailed[socketId] = true;
      console.log(`[MemoryGame] 플레이어 ${socketId} 오답 - 실패`);
    }
    
    // 모든 플레이어가 입력했는지 확인
    this.checkRoundComplete();
  }

  // 라운드 완료 확인
  checkRoundComplete() {
    const activePlayers = this.room.players.filter(
      p => !this.gameState.playerFailed[p.id]
    );
    
    // 활성 플레이어가 없으면 즉시 게임 종료
    if (activePlayers.length === 0) {
      console.log(`[MemoryGame] 모든 플레이어 실패 - 게임 종료`);
      if (this.endGameCallback) {
        this.endGameCallback();
      }
      return;
    }
    
    // 모든 활성 플레이어가 입력 완료했는지 확인
    let allCompleted = true;
    for (const player of activePlayers) {
      const inputLength = this.gameState.playerInputs[player.id]?.length || 0;
      if (inputLength < this.gameState.sequence.length) {
        allCompleted = false;
        break;
      }
    }
    
    if (allCompleted) {
      // 모든 플레이어가 입력 완료 - 다음 라운드로
      this.completeRound();
    }
  }

  // 라운드 완료 처리
  completeRound() {
    const round = this.gameState.currentRound;
    
    // 플레이어가 없는 방이면 즉시 게임 종료
    if (!this.room.players || this.room.players.length === 0) {
      console.log(`[MemoryGame] 플레이어가 없어 게임 종료`);
      if (this.endGameCallback) {
        this.endGameCallback();
      }
      return;
    }
    
    const activePlayers = this.room.players.filter(
      p => !this.gameState.playerFailed[p.id]
    );
    
    // 활성 플레이어가 없으면 즉시 게임 종료
    if (activePlayers.length === 0) {
      console.log(`[MemoryGame] 모든 플레이어 실패 - 게임 종료`);
      if (this.endGameCallback) {
        this.endGameCallback();
      }
      return;
    }
    
    // 다음 라운드로 진행
    this.gameState.currentRound++;
    
    // 최대 라운드 도달 시 게임 종료
    if (this.gameState.currentRound >= this.gameState.maxRounds) {
      console.log(`[MemoryGame] 최대 라운드 도달 - 게임 종료`);
      setTimeout(() => {
        if (this.endGameCallback) {
          this.endGameCallback();
        }
      }, 2000);
      return;
    }
    
    // 결과 표시 후 다음 라운드
    this.gameState.phase = 'result';
    this.sendUpdate();
    
    setTimeout(() => {
      this.startRound();
    }, 2000);
  }

  startUpdateLoop(endGameCallback) {
    this.endGameCallback = endGameCallback;
    
    const updateInterval = setInterval(() => {
      // 플레이어가 없는 방이면 즉시 게임 종료
      if (!this.room.players || this.room.players.length === 0) {
        console.log(`[MemoryGame] 플레이어가 없어 게임 종료`);
        clearInterval(updateInterval);
        if (this.endGameCallback) {
          this.endGameCallback();
        }
        return;
      }
      
      // 활성 플레이어가 없는지 체크
      const activePlayers = this.room.players.filter(
        p => !this.gameState.playerFailed[p.id]
      );
      if (activePlayers.length === 0) {
        console.log(`[MemoryGame] 모든 플레이어 실패 - 게임 종료`);
        clearInterval(updateInterval);
        if (this.endGameCallback) {
          this.endGameCallback();
        }
        return;
      }
      
      // 입력 시간 제한 체크
      if (this.gameState.phase === 'inputting' && this.gameState.inputStartTime) {
        const elapsed = Date.now() - this.gameState.inputStartTime;
        const remaining = this.gameState.inputDuration - elapsed;
        
        if (remaining <= 0) {
          // 시간 초과 - 입력 완료하지 않은 플레이어 실패 처리
          this.room.players.forEach((player) => {
            if (!this.gameState.playerFailed[player.id]) {
              const inputLength = this.gameState.playerInputs[player.id]?.length || 0;
              if (inputLength < this.gameState.sequence.length) {
                this.gameState.playerFailed[player.id] = true;
                console.log(`[MemoryGame] 플레이어 ${player.id} 시간 초과 - 실패`);
              }
            }
          });
          
          // 라운드 완료 처리 (활성 플레이어 체크 포함)
          this.completeRound();
        }
      }
      
      this.sendUpdate();
    }, 100);
    
    return updateInterval;
  }

  calculateResults() {
    // 점수 기반으로 결과 계산
    const results = this.room.players.map((player) => ({
      id: player.id,
      name: player.name,
      photo: player.photo,
      score: this.gameState.playerScores[player.id] || 0,
      isWinner: false,
    }));
    
    // 승자 결정
    const maxScore = Math.max(...results.map(r => r.score));
    results.forEach(r => {
      r.isWinner = r.score === maxScore && maxScore > 0;
    });
    
    results.sort((a, b) => b.score - a.score);
    
    const winners = results.filter(r => r.isWinner).map(r => r.id);
    
    return { results, winners };
  }

  getGameStateData() {
    const activePlayers = this.room.players.filter(
      p => !this.gameState.playerFailed[p.id]
    );
    
    return {
      currentRound: this.gameState.currentRound + 1,
      maxRounds: this.gameState.maxRounds,
      phase: this.gameState.phase, // waiting, showing, inputting, result
      currentShowingNumber: this.gameState.currentShowingNumber, // 현재 표시 중인 숫자/글자/이모지
      currentShowingIndex: this.gameState.currentShowingIndex, // 현재 표시 중인 인덱스
      sequenceLength: this.gameState.sequence.length,
      memoryMode: this.gameState.memoryMode || "number", // 게임 모드
      memoryOptionCount: this.gameState.memoryOptionCount || 4, // 옵션 개수
      availableOptions: this.gameState.availableOptions || [], // 이 라운드에서 사용 가능한 옵션들 (한글/이모지 모드에서 사용)
      playerInputs: this.gameState.playerInputs,
      playerScores: this.room.players.map(p => ({
        id: p.id,
        score: this.gameState.playerScores[p.id] || 0,
        failed: this.gameState.playerFailed[p.id] || false,
      })),
      inputTimeRemaining: this.gameState.phase === 'inputting' && this.gameState.inputStartTime
        ? Math.max(0, this.gameState.inputDuration - (Date.now() - this.gameState.inputStartTime))
        : 0,
      activePlayersCount: activePlayers.length,
    };
  }

  getClientUpdateData() {
    return this.getGameStateData();
  }

  getUpdateEventName() {
    return "memoryGameUpdate";
  }

  getGameStartedPayload(socketId) {
    const state = this.getGameStateData();
    return {
      duration: this.gameState.duration,
      startTime: this.gameState.startTime,
      gameType: this.gameState.gameType,
      memoryMode: this.gameState.memoryMode || "number",
      memoryOptionCount: this.gameState.memoryOptionCount || 4,
      ...state,
    };
  }

  sendUpdate() {
    const data = this.getClientUpdateData();
    this.io.to(this.room.id).emit(this.getUpdateEventName(), data);
  }

  handleAction(socketId, action, data) {
    if (action === "input") {
      return this.handleInput(socketId, data.number);
    }
    return false;
  }

  shouldUseGlobalTimer() {
    // 라운드 기반으로 자체 종료 처리
    return false;
  }
}

module.exports = MemoryGame;
