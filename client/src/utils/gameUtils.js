/**
 * 게임 관련 공통 유틸리티 함수
 */

/**
 * 게임에서 나가기 처리
 * @param {Object} socket - Socket.IO 소켓 객체
 * @param {Object} room - 방 객체
 * @param {Function} navigate - React Router의 navigate 함수
 */
export function handleLeaveGame(socket, room, navigate) {
  if (window.confirm("게임을 나가시겠습니까?")) {
    socket.emit("leaveRoom", { roomId: room.id });
    navigate("/");
  }
}

/**
 * 게임 종료 처리
 * @param {Object} socket - Socket.IO 소켓 객체
 * @param {Object} room - 방 객체
 * @param {Object} options - 옵션 객체
 * @param {boolean} options.isHost - 방장 여부 (false일 때는 실행하지 않음)
 * @param {string} options.message - 확인 메시지 (기본값: "게임을 종료하시겠습니까? 모든 플레이어가 로비로 돌아갑니다.")
 * @param {boolean} options.skipConfirm - 확인 메시지 건너뛰기 (기본값: false)
 */
export function handleEndGame(socket, room, options = {}) {
  const {
    isHost,
    message = "게임을 종료하시겠습니까? 모든 플레이어가 로비로 돌아갑니다.",
    skipConfirm = false,
  } = options;

  // isHost가 false이거나 undefined인 경우 실행하지 않음
  if (!isHost) {
    console.log("handleEndGame: 방장이 아니므로 게임 종료 불가");
    return;
  }

  if (!room || !room.id) {
    console.error("handleEndGame: room 또는 room.id가 없습니다", { room });
    return;
  }

  const shouldEnd = skipConfirm || window.confirm(message);
  if (shouldEnd) {
    console.log("handleEndGame: 게임 종료 이벤트 전송", { roomId: room.id });
    socket.emit("endGame", { roomId: room.id });
  }
}
