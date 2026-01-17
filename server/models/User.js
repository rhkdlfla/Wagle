const mongoose = require("mongoose");

// 유저 스키마 정의: DB에 저장할 사용자 정보 구조
const userSchema = new mongoose.Schema({
  provider: { type: String, required: true }, // google, kakao
  providerId: { type: String, required: true }, // 플랫폼별 고유 ID
  name: { type: String, required: true },
  email: { type: String },
  photo: { type: String },
  createdAt: { type: Date, default: Date.now },
});

// 중복 가입 방지
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });

// User 모델 생성
const User = mongoose.model("User", userSchema);

module.exports = User;
