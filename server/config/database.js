require("dotenv").config();
const mongoose = require("mongoose");

// MongoDB 연결 설정
const MONGO_URI = process.env.MONGO_URI;

// 환경 변수 검증
if (!MONGO_URI) {
  console.error("❌ MONGO_URI 환경 변수가 설정되지 않았습니다!");
  console.error("   .env 파일에 MONGO_URI를 추가해주세요.");
  console.error("   예: MONGO_URI=mongodb://localhost:27017/wagle");
  process.exit(1);
}

// MongoDB 연결 옵션
const mongooseOptions = {
  // MongoDB Atlas (mongodb+srv://)를 사용하는 경우 family 옵션은 제외
  // 로컬 MongoDB (mongodb://)를 사용하는 경우에만 IPv4 강제 사용
  ...(MONGO_URI.startsWith('mongodb://') && !MONGO_URI.startsWith('mongodb+srv://') 
    ? { family: 4 } 
    : {}),
  // 연결 풀 설정
  maxPoolSize: 10,
  // 서버 선택 타임아웃
  serverSelectionTimeoutMS: 5000,
  // 소켓 타임아웃
  socketTimeoutMS: 45000,
};

// MongoDB 연결
mongoose
  .connect(MONGO_URI, mongooseOptions)
  .then(() => {
    console.log("✅ MongoDB 연결 성공!");
    console.log(`   연결 URI: ${MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`); // 비밀번호 마스킹
  })
  .catch((err) => {
    console.error("❌ MongoDB 연결 실패!");
    console.error("   원인:", err.message);
    
    // 구체적인 에러 메시지 제공
    if (err.name === 'MongoServerSelectionError') {
      console.error("   → MongoDB 서버에 연결할 수 없습니다.");
      console.error("   → MongoDB가 실행 중인지 확인해주세요.");
      console.error("   → 연결 URI가 올바른지 확인해주세요.");
    } else if (err.name === 'MongoParseError') {
      console.error("   → MongoDB URI 형식이 잘못되었습니다.");
      console.error("   → 올바른 형식: mongodb://[username:password@]host[:port][/database]");
    } else if (err.name === 'MongoAuthenticationError') {
      console.error("   → MongoDB 인증에 실패했습니다.");
      console.error("   → 사용자 이름과 비밀번호를 확인해주세요.");
    } else {
      console.error("   → 전체 에러:", err);
    }
    
    // 연결 실패 시 앱 종료 (선택사항 - 필요시 주석 처리)
    // process.exit(1);
  });

// MongoDB 연결 이벤트 리스너
mongoose.connection.on('connected', () => {
  console.log('📡 Mongoose가 MongoDB에 연결되었습니다.');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose 연결 에러:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ Mongoose가 MongoDB에서 연결이 끊어졌습니다.');
});

// 앱 종료 시 MongoDB 연결 종료
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB 연결이 종료되었습니다.');
  process.exit(0);
});

module.exports = mongoose;
