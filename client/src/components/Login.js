import React, { useEffect } from "react";
import "./Login.css";

function Login({ onLoginSuccess }) {
  const SERVER_URL = process.env.REACT_APP_SERVER_URL || "/api";
  const clearLoginErrorShown = (errorKey) => {
    sessionStorage.removeItem(`loginErrorShown:${errorKey}`);
  };
  useEffect(() => {
    // URL에서 인증 성공 여부 확인
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get("error");
    const reason = urlParams.get("reason");
    if (error) {
      const shownKey = `loginErrorShown:${error}`;
      const hasShown = sessionStorage.getItem(shownKey);
      if (error === "kakao_config") {
        if (!hasShown) alert("카카오 로그인이 설정되지 않았습니다. 서버 관리자에게 문의하세요.");
      } else if (error === "kakao_timeout") {
        if (!hasShown) alert("카카오 로그인 시간이 초과되었습니다. 다시 시도해주세요.");
      } else if (error === "kakao") {
        if (!hasShown) {
          const reasonText = reason ? ` (사유: ${reason})` : "";
          alert(`카카오 로그인에 실패했습니다. 다시 시도해주세요.${reasonText}`);
        }
      } else {
        if (!hasShown) alert("로그인에 실패했습니다. 다시 시도해주세요.");
      }
      sessionStorage.setItem(shownKey, "true");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleGoogleLogin = () => {
    clearLoginErrorShown("google");
    window.location.href = `${SERVER_URL}/auth/google`;
  };

  const handleKakaoLogin = () => {
    clearLoginErrorShown("kakao");
    window.location.href = `${SERVER_URL}/auth/kakao`;
  };

  const handleGuestLogin = () => {
    // 로컬 스토리지에서 기존 게스트 정보 확인
    let guestInfo = localStorage.getItem("guestUser");
    
    if (!guestInfo) {
      // 새로운 게스트 정보 생성
      const guestId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const guestNames = [
        "게스트1", "게스트2", "게스트3", "게스트4", "게스트5",
        "익명의플레이어", "비회원유저", "손님", "방문자", "게이머"
      ];
      const randomName = guestNames[Math.floor(Math.random() * guestNames.length)];
      const randomNumber = Math.floor(Math.random() * 1000);
      
      guestInfo = {
        id: guestId,
        provider: "guest",
        name: `${randomName}${randomNumber}`,
        email: null,
        photo: null,
      };
      
      localStorage.setItem("guestUser", JSON.stringify(guestInfo));
    } else {
      guestInfo = JSON.parse(guestInfo);
    }
    
    // 게스트 로그인 성공 콜백 호출
    if (onLoginSuccess) {
      onLoginSuccess(guestInfo);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <h1>🎮 Wagle에 오신 것을 환영합니다!</h1>
          <p>로그인하여 게임을 시작하세요</p>
        </div>

        <div className="login-buttons">
          <button onClick={handleGoogleLogin} className="login-button google">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            구글로 로그인
          </button>

          <button onClick={handleKakaoLogin} className="login-button kakao">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 3C6.48 3 2 6.13 2 10c0 2.38 1.19 4.47 3 5.74V21l3.5-1.91c.5.13 1.03.21 1.5.21 5.52 0 10-3.13 10-7s-4.48-7-10-7z"
                fill="#3C1E1E"
              />
            </svg>
            카카오로 로그인
          </button>

          <div className="divider">
            <span>또는</span>
          </div>

          <button onClick={handleGuestLogin} className="login-button guest">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
                fill="currentColor"
              />
            </svg>
            게스트로 시작하기
          </button>
        </div>

        <div className="login-footer">
          <p>로그인하면 더 나은 게임 경험을 제공받을 수 있습니다.</p>
          <p className="guest-note">게스트로 시작하면 로컬에 저장되며, 브라우저를 닫으면 정보가 유지됩니다.</p>
        </div>
      </div>
    </div>
  );
}

export default Login;
