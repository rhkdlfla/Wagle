const mongoose = require("mongoose");

const QuizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: "",
  },
  thumbnailUrl: {
    type: String,
    default: null,
  },
  defaultQuestionType: {
    type: String,
    enum: ["객관식", "주관식"],
    default: "객관식",
  },
  creator: {
    userId: String,
    name: String,
    photo: String,
  },
  questions: [
    {
      questionType: {
        type: String,
        enum: ["객관식", "주관식"],
        default: "객관식",
      },
      imageUrl: {
        type: String,
        default: null, // 이미지 퀴즈용
      },
      audioUrl: {
        type: String,
        default: null, // 노래 퀴즈용
      },
      options: {
        type: [String],
        required: function() {
          return this.questionType === "객관식";
        },
        validate: {
          validator: function(options) {
            if (this.questionType === "객관식") {
              return options && options.length >= 2 && options.length <= 6;
            }
            return true; // 주관식은 options 검증 불필요
          },
          message: "객관식 선택지는 2개 이상 6개 이하여야 합니다.",
        },
      },
      correctAnswer: {
        type: mongoose.Schema.Types.Mixed, // Number(객관식 인덱스) 또는 String(주관식 답변)
        required: true,
      },
    },
  ],
  isPublic: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// 정답 검증 (Mongoose 9.x 호환)
QuizSchema.pre("save", function (next) {
  try {
    if (!this.questions || !Array.isArray(this.questions)) {
      if (typeof next === 'function') {
        return next();
      }
      return;
    }
    
    for (const question of this.questions) {
      const questionType = question.questionType || "객관식";
      
      if (questionType === "객관식") {
        // 객관식: correctAnswer는 인덱스(Number)
        if (!question.options || !Array.isArray(question.options)) {
          const error = new Error("객관식 문제는 선택지가 필요합니다.");
          if (typeof next === 'function') {
            return next(error);
          }
          throw error;
        }
        if (typeof question.correctAnswer !== 'number' || 
            question.correctAnswer < 0 || 
            question.correctAnswer >= question.options.length) {
          const error = new Error(`정답 인덱스가 선택지 범위를 벗어났습니다. (인덱스: ${question.correctAnswer}, 선택지 수: ${question.options.length})`);
          if (typeof next === 'function') {
            return next(error);
          }
          throw error;
        }
      } else if (questionType === "주관식") {
        // 주관식: correctAnswer는 답변(String)
        if (typeof question.correctAnswer !== 'string' || !question.correctAnswer.trim()) {
          const error = new Error("주관식 문제의 정답을 입력해주세요.");
          if (typeof next === 'function') {
            return next(error);
          }
          throw error;
        }
      }
    }
    if (typeof next === 'function') {
      next();
    }
  } catch (error) {
    if (typeof next === 'function') {
      next(error);
    } else {
      throw error;
    }
  }
});

module.exports = mongoose.model("Quiz", QuizSchema);
