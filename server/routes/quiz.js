const express = require("express");
const router = express.Router();
const Quiz = require("../models/Quiz");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");

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
  if (!req.user || !req.user._id) {
    return res.status(403).json({ error: "퀴즈 생성을 위해서는 로그인이 필요합니다." });
  }
  
  try {
    let { title, description, questions, isPublic } = req.body;

    // 유효성 검사
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "퀴즈 제목이 필요합니다." });
    }

    // questions가 없거나 빈 배열이면 빈 배열로 처리
    if (!questions || !Array.isArray(questions)) {
      questions = [];
    }

    // 각 문제 유효성 검사 (문제가 있을 때만)
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const questionType = q.questionType || "객관식";
      
      if (questionType === "객관식") {
        // 객관식 검증
        if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
          return res.status(400).json({ error: `문제 ${i + 1}의 형식이 올바르지 않습니다. (객관식은 최소 2개의 선택지가 필요합니다)` });
      }
      if (
        typeof q.correctAnswer !== "number" ||
        q.correctAnswer < 0 ||
        q.correctAnswer >= q.options.length
      ) {
        return res.status(400).json({ error: `문제 ${i + 1}의 정답 인덱스가 올바르지 않습니다.` });
        }
      } else if (questionType === "주관식") {
        // 주관식 검증
        if (typeof q.correctAnswer !== "string" || !q.correctAnswer.trim()) {
          return res.status(400).json({ error: `문제 ${i + 1}의 정답을 입력해주세요.` });
        }
        // 주관식은 options가 없거나 빈 배열이어야 함
        if (q.options && q.options.length > 0) {
          q.options = [];
        }
      }
    }

    // 사용자 정보 가져오기 (인증된 사용자만 가능)
    // req.user._id는 MongoDB ObjectId이므로 문자열로 변환하여 저장
    const creator = {
      userId: String(req.user._id),
      name: req.user.name,
      photo: req.user.photo,
    };

    const quiz = new Quiz({
      title: title.trim(),
      description: description || "",
      questions: questions.map((q) => {
        const questionType = q.questionType || "객관식";
        const question = {
          questionType,
        imageUrl: q.imageUrl || null,
          correctAnswerImageUrl: q.correctAnswerImageUrl || null,
        audioUrl: q.audioUrl || null,
        correctAnswer: q.correctAnswer,
        };
        
        if (questionType === "객관식") {
          question.options = q.options.map((opt) => opt.trim());
        } else {
          // 주관식은 options를 빈 배열로
          question.options = [];
        }
        
        return question;
      }),
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
    const userId = req.user?._id ? String(req.user._id) : null;
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
    if (!req.user || !req.user._id) {
      return res.status(403).json({ error: "퀴즈 수정을 위해서는 로그인이 필요합니다." });
    }

    const { quizId } = req.params;
    let { title, description, questions, isPublic } = req.body;

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ error: "퀴즈를 찾을 수 없습니다." });
    }

    // 권한 확인 - 본인이 만든 퀴즈만 수정 가능
    const currentUserId = String(req.user._id);
    if (!quiz.creator.userId || quiz.creator.userId !== currentUserId) {
      return res.status(403).json({ error: "퀴즈를 수정할 권한이 없습니다." });
    }

    // 유효성 검사
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "퀴즈 제목이 필요합니다." });
    }

    // questions가 없거나 빈 배열이면 빈 배열로 처리
    if (!questions || !Array.isArray(questions)) {
      questions = [];
    }

    // 각 문제 유효성 검사 (문제가 있을 때만)
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const questionType = q.questionType || "객관식";
      
      if (questionType === "객관식") {
        // 객관식 검증
        if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
          return res.status(400).json({ error: `문제 ${i + 1}의 형식이 올바르지 않습니다. (객관식은 최소 2개의 선택지가 필요합니다)` });
      }
      if (
        typeof q.correctAnswer !== "number" ||
        q.correctAnswer < 0 ||
        q.correctAnswer >= q.options.length
      ) {
        return res.status(400).json({ error: `문제 ${i + 1}의 정답 인덱스가 올바르지 않습니다.` });
        }
      } else if (questionType === "주관식") {
        // 주관식 검증
        if (typeof q.correctAnswer !== "string" || !q.correctAnswer.trim()) {
          return res.status(400).json({ error: `문제 ${i + 1}의 정답을 입력해주세요.` });
        }
        // 주관식은 options가 없거나 빈 배열이어야 함
        if (q.options && q.options.length > 0) {
          q.options = [];
        }
      }
    }

    // 퀴즈 업데이트
    quiz.title = title.trim();
    quiz.description = description || "";
    quiz.questions = questions.map((q) => {
      const questionType = q.questionType || "객관식";
      const question = {
        questionType,
      imageUrl: q.imageUrl || null,
        correctAnswerImageUrl: q.correctAnswerImageUrl || null,
      audioUrl: q.audioUrl || null,
      correctAnswer: q.correctAnswer,
      };
      
      if (questionType === "객관식") {
        question.options = q.options.map((opt) => opt.trim());
      } else {
        // 주관식은 options를 빈 배열로
        question.options = [];
      }
      
      return question;
    });
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

// 맞추기아이오 퀴즈 크롤링 (Puppeteer 사용)
router.post("/crawl", requireAuth, async (req, res) => {
  const { url, questionCount, socketId } = req.body;
  const io = req.app.locals.io; // Socket.IO 인스턴스 가져오기
  
  if (!url || !url.trim()) {
    return res.status(400).json({ error: "URL이 필요합니다." });
  }
  
  // 문제 수 설정 (기본값 10, 최소 1, 최대 50)
  const maxQuestions = Math.min(Math.max(parseInt(questionCount) || 10, 1), 50);

  // 맞추기아이오 URL 검증
  if (!url.includes("machugi.io/quiz/")) {
    return res.status(400).json({ error: "맞추기아이오 퀴즈 링크만 지원합니다." });
  }

  // 즉시 응답하여 타임아웃 방지
  res.json({ 
    success: true, 
    message: "크롤링을 시작했습니다. 진행 상황은 실시간으로 업데이트됩니다.",
    socketId: socketId 
  });

  // 백그라운드에서 크롤링 진행
  (async () => {
    let browser = null;
    try {
      console.log("퀴즈 크롤링 시작 (Puppeteer):", url);

    // Puppeteer 브라우저 실행
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // User-Agent 설정
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // 페이지 로드 (domcontentloaded로 변경하여 빠르게 로드)
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 // 60초로 증가
    });

    // 페이지가 완전히 로드될 때까지 최소한의 대기만
    await new Promise(resolve => setTimeout(resolve, 500));

    // "50개 풀기" 또는 "전체 풀기" 버튼 찾기 및 클릭 (JavaScript로)
    try {
      const buttonClicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a[role="button"], [onclick], div[role="button"]'));
        const loadButton = buttons.find(btn => {
          const text = (btn.textContent || btn.innerText || '').trim();
          return text.includes('50개') || 
                 (text.includes('50') && text.includes('풀기')) || 
                 text.includes('전체') ||
                 (text.includes('풀기') && !text.includes('10개') && !text.includes('20개') && !text.includes('30개')) ||
                 (typeof btn.className === 'string' && btn.className.includes('load')) ||
                 (typeof btn.className === 'string' && btn.className.includes('all')) ||
                 btn.getAttribute('data-testid')?.includes('load');
        });
        if (loadButton) {
          console.log('버튼 발견:', loadButton.textContent || loadButton.innerText);
          loadButton.click();
          return true;
        }
        return false;
      });
      
      if (buttonClicked) {
        // 문제가 로드될 때까지 대기 (최소한의 대기만)
        await Promise.race([
          page.waitForSelector('[data-question], .question-item, .quiz-question, [class*="question"], img[src*="question"], img[src*="quiz"]', { timeout: 3000 }).catch(() => null),
          new Promise(resolve => setTimeout(resolve, 1000))
        ]);
        await new Promise(resolve => setTimeout(resolve, 500)); // 추가 대기 최소화
      }
    } catch (e) {
      console.log("버튼 클릭 시도 실패:", e.message);
    }

    // __NEXT_DATA__에서 questionIds 추출
    const quizInfo = await page.evaluate(() => {
      const nextDataScript = document.querySelector('#__NEXT_DATA__');
      if (nextDataScript) {
        try {
          const nextData = JSON.parse(nextDataScript.textContent);
          const quizType = nextData.props?.pageProps?.quizType;
          if (quizType) {
            return {
              questionIds: quizType.questionIds || [],
              title: quizType.title || "",
              description: quizType.description || ""
            };
          }
        } catch (e) {
          console.error("__NEXT_DATA__ 파싱 실패:", e);
        }
      }
      return { questionIds: [], title: "", description: "" };
    });

    console.log(`questionIds ${quizInfo.questionIds.length}개 발견`);

    // 모든 문제를 순회하며 수집
    const allQuestions = [];
    // questionCount 파라미터로 받은 값 사용 (이미 위에서 maxQuestions로 설정됨)
    
    // 문제를 하나씩 순회하며 수집
    for (let i = 0; i < maxQuestions; i++) {
      try {
        console.log(`${i + 1}/${maxQuestions}번째 문제 처리 중...`);
        
        // 현재 문제의 이미지 추출
        const questionData = await page.evaluate(() => {
          // 방법 1: ImageQuizDisplay_root__YvVai 클래스로 찾기
          let questionImg = document.querySelector('img.ImageQuizDisplay_root__YvVai');
          
          // 방법 2: machugi-image를 포함하는 이미지 찾기
          if (!questionImg) {
            const allImgs = Array.from(document.querySelectorAll('img'));
            questionImg = allImgs.find(img => {
              const src = img.src || img.getAttribute('data-src') || '';
              return src && 
                     !src.includes('logo') && 
                     !src.includes('icon') && 
                     !src.includes('thumbnail') && 
                     !src.includes('avatar') &&
                     !src.includes('main.png') &&
                     !src.includes('favicon') &&
                     !src.includes('ic_arrow_white') &&
                     src.includes('machugi-image');
            });
          }
          
          return {
            imageUrl: questionImg?.src || questionImg?.getAttribute('data-src') || "",
            found: !!questionImg
          };
        });

        if (!questionData.found || !questionData.imageUrl) {
          console.log(`${i + 1}번째 문제 이미지를 찾을 수 없음`);
          // 이미지가 없어도 계속 진행
        }

        // 답안 입력 필드 찾기 및 "." 입력 후 제출
        const inputSelector = 'input.QuizDetailAnswerFreeResponse_questionInput__7urV0, input.ant-input, input[type="text"]';
        await page.waitForSelector(inputSelector, { timeout: 30000 }); // 30초로 증가
        
        // 입력 필드에 포커스
        await page.focus(inputSelector);
        await new Promise(resolve => setTimeout(resolve, 200)); // 500ms -> 200ms
        
        // "." 입력
        await page.type(inputSelector, '.', { delay: 50 }); // delay 100 -> 50
        await new Promise(resolve => setTimeout(resolve, 200)); // 500ms -> 200ms
        
        // Enter 키를 눌러서 제출
        await page.keyboard.press('Enter');
        
        // 답안이 표시될 때까지 대기
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // 제출 후 답안 추출 (정답 이미지는 제외)
        const answerData = await page.evaluate(() => {
            let answerText = "";
            
            // 방법 0-1: QuizDetailAnswerResult_questionResultAnswer__KzzLh 클래스에서 답안 찾기 (최우선)
            // 이 클래스가 가장 확실한 방법입니다
            const answerElement = document.querySelector('.QuizDetailAnswerResult_questionResultAnswer__KzzLh') ||
                                 document.querySelector('[class*="questionResultAnswer"]') ||
                                 document.querySelector('article[class*="questionResultAnswer"]');
            if (answerElement) {
              const text = answerElement.textContent?.trim() || '';
              // "오답!", "정답!" 제외하고 답안만 추출
              if (text && 
                  text !== '오답!' && 
                  text !== '정답!' && 
                  text !== '.' && 
                  text.length > 0 && 
                  text.length < 100 &&
                  !text.includes('광고') &&
                  !text.includes('뒤로가기')) {
                answerText = text;
                console.log('답안 추출 성공 (방법 0-1):', answerText);
              }
            }
            
            // 방법 0-2: "오답!" 또는 "정답!" 메시지 다음에 나오는 답안 텍스트 찾기
            if (!answerText) {
              const allElements = Array.from(document.querySelectorAll('*'));
              for (const el of allElements) {
              const text = el.textContent?.trim() || '';
              // "오답!" 또는 "정답!" 텍스트를 찾으면, 그 다음 형제 요소나 부모의 다른 자식에서 답안 찾기
              if (text === '오답!' || text === '정답!') {
                // 같은 부모의 다른 자식 요소에서 답안 찾기
                const parent = el.parentElement;
                if (parent) {
                  const siblings = Array.from(parent.children);
                  for (const sibling of siblings) {
                    const siblingText = sibling.textContent?.trim() || '';
                    if (siblingText && 
                        siblingText !== '오답!' && 
                        siblingText !== '정답!' &&
                        siblingText !== '.' &&
                        siblingText.length > 0 &&
                        siblingText.length < 100 &&
                        sibling.tagName !== 'BUTTON' &&
                        sibling.tagName !== 'INPUT') {
                      answerText = siblingText;
                      break;
                    }
                  }
                }
                // 부모의 다음 형제 요소에서 답안 찾기
                if (!answerText && parent && parent.nextElementSibling) {
                  const nextText = parent.nextElementSibling.textContent?.trim() || '';
                  if (nextText && 
                      nextText !== '오답!' && 
                      nextText !== '정답!' &&
                      nextText !== '.' &&
                      nextText.length > 0 &&
                      nextText.length < 100) {
                    answerText = nextText;
                  }
                }
                if (answerText) break;
              }
            }
            }
            
            // 방법 1: QuizDetailAnswerFreeResponse 관련 요소에서 답안 찾기
            let answerContainer = document.querySelector('[class*="QuizDetailAnswerFreeResponse"]');
            if (!answerContainer) {
              answerContainer = document.querySelector('[class*="QuizDetailAnswer"]');
            }
            if (answerContainer && !answerText) {
              // 답안 텍스트 찾기
              const input = answerContainer.querySelector('input');
              const inputValue = input?.value || '';
              const inputDisabled = input?.disabled || false;
              const inputPlaceholder = input?.placeholder || '';
              
              // placeholder에 답안이 있을 수 있음
              if (inputPlaceholder && inputPlaceholder !== '.' && inputPlaceholder.length > 0 && inputPlaceholder.length < 100) {
                answerText = inputPlaceholder;
              }
              
              // 입력 필드가 disabled되었거나 값이 "."일 때, 컨테이너의 다른 텍스트 찾기
              if (!answerText && (inputDisabled || !inputValue || inputValue === '.')) {
                // 전체 컨테이너 텍스트에서 입력 필드 값을 제외
                const containerText = answerContainer.textContent?.trim() || '';
                if (containerText && containerText !== inputValue && containerText !== '.') {
                  // 입력 필드 값을 제외한 나머지 텍스트
                  let cleanedText = containerText.replace(inputValue, '').trim();
                  // "광고" 같은 불필요한 텍스트 제거
                  cleanedText = cleanedText.replace(/광고/g, '').trim();
                  if (cleanedText && cleanedText.length > 0 && cleanedText.length < 100) {
                    answerText = cleanedText;
                  }
                }
                
                // TreeWalker로 텍스트 노드 찾기
                if (!answerText) {
                  const allTextNodes = [];
                  const walker = document.createTreeWalker(
                    answerContainer,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                  );
                  let node;
                  while (node = walker.nextNode()) {
                    const text = node.textContent?.trim() || '';
                    if (text && text !== '.' && text.length > 0 && text.length < 100) {
                      // 부모가 input이 아닌 경우만
                      if (node.parentElement?.tagName !== 'INPUT') {
                        allTextNodes.push(text);
                      }
                    }
                  }
                  
                  // 가장 긴 텍스트를 답안으로 선택 (입력 필드 값 제외)
                  if (allTextNodes.length > 0) {
                    const filtered = allTextNodes
                      .filter(t => t !== inputValue && t !== '.' && !t.includes('광고') && !t.includes('뒤로가기'));
                    if (filtered.length > 0) {
                      answerText = filtered.sort((a, b) => b.length - a.length)[0] || '';
                    }
                  }
                }
              }
              
              // 방법 4: 컨테이너 내부의 span, div, p 등에서 답안 찾기
              if (!answerText) {
                const textElements = answerContainer.querySelectorAll('span, div, p, label');
                for (const el of textElements) {
                  const text = el.textContent?.trim() || '';
                  if (text && 
                      text !== '.' && 
                      text !== inputValue &&
                      text.length > 0 && 
                      text.length < 100 &&
                      !text.includes('광고') &&
                      !text.includes('뒤로가기') &&
                      !text.includes('제출') &&
                      !text.includes('확인')) {
                    // 입력 필드의 부모가 아닌 경우만
                    if (!input || !el.contains(input)) {
                      answerText = text;
                      break;
                    }
                  }
                }
              }
              
              // 방법 5: 입력 필드의 value가 "."이 아니고 답안처럼 보이면
              if (!answerText && inputValue && inputValue !== '.' && inputValue.length > 0 && inputValue.length < 100) {
                answerText = inputValue;
              }
            }
            
            // 방법 3: disabled된 입력 필드 옆의 텍스트 찾기
            if (!answerText) {
              const disabledInput = document.querySelector('input[disabled]');
              if (disabledInput) {
                const parent = disabledInput.parentElement;
                if (parent) {
                  const siblings = Array.from(parent.childNodes);
                  for (const sibling of siblings) {
                    if (sibling.nodeType === Node.TEXT_NODE) {
                      const text = sibling.textContent?.trim() || '';
                      if (text && text !== '.' && text.length > 0 && text.length < 100) {
                        answerText = text;
                        break;
                      }
                    } else if (sibling.nodeType === Node.ELEMENT_NODE) {
                      const text = sibling.textContent?.trim() || '';
                      if (text && 
                          text !== '.' && 
                          text.length > 0 && 
                          text.length < 100 &&
                          sibling.tagName !== 'INPUT' &&
                          sibling.tagName !== 'BUTTON') {
                        answerText = text;
                        break;
                      }
                    }
                  }
                }
              }
            }
            
            // 방법 4: 전체 페이지에서 답안 관련 텍스트 찾기 (제목 제외)
            if (!answerText) {
              const allElements = Array.from(document.querySelectorAll('*'));
              const titleText = document.querySelector('title')?.textContent || '';
              
              for (const el of allElements) {
                const text = el.textContent?.trim() || '';
                const className = typeof el.className === 'string' ? el.className : '';
                
                // 답안으로 보이는 텍스트 (제목 제외, 입력 필드가 아니고, 길이가 적당한 경우)
                if (text && 
                    text !== '.' && 
                    text.length > 0 && 
                    text.length < 50 &&
                    text !== titleText &&
                    !text.includes('당신은 과자 매니아') &&
                    !text.includes('마추기 아이오') &&
                    el.tagName !== 'INPUT' &&
                    el.tagName !== 'BUTTON' &&
                    el.tagName !== 'TITLE' &&
                    el.tagName !== 'HEADER' &&
                    !className.includes('input') &&
                    !className.includes('Header') &&
                    !text.includes('제출') &&
                    !text.includes('확인') &&
                    !text.includes('다음') &&
                    !text.includes('뒤로가기') &&
                    !text.includes('광고')) {
                  answerText = text;
                  break;
                }
              }
            }
            
            return { answerText };
          });
          
          // 답안이 제목인 경우 제외
          if (answerData.answerText && (answerData.answerText.includes("당신은 과자 매니아") || answerData.answerText.includes("마추기 아이오"))) {
            answerData.answerText = "";
          }
          
          allQuestions.push({
            imageUrl: questionData.imageUrl,
            correctAnswer: answerData.answerText || "",
            correctAnswerImageUrl: "" // 정답 이미지는 제외
          });

          const answerPreview = answerData.answerText ? answerData.answerText.substring(0, 20) : "(답안 없음)";
          console.log(`${i + 1}번째 문제 수집 완료: ${answerPreview}`);
          
          // Socket.IO로 진행 상황 전송
          if (io && socketId) {
            io.to(socketId).emit('quizCrawlProgress', {
              current: i + 1,
              total: maxQuestions,
              answer: answerData.answerText || "(답안 없음)",
              imageUrl: questionData.imageUrl
            });
          }
          
          // 답안 추출 후 다시 Enter를 눌러서 다음 문제로 이동
          // 입력 필드에 포커스를 맞춘 후 Enter 키 입력
          await page.evaluate(() => {
            const input = document.querySelector('input.QuizDetailAnswerFreeResponse_questionInput__7urV0') ||
                         document.querySelector('input.ant-input') ||
                         document.querySelector('input[type="text"]');
            if (input) {
              input.focus();
            }
          });
          
          await page.keyboard.press('Enter');
          await new Promise(resolve => setTimeout(resolve, 2500)); // 다음 문제 로드 대기
          
          // 다음 문제로 이동했는지 확인 (이미지가 변경되었는지)
          const nextQuestionImg = await page.evaluate(() => {
            const img = document.querySelector('img.ImageQuizDisplay_root__YvVai');
            return img?.src || '';
          });
          
          if (nextQuestionImg && nextQuestionImg !== questionData.imageUrl) {
            console.log(`${i + 1}번째 문제에서 다음 문제로 이동 성공`);
          } else {
            console.log(`${i + 1}번째 문제에서 다음 문제로 이동 실패, 다음 버튼 클릭 시도`);
            // 다음 버튼 클릭 시도
            const nextClicked = await page.evaluate(() => {
              const nextBtn = document.querySelector('button.NextButton_root__MHkxh');
              if (nextBtn && !nextBtn.disabled) {
                nextBtn.click();
                return true;
              }
              return false;
            });
            if (nextClicked) {
              await new Promise(resolve => setTimeout(resolve, 1500)); // 2500ms -> 1500ms
            } else {
              // Enter 키를 한 번 더 시도
              await page.keyboard.press('Enter');
              await new Promise(resolve => setTimeout(resolve, 1000)); // 2000ms -> 1000ms
            }
          }
          
          // 다음 문제 처리로 넘어가기 위해 continue
          continue;

        // 다음 문제가 로드될 때까지 대기 (최소한의 대기만)
        await new Promise(resolve => setTimeout(resolve, 500)); // 1000ms -> 500ms로 감소
        
      } catch (e) {
        console.log(`${i + 1}번째 문제 처리 중 오류:`, e.message);
        // 오류가 나도 계속 진행
        if (i < maxQuestions - 1) {
          // 다음 버튼 클릭 시도
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const nextBtn = buttons.find(btn => {
              const text = (btn.textContent || '').trim();
              return text.includes('다음') || text.includes('Next') || text.includes('→');
            });
            if (nextBtn) nextBtn.click();
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    // 제목과 설명은 quizInfo에서 가져옴
    const quizData = {
      title: quizInfo.title || 
             document.querySelector('h1')?.textContent?.trim() ||
             document.querySelector('meta[property="og:title"]')?.content ||
             "",
      description: quizInfo.description ||
                   document.querySelector('meta[property="og:description"]')?.content ||
                   "",
      questions: allQuestions
    };

    await browser.close();
    browser = null;

    // 데이터 검증 및 변환
    if (!quizData.title) {
      quizData.title = "맞추기아이오 퀴즈";
    }

    const questions = quizData.questions.map((q) => {
      const question = {
        questionType: "주관식",
        imageUrl: q.imageUrl || q.image || q.imageSrc || "",
        correctAnswerImageUrl: q.correctAnswerImageUrl || q.answerImage || q.answerImageUrl || "",
        options: [],
        correctAnswer: q.answer || q.correctAnswer || q.correct_answer || ""
      };

      // 이미지 URL이 상대 경로인 경우 절대 경로로 변환
      if (question.imageUrl && !question.imageUrl.startsWith('http')) {
        try {
          question.imageUrl = new URL(question.imageUrl, url).href;
        } catch (e) {
          console.log("이미지 URL 변환 실패:", question.imageUrl);
        }
      }
      if (question.correctAnswerImageUrl && !question.correctAnswerImageUrl.startsWith('http')) {
        try {
          question.correctAnswerImageUrl = new URL(question.correctAnswerImageUrl, url).href;
        } catch (e) {
          console.log("정답 이미지 URL 변환 실패:", question.correctAnswerImageUrl);
        }
      }

      return question;
    }).filter(q => q.imageUrl || q.correctAnswer); // 이미지나 정답이 있는 문제만

      if (questions.length === 0) {
        const errorMsg = "퀴즈 문제를 찾을 수 없습니다.";
        console.error("크롤링 실패:", errorMsg);
        if (io && socketId) {
          io.to(socketId).emit('quizCrawlComplete', {
            success: false,
            error: errorMsg,
            details: "페이지에서 문제 데이터를 추출할 수 없었습니다."
          });
        }
        return;
      }

      const descPreview = quizData.description ? quizData.description.substring(0, 50) : "(설명 없음)";
      console.log(`크롤링 완료: 제목="${quizData.title}", 설명="${descPreview}...", 문제 수=${questions.length}`);

      // Socket.IO로 최종 결과 전송
      if (io && socketId) {
        io.to(socketId).emit('quizCrawlComplete', {
          success: true,
          title: quizData.title,
          description: quizData.description,
          questions,
          sourceUrl: url
        });
      }
    } catch (error) {
      if (browser) {
        await browser.close();
      }
      console.error("퀴즈 크롤링 오류:", error);
      const errorMessage = error.message?.includes('timeout')
        ? "페이지 로드 시간이 초과되었습니다."
        : error.message?.includes('net::ERR')
        ? "페이지에 접근할 수 없습니다."
        : "퀴즈를 가져오는 중 오류가 발생했습니다.";
      
      // Socket.IO로 에러 전송
      if (io && socketId) {
        io.to(socketId).emit('quizCrawlComplete', {
          success: false,
          error: errorMessage,
          details: error.message
        });
      }
    }
  })();
});

module.exports = router;
