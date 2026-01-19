const express = require("express");
const router = express.Router();
const passport = require("../config/passport");
const User = require("../models/User");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

function buildUserPayload(userDoc) {
  const userData = userDoc.toObject ? userDoc.toObject() : userDoc;
  const rawGameStats = userData.gameStats || {};
  const normalizedGameStats =
    rawGameStats instanceof Map ? Object.fromEntries(rawGameStats.entries()) : rawGameStats;
  const userWithId = {
    ...userData,
    id: userData._id || userData.id,
    nickname: userData.nickname || userData.name,
    gameStats: normalizedGameStats,
  };
  delete userWithId._id;
  return userWithId;
}

function stripProfileFields(userData) {
  const { gameHistory, gameStats, ...rest } = userData || {};
  return rest;
}

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
    if (req.query?.error) {
      console.error("❌ 카카오 콜백 에러:", req.query);
    }
    passport.authenticate(
      "kakao",
      {
        failureRedirect: `${CLIENT_URL}/login?error=kakao`,
        failureFlash: false,
        failWithError: true,
      },
      (err, user, info) => {
        if (err) {
          console.error("❌ 카카오 인증 에러:", err, info || "");
          return res.redirect(`${CLIENT_URL}/login?error=kakao&reason=auth_error`);
        }
        if (!user) {
          console.error("❌ 카카오 인증 실패: 사용자 정보 없음", info || "");
          return res.redirect(`${CLIENT_URL}/login?error=kakao&reason=no_user`);
        }
        req.logIn(user, (loginErr) => {
          if (loginErr) {
            console.error("❌ 카카오 로그인 세션 생성 에러:", loginErr);
            return res.redirect(`${CLIENT_URL}/login?error=kakao&reason=session_error`);
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
        const existing = userToSocket.get(userKey);
        const socketId = existing?.socketId;
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
    console.log("✅ 인증된 사용자:", req.user.name, `(${req.user.provider})`);
    const userWithId = buildUserPayload(req.user);
    res.json({ user: stripProfileFields(userWithId), authenticated: true });
  } else {
    res.json({ user: null, authenticated: false });
  }
});

// 프로필 상세 조회
router.get("/profile", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }

  const userWithId = buildUserPayload(req.user);
  const recentGames = (userWithId.gameHistory || []).slice(0, 10);
  const gameStats = userWithId.gameStats || {};

  res.json({
    user: stripProfileFields(userWithId),
    recentGames,
    gameStats,
  });
});

// 프로필 이름 변경
router.patch("/profile", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }

  const nickname = req.body?.nickname?.trim();
  if (!nickname) {
    return res.status(400).json({ error: "이름을 입력해주세요." });
  }
  if (nickname.length < 2 || nickname.length > 20) {
    return res.status(400).json({ error: "이름은 2~20자여야 합니다." });
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { nickname },
      { new: true }
    );
    const userWithId = buildUserPayload(updatedUser);
    res.json({ user: stripProfileFields(userWithId) });
  } catch (error) {
    console.error("프로필 변경 실패:", error);
    res.status(500).json({ error: "프로필 변경에 실패했습니다." });
  }
});

module.exports = router;
