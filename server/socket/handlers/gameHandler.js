const ClickBattle = require("../games/ClickBattle");
const AppleBattle = require("../games/AppleBattle");
const DrawGuess = require("../games/DrawGuess");
const QuizBattle = require("../games/QuizBattle");
const NumberRush = require("../games/NumberRush");
const LiarGame = require("../games/LiarGame");
const MemoryGame = require("../games/MemoryGame");
const User = require("../../models/User");

// 게임 인스턴스 저장 (updateInterval 관리를 위해)
const gameInstances = new Map(); // roomId -> { game, updateInterval, endTimeout, gameType }

// 게임 팩토리: 게임 타입별 클래스 매핑
const GAME_CLASSES = {
  clickBattle: ClickBattle,
  appleBattle: AppleBattle,
  drawGuess: DrawGuess,
  quizBattle: QuizBattle,
  numberRush: NumberRush,
  liarGame: LiarGame,
  ticTacToe: TicTacToe,
  memoryGame: MemoryGame,
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
  drawGuess: {
    defaultDuration: 90000, // 1분 30초
    minDuration: 30000,
    maxDuration: 180000,
    supportsRelayMode: false,
  },
  quizBattle: {
    defaultDuration: 600000, // 10분
    minDuration: 60000,
    maxDuration: 1800000,
    supportsRelayMode: false,
  },
  numberRush: {
    defaultDuration: 60000, // 1분
    minDuration: 10000,
    maxDuration: 300000,
    supportsRelayMode: false,
  },
  liarGame: {
    defaultDuration: 600000, // 10분 (전역 타이머 사용 안 함)
    minDuration: 60000,
    maxDuration: 1800000,
    supportsRelayMode: false,
  },
  ticTacToe: {
    defaultDuration: 300000, // 5분 (전역 타이머 사용 안 함)
    minDuration: 60000,
    maxDuration: 900000,
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

function buildRanking(results) {
  if (!Array.isArray(results)) return new Map();
  const sorted = [...results].sort((a, b) => {
    const aTeamScore = a.teamScore ?? null;
    const bTeamScore = b.teamScore ?? null;
    if (aTeamScore !== null && bTeamScore !== null && aTeamScore !== bTeamScore) {
      return bTeamScore - aTeamScore;
    }
    const aScore = a.score ?? 0;
    const bScore = b.score ?? 0;
    if (aScore !== bScore) return bScore - aScore;
    return 0;
  });

  const ranking = new Map();
  let currentRank = 1;
  let previousKey = null;

  sorted.forEach((result, index) => {
    const key = `${result.teamScore ?? "none"}|${result.score ?? 0}`;
    if (index === 0) {
      currentRank = 1;
      previousKey = key;
    } else if (key !== previousKey) {
      currentRank = index + 1;
      previousKey = key;
    }
    ranking.set(result.id, currentRank);
  });

  return ranking;
}

async function recordGameResults({ room, results, gameType }) {
  if (!room || !Array.isArray(results) || !gameType) return;

  const playerCount = room.players?.length || results.length || 0;
  const ranking = buildRanking(results);
  const playedAt = new Date();

  const updates = (room.players || [])
    .filter((player) => player.userId && player.provider !== "guest")
    .map((player) => {
      const result = results.find((entry) => entry.id === player.id) || {};
      const rank = ranking.get(player.id) || playerCount || 1;
      const isWinner = result.isWinner ?? rank === 1;
      const historyEntry = {
        gameType,
        rank,
        playersCount: playerCount,
        isWinner,
        playedAt,
      };

      return User.updateOne(
        { _id: player.userId },
        {
          $inc: {
            [`gameStats.${gameType}.plays`]: 1,
            [`gameStats.${gameType}.wins`]: isWinner ? 1 : 0,
          },
          $push: {
            gameHistory: {
              $each: [historyEntry],
              $position: 0,
              $slice: 10,
            },
          },
        }
      ).catch((error) => {
        console.error("게임 결과 저장 실패:", error);
      });
    });

  await Promise.allSettled(updates);
}

function setupGameHandlers(socket, io, rooms, gameStates, getRoomList) {
  // 게임별 업데이트 이벤트 이름 반환 (하위 호환성 - 게임 클래스에 getUpdateEventName이 없을 때 사용)
  function getUpdateEventName(gameType) {
    const eventNameMap = {
      clickBattle: "clickUpdate",
      appleBattle: "appleBattleUpdate",
      numberRush: "numberRushUpdate",
    };
    return eventNameMap[gameType] || `${gameType}Update`;
  }

  function getRoomOrNull(roomId) {
    if (!roomId) return null;
    return rooms.get(roomId) || null;
  }

  function getActiveGameContext({ roomId, requireGameType } = {}) {
    const room = getRoomOrNull(roomId);
    const gameState = roomId ? gameStates.get(roomId) : null;
    const instance = roomId ? gameInstances.get(roomId) : null;
    if (!room || !gameState || !gameState.isActive || !instance || !instance.game) {
      return { ok: false, room, gameState, instance };
    }
    if (requireGameType && gameState.gameType !== requireGameType) {
      return { ok: false, room, gameState, instance, wrongType: true };
    }
    const player = room.players?.find((p) => p.id === socket.id) || null;
    if (!player) {
      return { ok: false, room, gameState, instance, noPlayer: true };
    }
    return { ok: true, room, gameState, instance, player };
  }

  function emitNotActiveGameError() {
    socket.emit("gameError", { message: "게임이 진행 중이 아닙니다." });
  }

  function safeClearTimer(id) {
    if (!id) return;
    clearTimeout(id);
  }

  function safeClearInterval(id) {
    if (!id) return;
    clearInterval(id);
  }

  function cleanupInstance(roomId) {
    const instance = gameInstances.get(roomId);
    if (!instance) return;
    safeClearInterval(instance.updateInterval);
    safeClearTimer(instance.endTimeout);
    gameInstances.delete(roomId);
  }

  function buildGameStartedPayload(game, roomId, gameType, socketId) {
    const base = {
      duration: gameStates.get(roomId)?.duration,
      startTime: gameStates.get(roomId)?.startTime,
      gameType,
    };
    if (typeof game.getGameStartedPayload === "function") {
      return { ...base, ...game.getGameStartedPayload(socketId) };
    }
    // fallback: 기존 gameStateData 기반 (최소 필드)
    if (typeof game.getGameStateData === "function") {
      const state = game.getGameStateData(socketId);
      return {
        ...base,
        duration: state?.duration ?? base.duration,
        startTime: state?.startTime ?? base.startTime,
        gameType: state?.gameType ?? base.gameType,
      };
    }
    return base;
  }

  function emitGameSync(socket, room, roomId, gameState, instance) {
    const game = instance.game;
    const gameType = gameState.gameType;

    // 1) gameStarted (공통)
    socket.emit("gameStarted", {
      room,
      gameState: buildGameStartedPayload(game, roomId, gameType, socket.id),
    });

    // 2) update event (게임이 결정)
    const updateEventName =
      (typeof game.getUpdateEventName === "function" && game.getUpdateEventName()) ||
      getUpdateEventName(gameType);

    const updatePayload =
      (typeof game.getClientUpdateData === "function" && game.getClientUpdateData(socket.id)) ||
      (typeof game.getGameStateData === "function" && game.getGameStateData(socket.id)) ||
      {};

    socket.emit(updateEventName, updatePayload);

    // 3) 개인 전용 데이터(예: drawGuess 단어)
    if (typeof game.emitPrivateState === "function") {
      game.emitPrivateState(socket);
    }
  }

  // 게임 시작
  socket.on("startGame", async ({ 
    roomId, 
    gameType = "clickBattle", 
    duration, 
    quizId, 
    rounds, 
    liarCategory, 
    liarTurnDuration,
    questionTimeLimit, 
    timeBasedScoring, 
    infiniteRetry, 
    questionCount, 
    maxSum,
    memoryMode,
    memoryOptionCount
  }) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length === 0) return;

    // 방장만
    if (room.players[0].id !== socket.id) {
      socket.emit("gameError", { message: "방장만 게임을 시작할 수 있습니다." });
      return;
    }

    // 게임 타입 검증
    if (!GAME_CLASSES[gameType]) {
      socket.emit("gameError", { message: "알 수 없는 게임 타입입니다." });
      return;
    }

    if (gameType === "ticTacToe" && room.players.length !== 2) {
      socket.emit("gameError", { message: "2인만 플레이할 수 있습니다." });
      return;
    }

    room.status = "playing";
    room.selectedGame = gameType;

    const config = getGameConfig(gameType);
    // 퀴즈 배틀은 문제를 다 풀면 끝나므로 duration 설정 불필요
    // 전역 타이머를 사용하지 않으므로 duration은 임의의 값으로 설정 (실제로 사용되지 않음)
    const gameDuration = gameType === "quizBattle" 
      ? 3600000 // 1시간 (임의의 값, 실제로 사용되지 않음)
      : calculateGameDuration(gameType, duration);

    const gameState = {
      gameType,
      startTime: Date.now(),
      duration: gameDuration,
      clicks: {},
      isActive: true,
      relayMode: config.supportsRelayMode && room.teamMode && room.relayMode ? true : false,
      quizId: quizId || null,
      roundsPerPlayer: rounds ? Math.max(1, parseInt(rounds)) : undefined,
      liarCategory: liarCategory || null,
      liarTurnDuration: liarTurnDuration === null ? null : liarTurnDuration,
      questionTimeLimit: questionTimeLimit !== undefined ? (questionTimeLimit === null ? null : parseInt(questionTimeLimit)) : null, // 퀴즈 배틀 문제당 시간 제한 (밀리초, null이면 무제한)
      timeBasedScoring: timeBasedScoring === true, // 퀴즈 배틀 시간 비례 점수 모드
      infiniteRetry: infiniteRetry === true, // 퀴즈 배틀 무한 도전 모드
      questionCount: questionCount !== undefined ? (questionCount === null ? null : Math.max(1, parseInt(questionCount))) : null, // 퀴즈 배틀 풀 문제 수 (null이면 전체 문제)
      maxSum: maxSum !== undefined ? Math.max(2, Math.min(10, parseInt(maxSum))) : 10, // 사과배틀 최대 숫자 (2~10, 기본값 10)
      memoryMode: memoryMode || "number", // 메모리 게임 모드 ("number", "korean", "emoji")
      memoryOptionCount: memoryOptionCount !== undefined ? Math.max(4, Math.min(9, parseInt(memoryOptionCount))) : 4, // 메모리 게임 옵션 개수 (4, 6, 9)
    };
    
    console.log("게임 시작 - maxSum 설정:", gameState.maxSum, "받은 값:", maxSum, "게임 타입:", gameType);

    let game;
    try {
      game = createGame(gameType, io, gameState, room);
      if (typeof game.initialize === "function") {
        // sync/async 모두 지원
        await game.initialize();
      }
    } catch (error) {
      socket.emit("gameError", { message: error?.message || "게임을 시작할 수 없습니다." });
      room.status = "waiting";
      return;
    }

    gameStates.set(roomId, gameState);

    // 게임 시작 이벤트 (공통)
    io.to(roomId).emit("gameStarted", {
      room,
      gameState: buildGameStartedPayload(game, roomId, gameType, socket.id),
    });

    io.emit("roomList", getRoomList(rooms));
    console.log(
      `게임 시작: ${roomId}, 게임 타입: ${gameType}, 시작 시간: ${new Date(
        gameState.startTime
      ).toISOString()}`
    );

    const updateInterval = game.startUpdateLoop(() => endGame(roomId));
    gameInstances.set(roomId, { game, updateInterval, endTimeout: null, gameType });

    const useGlobalTimer =
      typeof game.shouldUseGlobalTimer === "function"
        ? game.shouldUseGlobalTimer()
        : true;

    if (useGlobalTimer) {
      const endTimeout = setTimeout(() => {
        endGame(roomId, { reason: "durationTimeout" });
      }, gameState.duration);
      const instance = gameInstances.get(roomId);
      if (instance) {
        instance.endTimeout = endTimeout;
      }
    }
  });

  // 게임 종료 함수
  async function endGame(roomId, { reason } = {}) {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);
    
    if (!gameState || !room) return;
    // idempotent 보장: 여러 경로에서 endGame이 호출돼도 한 번만 처리
    if (!gameState.isActive) return;
    
    // 플레이어가 없는 방이면 즉시 방 삭제
    if (!room.players || room.players.length === 0) {
      console.log(`게임 종료: ${roomId} - 플레이어가 없어 방 삭제`);
      gameStates.delete(roomId);
      cleanupInstance(roomId);
      rooms.delete(roomId);
      io.emit("roomList", getRoomList(rooms));
      return;
    }
    
    gameState.isActive = false;
    
    const instance = gameInstances.get(roomId);
    let results, winners, teamScores;
    
    if (instance && instance.game) {
      const gameResult = instance.game.calculateResults();
      results = gameResult.results;
      winners = gameResult.winners;
      teamScores = gameResult.teamScores || null; // 퀴즈 배틀 등에서 teamScores 포함
    } else {
      // 폴백 (게임 인스턴스가 없는 경우)
      results = [];
      winners = [];
      teamScores = null;
    }
    
    // 게임 종료 이벤트 전송
    io.to(roomId).emit("gameEnded", {
      results: results,
      winners: winners,
      teamScores: teamScores, // 팀 점수 포함
      reason: reason || null,
    });

    await recordGameResults({
      room,
      results,
      gameType: instance?.gameType || gameState.gameType,
    });
    
    // 게임 상태 및 인스턴스 삭제
    gameStates.delete(roomId);
    cleanupInstance(roomId);
    
    // 방 상태를 대기 중으로 변경
    room.status = "waiting";
    io.to(roomId).emit("roomUpdated", room);
    io.emit("roomList", getRoomList(rooms));
    
    console.log(`게임 종료: ${roomId}, 승자: ${winners.join(", ")}`, reason ? `(reason=${reason})` : "");
  }

  // 게임 상태 요청 (하드코딩 if/else 제거)
  socket.on("getGameState", ({ roomId }) => {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);
    
    if (!gameState || !room || !gameState.isActive) {
      return;
    }

    const instance = gameInstances.get(roomId);
    if (!instance || !instance.game) {
      return;
    }

    emitGameSync(socket, room, roomId, gameState, instance);
  });

  function dispatchGameAction({ roomId, action, data, requireGameType }) {
    const ctx = getActiveGameContext({ roomId, requireGameType });
    if (!ctx.ok) {
      if (ctx.noPlayer) {
        socket.emit("gameError", { message: "플레이어를 찾을 수 없습니다." });
      } else if (!ctx.wrongType) {
        emitNotActiveGameError();
      }
      return null;
    }

    const game = ctx.instance.game;
    if (typeof game.handleAction === "function") {
      try {
        game.handleAction(socket.id, action, data);
      } catch (error) {
        console.error(`게임 액션 처리 실패: ${action}`, error);
        socket.emit("gameError", { message: "액션을 처리할 수 없습니다." });
      }
      return ctx;
    }

    // 하위 호환성: 기존 게임별 메서드 호출
    handleLegacyGameAction(ctx.instance, ctx.gameState, socket.id, action, data);
    return ctx;
  }

  // 클릭 이벤트 (클릭 대결)
  socket.on("gameClick", ({ roomId }) => {
    // 레거시 이벤트를 공통 액션으로 흡수
    dispatchGameAction({ roomId, action: "click", data: {}, requireGameType: "clickBattle" });
  });
  
  // 이어달리기 모드: 다음 팀원에게 순서 넘기기 (우클릭)
  socket.on("passTurn", ({ roomId }) => {
    const ctx = getActiveGameContext({ roomId });
    if (!ctx.ok) return;
    if (!ctx.gameState.relayMode) return;
    const config = getGameConfig(ctx.gameState.gameType);
    if (!config.supportsRelayMode) return;
    const game = ctx.instance.game;
    if (typeof game.passTurn === "function") {
      game.passTurn(socket.id);
    } else if (typeof game.handleAction === "function") {
      // 향후 통합을 위한 fallback
      dispatchGameAction({ roomId, action: "passTurn", data: {} });
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
    endGame(roomId, { reason: "hostEnd" });
    console.log(`방장이 게임을 강제 종료함: ${roomId}`);
  });

  // 정답 제출 (퀴즈배틀)
  socket.on("submitAnswer", ({ roomId, answer, timeSpent }) => {
    // 레거시 이벤트 유지 + 내부는 통합
    const ctx = getActiveGameContext({ roomId, requireGameType: "quizBattle" });
    if (!ctx.ok) {
      if (ctx.noPlayer) socket.emit("gameError", { message: "플레이어를 찾을 수 없습니다." });
      else emitNotActiveGameError();
      return;
    }
    const game = ctx.instance.game;
    if (typeof game.submitAnswer === "function") {
      game.submitAnswer(socket.id, answer, timeSpent);
    } else {
      dispatchGameAction({
        roomId,
        action: "submitAnswer",
        data: { answer, timeSpent },
        requireGameType: "quizBattle",
      });
    }
  });

  // 문제 스킵 투표 (퀴즈배틀)
  socket.on("voteSkipQuestion", ({ roomId }) => {
    const ctx = getActiveGameContext({ roomId, requireGameType: "quizBattle" });
    if (!ctx.ok) {
      if (ctx.noPlayer) socket.emit("gameError", { message: "플레이어를 찾을 수 없습니다." });
      else emitNotActiveGameError();
      return;
    }
    const game = ctx.instance.game;
    if (typeof game.voteSkip === "function") {
      game.voteSkip(socket.id);
    } else {
      dispatchGameAction({
        roomId,
        action: "voteSkip",
        data: {},
        requireGameType: "quizBattle",
      });
    }
  });

  // 사과 제거 이벤트 (사과배틀)
  socket.on("appleBattleRemove", ({ roomId, startRow, startCol, endRow, endCol }) => {
    dispatchGameAction({
      roomId,
      action: "remove",
      data: { startRow, startCol, endRow, endCol },
      requireGameType: "appleBattle",
    });
  });

  socket.on("drawGuessStroke", ({ roomId, stroke }) => {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);

    if (!gameState || !room || gameState.gameType !== "drawGuess") {
      socket.emit("gameError", { message: "게임이 진행 중이 아닙니다." });
      return;
    }

    if (!gameState.isActive) {
      return;
    }

    const instance = gameInstances.get(roomId);
    if (instance && instance.game instanceof DrawGuess) {
      instance.game.handleStroke(socket.id, stroke);
    }
  });

  socket.on("drawGuessClear", ({ roomId }) => {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);

    if (!gameState || !room || gameState.gameType !== "drawGuess") {
      return;
    }

    if (!gameState.isActive) {
      return;
    }

    const instance = gameInstances.get(roomId);
    if (instance && instance.game instanceof DrawGuess) {
      instance.game.handleClear(socket.id);
    }
  });

  socket.on("drawGuessGuess", ({ roomId, guess }) => {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);

    if (!gameState || !room || gameState.gameType !== "drawGuess") {
      return;
    }

    if (!gameState.isActive) {
      return;
    }

    const instance = gameInstances.get(roomId);
    if (instance && instance.game instanceof DrawGuess) {
      instance.game.handleGuess(socket.id, guess);
    }
  });

  socket.on("drawGuessMessage", ({ roomId, message }) => {
    const room = rooms.get(roomId);
    const gameState = gameStates.get(roomId);
    if (!room || !gameState || !gameState.isActive || gameState.gameType !== "drawGuess") {
      return;
    }
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const trimmedMessage = (message || "").trim();
    if (!trimmedMessage) {
      return;
    }
    if (trimmedMessage.length > 100) {
      socket.emit("messageError", { message: "메시지는 100자 이하여야 합니다." });
      return;
    }

    const instance = gameInstances.get(roomId);
    let isCorrect = false;
    if (instance && instance.game instanceof DrawGuess) {
      isCorrect = instance.game.handleGuess(socket.id, trimmedMessage);
    }

    if (isCorrect) {
      return;
    }

    const messageData = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      roomId: roomId,
      playerId: socket.id,
      playerName: player.name,
      playerPhoto: player.photo || null,
      message: trimmedMessage,
      timestamp: Date.now(),
      type: "room",
    };

    io.to(roomId).emit("messageReceived", messageData);
  });

  // 범용 게임 액션 핸들러 (새로운 방식, 하위 호환성 유지)
  socket.on("gameAction", ({ roomId, action, data }) => {
    dispatchGameAction({ roomId, action, data });
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
