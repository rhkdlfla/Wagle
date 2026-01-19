import React, { useState } from "react";
import "./QuizForm.css";

function QuizForm({ onClose, onSuccess, user, quizToEdit = null, socket = null }) {
  // 게스트 사용자는 퀴즈를 만들 수 없음 (방어적 체크)
  React.useEffect(() => {
    if (!user || user.provider === "guest") {
      alert("퀴즈 생성을 위해서는 로그인이 필요합니다.");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const [title, setTitle] = useState(quizToEdit?.title || "");
  const [activeImageUploadIndex, setActiveImageUploadIndex] = useState(null); // 현재 이미지 업로드 중인 문제 인덱스
  const [description, setDescription] = useState(quizToEdit?.description || "");
  const [isPublic, setIsPublic] = useState(quizToEdit?.isPublic !== false);
  const [thumbnailUrl, setThumbnailUrl] = useState(quizToEdit?.thumbnailUrl || "");
  const [defaultQuestionType, setDefaultQuestionType] = useState(quizToEdit?.defaultQuestionType || "객관식");
  const [showSettings, setShowSettings] = useState(!quizToEdit); // 새 퀴즈 생성 시 설정 화면 먼저 표시
  const [questions, setQuestions] = useState(
    quizToEdit?.questions?.length > 0
      ? quizToEdit.questions.map((q) => ({
          questionType: q.questionType || "객관식",
          imageUrl: q.imageUrl || "",
          correctAnswerImageUrl: q.correctAnswerImageUrl || "",
          options: q.options || ["", ""],
          correctAnswer: q.correctAnswer || (q.questionType === "주관식" ? "" : 0),
        }))
      : [
          {
            questionType: "객관식",
            imageUrl: "",
            correctAnswerImageUrl: "",
            options: ["", ""],
            correctAnswer: 0,
          },
        ]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [editingQuestionIndex, setEditingQuestionIndex] = useState(null); // 현재 편집 중인 문제 인덱스
  const [crawlUrl, setCrawlUrl] = useState(""); // 크롤링할 URL
  const [isCrawling, setIsCrawling] = useState(false); // 크롤링 중 여부
  const [crawlQuestionCount, setCrawlQuestionCount] = useState(10); // 크롤링할 문제 수
  const [crawlProgress, setCrawlProgress] = useState(null); // 크롤링 진행 상황

  const addQuestion = () => {
    const newQuestion = {
      questionType: defaultQuestionType,
        imageUrl: "",
      correctAnswerImageUrl: "",
      options: defaultQuestionType === "객관식" ? ["", ""] : [],
      correctAnswer: defaultQuestionType === "객관식" ? 0 : "",
    };
    const newIndex = questions.length;
    setQuestions([...questions, newQuestion]);
    // 새로 추가된 문제의 인덱스로 편집 모달 열기
    setEditingQuestionIndex(newIndex);
  };

  const removeQuestion = (index) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((_, i) => i !== index));
    }
  };

  const updateQuestion = (index, field, value) => {
    setQuestions((prevQuestions) => {
      const updated = [...prevQuestions];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // 여러 필드를 한 번에 업데이트하는 함수
  const updateQuestionMultiple = (index, updates) => {
    setQuestions((prevQuestions) => {
      const updated = [...prevQuestions];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  };

  // 오답 선택지 추가 (객관식)
  const addOption = (questionIndex) => {
    setQuestions((prevQuestions) => {
      const updated = [...prevQuestions];
      // 정답 포함 최대 6개, 정답 제외 최대 5개 오답 가능
      if (updated[questionIndex].options.length < 6) {
        updated[questionIndex].options.push("");
        setQuestions(updated);
      }
      return updated;
    });
  };

  // 오답 선택지 제거 (객관식)
  const removeOption = (questionIndex, optionIndex) => {
    setQuestions((prevQuestions) => {
      const updated = [...prevQuestions];
      // 정답(인덱스 0) + 오답 최소 1개 = 최소 2개 필요
      if (updated[questionIndex].options.length > 2 && optionIndex > 0) {
        // 정답(인덱스 0)은 삭제 불가, 오답만 삭제 가능
        updated[questionIndex].options = updated[questionIndex].options.filter(
          (_, i) => i !== optionIndex
        );
      }
      return updated;
    });
  };

  const updateOption = (questionIndex, optionIndex, value) => {
    const updated = [...questions];
    updated[questionIndex].options[optionIndex] = value;
    setQuestions(updated);
  };

  // 이미지 리사이징 함수
  const resizeImage = (file, maxWidth = 1920, maxHeight = 1920, quality = 0.85) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // 크기가 큰 경우 리사이징
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = width * ratio;
            height = height * ratio;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                const resizedFile = new File([blob], file.name, {
                  type: file.type,
                  lastModified: Date.now(),
                });
                resolve(resizedFile);
              } else {
                reject(new Error('이미지 리사이징 실패'));
              }
            },
            file.type,
            quality
          );
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // 이미지 업로드 함수
  const uploadImage = async (file, questionIndex) => {
    try {
      setActiveImageUploadIndex(questionIndex);
      
      // 파일이 10MB보다 크면 리사이징
      let fileToUpload = file;
      if (file.size > 10 * 1024 * 1024) {
        try {
          fileToUpload = await resizeImage(file);
          console.log(`이미지 리사이징 완료: ${(file.size / 1024 / 1024).toFixed(2)}MB -> ${(fileToUpload.size / 1024 / 1024).toFixed(2)}MB`);
        } catch (resizeError) {
          console.error("이미지 리사이징 오류:", resizeError);
          // 리사이징 실패해도 원본 파일 사용
        }
      }

      const formData = new FormData();
      formData.append("image", fileToUpload);

      const response = await fetch("/api/upload/image", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      // 응답이 JSON인지 확인
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("서버 응답이 JSON이 아닙니다:", text);
        throw new Error("서버 응답 오류: HTML이 반환되었습니다. 상태 코드: " + response.status);
      }

      const data = await response.json();
      if (data.success) {
        updateQuestion(questionIndex, "imageUrl", data.url);
      } else {
        alert(data.error || "이미지 업로드에 실패했습니다.");
      }
    } catch (error) {
      console.error("이미지 업로드 오류:", error);
      console.error("업로드 실패한 파일:", file);
      console.error("업로드 실패한 questionIndex:", questionIndex);
      alert(`이미지 업로드에 실패했습니다: ${error.message || error}`);
    } finally {
      setActiveImageUploadIndex(null);
    }
  };

  // 정답 이미지 업로드 함수
  const uploadCorrectAnswerImage = async (file, questionIndex) => {
    try {
      setActiveImageUploadIndex(questionIndex);
      
      // 파일이 10MB보다 크면 리사이징
      let fileToUpload = file;
      if (file.size > 10 * 1024 * 1024) {
        try {
          fileToUpload = await resizeImage(file);
          console.log(`정답 이미지 리사이징 완료: ${(file.size / 1024 / 1024).toFixed(2)}MB -> ${(fileToUpload.size / 1024 / 1024).toFixed(2)}MB`);
        } catch (resizeError) {
          console.error("정답 이미지 리사이징 오류:", resizeError);
          // 리사이징 실패해도 원본 파일 사용
        }
      }

      const formData = new FormData();
      formData.append("image", fileToUpload);

      const response = await fetch("/api/upload/image", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      // 응답이 JSON인지 확인
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("서버 응답이 JSON이 아닙니다:", text);
        throw new Error("서버 응답 오류: HTML이 반환되었습니다. 상태 코드: " + response.status);
      }

      const data = await response.json();
      if (data.success) {
        updateQuestion(questionIndex, "correctAnswerImageUrl", data.url);
      } else {
        alert(data.error || "정답 이미지 업로드에 실패했습니다.");
      }
    } catch (error) {
      console.error("정답 이미지 업로드 오류:", error);
      alert(`정답 이미지 업로드에 실패했습니다: ${error.message || error}`);
    } finally {
      setActiveImageUploadIndex(null);
    }
  };

  // 썸네일 업로드 함수
  const uploadThumbnail = async (file) => {
    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch("/api/upload/image", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setThumbnailUrl(data.url);
      } else {
        alert(data.error || "썸네일 업로드에 실패했습니다.");
      }
    } catch (error) {
      console.error("썸네일 업로드 오류:", error);
      alert("썸네일 업로드에 실패했습니다.");
    }
  };

  // 클립보드에서 이미지 붙여넣기 처리
  const handlePaste = (e, questionIndex) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          uploadImage(file, questionIndex);
        }
        break;
      }
    }
  };

  // 클립보드에서 이미지 읽어오기
  const handleClipboardPaste = async (questionIndex) => {
    // Clipboard API 지원 확인 및 사용
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        const items = await navigator.clipboard.read();
        
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              const file = new File([blob], `clipboard-${Date.now()}.png`, { type: type });
              uploadImage(file, questionIndex);
              return;
            }
          }
        }
        
        alert('클립보드에서 이미지를 찾을 수 없습니다. 이미지를 복사한 후 다시 시도해주세요.');
      } catch (error) {
        console.error('클립보드 읽기 오류:', error);
        
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
          // Clipboard API 권한이 없는 경우 대체 방법 사용
          applyFallbackPasteMethod(questionIndex);
        } else {
          alert('클립보드에서 이미지를 읽을 수 없습니다. 이미지를 복사한 후 입력 영역에 Ctrl+V를 눌러주세요.');
        }
      }
    } else {
      // Clipboard API를 지원하지 않는 브라우저
      applyFallbackPasteMethod(questionIndex);
    }
  };

  // 대체 방법: 임시 요소를 만들고 paste 이벤트로 처리
  const applyFallbackPasteMethod = (questionIndex) => {
    // 활성화된 이미지 업로드 영역이 있으면 해당 영역에 포커스
    setActiveImageUploadIndex(questionIndex);
    
    // 사용자에게 안내
    const tempTextarea = document.createElement('textarea');
    tempTextarea.style.position = 'fixed';
    tempTextarea.style.left = '-9999px';
    tempTextarea.setAttribute('tabindex', '-1');
    document.body.appendChild(tempTextarea);
    tempTextarea.focus();
    
    let isCleanedUp = false;
    let timeoutId = null;
    
    const pasteHandler = (e) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.indexOf("image") !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              uploadImage(file, questionIndex);
            }
            cleanup();
            return;
          }
        }
      }
    };
    
    const blurHandler = () => {
      cleanup();
    };
    
    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      if (document.body.contains(tempTextarea)) {
        document.body.removeChild(tempTextarea);
      }
      
      document.removeEventListener('paste', pasteHandler);
      tempTextarea.removeEventListener('blur', blurHandler);
      setActiveImageUploadIndex(null);
    };
    
    document.addEventListener('paste', pasteHandler, { once: true });
    
    // 10초 후 자동 정리
    timeoutId = setTimeout(cleanup, 10000);
    
    // 포커스가 벗어나면 정리
    tempTextarea.addEventListener('blur', blurHandler, { once: true });
  };

  // 정답 이미지용 클립보드 붙여넣기
  const handleClipboardPasteForCorrectAnswer = async (questionIndex) => {
    // Clipboard API 지원 확인 및 사용
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        const items = await navigator.clipboard.read();
        
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              const file = new File([blob], `clipboard-${Date.now()}.png`, { type: type });
              uploadCorrectAnswerImage(file, questionIndex);
              return;
            }
          }
        }
        
        alert('클립보드에서 이미지를 찾을 수 없습니다. 이미지를 복사한 후 다시 시도해주세요.');
      } catch (error) {
        console.error('클립보드 읽기 오류:', error);
        
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
          // Clipboard API 권한이 없는 경우 대체 방법 사용
          applyFallbackPasteMethodForCorrectAnswer(questionIndex);
        } else {
          alert('클립보드에서 이미지를 읽을 수 없습니다. 이미지를 복사한 후 입력 영역에 Ctrl+V를 눌러주세요.');
        }
      }
    } else {
      // Clipboard API를 지원하지 않는 브라우저
      applyFallbackPasteMethodForCorrectAnswer(questionIndex);
    }
  };

  // 정답 이미지용 대체 붙여넣기 방법
  const applyFallbackPasteMethodForCorrectAnswer = (questionIndex) => {
    setActiveImageUploadIndex(questionIndex);
    
    const tempTextarea = document.createElement('textarea');
    tempTextarea.style.position = 'fixed';
    tempTextarea.style.left = '-9999px';
    tempTextarea.setAttribute('tabindex', '-1');
    document.body.appendChild(tempTextarea);
    tempTextarea.focus();
    
    let isCleanedUp = false;
    let timeoutId = null;
    
    const pasteHandler = (e) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.indexOf("image") !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              uploadCorrectAnswerImage(file, questionIndex);
            }
            cleanup();
            return;
          }
        }
      }
    };
    
    const blurHandler = () => {
      cleanup();
    };
    
    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      if (document.body.contains(tempTextarea)) {
        document.body.removeChild(tempTextarea);
      }
      
      document.removeEventListener('paste', pasteHandler);
      tempTextarea.removeEventListener('blur', blurHandler);
      setActiveImageUploadIndex(null);
    };
    
    document.addEventListener('paste', pasteHandler, { once: true });
    timeoutId = setTimeout(cleanup, 10000);
    tempTextarea.addEventListener('blur', blurHandler, { once: true });
  };

  // 드래그 앤 드롭 처리
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e, questionIndex, type) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("image/")) {
        if (type === "image") {
        uploadImage(file, questionIndex);
        } else if (type === "correctAnswerImage") {
          uploadCorrectAnswerImage(file, questionIndex);
        }
      }
    }
  };

  // 설정 저장 (빈 퀴즈 저장)
  const saveSettings = async () => {
    setError("");

    // 유효성 검사
    if (!title.trim()) {
      alert("퀴즈 제목을 입력해주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      const headers = {
        "Content-Type": "application/json",
      };

      // 게스트 사용자인 경우 헤더에 정보 추가 (Base64 인코딩)
      if (!user || !user.id) {
        const guestInfo = JSON.stringify({
          name: user?.name || "게스트",
        });
        headers["guest-user"] = btoa(unescape(encodeURIComponent(guestInfo)));
      }

      const apiUrl = quizToEdit ? `/api/quiz/${quizToEdit._id}` : "/api/quiz/create";
      const method = quizToEdit ? "PUT" : "POST";
      const requestBody = {
        title: title.trim(),
        description: description.trim(),
        thumbnailUrl: thumbnailUrl.trim() || null,
        defaultQuestionType: defaultQuestionType,
        questions: [], // 빈 문제 배열
        isPublic,
      };

      const response = await fetch(apiUrl, {
        method: method,
        headers,
          credentials: "include",
        body: JSON.stringify(requestBody),
      });

      if (response.status === 404) {
        const text = await response.text().catch(() => "");
        throw new Error(`경로를 찾을 수 없습니다. (HTTP 404)`);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        throw new Error(`서버 오류가 발생했습니다. (HTTP ${response.status})`);
      }

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error || (quizToEdit ? "퀴즈 수정에 실패했습니다." : "퀴즈 생성에 실패했습니다.");
        throw new Error(errorMsg);
      }

      // 새 퀴즈 생성 시 quizToEdit 업데이트 및 설정 화면 닫기
      if (!quizToEdit && data.quiz) {
        // quizToEdit를 업데이트하기 위해 App.js의 QuizFormPage에서 처리해야 함
        // 여기서는 설정 화면만 닫고 onSuccess 호출
        if (onSuccess) {
          onSuccess(data.quiz);
        }
        setShowSettings(false);
      } else if (quizToEdit) {
        // 편집 모드에서는 설정 화면만 닫기
        setShowSettings(false);
      }
    } catch (err) {
      console.error("퀴즈 설정 저장 에러:", err);
      setError(err.message || "퀴즈 저장에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // 유효성 검사
    if (!title.trim()) {
      setError("퀴즈 제목을 입력해주세요.");
      return;
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const questionType = q.questionType || "객관식";
      
      if (questionType === "주관식") {
        // 주관식: 정답 입력 확인
        if (!q.correctAnswer || !q.correctAnswer.trim()) {
          setError(`문제 ${i + 1}의 정답을 입력해주세요.`);
          return;
        }
      } else {
        // 객관식: 선택지 확인
        if (q.options.some((opt) => !opt.trim())) {
          setError(`문제 ${i + 1}의 모든 선택지를 입력해주세요.`);
          return;
        }
        if (q.options.length < 2) {
          setError(`문제 ${i + 1}는 최소 2개의 선택지가 필요합니다.`);
          return;
        }
      }
    }

    setIsSubmitting(true);

    try {
      const headers = {
        "Content-Type": "application/json",
      };

      // 게스트 사용자인 경우 헤더에 정보 추가 (Base64 인코딩)
      if (!user || !user.id) {
        const guestInfo = JSON.stringify({
          name: user?.name || "게스트",
        });
        // HTTP 헤더는 ISO-8859-1만 허용하므로 Base64로 인코딩
        headers["guest-user"] = btoa(unescape(encodeURIComponent(guestInfo)));
      }

      const apiUrl = quizToEdit ? `/api/quiz/${quizToEdit._id}` : "/api/quiz/create";
      const method = quizToEdit ? "PUT" : "POST";
      const requestBody = {
        title: title.trim(),
        description: description.trim(),
        thumbnailUrl: thumbnailUrl.trim() || null,
        defaultQuestionType: defaultQuestionType,
        questions: questions.map((q) => {
          const questionType = q.questionType || "객관식";
          const baseQuestion = {
            questionType,
            imageUrl: q.imageUrl.trim() || null,
          };
          
          if (questionType === "주관식") {
            return {
              ...baseQuestion,
              options: [], // 주관식은 선택지 없음
              correctAnswer: q.correctAnswer.trim() || "",
            };
          } else {
            // 객관식: 정답은 options[0], correctAnswer는 항상 0
            // 빈 오답 선택지 제거
            const cleanedOptions = q.options
              .map((opt) => opt.trim())
              .filter((opt, index) => index === 0 || opt.length > 0); // 정답(인덱스 0)은 항상 포함
            
            return {
              ...baseQuestion,
              options: cleanedOptions,
              correctAnswer: 0, // 정답은 항상 첫 번째 (인덱스 0)
            };
          }
        }),
        isPublic,
      };
      
      console.log("퀴즈 생성 요청:", apiUrl, { 
        method: "POST",
        headers: Object.keys(headers),
        bodySize: JSON.stringify(requestBody).length 
      });
      
      const response = await fetch(apiUrl, {
        method: method,
        headers,
        credentials: "include",
        body: JSON.stringify(requestBody),
      });

      console.log("서버 응답:", {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        url: response.url,
      });

      // 404 오류는 라우트 문제일 수 있음
      if (response.status === 404) {
        const text = await response.text().catch(() => "");
        console.error("404 응답 내용:", text.substring(0, 500));
        throw new Error(`경로를 찾을 수 없습니다. (HTTP 404) - ${apiUrl}\n응답: ${text.substring(0, 200)}`);
      }

      // Content-Type 확인 후 적절히 처리
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("서버 응답 (HTML):", text.substring(0, 500));
        throw new Error(`서버 오류가 발생했습니다. (HTTP ${response.status})`);
      }

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error || (quizToEdit ? "퀴즈 수정에 실패했습니다." : "퀴즈 생성에 실패했습니다.");
        const detailsMsg = data.details ? ` (${data.details})` : "";
        console.error(quizToEdit ? "퀴즈 수정 실패:" : "퀴즈 생성 실패:", { status: response.status, data });
        throw new Error(errorMsg + detailsMsg);
      }

      if (onSuccess) {
        onSuccess(data.quiz);
      }
      if (onClose) {
        onClose();
      }
    } catch (err) {
      console.error("퀴즈 생성 에러:", err);
      setError(err.message || "퀴즈 생성에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 맞추기아이오 퀴즈 크롤링
  const handleCrawlQuiz = async () => {
    if (!crawlUrl.trim()) {
      alert("URL을 입력해주세요.");
      return;
    }

    setIsCrawling(true);
    setError("");
    setCrawlProgress({ current: 0, total: crawlQuestionCount, answer: "" });

    // Socket.IO로 진행 상황 수신
    const progressHandler = (data) => {
      setCrawlProgress(data);
    };
    
    // Socket.IO로 완료 결과 수신
    const completeHandler = (data) => {
      if (data.success) {
        // 크롤링 결과를 폼에 채우기
        if (data.title) {
          setTitle(data.title);
        }
        if (data.description) {
          setDescription(data.description);
        }
        if (data.questions && data.questions.length > 0) {
          // 문제들을 폼 형식에 맞게 변환
          const formattedQuestions = data.questions.map((q) => ({
            questionType: q.questionType || "주관식",
            imageUrl: q.imageUrl || "",
            correctAnswerImageUrl: q.correctAnswerImageUrl || "",
            options: q.options || [],
            correctAnswer: q.correctAnswer || "",
          }));
          setQuestions(formattedQuestions);
          alert(`퀴즈를 성공적으로 가져왔습니다! (${formattedQuestions.length}개 문제)`);
          setCrawlUrl(""); // URL 초기화
        } else {
          setError("문제를 찾을 수 없습니다.");
        }
      } else {
        setError(data.error || "퀴즈를 가져오는데 실패했습니다.");
      }
      setIsCrawling(false);
      setCrawlProgress(null);
      if (socket) {
        socket.off('quizCrawlProgress', progressHandler);
        socket.off('quizCrawlComplete', completeHandler);
      }
    };
    
    if (socket) {
      socket.on('quizCrawlProgress', progressHandler);
      socket.on('quizCrawlComplete', completeHandler);
    }

    try {
      const response = await fetch("/api/quiz/crawl", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ 
          url: crawlUrl.trim(),
          questionCount: crawlQuestionCount,
          socketId: socket?.id || null
        }),
      });

      if (!response.ok) {
        let errorMessage = "퀴즈를 가져오는데 실패했습니다.";
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const data = await response.json();
            errorMessage = data.error || errorMessage;
          } else {
            const text = await response.text();
            errorMessage = `서버 오류 (${response.status}): ${text.substring(0, 100)}`;
          }
        } catch (e) {
          errorMessage = `서버 오류 (${response.status})`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      // 즉시 응답은 시작 확인 메시지일 뿐, 실제 결과는 Socket.IO로 전송됨
      console.log("크롤링 시작:", data.message);
    } catch (err) {
      console.error("퀴즈 크롤링 에러:", err);
      setError(err.message || "퀴즈를 가져오는데 실패했습니다.");
      setIsCrawling(false);
      setCrawlProgress(null);
      if (socket) {
        socket.off('quizCrawlProgress', progressHandler);
        socket.off('quizCrawlComplete', completeHandler);
      }
    }
  };

  return (
      <div 
      className="quiz-form-page"
        onPaste={(e) => {
        // 모달이 열려있으면 페이지 레벨 붙여넣기 비활성화
        if (editingQuestionIndex !== null) {
          return;
        }
          // 입력 필드가 아닌 곳에서 붙여넣기 시 이미지 업로드 영역에 붙여넣기
          const target = e.target;
          if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
            // 활성화된 이미지 업로드 영역이 있으면 해당 문제에 붙여넣기
            if (activeImageUploadIndex !== null) {
              handlePaste(e, activeImageUploadIndex);
            } else {
              // 활성화된 영역이 없으면 첫 번째 문제에 붙여넣기
              handlePaste(e, 0);
            }
          }
        }}
      >
      <div className="quiz-form-container">
        <div className="quiz-form-header">
          <h2>🧩 {showSettings ? "퀴즈 설정" : (quizToEdit ? "퀴즈 편집" : "새 퀴즈 만들기")}</h2>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {!showSettings && quizToEdit && (
              <button 
                type="button"
                className="settings-button"
                onClick={() => setShowSettings(true)}
              >
                ⚙️ 설정
              </button>
            )}
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
          </div>
        </div>

        {showSettings ? (
          // 설정 화면
          <div className="quiz-settings-form">
          {error && <div className="error-message">{error}</div>}

          <div className="form-section">
            <label>
              <span className="label-text">퀴즈 제목 *</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: K-pop 아티스트 맞추기"
                maxLength={100}
                required
              />
            </label>
          </div>

          <div className="form-section">
            <label>
              <span className="label-text">설명</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="퀴즈에 대한 간단한 설명을 입력하세요 (선택사항)"
                rows={3}
                maxLength={500}
              />
            </label>
          </div>

          {/* 맞추기아이오 퀴즈 크롤링 */}
          <div className="form-section">
            <label>
              <span className="label-text">맞추기아이오 퀴즈 가져오기</span>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px" }}>
                <input
                  type="text"
                  value={crawlUrl}
                  onChange={(e) => setCrawlUrl(e.target.value)}
                  placeholder="https://machugi.io/quiz/..."
                  style={{ flex: 1, padding: "8px", borderRadius: "4px", border: "1px solid #ddd" }}
                  disabled={isCrawling}
                />
                <select
                  value={crawlQuestionCount}
                  onChange={(e) => setCrawlQuestionCount(parseInt(e.target.value))}
                  disabled={isCrawling}
                  style={{
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid #ddd",
                    backgroundColor: "white",
                    cursor: isCrawling ? "not-allowed" : "pointer",
                  }}
                >
                  <option value={10}>10개</option>
                  <option value={20}>20개</option>
                  <option value={30}>30개</option>
                  <option value={50}>50개</option>
                </select>
                <button
                  type="button"
                  onClick={handleCrawlQuiz}
                  disabled={isCrawling || !crawlUrl.trim()}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: isCrawling ? "#ccc" : "#4CAF50",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: isCrawling ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap"
                  }}
                >
                  {isCrawling ? "가져오는 중..." : "가져오기"}
                </button>
              </div>
              {isCrawling && crawlProgress && (
                <div style={{
                  marginTop: "10px",
                  padding: "10px",
                  backgroundColor: "#f0f0f0",
                  borderRadius: "4px",
                  fontSize: "14px"
                }}>
                  <div style={{ marginBottom: "5px" }}>
                    진행 중: {crawlProgress.current} / {crawlProgress.total}
                  </div>
                  {crawlProgress.answer && (
                    <div style={{ color: "#666", fontSize: "12px", marginBottom: "5px" }}>
                      최근 답안: {crawlProgress.answer}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    {crawlProgress.imageUrl && (
                      <div>
                        <div style={{ fontSize: "12px", color: "#666", marginBottom: "3px" }}>문제 이미지:</div>
                        <img 
                          src={crawlProgress.imageUrl} 
                          alt="문제 이미지" 
                          style={{ maxWidth: "200px", maxHeight: "150px", borderRadius: "4px", border: "1px solid #ddd" }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
              <p style={{ fontSize: "0.85em", color: "#666", marginTop: "5px" }}>
                맞추기아이오 퀴즈 링크를 입력하면 자동으로 가져옵니다 (최대 {crawlQuestionCount}개 문제)
              </p>
            </label>
          </div>

            <div className="form-section">
              <label>
                <span className="label-text">썸네일 (선택)</span>
                <div 
                  className="file-upload-group"
                  onDragOver={handleDragOver}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const files = e.dataTransfer.files;
                    if (files.length > 0 && files[0].type.startsWith("image/")) {
                      uploadThumbnail(files[0]);
                    }
                  }}
                >
                  <div className="file-upload-area">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files[0];
                        if (file) {
                          uploadThumbnail(file);
                        }
                      }}
                      className="file-input"
                      id="thumbnail-input"
                    />
                    <div className="file-upload-buttons">
                      <label htmlFor="thumbnail-input" className="file-input-label">
                        📁 파일 선택
                      </label>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            if (navigator.clipboard && navigator.clipboard.read) {
                              const items = await navigator.clipboard.read();
                              for (const item of items) {
                                for (const type of item.types) {
                                  if (type.startsWith('image/')) {
                                    const blob = await item.getType(type);
                                    const file = new File([blob], `thumbnail-${Date.now()}.png`, { type: type });
                                    uploadThumbnail(file);
                                    return;
                                  }
                                }
                              }
                              alert('클립보드에서 이미지를 찾을 수 없습니다.');
                            } else {
                              alert('클립보드 접근이 지원되지 않습니다.');
                            }
                          } catch (error) {
                            console.error('클립보드 읽기 오류:', error);
                            alert('클립보드에서 이미지를 읽을 수 없습니다.');
                          }
                        }}
                        className="clipboard-button"
                      >
                        📋 클립보드에서 가져오기
                      </button>
                    </div>
                    <span className="file-upload-hint">또는 이미지를 여기에 드래그 앤 드롭</span>
                  </div>
                  {thumbnailUrl && (
                    <div className="file-preview">
                      <img src={thumbnailUrl} alt="썸네일 미리보기" className="preview-image" />
                      <button
                        type="button"
                        onClick={() => setThumbnailUrl("")}
                        className="remove-file-button"
                      >
                        ✕ 삭제
                      </button>
                    </div>
                  )}
                </div>
              </label>
            </div>

            <div className="form-section">
              <label>
                <span className="label-text">기본 답변 형식 *</span>
                <div className="question-type-buttons">
                  <button
                    type="button"
                    className={`type-button ${defaultQuestionType === "객관식" ? "active" : ""}`}
                    onClick={() => setDefaultQuestionType("객관식")}
                  >
                    객관식
                  </button>
                  <button
                    type="button"
                    className={`type-button ${defaultQuestionType === "주관식" ? "active" : ""}`}
                    onClick={() => setDefaultQuestionType("주관식")}
                  >
                    주관식
                  </button>
                </div>
                <span className="hint-text">새 문제 추가 시 기본으로 사용되는 답변 형식입니다.</span>
              </label>
            </div>

          <div className="form-section">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              <span>공개 퀴즈</span>
            </label>
          </div>

            <div className="form-actions">
              <button
                type="button"
                onClick={async () => {
                  if (quizToEdit) {
                    // 편집 모드: 설정 저장 후 설정 화면 닫기
                    await saveSettings();
                  } else {
                    // 새 퀴즈: 설정 저장 후 문제 편집 화면으로 이동
                    await saveSettings();
                  }
                }}
                className="submit-button"
                disabled={isSubmitting}
              >
                {isSubmitting ? "저장 중..." : (quizToEdit ? "저장" : "저장 후 문제 작성")}
              </button>
            </div>
          </div>
        ) : (
          // 문제 편집 화면
          <form onSubmit={handleSubmit} className="quiz-form">
            {error && <div className="error-message">{error}</div>}

          <div className="questions-section">
            <div className="questions-header">
              <h3>문제 ({questions.length}개)</h3>
            </div>

            <div className="questions-grid">
            {questions.map((question, qIndex) => (
              <div key={qIndex} className="question-card">
                  <div className="question-preview-wrapper">
                    <div className="question-preview" onClick={() => setEditingQuestionIndex(qIndex)}>
                      {question.imageUrl ? (
                        <img src={question.imageUrl} alt={`문제 ${qIndex + 1}`} className="question-preview-image" />
                      ) : (
                        <div className="question-placeholder">
                          <span>이미지를 추가하려면 클릭하세요</span>
                        </div>
                      )}
                    </div>
                    <div className="question-actions-overlay">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingQuestionIndex(qIndex);
                        }}
                        className="question-action-button edit-action"
                        title="편집"
                      >
                        ✏️
                      </button>
                  {questions.length > 1 && (
                    <button
                      type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeQuestion(qIndex);
                          }}
                          className="question-action-button delete-action"
                          title="삭제"
                    >
                          🗑️
                    </button>
                  )}
                    </div>
                  </div>
              </div>
            ))}
            {/* 문제 추가 카드 */}
            <div 
              className="question-card add-question-card" 
              onClick={addQuestion}
            >
              <div className="question-preview-wrapper">
                <div className="question-placeholder add-question-placeholder">
                  <div className="add-icon">+</div>
                  <span>문제를 추가해보세요.</span>
                </div>
              </div>
            </div>
            </div>
                </div>

          <div className="form-actions">
            <button
              type="button"
              onClick={onClose}
              className="cancel-button"
              disabled={isSubmitting}
            >
              취소
            </button>
            <button
              type="submit"
              className="submit-button"
              disabled={isSubmitting}
            >
              {isSubmitting ? (quizToEdit ? "수정 중..." : "생성 중...") : (quizToEdit ? "퀴즈 수정" : "퀴즈 만들기")}
            </button>
          </div>
        </form>
        )}
      </div>

      {/* 편집 모달 - form 밖에 위치 */}
      {editingQuestionIndex !== null && (
        <div 
          className="question-edit-modal-overlay" 
          onClick={() => setEditingQuestionIndex(null)}
        >
          <div 
            className="question-edit-modal" 
            onClick={(e) => e.stopPropagation()}
            onPaste={(e) => {
              // 모달 내부에서 paste 이벤트 발생 시 처리
              e.stopPropagation();
              handlePaste(e, editingQuestionIndex);
            }}
          >
            <div className="modal-header">
              <h3>문제 편집</h3>
              <button className="close-button" onClick={() => setEditingQuestionIndex(null)}>✕</button>
            </div>
            {questions[editingQuestionIndex] && (
              <div>
                <div className="form-section">
                  <label>
                    <span className="label-text">문제 유형 *</span>
                    <div className="question-type-buttons">
                      <button
                        type="button"
                        className={`type-button ${questions[editingQuestionIndex].questionType === "객관식" ? "active" : ""}`}
                        onClick={() => {
                          const qIndex = editingQuestionIndex;
                          const currentType = questions[qIndex].questionType;
                          if (currentType === "주관식") {
                            const updates = {
                              questionType: "객관식",
                              correctAnswer: 0,
                            };
                            if (!questions[qIndex].options || questions[qIndex].options.length === 0) {
                              updates.options = ["", ""];
                            }
                            updateQuestionMultiple(qIndex, updates);
                          } else {
                            updateQuestion(qIndex, "questionType", "객관식");
                          }
                        }}
                      >
                        객관식
                      </button>
                      <button
                        type="button"
                        className={`type-button ${questions[editingQuestionIndex].questionType === "주관식" ? "active" : ""}`}
                        onClick={() => {
                          const qIndex = editingQuestionIndex;
                          const currentType = questions[qIndex].questionType;
                          if (currentType === "객관식") {
                            updateQuestionMultiple(qIndex, {
                              questionType: "주관식",
                              correctAnswer: "",
                              options: [],
                            });
                          } else {
                            updateQuestion(qIndex, "questionType", "주관식");
                          }
                        }}
                      >
                        주관식
                      </button>
                    </div>
                  </label>
                </div>

                  <div className="form-section">
                    <label>
                      <span className="label-text">이미지 (선택)</span>
                      <div 
                        className="file-upload-group"
                        onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, editingQuestionIndex, "image")}
                      onFocus={() => setActiveImageUploadIndex(editingQuestionIndex)}
                        onBlur={() => setTimeout(() => setActiveImageUploadIndex(null), 200)}
                        tabIndex={0}
                      >
                        <div className="file-upload-area">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files[0];
                              if (file) {
                              uploadImage(file, editingQuestionIndex);
                              }
                            }}
                            className="file-input"
                          id={`image-input-edit-${editingQuestionIndex}`}
                          />
                        <div className="file-upload-buttons">
                          <label htmlFor={`image-input-edit-${editingQuestionIndex}`} className="file-input-label">
                            📁 파일 선택
                          </label>
                            <button
                              type="button"
                            onClick={() => handleClipboardPaste(editingQuestionIndex)}
                            className="clipboard-button"
                            >
                            📋 클립보드에서 가져오기
                            </button>
                          </div>
                        <span className="file-upload-hint">또는 이미지를 여기에 붙여넣기 (Ctrl+V) 또는 드래그 앤 드롭</span>
                      </div>
                      {questions[editingQuestionIndex].imageUrl && (
                          <div className="file-preview">
                          <img src={questions[editingQuestionIndex].imageUrl} alt="미리보기" className="preview-image" />
                            <button
                              type="button"
                            onClick={() => updateQuestion(editingQuestionIndex, "imageUrl", "")}
                              className="remove-file-button"
                            >
                              ✕ 삭제
                            </button>
                          </div>
                        )}
                      </div>
                    </label>
                </div>

                <div className="form-section">
                  <label>
                    <span className="label-text">정답 *</span>
                    {questions[editingQuestionIndex].questionType === "객관식" ? (
                      <input
                        type="text"
                        value={questions[editingQuestionIndex].options && questions[editingQuestionIndex].options[0] ? questions[editingQuestionIndex].options[0] : ""}
                        onChange={(e) => {
                          const qIndex = editingQuestionIndex;
                          const updatedOptions = [...(questions[qIndex].options || [""])];
                          updatedOptions[0] = e.target.value;
                          updateQuestion(qIndex, "options", updatedOptions);
                          updateQuestion(qIndex, "correctAnswer", 0);
                        }}
                        placeholder="정답을 입력하세요"
                        className="correct-answer-input"
                        required
                      />
                    ) : (
                      <input
                        type="text"
                        value={typeof questions[editingQuestionIndex].correctAnswer === 'string' ? questions[editingQuestionIndex].correctAnswer : ""}
                        onChange={(e) =>
                          updateQuestion(editingQuestionIndex, "correctAnswer", e.target.value)
                        }
                        placeholder="정답을 입력하세요"
                        className="correct-answer-input"
                        required
                      />
                    )}
                  </label>
                </div>

                <div className="form-section">
                  <label>
                    <span className="label-text">정답 이미지 (선택)</span>
                    <div 
                      className="file-upload-group"
                      onPaste={(e) => {
                        e.stopPropagation();
                        const items = e.clipboardData?.items;
                        if (!items) return;
                        for (let i = 0; i < items.length; i++) {
                          const item = items[i];
                          if (item.type.indexOf("image") !== -1) {
                            e.preventDefault();
                            const file = item.getAsFile();
                            if (file) {
                              uploadCorrectAnswerImage(file, editingQuestionIndex);
                            }
                            break;
                          }
                        }
                      }}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, editingQuestionIndex, "correctAnswerImage")}
                      onFocus={() => setActiveImageUploadIndex(editingQuestionIndex)}
                      onBlur={() => setTimeout(() => setActiveImageUploadIndex(null), 200)}
                      tabIndex={0}
                    >
                      <div className="file-upload-area">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (file) {
                              uploadCorrectAnswerImage(file, editingQuestionIndex);
                            }
                          }}
                          className="file-input"
                          id={`correct-answer-image-input-edit-${editingQuestionIndex}`}
                        />
                        <div className="file-upload-buttons">
                          <label htmlFor={`correct-answer-image-input-edit-${editingQuestionIndex}`} className="file-input-label">
                            📁 파일 선택
                          </label>
                          <button
                            type="button"
                            onClick={() => handleClipboardPasteForCorrectAnswer(editingQuestionIndex)}
                            className="clipboard-button"
                          >
                            📋 클립보드에서 가져오기
                          </button>
                        </div>
                        <span className="file-upload-hint">또는 이미지를 여기에 붙여넣기 (Ctrl+V) 또는 드래그 앤 드롭</span>
                      </div>
                      {questions[editingQuestionIndex].correctAnswerImageUrl && (
                        <div className="file-preview">
                          <img src={questions[editingQuestionIndex].correctAnswerImageUrl} alt="정답 이미지 미리보기" className="preview-image" />
                          <button
                            type="button"
                            onClick={() => updateQuestion(editingQuestionIndex, "correctAnswerImageUrl", "")}
                            className="remove-file-button"
                          >
                            ✕ 삭제
                          </button>
                        </div>
                      )}
                    </div>
                  </label>
                </div>

                {questions[editingQuestionIndex].questionType === "객관식" && (
                  <div className="options-section">
                    <div className="options-header">
                      <span className="label-text">오답 선택지 (선택사항)</span>
                      {questions[editingQuestionIndex].options && questions[editingQuestionIndex].options.length < 6 && (
                        <button
                          type="button"
                          onClick={() => addOption(editingQuestionIndex)}
                          className="add-option-button"
                        >
                          + 오답 선택지 추가
                        </button>
                      )}
                    </div>

                    {questions[editingQuestionIndex].options && questions[editingQuestionIndex].options.slice(1).map((option, oIndex) => (
                      <div key={oIndex + 1} className="option-row">
                        <input
                          type="text"
                          value={option}
                          onChange={(e) => {
                            const qIndex = editingQuestionIndex;
                            const updatedOptions = [...questions[qIndex].options];
                            updatedOptions[oIndex + 1] = e.target.value;
                            updateQuestion(qIndex, "options", updatedOptions);
                          }}
                          placeholder={`오답 선택지 ${oIndex + 1}`}
                          className="option-input"
                        />
                        {questions[editingQuestionIndex].options.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeOption(editingQuestionIndex, oIndex + 1)}
                            className="remove-option-button"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="form-actions" style={{ marginTop: "15px" }}>
            <button
              type="button"
                    onClick={() => setEditingQuestionIndex(null)}
              className="submit-button"
            >
                    완료
            </button>
          </div>
      </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default QuizForm;
