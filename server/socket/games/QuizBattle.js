const Quiz = require("../../models/Quiz");

class QuizBattle {
  constructor(io, gameState, room) {
    this.io = io;
    this.gameState = gameState;
    this.room = room;
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
    // 첫 문제 전송
    if (this.gameState.quiz && this.gameState.quiz.questions.length > 0) {
      setTimeout(() => {
        this.sendQuestion();
      }, 2000); // 게임 시작 2초 후 첫 문제
    }

    const updateInterval = setInterval(() => {
      const elapsed = Date.now() - this.gameState.startTime;
      const remaining = Math.max(0, this.gameState.duration - elapsed);

      if (remaining <= 0) {
        clearInterval(updateInterval);
        endGameCallback();
        return;
      }

      // 모든 플레이어가 답했는지 확인하고 시간 업데이트
      if (this.gameState.currentQuestionIndex < this.gameState.quiz?.questions.length) {
        // 문제 시간 업데이트 전송 (시간 제한 없음 - 모든 플레이어가 답할 때까지 대기)
        this.io.to(this.room.id).emit("quizUpdate", {
          questionTimeRemaining: null,
          timeRemaining: remaining,
          scores: this.gameState.scores,
          teamScores: this.room.teamMode ? this.gameState.teamScores : null,
        });
      }
    }, 100);

    return updateInterval;
  }

  // 정답 제출 처리
  submitAnswer(socketId, answer, timeSpent) {
    // 이미 답한 경우 무시
    if (this.gameState.answers[socketId]) {
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

    // 점수 계산 (정답만 점수)
    let points = 0;
    if (isCorrect) {
      points = 100; // 기본 100점
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

    this.gameState.answers[socketId] = {
      answer,
      timeSpent,
      isCorrect,
    };

    // 모든 플레이어가 답했는지 확인
    if (Object.keys(this.gameState.answers).length === this.room.players.length) {
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
    
    this.io.to(this.room.id).emit("questionResult", {
      questionType,
      correctAnswer: question.correctAnswer,
      correctAnswerText,
      answers: this.gameState.answers,
      scores: this.gameState.scores,
      teamScores: this.room.teamMode ? this.gameState.teamScores : null,
    });

    // 다음 문제로 이동
    setTimeout(() => {
      this.gameState.currentQuestionIndex++;
      this.gameState.answers = {};
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
    });
  }

  // 게임 종료
  endGame() {
    // 게임 종료는 gameHandler의 endGame에서 처리
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
    let questionTimeRemaining = null; // 시간 제한 없음

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
    };
  }
}

module.exports = QuizBattle;
