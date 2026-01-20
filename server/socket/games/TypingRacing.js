class TypingRacing {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
  }

  initialize() {
    // 타자연습 텍스트 (한글)
    const typingTexts = [
      "인생은 속도가 아니라 방향이다",
      "간절히 원하면 온 우주가 도와준다",
      "끝날 때까지 끝난 게 아니다",
      "꿈을 계속 간직하고 있으면 반드시 실현할 때가 온다",
      "성공은 준비된 자에게 주어지는 기회다",
      "오늘 할 수 있는 일을 내일로 미루지 마라",
      "실패는 성공의 어머니다",
      "노력은 배신하지 않는다",
      "작은 기회로부터 종종 위대한 업적이 시작된다",
      "자신감은 성공의 첫 번째 비밀이다"
    ];

    // 게임 상태 초기화
    this.gameState.text = typingTexts[Math.floor(Math.random() * typingTexts.length)];
    this.gameState.playerProgress = {}; // 플레이어별 진행도 (0~1)
    this.gameState.playerPosition = {}; // 플레이어별 커서 위치 (문자 인덱스)
    this.gameState.playerItems = {}; // 플레이어별 보유 아이템
    this.gameState.activeItems = {}; // 플레이어별 활성 아이템 (사용 대기 중인 단어)
    this.gameState.playerItemTyping = {}; // 플레이어별 아이템 단어 입력 진행도
    this.gameState.itemBoxes = []; // 아이템 박스 위치들 (진행도 기준)
    this.gameState.effects = {}; // 플레이어별 활성 효과
    this.gameState.finished = {}; // 완주한 플레이어들
    this.gameState.finishOrder = []; // 완주 순서

    // 아이템 박스 위치 설정 (8자 루프의 특정 지점)
    // 8자 루프는 0.0에서 시작해서 1.0에서 끝남
    // 아이템 박스는 0.25, 0.5, 0.75 지점에 배치
    this.gameState.itemBoxes = [0.25, 0.5, 0.75];

    // 아이템 정의 (아이템명: 사용할 단어)
    this.gameState.itemWords = {
      'boost': '부스트',
      'slow': '감속',
      'shield': '방패',
      'teleport': '순간이동'
    };

    // 플레이어 초기화
    this.room.players.forEach((player) => {
      this.gameState.playerProgress[player.id] = 0;
      this.gameState.playerPosition[player.id] = 0;
      this.gameState.playerItems[player.id] = [];
      this.gameState.activeItems[player.id] = null;
      this.gameState.playerItemTyping[player.id] = '';
      this.gameState.effects[player.id] = [];
      this.gameState.finished[player.id] = false;
    });

    this.sendUpdate();
  }

  // 주기적 업데이트 시작
  startUpdateLoop(endGameCallback) {
    this.endGameCallback = endGameCallback;
    
    const updateInterval = setInterval(() => {
      // 플레이어가 없는 방이면 즉시 게임 종료
      if (!this.room.players || this.room.players.length === 0) {
        console.log(`[TypingRacing] 플레이어가 없어 게임 종료`);
        clearInterval(updateInterval);
        if (this.endGameCallback) {
          this.endGameCallback();
        }
        return;
      }

      // 모든 플레이어가 완주했는지 확인
      const activePlayers = this.room.players.filter(
        p => !this.gameState.finished[p.id]
      );
      if (activePlayers.length === 0) {
        console.log(`[TypingRacing] 모든 플레이어 완주 - 게임 종료`);
        clearInterval(updateInterval);
        if (this.endGameCallback) {
          this.endGameCallback();
        }
        return;
      }

      // 효과 타이머 업데이트
      this.updateEffects();

      // 아이템 박스 획득 체크
      this.checkItemBoxes();

      this.sendUpdate();
    }, 100);
    
    return updateInterval;
  }

  // 타이핑 처리
  handleTyping(socketId, char) {
    const player = this.room.players.find(p => p.id === socketId);
    if (!player) return false;

    // 완주한 플레이어는 입력 무시
    if (this.gameState.finished[socketId]) {
      return false;
    }

    // 키보드 잠금 효과 확인
    if (this.hasEffect(socketId, 'keyboardLock')) {
      return false;
    }

    const text = this.gameState.text;
    const currentPos = this.gameState.playerPosition[socketId] || 0;

    // 아이템 활성화 단어 입력 중인지 확인
    if (this.gameState.activeItems[socketId]) {
      return this.handleItemWordTyping(socketId, char);
    }

    // 일반 타이핑 처리
    if (currentPos >= text.length) {
      // 이미 완주
      return false;
    }

    const expectedChar = text[currentPos];

    // 정확한 타이핑
    if (char === expectedChar) {
      this.gameState.playerPosition[socketId] = currentPos + 1;
      this.gameState.playerProgress[socketId] = 
        this.gameState.playerPosition[socketId] / text.length;
      
      // 완주 체크
      if (this.gameState.playerPosition[socketId] >= text.length) {
        this.handleFinish(socketId);
      }

      this.sendUpdate();
      return true;
    }
    
    return false;
  }

  // 아이템 단어 타이핑 처리
  handleItemWordTyping(socketId, char) {
    const activeItem = this.gameState.activeItems[socketId];
    if (!activeItem) return false;

    const itemWord = this.gameState.itemWords[activeItem];
    const currentTyped = this.gameState.playerItemTyping[socketId] || '';
    const nextChar = itemWord[currentTyped.length];

    if (char === nextChar) {
      const newTyped = currentTyped + char;
      
      // 아이템 단어 완성
      if (newTyped === itemWord) {
        this.useItem(socketId, activeItem);
        this.gameState.activeItems[socketId] = null;
        this.gameState.playerItemTyping[socketId] = '';
        this.sendUpdate();
        return true;
      } else {
        this.gameState.playerItemTyping[socketId] = newTyped;
        this.sendUpdate();
        return true;
      }
    }

    return false;
  }

  // 아이템 박스 획득 체크
  checkItemBoxes() {
    this.room.players.forEach((player) => {
      if (this.gameState.finished[player.id]) return;

      const progress = this.gameState.playerProgress[player.id] || 0;
      
      // 아이템 박스 위치를 지나갔는지 확인
      this.gameState.itemBoxes.forEach((boxPosition, index) => {
        const boxKey = `itemBox${index}_${player.id}`;
        // 박스를 지나갔고, 아직 획득하지 않은 경우
        if (progress >= boxPosition && !this.gameState[boxKey]) {
          // 아이템 획득
          const items = ['boost', 'slow', 'shield', 'teleport'];
          const randomItem = items[Math.floor(Math.random() * items.length)];
          
          if (!this.gameState.playerItems[player.id]) {
            this.gameState.playerItems[player.id] = [];
          }
          this.gameState.playerItems[player.id].push(randomItem);
          this.gameState[boxKey] = true;
          
          // 플레이어에게 아이템 획득 알림
          this.io.to(player.id).emit("itemReceived", { item: randomItem });
        }
      });
    });
  }

  // 아이템 사용
  useItem(socketId, itemType) {
    const player = this.room.players.find(p => p.id === socketId);
    if (!player) return false;

    // 아이템 보유 확인
    const itemIndex = this.gameState.playerItems[socketId]?.indexOf(itemType);
    if (itemIndex === -1) return false;

    // 아이템 제거
    this.gameState.playerItems[socketId].splice(itemIndex, 1);

    // 아이템 효과 적용
    switch(itemType) {
      case 'boost':
        this.applyEffect(socketId, 'speedBoost', 5000);
        break;
      case 'slow':
        // 1등에게 감속 효과
        const firstPlace = this.getFirstPlace();
        if (firstPlace) {
          this.applyEffect(firstPlace.id, 'slow', 5000);
        }
        break;
      case 'shield':
        this.applyEffect(socketId, 'shield', 10000);
        break;
      case 'teleport':
        // 앞서 있는 플레이어의 위치로 순간이동
        this.teleportPlayer(socketId);
        break;
    }

    this.sendUpdate();
    return true;
  }

  // 아이템 활성화 (단어 입력 모드로 전환)
  activateItem(socketId, itemType) {
    if (!this.gameState.playerItems[socketId]?.includes(itemType)) {
      return false;
    }

    this.gameState.activeItems[socketId] = itemType;
    this.gameState.playerItemTyping[socketId] = '';
    this.sendUpdate();
    return true;
  }

  // 효과 적용
  applyEffect(socketId, effectType, duration) {
    // 방패 효과가 있으면 공격 효과 차단
    if ((effectType === 'slow' || effectType === 'keyboardLock') && 
        this.hasEffect(socketId, 'shield')) {
      return;
    }

    if (!this.gameState.effects[socketId]) {
      this.gameState.effects[socketId] = [];
    }
    
    this.gameState.effects[socketId].push({
      type: effectType,
      endTime: Date.now() + duration
    });
  }

  // 효과 확인
  hasEffect(socketId, effectType) {
    const effects = this.gameState.effects[socketId] || [];
    return effects.some(e => e.type === effectType && Date.now() < e.endTime);
  }

  // 효과 업데이트 (만료된 효과 제거)
  updateEffects() {
    this.room.players.forEach((player) => {
      if (this.gameState.effects[player.id]) {
        this.gameState.effects[player.id] = this.gameState.effects[player.id].filter(
          e => Date.now() < e.endTime
        );
      }
    });
  }

  // 순간이동
  teleportPlayer(socketId) {
    const firstPlace = this.getFirstPlace();
    if (firstPlace && firstPlace.id !== socketId) {
      const targetProgress = firstPlace.progress * 0.8; // 1등의 80% 위치로
      this.gameState.playerProgress[socketId] = targetProgress;
      this.gameState.playerPosition[socketId] = Math.floor(
        targetProgress * this.gameState.text.length
      );
    }
  }

  // 1등 플레이어 가져오기
  getFirstPlace() {
    const rankings = this.getRankings();
    return rankings.length > 0 ? rankings[0] : null;
  }

  // 순위 계산
  getRankings() {
    return this.room.players
      .filter(p => !this.gameState.finished[p.id])
      .map(p => ({
        id: p.id,
        name: p.name,
        progress: this.gameState.playerProgress[p.id] || 0,
        position: this.gameState.playerPosition[p.id] || 0
      }))
      .sort((a, b) => b.progress - a.progress);
  }

  // 완주 처리
  handleFinish(socketId) {
    if (this.gameState.finished[socketId]) return;

    this.gameState.finished[socketId] = true;
    this.gameState.playerProgress[socketId] = 1.0;
    this.gameState.finishOrder.push(socketId);
    
    const player = this.room.players.find(p => p.id === socketId);
    if (player) {
      this.io.to(this.room.id).emit("playerFinished", {
        playerId: socketId,
        playerName: player.name,
        rank: this.gameState.finishOrder.length
      });
    }
  }

  // 게임 결과 계산
  calculateResults() {
    const results = this.room.players.map((player) => {
      const finishRank = this.gameState.finishOrder.indexOf(player.id) + 1;
      const score = finishRank > 0 ? 
        (this.room.players.length - finishRank + 1) * 100 : 
        Math.floor(this.gameState.playerProgress[player.id] * 50);
      
      return {
        id: player.id,
        name: player.name,
        photo: player.photo,
        score: score,
        isWinner: finishRank === 1,
      };
    });

    const winners = results.filter(r => r.isWinner);
    
    return { results, winners };
  }

  getGameStateData() {
    const rankings = this.getRankings();
    const finishedRankings = this.gameState.finishOrder.map((playerId, index) => {
      const player = this.room.players.find(p => p.id === playerId);
      return {
        id: playerId,
        name: player?.name || 'Unknown',
        rank: index + 1
      };
    });

    return {
      text: this.gameState.text,
      playerProgress: this.gameState.playerProgress,
      playerPosition: this.gameState.playerPosition,
      playerItems: this.gameState.playerItems,
      activeItems: this.gameState.activeItems,
      playerItemTyping: this.gameState.playerItemTyping || {},
      rankings: rankings,
      finishedRankings: finishedRankings,
      effects: this.gameState.effects,
      itemWords: this.gameState.itemWords,
    };
  }

  getClientUpdateData() {
    return this.getGameStateData();
  }

  getUpdateEventName() {
    return "typingRacingUpdate";
  }

  sendUpdate() {
    const data = this.getClientUpdateData();
    this.io.to(this.room.id).emit(this.getUpdateEventName(), data);
  }

  handleAction(socketId, action, data) {
    if (action === "typing") {
      return this.handleTyping(socketId, data.char);
    } else if (action === "activateItem") {
      return this.activateItem(socketId, data.itemType);
    }
    return false;
  }

  shouldUseGlobalTimer() {
    return true;
  }

  getGameStartedPayload(socketId) {
    const state = this.getGameStateData();
    return {
      duration: this.gameState.duration,
      startTime: this.gameState.startTime,
      gameType: this.gameState.gameType,
      ...state,
    };
  }
}

module.exports = TypingRacing;
