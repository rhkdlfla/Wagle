const fs = require('fs');
const path = require('path');

class TypingRacing {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
  }

  // 텍스트 파일에서 문제 텍스트 로드 (랜덤으로 10문장 선택)
  loadTypingText() {
    try {
      const filePath = path.join(__dirname, '../../data/typing-texts.txt');
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      // 모든 줄을 읽어서 빈 줄 제거
      const allLines = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      // 랜덤으로 10문장 선택 (10개 미만이면 모두 선택)
      const selectedCount = Math.min(10, allLines.length);
      const selectedLines = [];
      const usedIndices = new Set();
      
      while (selectedLines.length < selectedCount) {
        const randomIndex = Math.floor(Math.random() * allLines.length);
        if (!usedIndices.has(randomIndex)) {
          usedIndices.add(randomIndex);
          selectedLines.push(allLines[randomIndex]);
        }
      }
      
      // 선택된 문장들을 스페이스로 연결
      const text = selectedLines.join(' ');
      return text;
    } catch (error) {
      console.error('[TypingRacing] 텍스트 파일 로드 실패:', error);
      // 기본 텍스트 반환
      return "인생은 속도가 아니라 방향이다 간절히 원하면 온 우주가 도와준다 끝날 때까지 끝난 게 아니다";
    }
  }

  initialize() {
    // 타자연습 텍스트 파일에서 전체 내용 로드 (엔터는 스페이스로 변환)
    this.gameState.text = this.loadTypingText();
    this.gameState.playerProgress = {}; // 플레이어별 진행도 (0~1)
    this.gameState.playerPosition = {}; // 플레이어별 커서 위치 (문자 인덱스)
    this.gameState.playerItems = {}; // 플레이어별 보유 아이템
    this.gameState.playerItemTyping = {}; // 플레이어별 아이템 단어 입력 진행도 {playerId: {"itemTyping_itemId": "입력중인글자"}}
    this.gameState.playerItemWordMap = {}; // 플레이어별 아이템과 단어 매핑 {playerId: {"itemType_index": "itemId"}}
    this.gameState.itemBoxes = []; // 아이템 박스 위치들 (진행도 기준)
    this.gameState.effects = {}; // 플레이어별 활성 효과
    this.gameState.pendingEffects = {}; // 지연 발동 효과 {playerId: [{type, target, delay, data}]}
    this.gameState.playerTextModifications = {}; // 플레이어별 텍스트 수정 {playerId: {originalText, modifiedText}}
    this.gameState.autoTyping = {}; // 자동 타이핑 상태 {playerId: {active: bool, speed: number}}
    this.gameState.finished = {}; // 완주한 플레이어들
    this.gameState.finishOrder = []; // 완주 순서
    this.gameState.countdownEndTime = null; // 첫 완주 후 10초 카운트다운 종료 시간

    // 아이템 박스 위치 설정 (8자 루프의 특정 지점)
    // 8자 루프는 0.0에서 시작해서 1.0에서 끝남
    // 아이템 박스는 0.25, 0.5, 0.75 지점에 배치
    this.gameState.itemBoxes = [0.25, 0.5, 0.75];

    // 아이템 정의 (아이템명: 사용할 단어는 랜덤으로 생성)
    // 랜덤 두글자 한글 단어 생성 함수
    this.gameState.itemWords = {}; // 아이템별 단어는 획득 시 생성

    // 플레이어 초기화
    this.room.players.forEach((player) => {
      this.gameState.playerProgress[player.id] = 0;
      this.gameState.playerPosition[player.id] = 0;
      this.gameState.playerItems[player.id] = [];
      this.gameState.playerItemTyping[player.id] = {};
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
      
      // 지연 발동 효과 처리
      this.processPendingEffects();
      
      // 자동 타이핑 처리
      this.processAutoTyping();

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

    // 텍스트 수정 확인 (easyType 효과)
    let text = this.gameState.text;
    const textMod = this.gameState.playerTextModifications?.[socketId];
    if (textMod && textMod.modifiedText) {
      text = textMod.modifiedText;
    }
    
    const currentPos = this.gameState.playerPosition[socketId] || 0;

    // 보유한 아이템의 단어를 입력 중인지 확인 (아이템이 있으면 항상 체크)
    // 아이템 단어 입력은 일반 타이핑과 독립적으로 처리
    this.checkItemWordTyping(socketId, char);

    // 일반 타이핑 처리 (아이템 단어 입력과 독립적으로 처리)
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

  // 랜덤 두글자 한글 단어 생성 (실제 의미가 있는 단어 목록)
  generateRandomTwoCharWord() {
    // 실제로 사용되는 두글자 한글 단어 목록
    const twoCharWords = [
      // 자연
      '하늘', '바다', '구름', '별', '달', '태양', '바람', '비', '눈', '번개',
      // 식물
      '나무', '꽃', '풀', '잎', '열매', '씨', '뿌리', '가지',
      // 과일
      '사과', '포도', '딸기', '수박', '참외', '복숭아',
      // 동물
      '토끼', '새', '곰', '호랑이', '사자',
      // 교통수단
      '기차', '배', '버스', '지하철', '자전거',
      // 학용품
      '책', '연필', '지우개', '가방', '공책', '필통', '자', '지도',
      // 감정/관계
      '사랑', '친구', '가족', '행복', '기쁨', '슬픔', '웃음', '눈물',
      // 장소
      '학교', '집', '병원', '공원', '도서관', '상점', '시장', '극장',
      // 음식
      '밥', '물', '빵', '우유', '과자', '음료', '국',
      // 신체부위
      '손', '발', '눈', '코', '입', '귀', '머리', '팔',
      // 색깔
      '빨강', '파랑', '노랑', '초록', '보라', '주황', '검정', '하양',
      // 시간
      '오늘', '어제', '내일', '아침', '점심', '저녁', '밤', '낮',
      // 기타 일상 단어
      '문', '창문', '의자', '책상', '침대', '옷', '신발', '모자',
      '전화', '라디오', '시계', '열쇠', '돈', '카드', '우산', '장갑',
      '구두', '운동화', '안경', '지갑', '가위', '바늘', '실', '천',
      '종이', '펜', '볼펜', '마우스', '키보드', '모니터', '스피커', '마이크',
      '의사', '선생', '학생', '엄마', '아빠', '형', '누나', '동생',
      '친구', '이웃', '사람', '남자', '여자', '아이', '어른', '노인'
    ];
    
    const randomIndex = Math.floor(Math.random() * twoCharWords.length);
    return twoCharWords[randomIndex];
  }

  // 아이템 단어 입력 체크 (보유한 아이템 중 하나라도 입력 중인지 확인)
  // 일반 타이핑과 독립적으로 처리되므로 반환값 없음
  checkItemWordTyping(socketId, char) {
    const playerItems = this.gameState.playerItems[socketId] || [];
    if (playerItems.length === 0) return;

    // playerItemTyping 초기화 확인
    if (!this.gameState.playerItemTyping[socketId]) {
      this.gameState.playerItemTyping[socketId] = {};
    }

    // 각 아이템의 단어를 체크
    const itemWordMap = this.gameState.playerItemWordMap?.[socketId] || {};
    
    for (let itemIndex = 0; itemIndex < playerItems.length; itemIndex++) {
      const itemType = playerItems[itemIndex];
      const mapKey = `${itemType}_${itemIndex}`;
      const itemId = itemWordMap[mapKey];
      
      if (!itemId) continue;
      
      const itemWord = this.gameState.itemWords[itemId];
      if (!itemWord) continue;

      // 현재 아이템의 입력 진행도 가져오기
      const typingKey = `itemTyping_${itemId}`;
      const currentTyped = this.gameState.playerItemTyping[socketId][typingKey] || '';
      const nextChar = itemWord[currentTyped.length];

      if (char === nextChar) {
        const newTyped = currentTyped + char;
        
        // 아이템 단어 완성
        if (newTyped === itemWord) {
          this.useItem(socketId, itemType, itemIndex);
          // 해당 아이템의 입력 진행도 초기화
          delete this.gameState.playerItemTyping[socketId][typingKey];
          delete itemWordMap[mapKey];
          delete this.gameState.itemWords[itemId];
          this.sendUpdate();
          return;
        } else {
          // 입력 진행도 업데이트
          this.gameState.playerItemTyping[socketId][typingKey] = newTyped;
          this.sendUpdate();
          return;
        }
      }
    }

    // 어떤 아이템 단어도 매칭되지 않으면 진행 중인 입력 확인
    let hasActiveTyping = false;
    
    for (let itemIndex = 0; itemIndex < playerItems.length; itemIndex++) {
      const itemType = playerItems[itemIndex];
      const mapKey = `${itemType}_${itemIndex}`;
      const itemId = itemWordMap[mapKey];
      
      if (!itemId) continue;
      
      const typingKey = `itemTyping_${itemId}`;
      const currentTyped = this.gameState.playerItemTyping[socketId][typingKey] || '';
      if (currentTyped.length > 0) {
        // 다음 글자가 맞지 않으면 초기화
        const itemWord = this.gameState.itemWords[itemId];
        if (itemWord) {
          const nextChar = itemWord[currentTyped.length];
          if (char !== nextChar) {
            // 첫 글자와도 맞지 않으면 완전 초기화
            if (char !== itemWord[0]) {
              this.gameState.playerItemTyping[socketId][typingKey] = '';
            }
          } else {
            hasActiveTyping = true;
          }
        }
      }
    }
    
    // 첫 글자가 맞는 아이템이 있으면 입력 시작
    if (!hasActiveTyping) {
      for (let itemIndex = 0; itemIndex < playerItems.length; itemIndex++) {
        const itemType = playerItems[itemIndex];
        const mapKey = `${itemType}_${itemIndex}`;
        const itemId = itemWordMap[mapKey];
        
        if (!itemId) continue;
        
        const itemWord = this.gameState.itemWords[itemId];
        if (itemWord && char === itemWord[0]) {
          const typingKey = `itemTyping_${itemId}`;
          this.gameState.playerItemTyping[socketId][typingKey] = char;
          this.sendUpdate();
          return;
        }
      }
    }
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
          // 아이템 획득 (순위에 따른 가중치 적용)
          const randomItem = this.getWeightedRandomItem(player.id);
          
          if (!this.gameState.playerItems[player.id]) {
            this.gameState.playerItems[player.id] = [];
          }
          this.gameState.playerItems[player.id].push(randomItem);
          
          // 아이템별 랜덤 두글자 단어 생성
          const itemWord = this.generateRandomTwoCharWord();
          // 아이템별로 고유한 단어를 저장하기 위해 아이템 ID를 키로 사용
          const itemId = `${randomItem}_${player.id}_${Date.now()}_${Math.random()}`;
          this.gameState.itemWords[itemId] = itemWord;
          
          // 플레이어의 아이템과 단어 매핑 저장
          if (!this.gameState.playerItemWordMap) {
            this.gameState.playerItemWordMap = {};
          }
          if (!this.gameState.playerItemWordMap[player.id]) {
            this.gameState.playerItemWordMap[player.id] = {};
          }
          // 아이템 인덱스를 키로 사용 (같은 타입의 아이템이 여러 개일 수 있음)
          const itemIndex = this.gameState.playerItems[player.id].length - 1;
          this.gameState.playerItemWordMap[player.id][`${randomItem}_${itemIndex}`] = itemId;
          
          this.gameState[boxKey] = true;
          
          // 플레이어에게 아이템 획득 알림
          this.io.to(player.id).emit("itemReceived", { item: randomItem, word: itemWord });
        }
      });
    });
  }

  // 순위에 따른 가중치 아이템 선택
  getWeightedRandomItem(socketId) {
    const rankings = this.getRankings();
    const playerRank = rankings.findIndex(r => r.id === socketId) + 1;
    const totalPlayers = this.room.players.filter(p => !this.gameState.finished[p.id]).length;
    
    // 순위 계산 (1등 = 1, 꼴등 = totalPlayers)
    const rank = playerRank || totalPlayers;
    
    // 아이템 목록과 가중치
    const items = [
      { type: 'easyType', weight: 1 },      // 타이핑 도움
      { type: 'autoType', weight: 1 },      // 타이핑 도움
      { type: 'confuseText', weight: 1 },   // 공격
      { type: 'freezeEven', weight: 1 },    // 공격
      { type: 'blockFirst', weight: 1 },    // 공격
      { type: 'shield', weight: 1 },        // 방어
      { type: 'reflect', weight: 1 }        // 방어
    ];
    
    // 후발 주자(순위가 낮을수록)에게 타이핑 도움 아이템 가중치 증가
    // 선두 주자(순위가 높을수록)에게 방어 아이템 가중치 증가
    const rankRatio = rank / Math.max(totalPlayers, 1); // 0에 가까울수록 1등, 1에 가까울수록 꼴등
    
    items.forEach(item => {
      if (item.type === 'easyType' || item.type === 'autoType') {
        // 후발 주자에게 가중치 증가 (rankRatio가 클수록 가중치 증가)
        item.weight = 1 + (rankRatio * 2); // 최대 3배 가중치
      } else if (item.type === 'shield' || item.type === 'reflect') {
        // 선두 주자에게 가중치 증가 (rankRatio가 작을수록 가중치 증가)
        item.weight = 1 + ((1 - rankRatio) * 2); // 최대 3배 가중치
      }
    });
    
    // 가중치 기반 랜덤 선택
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const item of items) {
      random -= item.weight;
      if (random <= 0) {
        return item.type;
      }
    }
    
    // 기본값 (혹시 모를 경우)
    return items[Math.floor(Math.random() * items.length)].type;
  }

  // 아이템 사용
  useItem(socketId, itemType, itemIndex = null) {
    const player = this.room.players.find(p => p.id === socketId);
    if (!player) return false;

    // 아이템 보유 확인
    if (itemIndex === null) {
      itemIndex = this.gameState.playerItems[socketId]?.indexOf(itemType);
    }
    if (itemIndex === -1) return false;

    // 아이템 제거
    this.gameState.playerItems[socketId].splice(itemIndex, 1);
    
    // 아이템 단어 매핑 정리
    if (this.gameState.playerItemWordMap?.[socketId]) {
      const mapKey = `${itemType}_${itemIndex}`;
      delete this.gameState.playerItemWordMap[socketId][mapKey];
      
      // 나머지 아이템의 인덱스 재정렬
      const remainingItems = this.gameState.playerItems[socketId] || [];
      const newMap = {};
      remainingItems.forEach((item, idx) => {
        const oldKey = `${item}_${idx >= itemIndex ? idx + 1 : idx}`;
        if (this.gameState.playerItemWordMap[socketId][oldKey]) {
          newMap[`${item}_${idx}`] = this.gameState.playerItemWordMap[socketId][oldKey];
        }
      });
      this.gameState.playerItemWordMap[socketId] = newMap;
    }

    // 아이템 효과 적용
    switch(itemType) {
      case 'easyType':
        // 10초간 모든 글자를 가나다라마바사아자차카타파하로 랜덤 변경
        this.applyEasyType(socketId);
        break;
      case 'autoType':
        // 5초간 자동 타이핑
        this.applyAutoType(socketId);
        break;
      case 'confuseText':
        // 앞선 플레이어들의 글자를 어려운 단어로 변경 (3초 후 발동)
        this.scheduleDelayedEffect(socketId, 'confuseText', null, 3000, {});
        // 대상들에게 공격 알림 전송
        this.notifyAttackTargets(socketId, 'confuseText', 3);
        break;
      case 'freezeEven':
        // 앞선 플레이어 중 짝수칸에 있으면 3초간 멈춤 (3초 후 발동)
        this.scheduleDelayedEffect(socketId, 'freezeEven', null, 3000, {});
        // 대상들에게 공격 알림 전송
        this.notifyAttackTargets(socketId, 'freezeEven', 3);
        break;
      case 'blockFirst':
        // 1등을 3초간 타이핑 못하게 막기 (3초 후 발동)
        this.scheduleDelayedEffect(socketId, 'blockFirst', null, 3000, {});
        // 대상에게 공격 알림 전송
        const firstPlace = this.getFirstPlace();
        if (firstPlace) {
          const sourcePlayer = this.room.players.find(p => p.id === socketId);
          if (sourcePlayer) {
            this.io.to(firstPlace.id).emit("attackIncoming", {
              sourceName: sourcePlayer.name,
              effectType: 'blockFirst',
              remainingSeconds: 3
            });
          }
        }
        break;
      case 'shield':
        // 10초간 공격 면역
        this.applyEffect(socketId, 'shield', 10000);
        break;
      case 'reflect':
        // 1초간 공격 반사
        this.applyEffect(socketId, 'reflect', 1000);
        break;
    }

    this.sendUpdate();
    return true;
  }

  // 아이템 활성화는 더 이상 필요 없음 (자동으로 체크됨)
  // 하지만 호환성을 위해 유지
  activateItem(socketId, itemType) {
    // 아이템은 자동으로 체크되므로 항상 true 반환
    return true;
  }

  // 효과 적용
  applyEffect(socketId, effectType, duration, sourceId = null) {
    // 반사 효과 확인
    if (sourceId && this.hasEffect(socketId, 'reflect') && 
        (effectType === 'slow' || effectType === 'keyboardLock' || effectType === 'confuseText' || effectType === 'freezeEven')) {
      // 공격을 반사
      this.applyEffect(sourceId, effectType, duration, socketId);
      return;
    }
    
    // 방패 효과가 있으면 공격 효과 차단
    if ((effectType === 'slow' || effectType === 'keyboardLock' || effectType === 'confuseText' || effectType === 'freezeEven') && 
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
  
  // EasyType 효과 적용 (10초간 모든 글자를 가나다라마바사아자차카타파하로 랜덤 변경)
  applyEasyType(socketId) {
    const easyChars = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하'];
    const originalText = this.gameState.text;
    let modifiedText = '';
    
    for (let i = 0; i < originalText.length; i++) {
      if (originalText[i] === ' ') {
        modifiedText += ' ';
      } else {
        modifiedText += easyChars[Math.floor(Math.random() * easyChars.length)];
      }
    }
    
    this.gameState.playerTextModifications[socketId] = {
      originalText: originalText,
      modifiedText: modifiedText
    };
    
    this.applyEffect(socketId, 'easyType', 10000);
    
    // 10초 후 원래 텍스트로 복구
    setTimeout(() => {
      if (this.gameState.playerTextModifications[socketId]) {
        delete this.gameState.playerTextModifications[socketId];
      }
    }, 10000);
  }
  
  // AutoType 효과 적용 (5초간 자동 타이핑)
  applyAutoType(socketId) {
    this.gameState.autoTyping[socketId] = {
      active: true,
      speed: 100, // 100ms마다 한 글자
      endTime: Date.now() + 5000
    };
  }
  
  // 자동 타이핑 처리
  processAutoTyping() {
    Object.keys(this.gameState.autoTyping).forEach(socketId => {
      const autoType = this.gameState.autoTyping[socketId];
      if (!autoType.active || Date.now() >= autoType.endTime) {
        delete this.gameState.autoTyping[socketId];
        return;
      }
      
      // 마지막 자동 타이핑 시간 확인
      if (!autoType.lastTypingTime || Date.now() - autoType.lastTypingTime >= autoType.speed) {
        const text = this.gameState.text;
        const currentPos = this.gameState.playerPosition[socketId] || 0;
        
        if (currentPos < text.length) {
          const expectedChar = text[currentPos];
          this.handleTyping(socketId, expectedChar);
          autoType.lastTypingTime = Date.now();
        }
      }
    });
  }
  
  // 지연 발동 효과 스케줄링
  scheduleDelayedEffect(socketId, effectType, targetId, delay, data) {
    if (!this.gameState.pendingEffects[socketId]) {
      this.gameState.pendingEffects[socketId] = [];
    }
    
    const scheduledTime = Date.now() + delay;
    const effectData = {
      type: effectType,
      target: targetId,
      delay: delay,
      data: data,
      scheduledTime: scheduledTime,
      sourceId: socketId
    };
    
    this.gameState.pendingEffects[socketId].push(effectData);
    
    // 공격 효과인 경우 대상에게 알림 전송
    if (effectType === 'confuseText' || effectType === 'freezeEven' || effectType === 'blockFirst') {
      const sourcePlayer = this.room.players.find(p => p.id === socketId);
      if (sourcePlayer) {
        // 대상이 특정 플레이어인 경우
        if (targetId) {
          this.io.to(targetId).emit("attackIncoming", {
            sourceName: sourcePlayer.name,
            effectType: effectType,
            remainingSeconds: Math.ceil(delay / 1000)
          });
        } else {
          // 대상이 여러 플레이어인 경우 (confuseText, freezeEven)
          // applyConfuseText, applyFreezeEven, applyBlockFirst에서 처리
        }
      }
    }
  }
  
  // 지연 발동 효과 처리
  processPendingEffects() {
    Object.keys(this.gameState.pendingEffects).forEach(socketId => {
      const pending = this.gameState.pendingEffects[socketId];
      const now = Date.now();
      
      for (let i = pending.length - 1; i >= 0; i--) {
        const effect = pending[i];
        if (now >= effect.scheduledTime) {
          // 효과 발동
          if (effect.type === 'confuseText') {
            this.applyConfuseText(socketId);
          } else if (effect.type === 'freezeEven') {
            this.applyFreezeEven(socketId);
          } else if (effect.type === 'blockFirst') {
            this.applyBlockFirst(socketId);
          }
          pending.splice(i, 1);
        }
      }
      
      if (pending.length === 0) {
        delete this.gameState.pendingEffects[socketId];
      }
    });
  }
  
  // ConfuseText 효과 적용 (앞선 플레이어들의 글자를 어려운 단어로 변경)
  applyConfuseText(socketId) {
    const myProgress = this.gameState.playerProgress[socketId] || 0;
    const difficultWords = ['꿠뒑', '뷁', '똠방각하', '뽈뽈뽈', '뿌뿌뿌', '뽀뽀뽀', '뿡뿡뿡', '뽕뽕뽕'];
    
    this.room.players.forEach(player => {
      if (player.id === socketId || this.gameState.finished[player.id]) return;
      
      const playerProgress = this.gameState.playerProgress[player.id] || 0;
      if (playerProgress > myProgress) {
        // 앞서 있는 플레이어
        const originalText = this.gameState.text;
        let modifiedText = '';
        let wordIndex = 0;
        
        for (let i = 0; i < originalText.length; i++) {
          if (originalText[i] === ' ') {
            modifiedText += ' ';
          } else {
            // 어려운 단어로 교체 (원래 글자 하나당 어려운 단어 하나)
            const word = difficultWords[wordIndex % difficultWords.length];
            modifiedText += word;
            wordIndex++;
          }
        }
        
        // 앞서 있을수록 늦게 풀리게 (진행도 차이에 비례)
        const progressDiff = playerProgress - myProgress;
        const duration = 3000 + Math.floor(progressDiff * 10000); // 최소 3초, 최대 13초
        
        this.gameState.playerTextModifications[player.id] = {
          originalText: originalText,
          modifiedText: modifiedText
        };
        
        this.applyEffect(player.id, 'confuseText', duration, socketId);
        
        // 공격 알림 전송
        const sourcePlayer = this.room.players.find(p => p.id === socketId);
        if (sourcePlayer) {
          this.io.to(player.id).emit("attackIncoming", {
            sourceName: sourcePlayer.name,
            effectType: 'confuseText',
            remainingSeconds: 0 // 이미 발동됨
          });
        }
        
        setTimeout(() => {
          if (this.gameState.playerTextModifications[player.id]) {
            delete this.gameState.playerTextModifications[player.id];
          }
        }, duration);
      }
    });
  }
  
  // FreezeEven 효과 적용 (앞선 플레이어 중 짝수칸에 있으면 3초간 멈춤)
  applyFreezeEven(socketId) {
    const myProgress = this.gameState.playerProgress[socketId] || 0;
    const sourcePlayer = this.room.players.find(p => p.id === socketId);
    
    this.room.players.forEach(player => {
      if (player.id === socketId || this.gameState.finished[player.id]) return;
      
      const playerProgress = this.gameState.playerProgress[player.id] || 0;
      if (playerProgress > myProgress) {
        // 앞서 있는 플레이어
        const playerPosition = this.gameState.playerPosition[player.id] || 0;
        
        // 짝수칸에 있으면 멈춤
        if (playerPosition % 2 === 0) {
          this.applyEffect(player.id, 'keyboardLock', 3000, socketId);
          
          // 공격 알림 전송
          if (sourcePlayer) {
            this.io.to(player.id).emit("attackIncoming", {
              sourceName: sourcePlayer.name,
              effectType: 'freezeEven',
              remainingSeconds: 0 // 이미 발동됨
            });
          }
        }
      }
    });
  }
  
  // BlockFirst 효과 적용 (1등을 3초간 타이핑 못하게 막기)
  applyBlockFirst(socketId) {
    const firstPlace = this.getFirstPlace();
    const sourcePlayer = this.room.players.find(p => p.id === socketId);
    
    if (firstPlace) {
      this.applyEffect(firstPlace.id, 'keyboardLock', 3000, socketId);
      
      // 공격 알림 전송
      if (sourcePlayer) {
        this.io.to(firstPlace.id).emit("attackIncoming", {
          sourceName: sourcePlayer.name,
          effectType: 'blockFirst',
          remainingSeconds: 0 // 이미 발동됨
        });
      }
    }
  }
  
  // 공격 대상들에게 알림 전송
  notifyAttackTargets(socketId, effectType, delaySeconds) {
    const myProgress = this.gameState.playerProgress[socketId] || 0;
    const sourcePlayer = this.room.players.find(p => p.id === socketId);
    
    if (!sourcePlayer) return;
    
    this.room.players.forEach(player => {
      if (player.id === socketId || this.gameState.finished[player.id]) return;
      
      const playerProgress = this.gameState.playerProgress[player.id] || 0;
      
      if (effectType === 'confuseText' || effectType === 'freezeEven') {
        // 앞서 있는 플레이어들에게 알림
        if (playerProgress > myProgress) {
          this.io.to(player.id).emit("attackIncoming", {
            sourceName: sourcePlayer.name,
            effectType: effectType,
            remainingSeconds: delaySeconds
          });
        }
      }
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
    
    // 첫 번째 완주자면 10초 카운트다운 시작
    if (this.gameState.finishOrder.length === 1 && !this.gameState.countdownEndTime) {
      this.gameState.countdownEndTime = Date.now() + 10000;
      this.io.to(this.room.id).emit("countdownStarted", {
        endTime: this.gameState.countdownEndTime
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
      playerItemWordMap: this.gameState.playerItemWordMap || {},
      itemWords: this.gameState.itemWords || {},
      playerTextModifications: this.gameState.playerTextModifications || {},
      rankings: rankings,
      finishedRankings: finishedRankings,
      effects: this.gameState.effects,
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
    }
    // activateItem은 더 이상 필요 없음 (자동으로 체크됨)
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
