const express = require("express");
const router = express.Router();
const Quiz = require("../models/Quiz");

// 미들웨어: 인증 확인
function requireAuth(req, res, next) {
  // 게스트 사용자도 허용
  if (!req.user && !req.headers["guest-user"]) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  next();
}

// 퀴즈 생성 (인증된 사용자만 가능)
router.post("/create", requireAuth, async (req, res) => {
  console.log("퀴즈 생성 요청 수신:", req.method, req.path, req.body?.title);
  
  // 게스트 사용자는 퀴즈 생성 불가
  if (!req.user || !req.user.id) {
    return res.status(403).json({ error: "퀴즈 생성을 위해서는 로그인이 필요합니다." });
  }
  
  try {
    const { title, description, questions, isPublic } = req.body;

    // 유효성 검사
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "퀴즈 제목이 필요합니다." });
    }

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "최소 1개 이상의 문제가 필요합니다." });
    }

    // 각 문제 유효성 검사
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.options || q.options.length < 2) {
        return res.status(400).json({ error: `문제 ${i + 1}의 형식이 올바르지 않습니다.` });
      }
      if (
        typeof q.correctAnswer !== "number" ||
        q.correctAnswer < 0 ||
        q.correctAnswer >= q.options.length
      ) {
        return res.status(400).json({ error: `문제 ${i + 1}의 정답 인덱스가 올바르지 않습니다.` });
      }
    }

    // 사용자 정보 가져오기 (인증된 사용자만 가능)
    const creator = {
      userId: req.user.id,
      name: req.user.name,
      photo: req.user.photo,
    };

    const quiz = new Quiz({
      title: title.trim(),
      description: description || "",
      questions: questions.map((q) => ({
        imageUrl: q.imageUrl || null,
        audioUrl: q.audioUrl || null,
        options: q.options.map((opt) => opt.trim()),
        correctAnswer: q.correctAnswer,
      })),
      creator,
      isPublic: isPublic !== false,
      createdAt: new Date(),
    });

    await quiz.save();
    res.json({ success: true, quiz });
  } catch (error) {
    console.error("퀴즈 생성 오류:", error);
    console.error("에러 상세:", error.message, error.stack);
    // 개발 환경에서는 상세 에러 메시지 반환
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "퀴즈 생성에 실패했습니다." 
      : error.message || "퀴즈 생성에 실패했습니다.";
    res.status(500).json({ error: errorMessage, details: error.message });
  }
});

// 퀴즈 목록 조회
router.get("/list", async (req, res) => {
  try {
    const { search, limit = 50, skip = 0 } = req.query;
    const query = { isPublic: true };

    if (search && search.trim()) {
      query.$or = [
        { title: { $regex: search.trim(), $options: "i" } },
        { description: { $regex: search.trim(), $options: "i" } },
      ];
    }

    const quizzes = await Quiz.find(query)
      .select("title description creator createdAt questions")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    const total = await Quiz.countDocuments(query);

    res.json({ quizzes, total });
  } catch (error) {
    console.error("퀴즈 목록 조회 오류:", error);
    res.status(500).json({ error: "퀴즈 목록 조회에 실패했습니다." });
  }
});

// 퀴즈 상세 조회
router.get("/:quizId", async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.quizId);
    if (!quiz) {
      return res.status(404).json({ error: "퀴즈를 찾을 수 없습니다." });
    }

    // 공개 퀴즈이거나 본인이 만든 퀴즈만 조회 가능
    if (!quiz.isPublic) {
      const userId = req.user?.id || null;
      if (quiz.creator.userId !== userId) {
        return res.status(403).json({ error: "비공개 퀴즈입니다." });
      }
    }

    res.json(quiz);
  } catch (error) {
    console.error("퀴즈 상세 조회 오류:", error);
    res.status(500).json({ error: "퀴즈 조회에 실패했습니다." });
  }
});

// 내가 만든 퀴즈 목록
router.get("/my/list", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const query = { "creator.userId": userId };

    const quizzes = await Quiz.find(query)
      .select("title description isPublic createdAt")
      .sort({ createdAt: -1 });

    res.json({ quizzes });
  } catch (error) {
    console.error("내 퀴즈 목록 조회 오류:", error);
    res.status(500).json({ error: "퀴즈 목록 조회에 실패했습니다." });
  }
});

// 퀴즈 수정 (인증된 사용자만 가능)
router.put("/:quizId", requireAuth, async (req, res) => {
  try {
    // 게스트 사용자는 퀴즈 수정 불가
    if (!req.user || !req.user.id) {
      return res.status(403).json({ error: "퀴즈 수정을 위해서는 로그인이 필요합니다." });
    }

    const { quizId } = req.params;
    const { title, description, questions, isPublic } = req.body;

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ error: "퀴즈를 찾을 수 없습니다." });
    }

    // 권한 확인 - 본인이 만든 퀴즈만 수정 가능
    if (!quiz.creator.userId || quiz.creator.userId !== req.user.id) {
      return res.status(403).json({ error: "퀴즈를 수정할 권한이 없습니다." });
    }

    // 유효성 검사
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "퀴즈 제목이 필요합니다." });
    }

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "최소 1개 이상의 문제가 필요합니다." });
    }

    // 각 문제 유효성 검사
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.options || q.options.length < 2) {
        return res.status(400).json({ error: `문제 ${i + 1}의 형식이 올바르지 않습니다.` });
      }
      if (
        typeof q.correctAnswer !== "number" ||
        q.correctAnswer < 0 ||
        q.correctAnswer >= q.options.length
      ) {
        return res.status(400).json({ error: `문제 ${i + 1}의 정답 인덱스가 올바르지 않습니다.` });
      }
    }

    // 퀴즈 업데이트
    quiz.title = title.trim();
    quiz.description = description || "";
    quiz.questions = questions.map((q) => ({
      imageUrl: q.imageUrl || null,
      audioUrl: q.audioUrl || null,
      options: q.options.map((opt) => opt.trim()),
      correctAnswer: q.correctAnswer,
    }));
    quiz.isPublic = isPublic !== false;

    await quiz.save();
    res.json({ success: true, quiz });
  } catch (error) {
    console.error("퀴즈 수정 오류:", error);
    console.error("에러 상세:", error.message, error.stack);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "퀴즈 수정에 실패했습니다." 
      : error.message || "퀴즈 수정에 실패했습니다.";
    res.status(500).json({ error: errorMessage, details: error.message });
  }
});

module.exports = router;
