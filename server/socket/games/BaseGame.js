// 기본 게임 클래스 (인터페이스/추상 클래스 역할)
// 모든 게임이 상속받거나 참고할 수 있는 기본 구조

class BaseGame {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
  }

  // 게임 초기화 (필수 구현)
  initialize() {
    throw new Error("initialize() 메서드를 구현해야 합니다.");
  }

  // 주기적 업데이트 루프 (필수 구현)
  startUpdateLoop(endGameCallback) {
    throw new Error("startUpdateLoop() 메서드를 구현해야 합니다.");
  }

  // 게임 결과 계산 (필수 구현)
  calculateResults() {
    throw new Error("calculateResults() 메서드를 구현해야 합니다.");
  }

  // 게임 상태 반환 (재연결 시 사용, 필수 구현)
  getGameStateData() {
    throw new Error("getGameStateData() 메서드를 구현해야 합니다.");
  }

  // 범용 액션 핸들러 (선택적 구현)
  // 게임별 특정 메서드 대신 이 메서드를 사용할 수 있음
  handleAction(socketId, action, data) {
    // 기본 구현: 게임별 메서드로 라우팅
    const actionMap = {
      click: () => this.handleClick?.(socketId),
      remove: () => this.handleRemove?.(socketId, data.startRow, data.startCol, data.endRow, data.endCol),
      // 게임별 액션 추가 가능
    };

    const handler = actionMap[action];
    if (handler) {
      return handler();
    }
    return false;
  }

  // 업데이트 이벤트 이름 반환 (선택적)
  // getGameState에서 사용할 이벤트 이름
  getUpdateEventName() {
    // 기본값: 게임 타입 + "Update"
    return `${this.gameState.gameType}Update`;
  }

  // 이어달리기 모드: 순서 넘기기 (선택적 구현)
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
      return false;
    }

    const teamPlayers = this.room.players
      .filter((p) => p.teamId === player.teamId)
      .sort((a, b) => a.id.localeCompare(b.id));

    const currentIndex = teamPlayers.findIndex((p) => p.id === socketId);
    if (currentIndex === -1) {
      return false;
    }

    const nextIndex = (currentIndex + 1) % teamPlayers.length;
    this.gameState.teamActivePlayers[player.teamId] = teamPlayers[nextIndex].id;

    // 업데이트 전송 (게임별로 오버라이드 가능)
    this.sendUpdate();
    return true;
  }

  // 공통: 이어달리기 모드 체크 헬퍼
  canPlayerAct(socketId) {
    if (!this.gameState.relayMode || !this.room.teamMode) {
      return true;
    }

    const player = this.room.players.find((p) => p.id === socketId);
    if (!player || !player.teamId) {
      return false;
    }

    const activePlayerId = this.gameState.teamActivePlayers?.[player.teamId];
    return activePlayerId === socketId;
  }

  // 공통: 팀 점수 계산 헬퍼
  calculateTeamScores() {
    if (!this.room.teamMode || !this.room.teams) {
      return null;
    }

    const teamScores = {};
    this.room.teams.forEach((team) => {
      teamScores[team.id] = 0;
    });

    // 게임별 점수 데이터에서 팀 점수 계산
    // 각 게임 클래스에서 오버라이드 필요
    return teamScores;
  }

  // 공통: 게임 업데이트 전송 헬퍼
  sendUpdate() {
    const gameStateData = this.getGameStateData();
    const eventName = this.getUpdateEventName();
    this.io.to(this.room.id).emit(eventName, gameStateData);
  }

  // 공통: 시간 남은 시간 계산
  getTimeRemaining() {
    const elapsed = Date.now() - this.gameState.startTime;
    return Math.max(0, this.gameState.duration - elapsed);
  }
}

module.exports = BaseGame;
