import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import GameScoreboard from "./GameScoreboard";
import GameResults from "./GameResults";
import { handleLeaveGame as leaveGame, handleEndGame as endGame } from "../utils/gameUtils";
import "./QuizBattle.css";

function QuizBattle({ socket, room, onBackToLobby }) {
  const navigate = useNavigate();
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [essayAnswer, setEssayAnswer] = useState(""); // 주관식 답변
  const [questionTimeRemaining, setQuestionTimeRemaining] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [scores, setScores] = useState({});
  const [teamScores, setTeamScores] = useState(null);
  const [questionResult, setQuestionResult] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [results, setResults] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [correctPlayers, setCorrectPlayers] = useState([]); // 정답을 맞춘 플레이어 목록
  const [skipVotes, setSkipVotes] = useState({ voteCount: 0, totalPlayers: 0, unansweredCount: 0, majority: 0, hasVoted: false }); // 스킵 투표 상태
  const timerIntervalRef = useRef(null);
  const questionStartTimeRef = useRef(null);
  const isHost = room?.players[0]?.id === socket.id;

  useEffect(() => {
    // 게임 시작 수신
    const handleGameStarted = ({ gameState, room: gameRoom }) => {
      console.log("QuizBattle: 게임 시작 이벤트 수신", { gameState, gameRoom });
      if (!gameState) {
        console.error("gameState가 없습니다!");
        return;
      }

      setIsActive(true);
      // 퀴즈 배틀은 문제를 다 풀면 끝나므로 전체 게임 시간 표시 불필요
      setTimeRemaining(null);
      setQuiz(gameState.quiz);
      setCurrentQuestionIndex(0);
      setScores({});
      setTeamScores(null);
      setResults(null);
      setQuestionResult(null);
      setSelectedAnswer(null);
      setCurrentQuestion(null);

      // 기존 타이머가 있으면 정리
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      // 퀴즈 배틀은 전체 게임 시간 타이머를 사용하지 않음 (문제를 다 풀면 끝남)
    };

    socket.on("gameStarted", handleGameStarted);

    // 새 문제 수신
    socket.on("newQuestion", (questionData) => {
      console.log("새 문제 수신:", questionData);
      setCurrentQuestion(questionData);
      setSelectedAnswer(null);
      setEssayAnswer(""); // 주관식 답변 초기화
      setQuestionTimeRemaining(null); // 시간 제한 없음
      setQuestionResult(null);
      setCorrectPlayers([]); // 정답을 맞춘 플레이어 목록 초기화
      setSkipVotes({ voteCount: 0, totalPlayers: room.players.length, unansweredCount: room.players.length, majority: Math.ceil(room.players.length / 2), hasVoted: false }); // 스킵 투표 초기화
      questionStartTimeRef.current = Date.now();
      setCurrentQuestionIndex(questionData.questionNumber - 1);
    });

    // 정답 제출 확인
    socket.on("answerSubmitted", ({ isCorrect, points, currentScore, canRetry }) => {
      console.log("정답 제출 확인:", { isCorrect, points, currentScore, canRetry });
      
      // 무한 도전 모드: 틀린 답을 낸 경우 다시 시도 가능하도록 UI 리셋
      if (canRetry && !isCorrect) {
        setSelectedAnswer(null);
        setEssayAnswer("");
        // 틀렸다는 피드백은 잠시 표시 후 다시 시도 가능
      }
      // UI 피드백은 questionResult에서 처리
    });

    // 플레이어 정답 맞춤 실시간 알림
    socket.on("playerCorrectAnswer", ({ playerId, playerName, playerPhoto, points, currentScore }) => {
      console.log("플레이어 정답 맞춤:", { playerId, playerName, points });
      // 정답을 맞춘 플레이어 목록에 추가 (중복 방지)
      setCorrectPlayers((prev) => {
        if (prev.some((p) => p.playerId === playerId)) {
          return prev; // 이미 있으면 추가하지 않음
        }
        return [...prev, { playerId, playerName, playerPhoto, points, currentScore }];
      });
    });

    // 스킵 투표 업데이트
    socket.on("skipVoteUpdate", ({ voteCount, totalPlayers, unansweredCount, majority, voters }) => {
      console.log("스킵 투표 업데이트:", { voteCount, totalPlayers, unansweredCount, majority });
      setSkipVotes({
        voteCount,
        totalPlayers,
        unansweredCount: unansweredCount || totalPlayers,
        majority,
        hasVoted: voters.includes(socket.id),
      });
    });

    // 문제 결과 수신
    socket.on("questionResult", (resultData) => {
      console.log("문제 결과 수신:", resultData);
      setQuestionResult(resultData);
      setScores(resultData.scores);
      setTeamScores(resultData.teamScores || null);
    });

    // 퀴즈 업데이트
    socket.on("quizUpdate", ({ questionTimeRemaining: qTime, timeRemaining: tTime, scores: scoreUpdates, teamScores: teamScoreUpdates }) => {
      if (qTime !== undefined) {
        setQuestionTimeRemaining(qTime);
      }
      // 퀴즈 배틀은 전체 게임 시간이 의미 없으므로 null이면 무시
      if (tTime !== undefined && tTime !== null) {
        setTimeRemaining(tTime);
      } else if (tTime === null) {
        setTimeRemaining(null);
      }
      if (scoreUpdates) {
        setScores(scoreUpdates);
      }
      if (teamScoreUpdates) {
        setTeamScores(teamScoreUpdates);
      }
    });

    // 게임 종료 수신
    socket.on("gameEnded", ({ results: gameResults, winners, teamScores: gameTeamScores }) => {
      console.log("QuizBattle: 게임 종료 이벤트 수신", { results: gameResults, winners, teamScores: gameTeamScores });
      setIsActive(false);
      setResults({
        results: gameResults,
        winners: winners,
        teamScores: gameTeamScores || null,
      });
      setCurrentQuestion(null);
      setQuestionResult(null);
      // 타이머 정리
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    });

    return () => {
      socket.off("gameStarted");
      socket.off("newQuestion");
      socket.off("answerSubmitted");
      socket.off("playerCorrectAnswer");
      socket.off("skipVoteUpdate");
      socket.off("questionResult");
      socket.off("quizUpdate");
      socket.off("gameEnded");
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [socket]);

  // 컴포넌트 마운트 시 게임 상태 확인
  useEffect(() => {
    if (room && room.id) {
      socket.emit("getGameState", { roomId: room.id });
    }
  }, [socket, room]);

  // 정답 제출 (객관식)
  const handleSubmitAnswer = (answerIndex) => {
    if (selectedAnswer !== null || !currentQuestion) return; // 이미 답했거나 문제가 없으면 무시

    const timeSpent = questionStartTimeRef.current
      ? Date.now() - questionStartTimeRef.current
      : 0;

    socket.emit("submitAnswer", {
      roomId: room.id,
      answer: answerIndex,
      timeSpent,
    });

    setSelectedAnswer(answerIndex);
  };

  // 주관식 답변 제출
  const handleSubmitEssayAnswer = () => {
    if (selectedAnswer !== null || !currentQuestion || !essayAnswer.trim()) return;

    const timeSpent = questionStartTimeRef.current
      ? Date.now() - questionStartTimeRef.current
      : 0;

    socket.emit("submitAnswer", {
      roomId: room.id,
      answer: essayAnswer.trim(),
      timeSpent,
    });

    setSelectedAnswer(essayAnswer.trim()); // 제출 완료 표시용
  };

  // 문제 스킵 투표
  const handleVoteSkip = () => {
    if (skipVotes.hasVoted) return; // 이미 투표한 경우 무시
    socket.emit("voteSkipQuestion", { roomId: room.id });
  };

  const formatTime = (ms) => {
    if (ms === null || ms === undefined) {
      return ""; // 퀴즈 배틀은 전체 게임 시간 표시 안 함
    }
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  // 문제당 남은 시간 포맷팅 (초 단위)
  const formatQuestionTime = (ms) => {
    if (ms === null || ms === undefined) {
      return null;
    }
    const seconds = Math.ceil(ms / 1000); // 올림 처리로 0초가 되기 전까지 표시
    if (seconds < 60) {
      return `${seconds}초`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}분 ${remainingSeconds}초` : `${minutes}분`;
  };

  const handleLeaveGame = () => leaveGame(socket, room, navigate);

  const handleEndGame = () => endGame(socket, room, { 
    isHost, 
    message: "정말로 게임을 종료하시겠습니까? 모든 플레이어의 게임이 종료됩니다." 
  });

  const getPlayerScore = (playerId) => {
    return scores[playerId] || 0;
  };

  if (!isActive && !results) {
    return (
      <div className="quiz-battle-container">
        <div className="game-header">
          <h1>🧩 퀴즈 배틀</h1>
          <p>게임 시작을 기다리는 중...</p>
        </div>
      </div>
    );
  }

  if (results) {
    return (
      <div className="quiz-battle-container">
        <div className="game-header">
          <h1>🧩 퀴즈 배틀</h1>
          <p>게임 종료!</p>
        </div>
        <GameResults
          teams={room.teamMode ? room.teams : []}
          teamScores={results.teamScores}
          results={results.results || []}
          myPlayerId={socket.id}
          teamMode={room.teamMode}
          scoreUnit="점"
        />
        <div className="game-actions">
          <button onClick={onBackToLobby} className="back-to-lobby-button">
            로비로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="quiz-battle-container">
      <div className="game-header">
        <div className="game-header-content">
          <h1>🧩 퀴즈 배틀</h1>
          {quiz && <h2>{quiz.title}</h2>}
          {timeRemaining !== null && (
            <div className="timer">⏱️ {formatTime(timeRemaining)}</div>
          )}
        </div>
        <div className="game-header-actions">
          {isHost && isActive && (
            <button onClick={handleEndGame} className="end-game-button">
              게임 종료
            </button>
          )}
          {isActive && (
            <button onClick={handleLeaveGame} className="leave-game-button" title="게임 나가기">
              🚪 나가기
            </button>
          )}
        </div>
      </div>

      {isActive && (
        <div className="quiz-game-screen">
          {questionResult ? (
            // 결과 표시 중
            <div className="question-result">
              <h2>정답 공개!</h2>
              {quiz && (quiz.questions[currentQuestionIndex]?.correctAnswerImageUrl || quiz.questions[currentQuestionIndex]?.imageUrl) && (
                <div className="question-image-result">
                  <img 
                    src={quiz.questions[currentQuestionIndex].correctAnswerImageUrl || quiz.questions[currentQuestionIndex].imageUrl} 
                    alt="정답 이미지" 
                    className="result-question-image"
                  />
                </div>
              )}
              <div className="correct-answer-display">
                <p className="correct-answer-text">
                  정답: <strong>{questionResult.correctAnswerText}</strong>
                </p>
              </div>
              <div className="player-answers">
                {room.players.map((player) => {
                  const answer = questionResult.answers[player.id];
                  if (!answer) return null;
                  const question = quiz.questions[currentQuestionIndex];
                  return (
                    <div
                      key={player.id}
                      className={`player-answer ${answer.isCorrect ? "correct" : "incorrect"} ${player.id === socket.id ? "my-answer" : ""}`}
                    >
                      <span className="player-name">{player.name}</span>
                      <span className="player-answer-text">
                        {answer.answerText !== undefined && answer.answerText !== null
                          ? answer.answerText
                          : answer.answer !== null
                          ? (question.questionType === "주관식" 
                              ? String(answer.answer)
                              : (question.options && question.options[answer.answer] 
                                  ? question.options[answer.answer] 
                                  : `선택지 ${answer.answer + 1}`))
                          : "답하지 않음"}
                      </span>
                      {answer.isCorrect && (
                        <span className="correct-badge">✓</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="next-question-message">다음 문제로 이동합니다...</p>
            </div>
          ) : currentQuestion ? (
            // 문제 표시
            <div className="question-area">
              <div className="question-header">
                <div className="question-number">
                  문제 {currentQuestion.questionNumber} / {currentQuestion.totalQuestions}
                </div>
                {questionTimeRemaining !== null && questionTimeRemaining !== undefined && (
                  <div className="question-timer">
                    ⏱️ {formatQuestionTime(questionTimeRemaining)}
                  </div>
                )}
              </div>

              {/* 스킵 투표 버튼 */}
              <div className="skip-vote-section">
                <button
                  onClick={handleVoteSkip}
                  disabled={skipVotes.hasVoted || questionResult !== null || selectedAnswer !== null}
                  className={`skip-vote-button ${skipVotes.hasVoted ? "voted" : ""} ${selectedAnswer !== null ? "disabled" : ""}`}
                  title={selectedAnswer !== null ? "이미 답을 제출했습니다. 못 푼 사람만 스킵 투표할 수 있습니다." : ""}
                >
                  {skipVotes.hasVoted ? "✓ 투표 완료" : selectedAnswer !== null ? "❌ 답 제출 완료 (스킵 불가)" : "⏭️ 문제 스킵 투표"}
                </button>
                {skipVotes.voteCount > 0 && (
                  <div className="skip-vote-info">
                    투표: {skipVotes.voteCount} / {skipVotes.majority} (못 푼 사람 {skipVotes.unansweredCount}명 중 과반수 필요)
                  </div>
                )}
              </div>

              {/* 정답을 맞춘 플레이어 실시간 표시 */}
              {correctPlayers.length > 0 && (
                <div className="correct-players-list">
                  <div className="correct-players-title">✅ 정답을 맞춘 플레이어</div>
                  <div className="correct-players-items">
                    {correctPlayers.map((player) => (
                      <div key={player.playerId} className="correct-player-item">
                        {player.playerPhoto && (
                          <img
                            src={player.playerPhoto}
                            alt={player.playerName}
                            className="correct-player-avatar"
                          />
                        )}
                        <span className="correct-player-name">{player.playerName}</span>
                        <span className="correct-player-points">+{player.points}점</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentQuestion.imageUrl && (
                <div className="question-image">
                  <img src={currentQuestion.imageUrl} alt="문제 이미지" />
                </div>
              )}

              {currentQuestion.audioUrl && (
                <div className="question-audio">
                  <audio src={currentQuestion.audioUrl} controls autoPlay />
                </div>
              )}

              {currentQuestion.questionType === "주관식" ? (
                <div className="essay-answer-section">
                  <div className="essay-input-group">
                    <label htmlFor="essay-answer-input" className="essay-label">
                      답변을 입력하세요:
                    </label>
                    <input
                      id="essay-answer-input"
                      type="text"
                      value={essayAnswer}
                      onChange={(e) => setEssayAnswer(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === "Enter" && essayAnswer.trim() && selectedAnswer === null) {
                          handleSubmitEssayAnswer();
                        }
                      }}
                      placeholder="정답을 입력하세요"
                      className="essay-input"
                      disabled={selectedAnswer !== null}
                      autoFocus
                    />
                    <button
                      onClick={() => handleSubmitEssayAnswer()}
                      disabled={!essayAnswer.trim() || selectedAnswer !== null}
                      className="submit-essay-button"
                    >
                      제출
                    </button>
                  </div>
                  {selectedAnswer !== null && (
                    <div className="answer-submitted-message">
                      <p>답변을 제출했습니다!</p>
                      <p>다른 플레이어들이 답변할 때까지 기다려주세요.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="answer-options">
                  {currentQuestion.options && currentQuestion.options.map((option, index) => {
                    let optionClass = "answer-option";
                    if (selectedAnswer === index) {
                      optionClass += " selected";
                    }
                    if (selectedAnswer !== null) {
                      optionClass += " disabled";
                    }

                    return (
                      <button
                        key={index}
                        className={optionClass}
                        onClick={() => handleSubmitAnswer(index)}
                        disabled={selectedAnswer !== null}
                      >
                        <span className="option-number">{index + 1}</span>
                        <span className="option-text">{option}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedAnswer !== null && currentQuestion.questionType !== "주관식" && (
                <div className="answer-submitted-message">
                  <p>답변을 제출했습니다!</p>
                  <p>다른 플레이어들이 답변할 때까지 기다려주세요.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="waiting-question">
              <p>문제를 기다리는 중...</p>
            </div>
          )}

          <GameScoreboard
            teams={room.teamMode ? room.teams : []}
            teamScores={teamScores}
            players={room.players}
            scores={scores}
            myPlayerId={socket.id}
            teamMode={room.teamMode}
            scoreUnit="점"
            getPlayerScore={getPlayerScore}
          />
        </div>
      )}
    </div>
  );
}

export default QuizBattle;
