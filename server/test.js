const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = "mongodb://bettykim_db_user:hL2k3F5FKdGn87pX@cluster0-shard-00-00.okbhwj3.mongodb.net:27017,cluster0-shard-00-01.okbhwj3.mongodb.net:27017,cluster0-shard-00-02.okbhwj3.mongodb.net:27017/wagle?ssl=true&authSource=admin";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    console.log("🚀 연결 시도 중...");
    
    // 1. 서버에 연결
    await client.connect();
    
    // 2. 핑(Ping) 날려보기
    await client.db("admin").command({ ping: 1 });
    
    console.log("✅ 성공했다!!! MongoDB에 연결되었습니다!");
  } catch (error) {
    console.log("❌ 실패함. 에러 로그 확인:");
    console.dir(error); // 에러를 자세히 출력
  } finally {
    // 끝나면 연결 종료
    await client.close();
  }
}

run();