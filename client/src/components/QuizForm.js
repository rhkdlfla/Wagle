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
  const [activeImageUploadIndex, setActiveImageUploadIndex] = useState(null); // 현재 이미지 업로드 중인 문제 인덱스
  const [description, setDescription] = useState(quizToEdit?.description || "");
  const [isPublic, setIsPublic] = useState(quizToEdit?.isPublic !== false);
  const [questions, setQuestions] = useState(
    quizToEdit?.questions?.length > 0
      ? quizToEdit.questions.map((q) => ({
          questionType: q.questionType || "객관식",
          imageUrl: q.imageUrl || "",
          audioUrl: q.audioUrl || "",
          options: q.options || ["", ""],
          correctAnswer: q.correctAnswer || (q.questionType === "주관식" ? "" : 0),
        }))
      : [
          {
            questionType: "객관식",
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
        questionType: "객관식",
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

  // 이미지 업로드 함수
  const uploadImage = async (file, questionIndex) => {
    const formData = new FormData();
    formData.append("image", file);

    try {
      setActiveImageUploadIndex(questionIndex);
      const response = await fetch("/api/upload/image", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        updateQuestion(questionIndex, "imageUrl", data.url);
      } else {
        alert(data.error || "이미지 업로드에 실패했습니다.");
      }
    } catch (error) {
      console.error("이미지 업로드 오류:", error);
      alert("이미지 업로드에 실패했습니다.");
    } finally {
      setActiveImageUploadIndex(null);
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
      if (type === "image" && file.type.startsWith("image/")) {
        uploadImage(file, questionIndex);
      } else if (type === "audio" && file.type.startsWith("audio/")) {
        // 오디오 업로드
        const formData = new FormData();
        formData.append("audio", file);

        fetch("/api/upload/audio", {
          method: "POST",
          credentials: "include",
          body: formData,
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) {
              updateQuestion(questionIndex, "audioUrl", data.url);
            } else {
              alert(data.error || "오디오 업로드에 실패했습니다.");
            }
          })
          .catch((error) => {
            console.error("오디오 업로드 오류:", error);
            alert("오디오 업로드에 실패했습니다.");
          });
      }
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
        questions: questions.map((q) => {
          const questionType = q.questionType || "객관식";
          const baseQuestion = {
            questionType,
            imageUrl: q.imageUrl.trim() || null,
            audioUrl: q.audioUrl.trim() || null,
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

  return (
    <div className="quiz-form-overlay" onClick={onClose}>
      <div 
        className="quiz-form-container" 
        onClick={(e) => e.stopPropagation()}
        onPaste={(e) => {
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

                <div className="form-section">
                  <label>
                    <span className="label-text">문제 유형 *</span>
                    <div className="question-type-buttons">
                      <button
                        type="button"
                        className={`type-button ${question.questionType === "객관식" ? "active" : ""}`}
                        onClick={() => {
                          const currentType = question.questionType;
                          // 주관식에서 객관식으로 변경 시 초기화
                          if (currentType === "주관식") {
                            const updates = {
                              questionType: "객관식",
                              correctAnswer: 0,
                            };
                            // 객관식 기본 선택지 복원
                            if (!question.options || question.options.length === 0) {
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
                        className={`type-button ${question.questionType === "주관식" ? "active" : ""}`}
                        onClick={() => {
                          const currentType = question.questionType;
                          // 객관식에서 주관식으로 변경 시 초기화
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

                <div className="form-row">
                  <div className="form-section">
                    <label>
                      <span className="label-text">이미지 (선택)</span>
                      <div 
                        className="file-upload-group"
                        onPaste={(e) => handlePaste(e, qIndex)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, qIndex, "image")}
                        onFocus={() => setActiveImageUploadIndex(qIndex)}
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
                                uploadImage(file, qIndex);
                              }
                            }}
                            className="file-input"
                            id={`image-input-${qIndex}`}
                          />
                          <label htmlFor={`image-input-${qIndex}`} className="file-input-label">
                            📁 파일 선택
                          </label>
                          <span className="file-upload-hint">또는 이미지를 여기에 붙여넣기 (Ctrl+V) 또는 드래그 앤 드롭</span>
                        </div>
                        {question.imageUrl && (
                          <div className="file-preview">
                            <img src={question.imageUrl} alt="미리보기" className="preview-image" />
                            <button
                              type="button"
                              onClick={() => updateQuestion(qIndex, "imageUrl", "")}
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
                      <span className="label-text">오디오 (선택)</span>
                      <div 
                        className="file-upload-group"
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, qIndex, "audio")}
                      >
                        <div className="file-upload-area">
                          <input
                            type="file"
                            accept="audio/*"
                            onChange={async (e) => {
                              const file = e.target.files[0];
                              if (!file) return;

                              const formData = new FormData();
                              formData.append("audio", file);

                              try {
                                const response = await fetch("/api/upload/audio", {
                                  method: "POST",
                                  credentials: "include",
                                  body: formData,
                                });

                                const data = await response.json();
                                if (data.success) {
                                  updateQuestion(qIndex, "audioUrl", data.url);
                                } else {
                                  alert(data.error || "오디오 업로드에 실패했습니다.");
                                }
                              } catch (error) {
                                console.error("오디오 업로드 오류:", error);
                                alert("오디오 업로드에 실패했습니다.");
                              }
                            }}
                            className="file-input"
                            id={`audio-input-${qIndex}`}
                          />
                          <label htmlFor={`audio-input-${qIndex}`} className="file-input-label">
                            📁 파일 선택
                          </label>
                          <span className="file-upload-hint">또는 파일을 여기에 드래그 앤 드롭</span>
                        </div>
                        {question.audioUrl && (
                          <div className="file-preview">
                            <audio src={question.audioUrl} controls className="preview-audio" />
                            <button
                              type="button"
                              onClick={() => updateQuestion(qIndex, "audioUrl", "")}
                              className="remove-file-button"
                            >
                              ✕ 삭제
                            </button>
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                </div>

                <div className="form-section">
                  <label>
                    <span className="label-text">정답 *</span>
                    {question.questionType === "객관식" ? (
                      <input
                        type="text"
                        value={question.options && question.options[0] ? question.options[0] : ""}
                        onChange={(e) => {
                          // 정답은 options[0]에 저장
                          const updatedOptions = [...(question.options || [""])];
                          updatedOptions[0] = e.target.value;
                          updateQuestion(qIndex, "options", updatedOptions);
                          // correctAnswer는 항상 0 (정답이 첫 번째)
                          updateQuestion(qIndex, "correctAnswer", 0);
                        }}
                        placeholder="정답을 입력하세요"
                        className="correct-answer-input"
                        required
                      />
                    ) : (
                      <input
                        type="text"
                        value={typeof question.correctAnswer === 'string' ? question.correctAnswer : ""}
                        onChange={(e) =>
                          updateQuestion(qIndex, "correctAnswer", e.target.value)
                        }
                        placeholder="정답을 입력하세요"
                        className="correct-answer-input"
                        required
                      />
                    )}
                  </label>
                </div>

                {question.questionType === "객관식" && (
                  <div className="options-section">
                    <div className="options-header">
                      <span className="label-text">오답 선택지 (선택사항)</span>
                      {question.options && question.options.length < 6 && (
                        <button
                          type="button"
                          onClick={() => addOption(qIndex)}
                          className="add-option-button"
                        >
                          + 오답 선택지 추가
                        </button>
                      )}
                    </div>

                    {question.options && question.options.slice(1).map((option, oIndex) => (
                      <div key={oIndex + 1} className="option-row">
                        <input
                          type="text"
                          value={option}
                          onChange={(e) => {
                            const updatedOptions = [...question.options];
                            updatedOptions[oIndex + 1] = e.target.value;
                            updateQuestion(qIndex, "options", updatedOptions);
                          }}
                          placeholder={`오답 선택지 ${oIndex + 1}`}
                          className="option-input"
                        />
                        {question.options.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeOption(qIndex, oIndex + 1)}
                            className="remove-option-button"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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
