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
  category: {
    type: String,
    required: true,
    enum: ["종합인물", "국기", "노래", "게임캐릭터", "기타"],
    default: "기타",
  },
  creator: {
    userId: String,
    name: String,
    photo: String,
  },
  questions: [
    {
      question: {
        type: String,
        required: true,
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
      timeLimit: {
        type: Number,
        default: 30, // 기본 30초
        min: 5,
        max: 120,
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

// 정답 인덱스 검증
QuizSchema.pre("save", function (next) {
  for (const question of this.questions) {
    if (question.correctAnswer < 0 || question.correctAnswer >= question.options.length) {
      return next(new Error("정답 인덱스가 선택지 범위를 벗어났습니다."));
    }
  }
  next();
});

module.exports = mongoose.model("Quiz", QuizSchema);
