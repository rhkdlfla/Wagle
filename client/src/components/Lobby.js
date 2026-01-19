import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./Lobby.css";

// 게임 목록
const ALLOW_SOLO_DRAW_GUESS =
  process.env.REACT_APP_ALLOW_SOLO_DRAW_GUESS === "true" ||
  process.env.NODE_ENV === "development";
const GAMES = [
  {
    id: "clickBattle",
    name: "클릭 대결",
    description: "일정 시간 동안 최대한 많이 클릭하세요!",
    icon: "👆",
    minPlayers: 1,
    defaultDuration: 30,
    minDuration: 5,
    maxDuration: 300,
    durationPresets: [10, 30, 60, 120, 300],
    supportsDuration: true,
    supportsRelayMode: true,
  },
  {
    id: "appleBattle",
    name: "사과배틀",
    description: "합이 10이 되는 사과를 선택해 땅따먹기!",
    icon: "🍎",
    minPlayers: 1,
    defaultDuration: 120,
    minDuration: 30,
    maxDuration: 300,
    durationPresets: [30, 60, 120, 180, 300],
    supportsDuration: true,
    supportsRelayMode: true,
  },
  {
    id: "drawGuess",
    name: "그림 맞히기",
    description: "그림을 보고 제시어를 맞혀보세요!",
    icon: "🎨",
    minPlayers: ALLOW_SOLO_DRAW_GUESS ? 1 : 2,
    defaultDuration: 90,
    minDuration: 30,
    maxDuration: 180,
    durationPresets: [60, 90, 120, 150, 180],
    supportsDuration: true,
    supportsRelayMode: false,
  },
  {
    id: "quizBattle",
    name: "퀴즈 배틀",
    description: "다양한 퀴즈를 풀어보세요!",
    icon: "🧩",
    minPlayers: 1,
    defaultDuration: 600,
    minDuration: 60,
    maxDuration: 1800,
    durationPresets: [300, 600, 900, 1200],
    supportsDuration: true,
    supportsRelayMode: false,
  },
  {
    id: "numberRush",
    name: "넘버 러시",
    description: "숫자를 빠르게 입력하세요!",
    icon: "🔢",
    minPlayers: 1,
    defaultDuration: 60,
    minDuration: 10,
    maxDuration: 300,
    durationPresets: [30, 60, 120, 180, 300],
    supportsDuration: true,
    supportsRelayMode: false,
  },
];

// 게임 설정 가져오기 함수
function getGameConfig(gameId) {
  const game = GAMES.find(g => g.id === gameId);
  if (!game) {
    return {
      supportsDuration: false,
      supportsRelayMode: false,
      defaultDuration: 30,
      minDuration: 5,
      maxDuration: 300,
      durationPresets: [],
    };
  }
  return {
    supportsDuration: game.supportsDuration || false,
    supportsRelayMode: game.supportsRelayMode || false,
    defaultDuration: game.defaultDuration || 30,
    minDuration: game.minDuration || 5,
    maxDuration: game.maxDuration || 300,
    durationPresets: game.durationPresets || [],
  };
}

function Lobby({ socket, room, onLeaveRoom, onStartGame, user }) {
  // localStorage에서 게임 설정 복원
  const loadGameSettings = (roomId) => {
    if (!roomId) return null;
    try {
      const saved = localStorage.getItem(`gameSettings_${roomId}`);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error("게임 설정 로드 실패:", error);
    }
    return null;
  };

  // 게임 설정 저장
  const saveGameSettings = (settings, roomId) => {
    if (!roomId) return;
    try {
      localStorage.setItem(`gameSettings_${roomId}`, JSON.stringify(settings));
    } catch (error) {
      console.error("게임 설정 저장 실패:", error);
    }
  };

  const savedSettings = loadGameSettings(room?.id);
  const [playerName, setPlayerName] = useState("");
  const [currentRoom, setCurrentRoom] = useState(room);
  const [selectedGame, setSelectedGame] = useState(
    currentRoom?.selectedGame || savedSettings?.selectedGame || GAMES[0].id
  );
  const [drawGuessRounds, setDrawGuessRounds] = useState(
    savedSettings?.drawGuessRounds || 1
  );
  const [selectedQuizId, setSelectedQuizId] = useState(
    savedSettings?.selectedQuizId || null
  ); // 선택된 퀴즈 ID
  const [availableQuizzes, setAvailableQuizzes] = useState([]); // 사용 가능한 퀴즈 목록
  // 게임별 duration 관리 (게임 ID -> duration 초 단위)
  const [gameDurations, setGameDurations] = useState(() => {
    if (savedSettings?.gameDurations) {
      return savedSettings.gameDurations;
    }
    const durations = {};
    GAMES.forEach((game) => {
      if (game.supportsDuration) {
        durations[game.id] = game.defaultDuration;
      }
    });
    return durations;
  });
  // 퀴즈 배틀 문제당 시간 제한 (초 단위, null이면 무제한)
  const [quizQuestionTimeLimit, setQuizQuestionTimeLimit] = useState(
    savedSettings?.quizQuestionTimeLimit !== undefined 
      ? savedSettings.quizQuestionTimeLimit 
      : null
  ); // null = 무제한
  // 퀴즈 배틀 시간 비례 점수 모드 (남은 시간에 비례해서 점수 부여)
  const [quizTimeBasedScoring, setQuizTimeBasedScoring] = useState(
    savedSettings?.quizTimeBasedScoring || false
  );
  // 퀴즈 배틀 무한 도전 모드 (틀린 답을 내도 계속 시도 가능)
  const [quizInfiniteRetry, setQuizInfiniteRetry] = useState(
    savedSettings?.quizInfiniteRetry || false
  );
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [chatMode, setChatMode] = useState("room"); // "room" or "team"
  const messagesEndRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isHost = currentRoom?.players[0]?.id === socket.id;
  
  // 현재 플레이어의 팀 ID 가져오기
  const myTeamId = currentRoom?.players?.find((p) => p.id === socket.id)?.teamId || null;

  // 게임 설정 변경 시 자동 저장
  useEffect(() => {
    if (currentRoom?.id) {
      saveGameSettings({
        selectedGame,
        drawGuessRounds,
        selectedQuizId,
        gameDurations,
        quizQuestionTimeLimit,
        quizTimeBasedScoring,
        quizInfiniteRetry,
      }, currentRoom.id);
    }
  }, [selectedGame, drawGuessRounds, selectedQuizId, gameDurations, quizQuestionTimeLimit, quizTimeBasedScoring, quizInfiniteRetry, currentRoom?.id]);

  useEffect(() => {
    // 방 업데이트 수신
    socket.on("roomUpdated", (updatedRoom) => {
      setCurrentRoom(updatedRoom);
      // selectedGame만 서버에서 업데이트 (다른 설정은 localStorage에서 복원)
      if (updatedRoom.selectedGame && updatedRoom.selectedGame !== selectedGame) {
        setSelectedGame(updatedRoom.selectedGame);
      }
    });
    
    // 이어달리기 모드 에러 수신
    socket.on("relayModeError", ({ message }) => {
      alert(message);
    });

    // 게임 시작 수신
    socket.on("gameStarted", ({ room }) => {
      setCurrentRoom(room);
      onStartGame(room);
    });

    // 방 나가기 성공
    socket.on("leftRoom", () => {
      onLeaveRoom();
    });

    // 채팅 메시지 수신
    socket.on("messageReceived", (messageData) => {
      setMessages((prev) => [...prev, messageData]);
    });

    // 메시지 에러 수신
    socket.on("messageError", ({ message }) => {
      console.error("채팅 에러:", message);
    });

    // 팀 설정 에러 수신
    socket.on("setTeamsError", ({ message }) => {
      alert(message);
    });

    // 팀 배치 에러 수신
    socket.on("assignTeamError", ({ message }) => {
      alert(message);
    });

    return () => {
      socket.off("roomUpdated");
      socket.off("gameStarted");
      socket.off("leftRoom");
      socket.off("messageReceived");
      socket.off("messageError");
      socket.off("setTeamsError");
      socket.off("assignTeamError");
      socket.off("relayModeError");
    };
  }, [socket, onLeaveRoom, onStartGame]);

  // 메시지 목록이 업데이트될 때마다 스크롤을 맨 아래로
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);


  const handleUpdateName = () => {
    if (playerName.trim() !== "") {
      socket.emit("updatePlayerName", {
        roomId: currentRoom.id,
        playerName: playerName.trim(),
      });
      setPlayerName("");
    }
  };

  const handleGameSelect = (gameId) => {
    if (isHost) {
      setSelectedGame(gameId);
      socket.emit("selectGame", {
        roomId: currentRoom.id,
        gameId: gameId,
      });
      // 퀴즈 배틀 선택 시 퀴즈 목록 불러오기
      if (gameId === "quizBattle") {
        fetchAvailableQuizzes();
      } else {
        setSelectedQuizId(null);
      }
    }
  };

  // 퀴즈 목록 불러오기
  const fetchAvailableQuizzes = async () => {
    try {
      const response = await fetch("/api/quiz/list?limit=20");
      const data = await response.json();
      if (data.quizzes) {
        setAvailableQuizzes(data.quizzes);
        if (data.quizzes.length > 0 && !selectedQuizId) {
          setSelectedQuizId(data.quizzes[0]._id);
        }
      }
    } catch (error) {
      console.error("퀴즈 목록 불러오기 실패:", error);
    }
  };

  // 퀴즈 페이지에서 돌아왔을 때 목록 새로고침
  useEffect(() => {
    if (selectedGame === "quizBattle" && location.pathname.includes("/room/")) {
      fetchAvailableQuizzes();
      
      // 게임 변경 시 해당 게임의 기본 duration 설정 (없으면)
      const gameConfig = getGameConfig(selectedGame);
      if (gameConfig.supportsDuration && !gameDurations[selectedGame]) {
        setGameDurations((prev) => ({
          ...prev,
          [selectedGame]: gameConfig.defaultDuration,
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, selectedGame]);

  // 퀴즈 편집 시작 - 페이지로 이동
  const handleEditQuiz = (quizId) => {
    navigate(`/quiz/edit/${quizId}`);
  };

  // 내가 만든 퀴즈인지 확인 (로그인된 사용자만, 게스트 제외)
  const isMyQuiz = (quiz) => {
    if (!user || user.provider === "guest" || !quiz.creator || !quiz.creator.userId) {
      return false;
    }
    // user.id 또는 user._id 사용 (서버에서 id로 변환하여 반환)
    const userId = String(user.id || user._id || "");
    const creatorUserId = String(quiz.creator.userId || "");
    const isMine = userId === creatorUserId && userId !== "";
    
    // 디버깅용 로그 (필요시 주석 해제)
    // console.log("퀴즈 소유자 확인:", {
    //   userId,
    //   creatorUserId,
    //   isMine,
    //   quizTitle: quiz.title,
    //   userProvider: user.provider,
    //   userObject: { id: user.id, _id: user._id }
    // });
    
    return isMine;
  };

  const handleStartGame = () => {
    if (isHost && currentRoom.players.length > 0) {
      const selected = GAMES.find((game) => game.id === selectedGame);
      if (selected && currentRoom.players.length < selected.minPlayers) {
        alert(`이 게임은 최소 ${selected.minPlayers}명 이상 필요합니다.`);
        return;
      }
      if (selectedGame === "quizBattle" && !selectedQuizId) {
        alert("퀴즈를 선택해주세요.");
        return;
      }
      
      // 게임 시작 전 현재 설정 저장
      saveGameSettings({
        selectedGame,
        drawGuessRounds,
        selectedQuizId,
        gameDurations,
        quizQuestionTimeLimit,
        quizTimeBasedScoring,
        quizInfiniteRetry,
      }, currentRoom.id);
      
      const gameConfig = getGameConfig(selectedGame);
      // 퀴즈 배틀은 문제를 다 풀면 끝나므로 duration 설정 불필요
      const duration = (selectedGame === "quizBattle" || !gameConfig.supportsDuration)
        ? undefined
        : (gameDurations[selectedGame] || gameConfig.defaultDuration) * 1000;
      const rounds = selectedGame === "drawGuess" ? drawGuessRounds : undefined;
      socket.emit("startGame", {
        roomId: currentRoom.id,
        gameType: selectedGame,
        duration: duration,
        rounds: rounds,
        quizId: selectedGame === "quizBattle" ? selectedQuizId : undefined,
        questionTimeLimit: selectedGame === "quizBattle" ? (quizQuestionTimeLimit === null ? null : quizQuestionTimeLimit * 1000) : undefined,
        timeBasedScoring: selectedGame === "quizBattle" ? quizTimeBasedScoring : undefined,
        infiniteRetry: selectedGame === "quizBattle" ? quizInfiniteRetry : undefined,
      });
    }
  };
  
  const handleRelayModeChange = (enabled) => {
    if (isHost) {
      socket.emit("setRelayMode", {
        roomId: currentRoom.id,
        relayMode: enabled,
      });
    }
  };

  const handleEnableTeamMode = () => {
    if (isHost) {
      // 기본 2팀으로 시작
      socket.emit("setTeams", {
        roomId: currentRoom.id,
        teamCount: 2,
      });
    }
  };

  const handleAddTeam = () => {
    if (isHost) {
      socket.emit("addTeam", {
        roomId: currentRoom.id,
      });
    }
  };

  const handleRemoveTeam = (teamId) => {
    if (isHost) {
      socket.emit("removeTeam", {
        roomId: currentRoom.id,
        teamId: teamId,
      });
    }
  };

  const handleDisableTeamMode = () => {
    if (isHost) {
      socket.emit("disableTeamMode", {
        roomId: currentRoom.id,
      });
    }
  };

  const handleAssignPlayerToTeam = (playerId, teamId) => {
    socket.emit("assignPlayerToTeam", {
      roomId: currentRoom.id,
      playerId: playerId,
      teamId: teamId,
    });
  };

  const getPlayersByTeam = () => {
    if (!currentRoom.teamMode || !currentRoom.teams || currentRoom.teams.length === 0) {
      return null;
    }

    const teamsMap = {};
    currentRoom.teams.forEach((team) => {
      teamsMap[team.id] = {
        team,
        players: [],
      };
    });

    // 팀 없는 플레이어들
    teamsMap[null] = {
      team: { id: null, name: "팀 없음", color: "#666" },
      players: [],
    };

    currentRoom.players.forEach((player) => {
      const teamId = player.teamId || null;
      if (teamsMap[teamId]) {
        teamsMap[teamId].players.push(player);
      }
    });

    return teamsMap;
  };

  // 시간을 초 단위로 포맷팅
  const formatDuration = (seconds) => {
    if (seconds < 60) {
      return `${seconds}초`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 
      ? `${minutes}분 ${remainingSeconds}초` 
      : `${minutes}분`;
  };

  const handleLeaveRoom = () => {
    socket.emit("leaveRoom", { roomId: currentRoom.id });
  };

  const handleCopyInviteLink = async () => {
    const inviteLink = `${window.location.origin}${location.pathname}`;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // 클립보드 API가 지원되지 않는 경우 대체 방법
      const textArea = document.createElement("textarea");
      textArea.value = inviteLink;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        alert("링크 복사에 실패했습니다. 수동으로 복사해주세요: " + inviteLink);
      }
      document.body.removeChild(textArea);
    }
  };

  const handleSendMessage = () => {
    if (messageInput.trim() && currentRoom) {
      if (chatMode === "team" && currentRoom.teamMode && myTeamId) {
        // 팀 채팅 전송
        socket.emit("sendTeamMessage", {
          roomId: currentRoom.id,
          message: messageInput.trim(),
          teamId: myTeamId,
        });
      } else {
        // 전체 채팅 전송
        socket.emit("sendMessage", {
          roomId: currentRoom.id,
          message: messageInput.trim(),
        });
      }
      setMessageInput("");
    }
  };
  
  // 표시할 메시지 필터링 (현재 채팅 모드에 따라)
  const getDisplayedMessages = () => {
    if (!currentRoom?.teamMode || chatMode === "room") {
      // 전체 채팅 모드: 모든 메시지 표시
      return messages;
    } else {
      // 팀 채팅 모드: 팀 채팅만 표시
      return messages.filter((msg) => msg.type === "team" && msg.teamId === myTeamId);
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  if (!currentRoom) {
    return null;
  }

  return (
    <div className="lobby-container">
      <div className="lobby-header">
        <h1>🎯 게임 로비</h1>
        <div className="room-info-header">
          <span className="room-name-badge">{currentRoom.name}</span>
          <span className="room-id">방 ID: {currentRoom.id.substring(0, 15)}...</span>
        </div>
        <button
          onClick={handleCopyInviteLink}
          className="invite-link-button"
          title="초대 링크 복사"
        >
          {copied ? "✓ 복사됨!" : "🔗 초대 링크 복사"}
        </button>
      </div>

      <div className="lobby-content">
        <div className="chat-section">
          <div className="chat-header">
            <h2>💬 채팅</h2>
            {currentRoom?.teamMode && myTeamId && (
              <div className="chat-mode-toggle">
                <button
                  className={`chat-mode-button ${chatMode === "room" ? "active" : ""}`}
                  onClick={() => setChatMode("room")}
                >
                  전체
                </button>
                <button
                  className={`chat-mode-button ${chatMode === "team" ? "active" : ""}`}
                  onClick={() => setChatMode("team")}
                >
                  {currentRoom.teams?.find((t) => t.id === myTeamId)?.name || "팀"}
                </button>
              </div>
            )}
          </div>
          <div className="chat-messages">
            {getDisplayedMessages().length === 0 ? (
              <div className="chat-empty">아직 메시지가 없습니다.</div>
            ) : (
              getDisplayedMessages().map((msg) => {
                const isMyMessage = msg.playerId === socket.id;
                const isTeamMessage = msg.type === "team";
                return (
                  <div
                    key={msg.id}
                    className={`chat-message ${isMyMessage ? "my-message" : ""} ${
                      isTeamMessage ? "team-message" : ""
                    }`}
                  >
                    {!isMyMessage && (
                      <div className="message-sender">
                        {msg.playerPhoto ? (
                          <img
                            src={msg.playerPhoto}
                            alt={msg.playerName}
                            className="message-avatar"
                          />
                        ) : (
                          <div className="message-avatar-placeholder">
                            {msg.playerName.charAt(0)}
                          </div>
                        )}
                        <span className="message-player-name">
                          {msg.playerName}
                          {isTeamMessage && msg.teamName && (
                            <span className="team-badge" style={{ color: msg.teamColor }}>
                              [{msg.teamName}]
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    <div className="message-content">
                      <p>{msg.message}</p>
                      <span className="message-time">{formatTime(msg.timestamp)}</span>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="chat-input-group">
            <input
              type="text"
              placeholder="메시지를 입력하세요..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              maxLength={500}
            />
            <button onClick={handleSendMessage} disabled={!messageInput.trim()}>
              전송
            </button>
          </div>
        </div>

        <div className="players-section">
          <h2>플레이어 목록 ({currentRoom.players.length}/{currentRoom.maxPlayers})</h2>
          
          {/* 팀 설정 UI (방장만) */}
          {isHost && (
            <div className="team-settings">
              {!currentRoom.teamMode ? (
                <div className="team-mode-toggle">
                  <h3>팀전 모드</h3>
                  <button
                    onClick={handleEnableTeamMode}
                    className="enable-team-mode-button"
                  >
                    팀전 모드 활성화
                  </button>
                </div>
              ) : (
                <div className="team-mode-active">
                  <div className="team-mode-header">
                    <h3>팀전 모드 활성화됨 ({currentRoom.teams?.length || 0}팀)</h3>
                    <div className="team-control-buttons">
                      <button
                        onClick={handleAddTeam}
                        className="add-team-button"
                        disabled={currentRoom.teams && currentRoom.teams.length >= 8}
                        title="팀 추가 (최대 8개)"
                      >
                        + 팀 추가
                      </button>
                      {currentRoom.teams && currentRoom.teams.length > 2 && (
                        <button
                          onClick={() => {
                            // 마지막 팀 삭제
                            const lastTeam = currentRoom.teams[currentRoom.teams.length - 1];
                            handleRemoveTeam(lastTeam.id);
                          }}
                          className="remove-team-button"
                          title="팀 삭제 (최소 2개 유지)"
                        >
                          - 팀 삭제
                        </button>
                      )}
                      <button
                        onClick={handleDisableTeamMode}
                        className="disable-team-mode-button"
                      >
                        팀전 모드 해제
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 팀별 플레이어 목록 또는 일반 플레이어 목록 */}
          {currentRoom.teamMode && currentRoom.teams && currentRoom.teams.length > 0 ? (
            <div className="teams-list">
              {Object.values(getPlayersByTeam()).map(({ team, players }) => (
                <div key={team.id || "no-team"} className="team-group">
                  <div
                    className="team-header"
                    style={{ borderLeftColor: team.color }}
                  >
                    <div
                      className="team-color-indicator"
                      style={{ backgroundColor: team.color }}
                    />
                    <span className="team-name">{team.name}</span>
                    <span className="team-count">({players.length}명)</span>
                  </div>
                  <div className="team-players">
                    {players.map((player, index) => {
                      const isPlayerHost = currentRoom.players[0].id === player.id;
                      const canChangeTeam = isHost || player.id === socket.id;
                      return (
                        <div
                          key={player.id}
                          className={`player-item ${player.id === socket.id ? "me" : ""} ${
                            isPlayerHost ? "host" : ""
                          }`}
                        >
                          <div className="player-info">
                            {player.photo ? (
                              <img
                                src={player.photo}
                                alt={player.name}
                                className="player-avatar"
                              />
                            ) : (
                              <span className="player-number">{index + 1}</span>
                            )}
                            <span className="player-name">
                              {player.name}
                              {isPlayerHost && (
                                <span className="host-badge">👑 방장</span>
                              )}
                              {player.id === socket.id && (
                                <span className="me-badge">나</span>
                              )}
                            </span>
                          </div>
                          {canChangeTeam && (
                            <div className="team-select">
                              <select
                                value={player.teamId || ""}
                                onChange={(e) =>
                                  handleAssignPlayerToTeam(
                                    player.id,
                                    e.target.value === "" ? null : Number(e.target.value)
                                  )
                                }
                              >
                                <option value="">팀 없음</option>
                                {currentRoom.teams.map((team) => (
                                  <option key={team.id} value={team.id}>
                                    {team.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="players-list">
              {currentRoom.players.map((player, index) => (
                <div
                  key={player.id}
                  className={`player-item ${player.id === socket.id ? "me" : ""} ${
                    index === 0 ? "host" : ""
                  }`}
                >
                  <div className="player-info">
                    {player.photo ? (
                      <img
                        src={player.photo}
                        alt={player.name}
                        className="player-avatar"
                      />
                    ) : (
                      <span className="player-number">{index + 1}</span>
                    )}
                    <span className="player-name">
                      {player.name}
                      {index === 0 && <span className="host-badge">👑 방장</span>}
                      {player.id === socket.id && (
                        <span className="me-badge">나</span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
              {Array.from({
                length: currentRoom.maxPlayers - currentRoom.players.length,
              }).map((_, index) => (
                <div key={`empty-${index}`} className="player-item empty">
                  <div className="player-info">
                    <span className="player-number">
                      {currentRoom.players.length + index + 1}
                    </span>
                    <span className="player-name empty-name">대기 중...</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="name-input-section">
            <h3>내 이름 변경</h3>
            <div className="name-input-group">
              <input
                type="text"
                placeholder="이름을 입력하세요"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleUpdateName()}
                maxLength={15}
              />
              <button onClick={handleUpdateName}>변경</button>
            </div>
          </div>
        </div>

        <div className="game-selection-section">
          <h2>게임 선택</h2>
          <div className="games-list">
            {GAMES.map((game) => (
              <div
                key={game.id}
                className={`game-item ${
                  selectedGame === game.id ? "selected" : ""
                } ${!isHost ? "disabled" : ""}`}
                onClick={() => isHost && handleGameSelect(game.id)}
              >
                <div className="game-icon">{game.icon}</div>
                <div className="game-info">
                  <div className="game-name">{game.name}</div>
                  <div className="game-description">{game.description}</div>
                </div>
                {selectedGame === game.id && (
                  <div className="selected-badge">✓</div>
                )}
              </div>
            ))}
          </div>
          
          {/* 퀴즈 배틀 퀴즈 선택 UI */}
          {selectedGame === "quizBattle" && isHost && (
            <div className="quiz-selection-section">
              <div className="quiz-selection-header">
                <h3>🧩 퀴즈 선택</h3>
                <button
                  onClick={() => {
                    if (!user || user.provider === "guest") {
                      alert("퀴즈 생성을 위해서는 로그인이 필요합니다.");
                      return;
                    }
                    navigate("/quiz/create");
                  }}
                  className="create-quiz-button"
                >
                  + 새 퀴즈 만들기
                </button>
              </div>
              {availableQuizzes.length === 0 ? (
                <div className="quiz-loading">
                  <p>퀴즈 목록을 불러오는 중...</p>
                  <button onClick={fetchAvailableQuizzes} className="refresh-quiz-button">
                    새로고침
                  </button>
                </div>
              ) : (
                <div className="quiz-list">
                  {availableQuizzes.map((quiz) => {
                    const isMyOwnQuiz = isMyQuiz(quiz);
                    return (
                      <div
                        key={quiz._id}
                        className={`quiz-item ${
                          selectedQuizId === quiz._id ? "selected" : ""
                        } ${isMyOwnQuiz ? "my-quiz" : ""}`}
                      >
                        <div 
                          className="quiz-item-content"
                          onClick={() => setSelectedQuizId(quiz._id)}
                        >
                          <div className="quiz-icon">🧩</div>
                          <div className="quiz-info">
                            <div className="quiz-name">
                              {quiz.title}
                              {isMyOwnQuiz && <span className="my-quiz-badge">내가 만든 퀴즈</span>}
                            </div>
                            <div className="quiz-meta">
                              <span className="quiz-questions-count">
                                {quiz.questions?.length || 0}문제
                              </span>
                            </div>
                            {quiz.description && (
                              <div className="quiz-description">{quiz.description}</div>
                            )}
                          </div>
                          {selectedQuizId === quiz._id && (
                            <div className="selected-badge">✓</div>
                          )}
                        </div>
                        {isMyOwnQuiz && (
                          <button
                            className="edit-quiz-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditQuiz(quiz._id);
                            }}
                            title="퀴즈 편집"
                          >
                            ✏️ 편집
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 그림 맞히기 라운드 설정 UI */}
          {selectedGame === "drawGuess" && isHost && (
            <div className="game-duration-section">
              <h3>🎨 라운드 설정</h3>
              <div className="duration-controls">
                <label htmlFor="rounds-slider">
                  라운드(모두 한 번씩): <strong>{drawGuessRounds}회</strong>
                </label>
                <input
                  id="rounds-slider"
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={drawGuessRounds}
                  onChange={(e) => setDrawGuessRounds(parseInt(e.target.value))}
                  className="duration-slider"
                />
              </div>
            </div>
          )}

          {/* 퀴즈 배틀 문제당 시간 제한 설정 UI */}
          {selectedGame === "quizBattle" && isHost && (
            <div className="game-duration-section">
              <h3>⏱️ 문제당 시간 제한</h3>
              <div className="duration-controls">
                <label style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <input
                    type="checkbox"
                    checked={quizQuestionTimeLimit === null}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setQuizQuestionTimeLimit(null);
                      } else {
                        setQuizQuestionTimeLimit(30); // 기본값 30초
                      }
                    }}
                    style={{ marginRight: "5px" }}
                  />
                  <span>무제한 시간</span>
                </label>
                {quizQuestionTimeLimit !== null && (
                  <>
                    <label htmlFor="question-time-slider">
                      시간: <strong>{quizQuestionTimeLimit}초</strong>
                    </label>
                    <input
                      id="question-time-slider"
                      type="range"
                      min="5"
                      max="120"
                      step="5"
                      value={quizQuestionTimeLimit}
                      onChange={(e) => setQuizQuestionTimeLimit(parseInt(e.target.value))}
                      className="duration-slider"
                    />
                    <div className="duration-presets">
                      {[10, 15, 20, 30, 45, 60, 90, 120].map((preset) => (
                        <button
                          key={preset}
                          onClick={() => setQuizQuestionTimeLimit(preset)}
                          className={quizQuestionTimeLimit === preset ? "active" : ""}
                        >
                          {preset}초
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "15px" }}>
                  <input
                    type="checkbox"
                    checked={quizTimeBasedScoring}
                    onChange={(e) => setQuizTimeBasedScoring(e.target.checked)}
                    style={{ marginRight: "5px" }}
                  />
                  <span>시간 비례 점수 (빠르게 답할수록 높은 점수)</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px" }}>
                  <input
                    type="checkbox"
                    checked={quizInfiniteRetry}
                    onChange={(e) => setQuizInfiniteRetry(e.target.checked)}
                    style={{ marginRight: "5px" }}
                  />
                  <span>무한 도전 모드 (틀려도 정답을 맞출 때까지 계속 시도 가능)</span>
                </label>
              </div>
            </div>
          )}

          {/* 게임 시간 설정 UI (범용) - 퀴즈 배틀 제외 */}
          {(() => {
            const gameConfig = getGameConfig(selectedGame);
            // 퀴즈 배틀은 문제당 시간 제한만 사용하므로 전체 게임 시간 설정 제외
            if (!gameConfig.supportsDuration || !isHost || selectedGame === "quizBattle") return null;
            
            const currentDuration = gameDurations[selectedGame] || gameConfig.defaultDuration;
            const step = gameConfig.minDuration < 30 ? 5 : 10;
            
            return (
              <div className="game-duration-section">
                <h3>⏱️ 게임 시간 설정</h3>
                <div className="duration-controls">
                  <label htmlFor={`duration-slider-${selectedGame}`}>
                    시간: <strong>{formatDuration(currentDuration)}</strong>
                  </label>
                  <input
                    id={`duration-slider-${selectedGame}`}
                    type="range"
                    min={gameConfig.minDuration}
                    max={gameConfig.maxDuration}
                    step={step}
                    value={currentDuration}
                    onChange={(e) =>
                      setGameDurations((prev) => ({
                        ...prev,
                        [selectedGame]: parseInt(e.target.value),
                      }))
                    }
                    className="duration-slider"
                  />
                  <div className="duration-presets">
                    {gameConfig.durationPresets.map((preset) => (
                      <button
                        key={preset}
                        onClick={() =>
                          setGameDurations((prev) => ({
                            ...prev,
                            [selectedGame]: preset,
                          }))
                        }
                        className={currentDuration === preset ? "active" : ""}
                      >
                        {formatDuration(preset)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
          
          {/* 게임 설정 정보 표시 (모든 플레이어가 볼 수 있음) */}
          {(() => {
            const gameConfig = getGameConfig(selectedGame);
            return gameConfig.supportsRelayMode && currentRoom.teamMode;
          })() && (
            <div className="game-setting-info">
              <h3>⚙️ 게임 모드 설정</h3>
              {isHost ? (
                <div className="game-setting-item">
                  <label className="game-setting-label">
                    <input
                      type="checkbox"
                      checked={currentRoom.relayMode || false}
                      onChange={(e) => handleRelayModeChange(e.target.checked)}
                      style={{ marginRight: "8px" }}
                    />
                    <span className={currentRoom.relayMode ? "mode-active" : ""}>
                      이어달리기 모드 {currentRoom.relayMode && "✓"}
                    </span>
                    <span className="setting-description">
                      (각 팀당 한 명씩만 클릭 가능, 우클릭으로 다음 팀원에게 순서 넘기기)
                    </span>
                  </label>
                </div>
              ) : (
                <div className="game-setting-display">
                  <div className="setting-status">
                    <span className={`mode-badge ${currentRoom.relayMode ? "mode-active" : "mode-inactive"}`}>
                      {currentRoom.relayMode ? "🔄 이어달리기 모드 활성화" : "⚡ 일반 모드"}
                    </span>
                  </div>
                  {currentRoom.relayMode && (
                    <div className="setting-description">
                      각 팀당 한 명씩만 클릭 가능하며, 우클릭으로 다음 팀원에게 순서를 넘길 수 있습니다.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lobby-actions">
          {isHost && (
            <button
              onClick={handleStartGame}
              disabled={currentRoom.players.length < 1}
              className="start-game-button"
            >
              🎮 게임 시작
            </button>
          )}
          {!isHost && (
            <div className="waiting-message">
              <p>방장이 게임을 시작할 때까지 기다려주세요...</p>
            </div>
          )}
          <button onClick={handleLeaveRoom} className="leave-button">
            방 나가기
          </button>
        </div>
      </div>
    </div>
  );
}

export default Lobby;
