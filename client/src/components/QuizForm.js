import React, { useState } from "react";
import "./QuizForm.css";

function QuizForm({ onClose, onSuccess, user, quizToEdit = null }) {
  // 게스트 사용자는 퀴즈를 만들 수 없음 (방어적 체크)
  React.useEffect(() => {
    if (!user || user.provider === "guest") {
      alert("퀴즈 생성을 위해서는 로그인이 필요합니다.");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const [title, setTitle] = useState(quizToEdit?.title || "");
  const [description, setDescription] = useState(quizToEdit?.description || "");
  const [isPublic, setIsPublic] = useState(quizToEdit?.isPublic !== false);
  const [questions, setQuestions] = useState(
    quizToEdit?.questions?.length > 0
      ? quizToEdit.questions.map((q) => ({
          imageUrl: q.imageUrl || "",
          audioUrl: q.audioUrl || "",
          options: q.options || ["", ""],
          correctAnswer: q.correctAnswer || 0,
        }))
      : [
          {
            imageUrl: "",
            audioUrl: "",
            options: ["", ""],
            correctAnswer: 0,
          },
        ]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const addQuestion = () => {
    setQuestions([
      ...questions,
      {
        imageUrl: "",
        audioUrl: "",
        options: ["", ""],
        correctAnswer: 0,
      },
    ]);
  };

  const removeQuestion = (index) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((_, i) => i !== index));
    }
  };

  const updateQuestion = (index, field, value) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], [field]: value };
    setQuestions(updated);
  };

  const addOption = (questionIndex) => {
    const updated = [...questions];
    if (updated[questionIndex].options.length < 6) {
      updated[questionIndex].options.push("");
      setQuestions(updated);
    }
  };

  const removeOption = (questionIndex, optionIndex) => {
    const updated = [...questions];
    if (updated[questionIndex].options.length > 2) {
      updated[questionIndex].options = updated[questionIndex].options.filter(
        (_, i) => i !== optionIndex
      );
      // 정답 인덱스 조정
      if (updated[questionIndex].correctAnswer >= updated[questionIndex].options.length) {
        updated[questionIndex].correctAnswer = updated[questionIndex].options.length - 1;
      }
      setQuestions(updated);
    }
  };

  const updateOption = (questionIndex, optionIndex, value) => {
    const updated = [...questions];
    updated[questionIndex].options[optionIndex] = value;
    setQuestions(updated);
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
      if (q.options.some((opt) => !opt.trim())) {
        setError(`문제 ${i + 1}의 모든 선택지를 입력해주세요.`);
        return;
      }
      if (q.options.length < 2) {
        setError(`문제 ${i + 1}는 최소 2개의 선택지가 필요합니다.`);
        return;
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
        questions: questions.map((q) => ({
          imageUrl: q.imageUrl.trim() || null,
          audioUrl: q.audioUrl.trim() || null,
          options: q.options.map((opt) => opt.trim()),
          correctAnswer: q.correctAnswer,
        })),
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

  return (
    <div className="quiz-form-overlay" onClick={onClose}>
      <div className="quiz-form-container" onClick={(e) => e.stopPropagation()}>
        <div className="quiz-form-header">
          <h2>🧩 {quizToEdit ? "퀴즈 편집" : "새 퀴즈 만들기"}</h2>
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="quiz-form">
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

          <div className="questions-section">
            <div className="questions-header">
              <h3>문제 ({questions.length}개)</h3>
              <button
                type="button"
                onClick={addQuestion}
                className="add-question-button"
              >
                + 문제 추가
              </button>
            </div>

            {questions.map((question, qIndex) => (
              <div key={qIndex} className="question-card">
                <div className="question-header">
                  <h4>문제 {qIndex + 1}</h4>
                  {questions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeQuestion(qIndex)}
                      className="remove-question-button"
                    >
                      삭제
                    </button>
                  )}
                </div>

                <div className="form-row">
                  <div className="form-section">
                    <label>
                      <span className="label-text">이미지 URL (선택)</span>
                      <input
                        type="url"
                        value={question.imageUrl}
                        onChange={(e) =>
                          updateQuestion(qIndex, "imageUrl", e.target.value)
                        }
                        placeholder="https://example.com/image.jpg"
                      />
                    </label>
                  </div>

                  <div className="form-section">
                    <label>
                      <span className="label-text">오디오 URL (선택)</span>
                      <input
                        type="url"
                        value={question.audioUrl}
                        onChange={(e) =>
                          updateQuestion(qIndex, "audioUrl", e.target.value)
                        }
                        placeholder="https://example.com/audio.mp3"
                      />
                    </label>
                  </div>
                </div>

                <div className="options-section">
                  <div className="options-header">
                    <span className="label-text">선택지 *</span>
                    {question.options.length < 6 && (
                      <button
                        type="button"
                        onClick={() => addOption(qIndex)}
                        className="add-option-button"
                      >
                        + 선택지 추가
                      </button>
                    )}
                  </div>

                  {question.options.map((option, oIndex) => (
                    <div key={oIndex} className="option-row">
                      <input
                        type="radio"
                        name={`correct-${qIndex}`}
                        checked={question.correctAnswer === oIndex}
                        onChange={() =>
                          updateQuestion(qIndex, "correctAnswer", oIndex)
                        }
                        className="correct-radio"
                      />
                      <input
                        type="text"
                        value={option}
                        onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                        placeholder={`선택지 ${oIndex + 1}`}
                        className="option-input"
                        required
                      />
                      {question.options.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeOption(qIndex, oIndex)}
                          className="remove-option-button"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
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
      </div>
    </div>
  );
}

export default QuizForm;
