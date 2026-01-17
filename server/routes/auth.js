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
  if (!process.env.KAKAO_CLIENT_ID) {
    console.error("❌ KAKAO_CLIENT_ID 미설정");
    return res.redirect(`${CLIENT_URL}/login?error=kakao_config`);
  }
  passport.authenticate("kakao")(req, res, next);
});

router.get(
  "/kakao/callback",
  (req, res, next) => {
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
          return res.redirect(`${CLIENT_URL}/login?error=kakao`);
        }
        if (!user) {
          console.error("❌ 카카오 인증 실패: 사용자 정보 없음");
          return res.redirect(`${CLIENT_URL}/login?error=kakao`);
        }
        req.logIn(user, (loginErr) => {
          if (loginErr) {
            console.error("❌ 카카오 로그인 세션 생성 에러:", loginErr);
            return res.redirect(`${CLIENT_URL}/login?error=kakao`);
          }
          res.redirect(`${CLIENT_URL}/auth/success`);
        });
      }
    )(req, res, next);
  }
);

// 로그아웃
router.get("/logout", (req, res) => {
  const currentUser = req.user || null;
  const provider = currentUser?.provider || null;
  const providerId = currentUser?.providerId || currentUser?.id || currentUser?._id || null;
  const userKey = provider && providerId ? `${provider}:${providerId}` : null;

  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "로그아웃 실패" });
    }
    req.session.destroy(() => {
      if (userKey && req.app?.locals?.userToSocket) {
        const userToSocket = req.app.locals.userToSocket;
        const socketId = userToSocket.get(userKey);
        if (socketId && req.app?.locals?.io) {
          const socket = req.app.locals.io.sockets.sockets.get(socketId);
          if (socket) {
            socket.disconnect(true);
          }
        }
        userToSocket.delete(userKey);
      }
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });
});

// 현재 사용자 정보 조회
router.get("/user", (req, res) => {
  if (req.isAuthenticated()) {
    // MongoDB의 _id를 id로 변환하여 반환
    const userData = req.user.toObject ? req.user.toObject() : req.user;
    const userWithId = {
      ...userData,
      id: userData._id || userData.id, // _id를 id로 변환
    };
    delete userWithId._id; // _id 제거
    res.json({ user: userWithId, authenticated: true });
  } else {
    res.json({ user: null, authenticated: false });
  }
});

module.exports = router;
