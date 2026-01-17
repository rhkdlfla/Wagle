const express = require("express");
const router = express.Router();
const passport = require("../config/passport");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// 구글 로그인
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: `${CLIENT_URL}/login?error=google` }),
  (req, res) => {
    res.redirect(`${CLIENT_URL}/auth/success`);
  }
);

// 카카오 로그인
router.get("/kakao", (req, res, next) => {
  console.log("🔵 카카오 로그인 시도");
  if (!process.env.KAKAO_CLIENT_ID) {
    console.error("❌ KAKAO_CLIENT_ID 미설정");
    return res.redirect(`${CLIENT_URL}/login?error=kakao_config`);
  }
  passport.authenticate("kakao")(req, res, next);
});

router.get(
  "/kakao/callback",
  (req, res, next) => {
    console.log("🔄 카카오 콜백 수신:", req.query);
    if (!process.env.KAKAO_CLIENT_ID) {
      console.error("❌ KAKAO_CLIENT_ID 미설정");
      return res.redirect(`${CLIENT_URL}/login?error=kakao_config`);
    }
    passport.authenticate(
      "kakao",
      {
        failureRedirect: `${CLIENT_URL}/login?error=kakao`,
        failureFlash: false,
      },
      (err, user, info) => {
        if (err) {
          console.error("❌ 카카오 인증 에러:", err);
          console.error("   에러 상세:", err.message, err.stack);
          return res.redirect(`${CLIENT_URL}/login?error=kakao`);
        }
        if (!user) {
          console.error("❌ 카카오 인증 실패: 사용자 정보 없음");
          console.error("   정보:", info);
          return res.redirect(`${CLIENT_URL}/login?error=kakao`);
        }
        console.log("✅ 카카오 사용자 정보 수신:", {
          id: user.id || user._id,
          name: user.name,
          provider: user.provider
        });
        req.logIn(user, (loginErr) => {
          if (loginErr) {
            console.error("❌ 카카오 로그인 세션 생성 에러:", loginErr);
            return res.redirect(`${CLIENT_URL}/login?error=kakao`);
          }
          console.log("✅ 카카오 로그인 성공:", user.name);
          console.log("   리다이렉트:", `${CLIENT_URL}/auth/success`);
          res.redirect(`${CLIENT_URL}/auth/success`);
        });
      }
    )(req, res, next);
  }
);

// 로그아웃
router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "로그아웃 실패" });
    }
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });
});

// 현재 사용자 정보 조회
router.get("/user", (req, res) => {
  if (req.isAuthenticated()) {
    console.log("✅ 인증된 사용자:", req.user.name, `(${req.user.provider})`);
    // _id를 id로 명시적으로 변환하여 반환 (MongoDB ObjectId를 문자열로)
    const userData = req.user.toObject ? req.user.toObject() : req.user;
    if (userData._id) {
      userData.id = String(userData._id);
    }
    res.json({ user: userData, authenticated: true });
  } else {
    console.log("❌ 인증되지 않은 사용자 요청");
    console.log("   세션 ID:", req.sessionID);
    console.log("   세션 데이터:", req.session);
    res.json({ user: null, authenticated: false });
  }
});

module.exports = router;
