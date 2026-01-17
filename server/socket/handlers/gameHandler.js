const ClickBattle = require("../games/ClickBattle");
const AppleBattle = require("../games/AppleBattle");
const NumberRush = require("../games/NumberRush");

// 게임 인스턴스 저장 (updateInterval 관리를 위해)
const gameInstances = new Map(); // roomId -> { game, updateInterval, gameType }

// 게임 팩토리: 게임 타입별 클래스 매핑
const GAME_CLASSES = {
  clickBattle: ClickBattle,
  appleBattle: AppleBattle,
  numberRush: NumberRush,
};

// 게임 설정 (각 게임의 기본 설정을 중앙에서 관리)
const GAME_CONFIGS = {
  clickBattle: {
    defaultDuration: 30000, // 30초
    minDuration: 5000,
    maxDuration: 300000,
    supportsRelayMode: true,
  },
  appleBattle: {
    defaultDuration: 120000, // 2분
    minDuration: 30000,
    maxDuration: 300000,
    supportsRelayMode: true,
  },
  numberRush: {
    defaultDuration: 60000, // 1분
    minDuration: 10000,
    maxDuration: 300000,
    supportsRelayMode: false,
  },
};

// 게임 팩토리 함수
function createGame(gameType, io, gameState, room) {
  const GameClass = GAME_CLASSES[gameType];
  if (!GameClass) {
    throw new Error(`알 수 없는 게임 타입: ${gameType}`);
  }
  return new GameClass(io, gameState, room);
}

// 게임 설정 가져오기
function getGameConfig(gameType) {
  return GAME_CONFIGS[gameType] || GAME_CONFIGS.clickBattle;
}

// 게임 시간 계산
function calculateGameDuration(gameType, requestedDuration) {
  const config = getGameConfig(gameType);
  if (requestedDuration) {
    return Math.max(
      config.minDuration,
      Math.min(config.maxDuration, parseInt(requestedDuration))
    );
  }
  return config.defaultDuration;
}

function setupGameHandlers(socket, io, rooms, gameStates, getRoomList) {
  // 게임 시작
  socket.on("startGame", ({ roomId, gameType = "clickBattle", duration }) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length === 0) {
      return;
    }

    // 방장만 게임 시작 가능
    if (room.players[0].id !== socket.id) {
      socket.emit("gameError", { message: "방장만 게임을 시작할 수 있습니다." });
      return;
    }

    // 게임 타입 검증
    if (!GAME_CLASSES[gameType]) {
      socket.emit("gameError", { message: "알 수 없는 게임 타입입니다." });
      return;
    }

    room.status = "playing";
    room.selectedGame = gameType;

    // 게임 시간 계산
    const gameDuration = calculateGameDuration(gameType, duration);
    const config = getGameConfig(gameType);

    // 게임 상태 초기화
    const gameState = {
      gameType: gameType,
      startTime: Date.now(),
      duration: gameDuration,
      clicks: {},
      isActive: true,
      relayMode:
        config.supportsRelayMode &&
        room.teamMode &&
        room.relayMode
          ? true
          : false,
    };

    // 게임 인스턴스 생성 및 초기화
    try {
      const game = createGame(gameType, io, gameState, room);
      game.initialize();
      gameStates.set(roomId, gameState);

      // 게임 시작 이벤트 전송
      const gameStateData = game.getGameStateData();
      io.to(roomId).emit("gameStarted", {
        room: room,
        gameState: {
          duration: gameState.duration,
          startTime: gameState.startTime,
          gameType: gameType,
          // 게임별 추가 데이터는 getGameStateData에서 포함
          ...(gameStateData.grid && { grid: gameStateData.grid }),
        },
      });

      io.emit("roomList", getRoomList(rooms));
      console.log(
        `게임 시작: ${roomId}, 게임 타입: ${gameType}, 시작 시간: ${new Date(
          gameState.startTime
        ).toISOString()}`
      );

      // 업데이트 루프 시작
      const updateInterval = game.startUpdateLoop(() => endGame(roomId));

      // 게임 인스턴스 저장
      gameInstances.set(roomId, { game, updateInterval, gameType });

      // 게임 종료 타이머
      setTimeout(() => {
        const instance = gameInstances.get(roomId);
        if (instance && instance.updateInterval) {
          clearInterval(instance.updateInterval);
        }
        endGame(roomId);
      }, gameState.duration);
    } catch (error) {
      console.error(`게임 생성 실패: ${gameType}`, error);
      socket.emit("gameError", { message: "게임을 시작할 수 없습니다." });
      room.status = "waiting";
    }
  });

  // 게임 종료 함수
  function endGame(roomId) {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);
    
    if (!gameState || !room) return;
    
    gameState.isActive = false;
    
    const instance = gameInstances.get(roomId);
    let results, winners;
    
    if (instance && instance.game) {
      const gameResult = instance.game.calculateResults();
      results = gameResult.results;
      winners = gameResult.winners;
    } else {
      // 폴백 (게임 인스턴스가 없는 경우)
      results = [];
      winners = [];
    }
    
    // 게임 종료 이벤트 전송
    io.to(roomId).emit("gameEnded", {
      results: results,
      winners: winners,
    });
    
    // 게임 상태 및 인스턴스 삭제
    gameStates.delete(roomId);
    gameInstances.delete(roomId);
    
    // 방 상태를 대기 중으로 변경
    room.status = "waiting";
    io.emit("roomList", getRoomList(rooms));
    
    console.log(`게임 종료: ${roomId}, 승자: ${winners.join(", ")}`);
  }

  // 게임 상태 요청 (개선: 게임별 분기 제거)
  socket.on("getGameState", ({ roomId }) => {
    console.log(`게임 상태 요청 받음: ${roomId} from ${socket.id}`);
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);

    if (!gameState || !room || !gameState.isActive) {
      console.log(
        `게임이 진행 중이 아닙니다. roomId: ${roomId}, roomStatus: ${room?.status}`
      );
      return;
    }

    const instance = gameInstances.get(roomId);
    if (!instance || !instance.game) {
      return;
    }

    try {
      const gameStateData = instance.game.getGameStateData();
      
      // 게임 시작 이벤트 전송
      socket.emit("gameStarted", {
        room: room,
        gameState: {
          duration: gameStateData.duration,
          startTime: gameStateData.startTime,
          gameType: gameState.gameType,
          ...(gameStateData.grid && { grid: gameStateData.grid }),
        },
      });

      // 게임별 업데이트 이벤트 전송 (게임 클래스에서 클라이언트 형식으로 변환)
      const updateEventName = instance.game.getUpdateEventName?.() || getUpdateEventName(gameState.gameType);
      
      // 게임 클래스에 getClientUpdateData 메서드가 있으면 사용, 없으면 기본 데이터 사용
      const clientUpdateData = instance.game.getClientUpdateData?.() || gameStateData;
      socket.emit(updateEventName, clientUpdateData);
    } catch (error) {
      console.error(`게임 상태 전송 실패: ${roomId}`, error);
    }
  });

  // 게임별 업데이트 이벤트 이름 반환 (하위 호환성 - 게임 클래스에 getUpdateEventName이 없을 때 사용)
  function getUpdateEventName(gameType) {
    const eventNameMap = {
      clickBattle: "clickUpdate",
      appleBattle: "appleBattleUpdate",
      numberRush: "numberRushUpdate",
    };
    return eventNameMap[gameType] || `${gameType}Update`;
  }

  // 클릭 이벤트 (클릭 대결)
  socket.on("gameClick", ({ roomId }) => {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);
    
    if (!gameState || !room) {
      socket.emit("gameError", { message: "게임이 진행 중이 아닙니다." });
      return;
    }
    
    if (!gameState.isActive || gameState.gameType !== "clickBattle") {
      return;
    }
    
    // 플레이어가 방에 있는지 확인
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      socket.emit("gameError", { message: "플레이어를 찾을 수 없습니다." });
      return;
    }
    
    const instance = gameInstances.get(roomId);
    if (instance && instance.game instanceof ClickBattle) {
      instance.game.handleClick(socket.id);
    }
  });
  
  // 이어달리기 모드: 다음 팀원에게 순서 넘기기 (우클릭)
  socket.on("passTurn", ({ roomId }) => {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);

    if (!gameState || !room || !gameState.isActive || !gameState.relayMode) {
      return;
    }

    const config = getGameConfig(gameState.gameType);
    if (!config.supportsRelayMode) {
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return;
    }

    const instance = gameInstances.get(roomId);
    if (instance && instance.game && typeof instance.game.passTurn === "function") {
      instance.game.passTurn(socket.id);
    }
  });
  
  // 게임 종료 (방장만 가능)
  socket.on("endGame", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      return;
    }
    
    // 방장만 게임 종료 가능
    if (room.players[0].id !== socket.id) {
      socket.emit("gameError", { message: "방장만 게임을 종료할 수 있습니다." });
      return;
    }
    
    const gameState = gameStates.get(roomId);
    if (!gameState || !gameState.isActive) {
      return; // 게임이 진행 중이 아닌 경우 무시
    }
    
    // 게임 종료
    endGame(roomId);
    console.log(`방장이 게임을 강제 종료함: ${roomId}`);
  });

  // 사과 제거 이벤트 (사과배틀)
  socket.on("appleBattleRemove", ({ roomId, startRow, startCol, endRow, endCol }) => {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);
    
    if (!gameState || !room || gameState.gameType !== "appleBattle") {
      socket.emit("gameError", { message: "게임이 진행 중이 아닙니다." });
      return;
    }
    
    if (!gameState.isActive) {
      return;
    }
    
    // 플레이어가 방에 있는지 확인
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return;
    }
    
    const instance = gameInstances.get(roomId);
    if (instance && instance.game instanceof AppleBattle) {
      instance.game.handleRemove(socket.id, startRow, startCol, endRow, endCol);
    }
  });

  // 범용 게임 액션 핸들러 (새로운 방식, 하위 호환성 유지)
  socket.on("gameAction", ({ roomId, action, data }) => {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);

    if (!gameState || !room || !gameState.isActive) {
      socket.emit("gameError", { message: "게임이 진행 중이 아닙니다." });
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      socket.emit("gameError", { message: "플레이어를 찾을 수 없습니다." });
      return;
    }

    const instance = gameInstances.get(roomId);
    if (!instance || !instance.game) {
      return;
    }

    // 게임 클래스의 handleAction 메서드 호출 (있는 경우)
    if (typeof instance.game.handleAction === "function") {
      try {
        instance.game.handleAction(socket.id, action, data);
      } catch (error) {
        console.error(`게임 액션 처리 실패: ${action}`, error);
        socket.emit("gameError", { message: "액션을 처리할 수 없습니다." });
      }
    } else {
      // 하위 호환성: 기존 게임별 메서드 호출
      handleLegacyGameAction(instance, gameState, socket.id, action, data);
    }
  });

  // 하위 호환성: 기존 게임별 액션 처리
  function handleLegacyGameAction(instance, gameState, socketId, action, data) {
    if (gameState.gameType === "clickBattle" && action === "click") {
      if (instance.game.handleClick) {
        instance.game.handleClick(socketId);
      }
    } else if (gameState.gameType === "appleBattle" && action === "remove") {
      if (instance.game.handleRemove) {
        instance.game.handleRemove(
          socketId,
          data.startRow,
          data.startCol,
          data.endRow,
          data.endCol
        );
      }
    }
  }
}

module.exports = { setupGameHandlers, GAME_CLASSES, GAME_CONFIGS };
