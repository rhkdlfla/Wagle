const ClickBattle = require("../games/ClickBattle");
const AppleBattle = require("../games/AppleBattle");

// 게임 인스턴스 저장 (updateInterval 관리를 위해)
const gameInstances = new Map(); // roomId -> { game, updateInterval }

function setupGameHandlers(socket, io, rooms, gameStates, getRoomList) {
  // 게임 시작
  socket.on("startGame", ({ roomId, gameType = "clickBattle" }) => {
    const room = rooms.get(roomId);
    if (room && room.players.length > 0) {
      // 방장만 게임 시작 가능 (첫 번째 플레이어)
      if (room.players[0].id === socket.id) {
        room.status = "playing";
        room.selectedGame = gameType;
        
        // 게임 상태 초기화
        const gameState = {
          gameType: gameType,
          startTime: Date.now(),
          duration: gameType === "appleBattle" ? 120000 : 30000, // 사과배틀: 2분, 클릭대결: 30초
          clicks: {},
          isActive: true,
        };
        
        // 게임 인스턴스 생성 및 초기화
        let game;
        if (gameType === "clickBattle") {
          game = new ClickBattle(io, gameState, room);
          game.initialize();
        } else if (gameType === "appleBattle") {
          game = new AppleBattle(io, gameState, room);
          game.initialize();
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
            timeRemaining: gameStateData.timeRemaining,
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
            timeRemaining: gameStateData.timeRemaining,
            grid: gameStateData.grid,
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
