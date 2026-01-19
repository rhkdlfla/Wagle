const Quiz = require("../../models/Quiz");

class QuizBattle {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
    this.endGameCallback = null; // 게임 종료 콜백 저장
    this.updateInterval = null; // 업데이트 인터벌 저장
    this.questionTimeout = null; // 문제당 시간 제한 타이머
  }

  // 게임 초기화
  async initialize() {
    // 퀴즈 데이터 로드
    if (this.gameState.quizId) {
      try {
        const quiz = await Quiz.findById(this.gameState.quizId);
        if (!quiz) {
          throw new Error("퀴즈를 찾을 수 없습니다.");
        }
        
        // 문제 순서를 랜덤으로 섞기
        const shuffledQuestions = this.shuffleArray([...quiz.questions]);
        
        this.gameState.quiz = {
          id: quiz._id.toString(),
          title: quiz.title,
          questions: shuffledQuestions,
        };
      } catch (error) {
        console.error("퀴즈 로드 오류:", error);
        throw error;
      }
    }

    // 게임 상태 초기화
    this.gameState.currentQuestionIndex = 0;
    this.gameState.answers = {}; // { playerId: { answer, timeSpent, isCorrect } }
    this.gameState.correctAnswers = {}; // 무한 도전 모드: 정답을 맞춘 플레이어 { playerId: true }
    this.gameState.skipVotes = new Set(); // 문제 스킵 투표 { playerId }
    this.gameState.scores = {}; // { playerId: score }
    this.gameState.questionStartTime = Date.now();
    
    // 플레이어 점수 초기화
    this.room.players.forEach((player) => {
      this.gameState.scores[player.id] = 0;
    });

    // 팀전 모드인 경우 팀 점수 초기화
    if (this.room.teamMode && this.room.teams) {
      this.gameState.teamScores = {};
      this.room.teams.forEach((team) => {
        this.gameState.teamScores[team.id] = 0;
      });
    }
  }

  // 주기적 업데이트 시작
  startUpdateLoop(endGameCallback) {
    // 게임 종료 콜백 저장
    this.endGameCallback = endGameCallback;
    
    // 첫 문제 전송
    if (this.gameState.quiz && this.gameState.quiz.questions.length > 0) {
      setTimeout(() => {
        this.sendQuestion();
      }, 2000); // 게임 시작 2초 후 첫 문제
    }

    this.updateInterval = setInterval(() => {
      // 퀴즈 배틀은 문제를 다 풀면 끝나므로 duration 체크는 무시 (매우 큰 값으로 설정되어 있어도 실제로는 문제 완료 시 종료)
      // duration이 설정되어 있으면 최대 시간 제한으로만 사용
      const elapsed = Date.now() - this.gameState.startTime;
      const remaining = this.gameState.duration ? Math.max(0, this.gameState.duration - elapsed) : Infinity;

      // duration이 설정되어 있고 시간이 초과되면 게임 종료 (하지만 실제로는 문제 완료 시 종료됨)
      if (this.gameState.duration && remaining <= 0) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
        endGameCallback();
        return;
      }

      // 모든 플레이어가 답했는지 확인하고 시간 업데이트
      if (this.gameState.currentQuestionIndex < this.gameState.quiz?.questions.length) {
        // 문제당 시간 제한 계산
        let questionTimeRemaining = null;
        if (this.gameState.questionTimeLimit !== null && this.gameState.questionStartTime) {
          const questionElapsed = Date.now() - this.gameState.questionStartTime;
          questionTimeRemaining = Math.max(0, this.gameState.questionTimeLimit - questionElapsed);
        }
        
        // 문제 시간 업데이트 전송
        // 퀴즈 배틀은 문제를 다 풀면 끝나므로 timeRemaining은 표시하지 않음 (null로 전송)
        this.io.to(this.room.id).emit("quizUpdate", {
          questionTimeRemaining: questionTimeRemaining,
          timeRemaining: null, // 퀴즈 배틀은 전체 게임 시간이 의미 없음
          scores: this.gameState.scores,
          teamScores: this.room.teamMode ? this.gameState.teamScores : null,
        });
      }
    }, 100);

    return this.updateInterval;
  }

  // 정답 제출 처리
  submitAnswer(socketId, answer, timeSpent) {
    // 무한 도전 모드가 아닌 경우: 이미 답한 경우 무시
    if (!this.gameState.infiniteRetry && this.gameState.answers[socketId]) {
      return false;
    }
    
    // 무한 도전 모드: 이미 정답을 맞춘 경우 무시
    if (this.gameState.infiniteRetry && this.gameState.correctAnswers[socketId]) {
      return false;
    }

    const question = this.gameState.quiz.questions[this.gameState.currentQuestionIndex];
    const questionType = question.questionType || "객관식";
    
    // 주관식/객관식에 따라 정답 비교
    let isCorrect = false;
    if (questionType === "주관식") {
      // 주관식: 문자열 비교 (대소문자 무시, 앞뒤 공백 제거)
      const userAnswer = String(answer || "").trim().toLowerCase();
      const correctAnswer = String(question.correctAnswer || "").trim().toLowerCase();
      isCorrect = userAnswer === correctAnswer;
    } else {
      // 객관식: 섞인 선택지 기준으로 정답 인덱스 비교
      // 섞인 선택지가 있으면 섞인 배열 기준 인덱스, 없으면 원본 기준
      const correctIndex = this.gameState.currentCorrectAnswerIndex !== null
        ? this.gameState.currentCorrectAnswerIndex
        : question.correctAnswer;
      isCorrect = answer === correctIndex;
    }

    // 점수 계산
    let points = 0;
    if (isCorrect) {
      // 무한 도전 모드: 정답을 맞춘 경우에만 점수 부여 (이미 맞춘 경우 중복 점수 없음)
      if (this.gameState.infiniteRetry && this.gameState.correctAnswers[socketId]) {
        points = 0; // 이미 정답을 맞춘 경우 점수 없음
      } else {
        if (this.gameState.timeBasedScoring && this.gameState.questionTimeLimit) {
          // 시간 비례 점수 모드: 남은 시간에 비례해서 점수 부여
          const elapsed = Date.now() - this.gameState.questionStartTime;
          const remaining = Math.max(0, this.gameState.questionTimeLimit - elapsed);
          const timeRatio = remaining / this.gameState.questionTimeLimit;
          // 최소 10점 보장 (0초에 답해도 최소 점수)
          points = Math.max(10, Math.round(timeRatio * 100));
        } else {
          // 기본 모드: 정답이면 100점
          points = 100;
        }
        
        // 무한 도전 모드: 정답을 맞춘 플레이어 기록
        if (this.gameState.infiniteRetry) {
          this.gameState.correctAnswers[socketId] = true;
        }
      }
    } else {
      // 무한 도전 모드: 틀린 답을 낸 경우 피드백만 전송하고 계속 시도 가능
      if (this.gameState.infiniteRetry) {
        this.io.to(socketId).emit("answerSubmitted", {
          isCorrect: false,
          points: 0,
          currentScore: this.gameState.scores[socketId] || 0,
          canRetry: true, // 다시 시도 가능
        });
        return true; // 틀렸지만 계속 시도 가능
      }
    }

    this.gameState.scores[socketId] = (this.gameState.scores[socketId] || 0) + points;

    // 팀전 모드인 경우 팀 점수에도 반영
    if (this.room.teamMode) {
      const player = this.room.players.find((p) => p.id === socketId);
      if (player && player.teamId) {
        this.gameState.teamScores[player.teamId] =
          (this.gameState.teamScores[player.teamId] || 0) + points;
      }
    }

    // 답변 기록 (무한 도전 모드에서는 정답을 맞춘 경우에만 기록)
    if (!this.gameState.infiniteRetry || isCorrect) {
      this.gameState.answers[socketId] = {
        answer,
        timeSpent,
        isCorrect,
      };
    }

    // 다음 문제로 이동 조건 확인
    let shouldMoveNext = false;
    if (this.gameState.infiniteRetry) {
      // 무한 도전 모드: 모든 플레이어가 정답을 맞춘 경우
      shouldMoveNext = Object.keys(this.gameState.correctAnswers).length === this.room.players.length;
    } else {
      // 기본 모드: 모든 플레이어가 답한 경우
      shouldMoveNext = Object.keys(this.gameState.answers).length === this.room.players.length;
    }

    if (shouldMoveNext) {
      // 문제당 시간 제한 타이머 정리
      if (this.questionTimeout) {
        clearTimeout(this.questionTimeout);
        this.questionTimeout = null;
      }
      
      // 모두 답했으면 잠시 후 다음 문제로
      setTimeout(() => {
        this.nextQuestion();
      }, 1000);
    }

    // 개별 답변 확인 전송
    this.io.to(socketId).emit("answerSubmitted", {
      isCorrect,
      points,
      currentScore: this.gameState.scores[socketId],
    });

    // 정답을 맞춘 경우 모든 클라이언트에 실시간 알림 전송
    if (isCorrect) {
      const player = this.room.players.find((p) => p.id === socketId);
      if (player) {
        this.io.to(this.room.id).emit("playerCorrectAnswer", {
          playerId: socketId,
          playerName: player.name,
          playerPhoto: player.photo,
          points: points,
          currentScore: this.gameState.scores[socketId],
        });
      }
      
      // 정답을 맞춘 후 스킵 투표 상태 업데이트 (정답 맞춘 사람의 스킵 투표 제거 및 과반수 재계산)
      this.updateSkipVoteStatus();
    }

    return true;
  }

  // 다음 문제로 이동
  nextQuestion() {
    // 정답 공개 및 결과 전송
    const question = this.gameState.quiz.questions[this.gameState.currentQuestionIndex];
    const questionType = question.questionType || "객관식";
    
    let correctAnswerText = "";
    if (questionType === "주관식") {
      correctAnswerText = String(question.correctAnswer);
    } else {
      // 객관식: 섞인 선택지가 있으면 섞인 배열에서 정답 텍스트 가져오기
      if (this.gameState.currentShuffledOptions && this.gameState.currentCorrectAnswerIndex !== null) {
        correctAnswerText = this.gameState.currentShuffledOptions[this.gameState.currentCorrectAnswerIndex] || "";
      } else {
        // 섞인 선택지가 없으면 원본 기준
        correctAnswerText = question.options && question.options[question.correctAnswer] 
          ? question.options[question.correctAnswer] 
          : "";
      }
    }
    
    // 각 플레이어의 답변 텍스트 생성
    const answersWithText = {};
    Object.entries(this.gameState.answers).forEach(([playerId, answerData]) => {
      let answerText = null;
      if (answerData.answer !== null) {
        if (questionType === "주관식") {
          // 주관식: 답변 자체가 텍스트
          answerText = String(answerData.answer);
        } else {
          // 객관식: 섞인 선택지에서 텍스트 가져오기
          if (this.gameState.currentShuffledOptions && answerData.answer !== null) {
            answerText = this.gameState.currentShuffledOptions[answerData.answer] || null;
          } else if (question.options && answerData.answer !== null) {
            answerText = question.options[answerData.answer] || null;
          }
        }
      }
      answersWithText[playerId] = {
        ...answerData,
        answerText: answerText,
      };
    });
    
    this.io.to(this.room.id).emit("questionResult", {
      questionType,
      correctAnswer: question.correctAnswer,
      correctAnswerText,
      answers: answersWithText,
      scores: this.gameState.scores,
      teamScores: this.room.teamMode ? this.gameState.teamScores : null,
    });

    // 다음 문제로 이동
    setTimeout(() => {
      this.gameState.currentQuestionIndex++;
      this.gameState.answers = {};
      this.gameState.correctAnswers = {}; // 무한 도전 모드 초기화
      this.gameState.skipVotes = new Set(); // 스킵 투표 초기화
      this.gameState.questionStartTime = Date.now();
      // 섞인 선택지 정보 초기화
      this.gameState.currentShuffledOptions = null;
      this.gameState.currentCorrectAnswerIndex = null;

      if (
        this.gameState.currentQuestionIndex >= this.gameState.quiz.questions.length
      ) {
        // 모든 문제 완료
        this.endGame();
      } else {
        this.sendQuestion();
      }
    }, 4000); // 4초 후 다음 문제 (정답 공개 시간 포함)
  }

  // 배열 섞기 (Fisher-Yates 알고리즘)
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // 문제 전송
  sendQuestion() {
    const question =
      this.gameState.quiz.questions[this.gameState.currentQuestionIndex];
    this.gameState.questionStartTime = Date.now();

    // 이전 문제의 타이머 정리
    if (this.questionTimeout) {
      clearTimeout(this.questionTimeout);
      this.questionTimeout = null;
    }
    
    // 무한 도전 모드 초기화
    if (this.gameState.infiniteRetry) {
      this.gameState.correctAnswers = {};
    }
    
    // 스킵 투표 초기화
    this.gameState.skipVotes = new Set();

    let options = question.options || [];
    let correctAnswerIndex = 0;

    // 객관식인 경우 선택지 섞기
    if (question.questionType !== "주관식" && options.length > 0) {
      // 정답(첫 번째 옵션)의 원래 인덱스는 0
      const originalCorrectAnswer = options[0];
      
      // 선택지 섞기
      const shuffledOptions = this.shuffleArray(options);
      
      // 섞인 배열에서 정답의 새 인덱스 찾기
      correctAnswerIndex = shuffledOptions.findIndex(opt => opt === originalCorrectAnswer);
      
      // gameState에 섞인 선택지와 정답 인덱스 저장 (답안 제출 시 사용)
      this.gameState.currentShuffledOptions = shuffledOptions;
      this.gameState.currentCorrectAnswerIndex = correctAnswerIndex;
      
      options = shuffledOptions;
    } else {
      // 주관식이거나 선택지가 없으면 그대로
      this.gameState.currentShuffledOptions = null;
      this.gameState.currentCorrectAnswerIndex = null;
    }

    this.io.to(this.room.id).emit("newQuestion", {
      questionType: question.questionType || "객관식",
      imageUrl: question.imageUrl,
      audioUrl: question.audioUrl,
      options: options,
      questionNumber: this.gameState.currentQuestionIndex + 1,
      totalQuestions: this.gameState.quiz.questions.length,
      questionTimeLimit: this.gameState.questionTimeLimit,
    });

    // 문제당 시간 제한이 설정되어 있으면 타이머 시작
    if (this.gameState.questionTimeLimit !== null && this.gameState.questionTimeLimit > 0) {
      this.questionTimeout = setTimeout(() => {
        // 무한 도전 모드가 아닌 경우: 시간 초과 시 모든 플레이어의 답변 처리 (미답변은 오답 처리)
        if (!this.gameState.infiniteRetry) {
          this.room.players.forEach((player) => {
            if (!this.gameState.answers[player.id]) {
              // 미답변 플레이어는 오답 처리 (점수 없음)
              this.gameState.answers[player.id] = {
                answer: null,
                timeSpent: this.gameState.questionTimeLimit,
                isCorrect: false,
              };
            }
          });
        }
        // 무한 도전 모드: 시간 초과 시에도 모든 플레이어가 정답을 맞추지 못했으면 다음 문제로 이동
        // (시간 제한이 있으면 시간이 지나면 다음 문제로 넘어감)
        
        // 타이머 정리
        this.questionTimeout = null;
        
        // 다음 문제로 이동
        setTimeout(() => {
          this.nextQuestion();
        }, 1000);
      }, this.gameState.questionTimeLimit);
    }
  }

  // 게임 종료
  endGame() {
    // 업데이트 인터벌 정리
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // 문제당 시간 제한 타이머 정리
    if (this.questionTimeout) {
      clearTimeout(this.questionTimeout);
      this.questionTimeout = null;
    }
    
    // 모든 문제를 완료했을 때 게임 종료
    if (this.endGameCallback) {
      this.endGameCallback();
    }
  }

  // 게임 결과 계산
  calculateResults() {
    // 팀전 모드인 경우
    if (this.room.teamMode && this.gameState.teamScores) {
      let winningTeams = [];
      let maxTeamScore = 0;

      Object.entries(this.gameState.teamScores).forEach(([teamId, score]) => {
        if (score > maxTeamScore) {
          maxTeamScore = score;
          winningTeams = [Number(teamId)];
        } else if (score === maxTeamScore && maxTeamScore > 0) {
          winningTeams.push(Number(teamId));
        }
      });

      const results = this.room.players.map((player) => {
        const score = this.gameState.scores[player.id] || 0;
        const isWinner = player.teamId && winningTeams.includes(player.teamId);
        return {
          id: player.id,
          name: player.name,
          photo: player.photo,
          score: score,
          teamId: player.teamId || null,
          teamScore: player.teamId ? this.gameState.teamScores[player.teamId] : null,
          isWinner: isWinner,
        };
      });

      results.sort((a, b) => {
        if (a.teamScore !== null && b.teamScore !== null) {
          if (b.teamScore !== a.teamScore) return b.teamScore - a.teamScore;
        }
        return b.score - a.score;
      });

      return { results, winners: winningTeams, teamScores: this.gameState.teamScores };
    }

    // 개인전 모드
    let winners = [];
    let maxScore = 0;

    Object.entries(this.gameState.scores).forEach(([playerId, score]) => {
      if (score > maxScore) {
        maxScore = score;
        winners.length = 0;
        winners.push(playerId);
      } else if (score === maxScore && maxScore > 0) {
        winners.push(playerId);
      }
    });

    const results = this.room.players.map((player) => ({
      id: player.id,
      name: player.name,
      photo: player.photo,
      score: this.gameState.scores[player.id] || 0,
      isWinner: winners.includes(player.id),
    }));

    results.sort((a, b) => b.score - a.score);

    return { results, winners };
  }

  // 게임 상태 반환 (재연결 시)
  getGameStateData() {
    const elapsed = Date.now() - this.gameState.startTime;
    const remaining = Math.max(0, this.gameState.duration - elapsed);

    const question = this.gameState.quiz?.questions[this.gameState.currentQuestionIndex];
    let questionTimeRemaining = null;
    
    // 문제당 시간 제한 계산
    if (this.gameState.questionTimeLimit !== null && this.gameState.questionStartTime) {
      const questionElapsed = Date.now() - this.gameState.questionStartTime;
      questionTimeRemaining = Math.max(0, this.gameState.questionTimeLimit - questionElapsed);
    }

    return {
      duration: this.gameState.duration,
      startTime: this.gameState.startTime,
      gameType: this.gameState.gameType,
      quiz: this.gameState.quiz,
      currentQuestionIndex: this.gameState.currentQuestionIndex,
      scores: this.gameState.scores,
      teamScores: this.room.teamMode ? this.gameState.teamScores : null,
      timeRemaining: remaining,
      questionTimeRemaining: questionTimeRemaining,
      questionTimeLimit: this.gameState.questionTimeLimit,
    };
  }

  // ===== Refactor hooks (gameHandler에서 하드코딩 제거용) =====
  getUpdateEventName() {
    return "quizUpdate";
  }

  getClientUpdateData() {
    const state = this.getGameStateData();
    return {
      questionTimeRemaining: state.questionTimeRemaining ?? null,
      timeRemaining: state.timeRemaining ?? 0,
      scores: state.scores || {},
      teamScores: state.teamScores || null,
    };
  }

  getGameStartedPayload() {
    const state = this.getGameStateData();
    return {
      duration: state.duration,
      startTime: state.startTime,
      gameType: state.gameType,
      quiz: state.quiz,
      currentQuestionIndex: state.currentQuestionIndex,
    };
  }

  handleAction(socketId, action, data) {
    if (action === "submitAnswer") {
      return this.submitAnswer(socketId, data?.answer, data?.timeSpent);
    }
    if (action === "voteSkip") {
      return this.voteSkip(socketId);
    }
    return false;
  }

  // 스킵 투표 상태 업데이트 및 전송 (정답 맞춘 후 호출)
  updateSkipVoteStatus() {
    // 정답을 맞춘 사람의 스킵 투표 제거
    const votersToRemove = [];
    this.gameState.skipVotes.forEach((voterId) => {
      if (!this.gameState.infiniteRetry) {
        // 무한 도전 모드가 아닌 경우: 답을 제출한 사람은 스킵 투표 제거
        if (this.gameState.answers[voterId] && this.gameState.answers[voterId].isCorrect) {
          votersToRemove.push(voterId);
        }
      } else {
        // 무한 도전 모드: 정답을 맞춘 사람은 스킵 투표 제거
        if (this.gameState.correctAnswers[voterId]) {
          votersToRemove.push(voterId);
        }
      }
    });
    
    // 스킵 투표 제거
    votersToRemove.forEach((voterId) => {
      this.gameState.skipVotes.delete(voterId);
    });

    // 못 푼 사람 수 계산
    let unansweredCount = 0;
    this.room.players.forEach((player) => {
      if (!this.gameState.infiniteRetry) {
        // 무한 도전 모드가 아닌 경우: 답을 제출하지 않았거나 오답인 사람
        if (!this.gameState.answers[player.id] || !this.gameState.answers[player.id].isCorrect) {
          unansweredCount++;
        }
      } else {
        // 무한 도전 모드: 정답을 맞추지 않은 사람
        if (!this.gameState.correctAnswers[player.id]) {
          unansweredCount++;
        }
      }
    });

    const voteCount = this.gameState.skipVotes.size;
    const majority = Math.ceil(unansweredCount / 2); // 못 푼 사람 기준 과반수 (50% 이상)

    // 모든 클라이언트에 투표 현황 전송
    this.io.to(this.room.id).emit("skipVoteUpdate", {
      voteCount,
      totalPlayers: this.room.players.length,
      unansweredCount,
      majority,
      voters: Array.from(this.gameState.skipVotes),
    });

    // 과반수 달성 시 문제 스킵
    if (voteCount >= majority && majority > 0 && unansweredCount > 0) {
      // 문제당 시간 제한 타이머 정리
      if (this.questionTimeout) {
        clearTimeout(this.questionTimeout);
        this.questionTimeout = null;
      }

      // 모든 플레이어를 미답변 처리 (스킵된 문제는 점수 없음)
      this.room.players.forEach((player) => {
        if (!this.gameState.answers[player.id]) {
          this.gameState.answers[player.id] = {
            answer: null,
            timeSpent: Date.now() - this.gameState.questionStartTime,
            isCorrect: false,
          };
        }
      });

      // 잠시 후 다음 문제로 이동
      setTimeout(() => {
        this.nextQuestion();
      }, 1000);
    }
  }

  // 문제 스킵 투표
  voteSkip(socketId) {
    // 이미 투표한 경우 무시
    if (this.gameState.skipVotes.has(socketId)) {
      return false;
    }

    // 못 푼 사람만 스킵 투표 가능
    // 무한 도전 모드가 아닌 경우: 이미 답을 제출한 사람은 스킵 투표 불가
    if (!this.gameState.infiniteRetry && this.gameState.answers[socketId]) {
      return false;
    }
    
    // 무한 도전 모드: 이미 정답을 맞춘 사람은 스킵 투표 불가
    if (this.gameState.infiniteRetry && this.gameState.correctAnswers[socketId]) {
      return false;
    }

    // 못 푼 사람 수 계산
    let unansweredCount = 0;
    this.room.players.forEach((player) => {
      if (!this.gameState.infiniteRetry) {
        // 무한 도전 모드가 아닌 경우: 답을 제출하지 않은 사람
        if (!this.gameState.answers[player.id]) {
          unansweredCount++;
        }
      } else {
        // 무한 도전 모드: 정답을 맞추지 않은 사람
        if (!this.gameState.correctAnswers[player.id]) {
          unansweredCount++;
        }
      }
    });

    // 스킵 투표 추가
    this.gameState.skipVotes.add(socketId);
    
    // 스킵 투표 상태 업데이트 및 전송 (과반수 체크 포함)
    this.updateSkipVoteStatus();

    return true;
  }

  // 전역 타이머 사용 여부 (퀴즈 배틀은 문제를 다 풀면 끝나므로 전역 타이머 불필요)
  shouldUseGlobalTimer() {
    return false;
  }
}

module.exports = QuizBattle;
