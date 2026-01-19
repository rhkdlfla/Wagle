const mongoose = require("mongoose");

const gameStatsSchema = new mongoose.Schema(
  {
    plays: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
  },
  { _id: false }
);

const gameHistorySchema = new mongoose.Schema(
  {
    gameType: { type: String, required: true },
    rank: { type: Number, required: true },
    playersCount: { type: Number, required: true },
    isWinner: { type: Boolean, default: false },
    playedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// 유저 스키마 정의: DB에 저장할 사용자 정보 구조
const userSchema = new mongoose.Schema({
  provider: { type: String, required: true }, // google, kakao
  providerId: { type: String, required: true }, // 플랫폼별 고유 ID
  name: { type: String, required: true },
  nickname: { type: String },
  email: { type: String },
  photo: { type: String },
  gameStats: { type: Map, of: gameStatsSchema, default: {} },
  gameHistory: { type: [gameHistorySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

// 중복 가입 방지
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });

// User 모델 생성
const User = mongoose.model("User", userSchema);

module.exports = User;
