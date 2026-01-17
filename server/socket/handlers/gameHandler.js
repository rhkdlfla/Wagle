const ClickBattle = require("../games/ClickBattle");
const AppleBattle = require("../games/AppleBattle");
const QuizBattle = require("../games/QuizBattle");

// 게임 인스턴스 저장 (updateInterval 관리를 위해)
const gameInstances = new Map(); // roomId -> { game, updateInterval }

function setupGameHandlers(socket, io, rooms, gameStates, getRoomList) {
  // 게임 시작
  socket.on("startGame", async ({ roomId, gameType = "clickBattle", duration, quizId }) => {
    const room = rooms.get(roomId);
    if (room && room.players.length > 0) {
      // 방장만 게임 시작 가능 (첫 번째 플레이어)
      if (room.players[0].id === socket.id) {
        room.status = "playing";
        room.selectedGame = gameType;
        
        // 게임 시간 설정 (밀리초)
        let gameDuration;
        if (gameType === "appleBattle") {
          // 사과배틀: 기본 2분, 범위 30초 ~ 5분
          const minDuration = 30000; // 30초
          const maxDuration = 300000; // 5분
          gameDuration = duration 
            ? Math.max(minDuration, Math.min(maxDuration, parseInt(duration))) 
            : 120000; // 기본 2분
        } else if (gameType === "quizBattle") {
          // 퀴즈배틀: 퀴즈 문제 수에 따라 자동 계산 (문제당 기본 30초 + 정답 공개 시간)
          gameDuration = duration || 600000; // 기본 10분
        } else {
          // 클릭대결: 기본 30초, 범위 5초 ~ 5분
          const minDuration = 5000; // 5초
          const maxDuration = 300000; // 5분
          gameDuration = duration 
            ? Math.max(minDuration, Math.min(maxDuration, parseInt(duration))) 
            : 30000; // 기본 30초
        }
        
        // 게임 상태 초기화
        const gameState = {
          gameType: gameType,
          startTime: Date.now(),
          duration: gameDuration,
          clicks: {},
          isActive: true,
          relayMode: (gameType === "clickBattle" || gameType === "appleBattle") && room.teamMode && room.relayMode ? true : false, // 팀전 모드이고 room에 relayMode가 활성화되어 있을 때만 이어달리기 모드 활성화
          quizId: gameType === "quizBattle" ? quizId : null, // 퀴즈 ID
        };
        
        // 게임 인스턴스 생성 및 초기화
        let game;
        if (gameType === "clickBattle") {
          game = new ClickBattle(io, gameState, room);
          game.initialize();
        } else if (gameType === "appleBattle") {
          game = new AppleBattle(io, gameState, room);
          game.initialize();
        } else if (gameType === "quizBattle") {
          if (!quizId) {
            socket.emit("gameError", { message: "퀴즈를 선택해주세요." });
            return;
          }
          game = new QuizBattle(io, gameState, room);
          try {
            await game.initialize(); // 비동기 초기화
          } catch (error) {
            socket.emit("gameError", { message: error.message || "퀴즈 로드에 실패했습니다." });
            return;
          }
        } else {
          socket.emit("gameError", { message: "알 수 없는 게임 타입입니다." });
          return;
        }
        
        gameStates.set(roomId, gameState);
        
        // 게임 시작 이벤트 전송
        const gameStateData = game.getGameStateData();
        io.to(roomId).emit("gameStarted", {
          room: room,
          gameState: {
            duration: gameState.duration,
            startTime: gameState.startTime,
            gameType: gameType,
            grid: gameType === "appleBattle" ? gameState.grid : undefined,
            quiz: gameType === "quizBattle" ? gameState.quiz : undefined,
            relayMode: gameState.relayMode,
            teamActivePlayers: gameState.teamActivePlayers,
          },
        });
        
        io.emit("roomList", getRoomList(rooms));
        console.log(`게임 시작: ${roomId}, 게임 타입: ${gameType}, 시작 시간: ${new Date(gameState.startTime).toISOString()}`);
        
        // 업데이트 루프 시작
        const updateInterval = game.startUpdateLoop(() => endGame(roomId));
        
        // 게임 인스턴스 저장
        gameInstances.set(roomId, { game, updateInterval });
        
        // 게임 종료 타이머
        setTimeout(() => {
          const instance = gameInstances.get(roomId);
          if (instance && instance.updateInterval) {
            clearInterval(instance.updateInterval);
          }
          endGame(roomId);
        }, gameState.duration);
      }
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

  // 게임 상태 요청
  socket.on("getGameState", ({ roomId }) => {
    console.log(`게임 상태 요청 받음: ${roomId} from ${socket.id}`);
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);
    
    console.log("게임 상태:", { 
      hasGameState: !!gameState, 
      hasRoom: !!room, 
      isActive: gameState?.isActive,
      roomStatus: room?.status 
    });
    
    if (gameState && room && gameState.isActive) {
      const instance = gameInstances.get(roomId);
      if (instance && instance.game) {
        const gameStateData = instance.game.getGameStateData();
        
        if (gameState.gameType === "clickBattle") {
          socket.emit("gameStarted", {
            room: room,
            gameState: {
              duration: gameStateData.duration,
              startTime: gameStateData.startTime,
              gameType: gameState.gameType,
            },
          });
          
          socket.emit("clickUpdate", {
            updates: gameStateData.clickUpdates,
            teamScores: gameStateData.teamScores || null,
            timeRemaining: gameStateData.timeRemaining,
            teamActivePlayers: gameStateData.teamActivePlayers || null,
          });
        } else if (gameState.gameType === "appleBattle") {
          socket.emit("gameStarted", {
            room: room,
            gameState: {
              duration: gameStateData.duration,
              startTime: gameStateData.startTime,
              gameType: gameState.gameType,
              grid: gameStateData.grid,
            },
          });
          
          socket.emit("appleBattleUpdate", {
            scores: gameStateData.scoreUpdates,
            teamScores: gameStateData.teamScores || null,
            timeRemaining: gameStateData.timeRemaining,
            grid: gameStateData.grid,
            teamActivePlayers: gameStateData.teamActivePlayers || null,
          });
        } else if (gameState.gameType === "quizBattle") {
          socket.emit("gameStarted", {
            room: room,
            gameState: {
              duration: gameStateData.duration,
              startTime: gameStateData.startTime,
              gameType: gameState.gameType,
              quiz: gameStateData.quiz,
              currentQuestionIndex: gameStateData.currentQuestionIndex,
            },
          });
        }
      }
    } else {
      console.log(`게임이 진행 중이 아닙니다. roomId: ${roomId}, roomStatus: ${room?.status}`);
    }
  });

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
    
    if (gameState.gameType !== "clickBattle" && gameState.gameType !== "appleBattle") {
      return;
    }
    
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      return;
    }
    
    const instance = gameInstances.get(roomId);
    if (instance) {
      if (instance.game instanceof ClickBattle && gameState.gameType === "clickBattle") {
        instance.game.passTurn(socket.id);
      } else if (instance.game instanceof AppleBattle && gameState.gameType === "appleBattle") {
        instance.game.passTurn(socket.id);
      }
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

  // 정답 제출 (퀴즈배틀)
  socket.on("submitAnswer", ({ roomId, answer, timeSpent }) => {
    const gameState = gameStates.get(roomId);
    const room = rooms.get(roomId);
    
    if (!gameState || !room || gameState.gameType !== "quizBattle") {
      socket.emit("gameError", { message: "게임이 진행 중이 아닙니다." });
      return;
    }
    
    if (!gameState.isActive) {
      return;
    }
    
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      socket.emit("gameError", { message: "플레이어를 찾을 수 없습니다." });
      return;
    }
    
    const instance = gameInstances.get(roomId);
    if (instance && instance.game instanceof QuizBattle) {
      instance.game.submitAnswer(socket.id, answer, timeSpent);
    }
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
}

module.exports = { setupGameHandlers };
