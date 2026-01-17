const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const KakaoStrategy = require("passport-kakao").Strategy;
const User = require("../models/User");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const SERVER_URL = process.env.SERVER_URL || "http://localhost:4000";

// 사용자 직렬화 (세션에 저장)
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// 사용자 역직렬화 (세션에서 복원)
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// 구글 OAuth 전략
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${SERVER_URL}/auth/google/callback`,
      },
      // 구글 로그인 시 DB 조회 및 저장 로직 적용
      async (accessToken, refreshToken, profile, done) => {
        try {
          // DB에 이미 있는 유저인지 확인
          let existingUser = await User.findOne({ 
            provider: "google", 
            providerId: profile.id 
          });

          if (existingUser) {
            return done(null, existingUser);
          }

          // 없으면 DB에 새로 생성
          const newUser = await User.create({
            provider: "google",
            providerId: profile.id,
            name: profile.displayName,
            email: profile.emails?.[0]?.value,
            photo: profile.photos?.[0]?.value,
          });
          
          return done(null, newUser);
        } catch (err) {
          console.error("구글 로그인 에러:", err);
          return done(err, null);
        }
      }
    )
  );
}

// 카카오 OAuth 전략
if (process.env.KAKAO_CLIENT_ID) {
  const kakaoCallbackURL = `${SERVER_URL}/auth/kakao/callback`;
  console.log("🔗 카카오 콜백 URL:", kakaoCallbackURL);
  console.log("   → 카카오 개발자 콘솔에 이 URL을 리다이렉트 URI로 등록하세요!");
  passport.use(
    "kakao",
    new KakaoStrategy(
      {
        clientID: process.env.KAKAO_CLIENT_ID,
        callbackURL: kakaoCallbackURL,
      },
      // 카카오 로그인 시 DB 조회 및 저장 로직 적용
      async (accessToken, refreshToken, profile, done) => {
        try {
          let existingUser = await User.findOne({ 
            provider: "kakao", 
            providerId: profile.id.toString() 
          });

          if (existingUser) {
            return done(null, existingUser);
          }

          const newUser = await User.create({
            provider: "kakao",
            providerId: profile.id.toString(),
            name: profile.displayName || profile.username || profile._json?.properties?.nickname,
            email: profile._json?.kakao_account?.email,
            photo: profile._json?.properties?.profile_image,
          });

          return done(null, newUser);
        } catch (err) {
          console.error("카카오 로그인 에러:", err);
          return done(err, null);
        }
      }
    )
  );
} else {
  console.warn("⚠️ KAKAO_CLIENT_ID 미설정");
}

module.exports = passport;
