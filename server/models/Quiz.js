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
  creator: {
    userId: String,
    name: String,
    photo: String,
  },
  questions: [
    {
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
        required: true,
        validate: {
          validator: (options) => options.length >= 2 && options.length <= 6,
          message: "선택지는 2개 이상 6개 이하여야 합니다.",
        },
      },
      correctAnswer: {
        type: Number,
        required: true,
        min: 0,
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

// 정답 인덱스 검증 (Mongoose 9.x 호환)
QuizSchema.pre("save", function (next) {
  try {
    if (!this.questions || !Array.isArray(this.questions)) {
      if (typeof next === 'function') {
        return next();
      }
      return;
    }
    
    for (const question of this.questions) {
      if (!question.options || !Array.isArray(question.options)) {
        continue;
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
