import React, { useEffect, useState } from "react";
import "./UserProfileModal.css";

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "/api";

const GAME_LABELS = {
  clickBattle: "클릭 대결",
  appleBattle: "사과 배틀",
  drawGuess: "그림 맞히기",
  quizBattle: "퀴즈 배틀",
  numberRush: "숫자 러시",
  liarGame: "라이어 게임",
  ticTacToe: "틱택토",
};

function UserProfileModal({ isOpen, onClose, user, onUserUpdated }) {
  const [profile, setProfile] = useState(null);
  const [nickname, setNickname] = useState(user?.nickname || user?.name || "");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setMessage("");
    setNickname(user?.nickname || user?.name || "");

    if (user?.provider === "guest") {
      setProfile(null);
      return;
    }

    const fetchProfile = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${SERVER_URL}/auth/profile`, {
          credentials: "include",
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || "프로필을 불러오지 못했습니다.");
        }
        setProfile(data);
      } catch (error) {
        setMessage(error.message || "프로필을 불러오지 못했습니다.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfile();
  }, [isOpen, user]);

  if (!isOpen) return null;

  const displayName = user?.nickname || user?.name || "사용자";
  const providerLabel =
    user?.provider === "google" ? "Google" : user?.provider === "kakao" ? "Kakao" : "Guest";

  const recentGames = profile?.recentGames || [];
  const gameStats = profile?.gameStats || {};

  const handleSaveNickname = async () => {
    if (user?.provider === "guest") return;
    setMessage("");
    try {
      const response = await fetch(`${SERVER_URL}/auth/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nickname }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "이름 변경에 실패했습니다.");
      }
      setProfile((prev) => (prev ? { ...prev, user: data.user } : prev));
      if (onUserUpdated) {
        onUserUpdated(data.user);
      }
      setMessage("이름이 변경되었습니다.");
    } catch (error) {
      setMessage(error.message || "이름 변경에 실패했습니다.");
    }
  };

  return (
    <div className="profile-modal-backdrop" onClick={onClose}>
      <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
        <div className="profile-modal-header">
          <h2>프로필</h2>
          <button type="button" className="profile-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="profile-identity">
          {user?.photo ? (
            <img src={user.photo} alt={displayName} className="profile-avatar" />
          ) : (
            <div className="profile-avatar-placeholder">👤</div>
          )}
          <div>
            <div className="profile-name">{displayName}</div>
            <div className="profile-provider-label">{providerLabel}</div>
          </div>
        </div>

        <div className="profile-section">
          <div className="profile-section-title">이름 변경</div>
          <div className="profile-row">
            <input
              type="text"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              disabled={user?.provider === "guest"}
              className="profile-input"
              maxLength={20}
            />
            <button
              type="button"
              onClick={handleSaveNickname}
              disabled={user?.provider === "guest" || !nickname.trim()}
              className="profile-save-button"
            >
              저장
            </button>
          </div>
          {user?.provider === "guest" && (
            <div className="profile-note">게스트는 이름 변경이 저장되지 않습니다.</div>
          )}
          {message && <div className="profile-message">{message}</div>}
        </div>

        <div className="profile-section">
          <div className="profile-section-title">최근 10판 전적</div>
          {isLoading && <div className="profile-note">불러오는 중...</div>}
          {!isLoading && recentGames.length === 0 && (
            <div className="profile-note">기록이 없습니다.</div>
          )}
          {!isLoading && recentGames.length > 0 && (
            <div className="profile-list profile-list-scroll">
              {recentGames.map((entry, index) => (
                <div key={`${entry.playedAt}-${index}`} className="profile-list-item">
                  <div className="profile-list-game">
                    {GAME_LABELS[entry.gameType] || entry.gameType}
                  </div>
                  <div className="profile-list-rank">
                    {entry.rank}위 / {entry.playersCount}명
                  </div>
                  <div className="profile-list-date">
                    {new Date(entry.playedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="profile-section">
          <div className="profile-section-title">게임별 승률</div>
          {Object.keys(gameStats).length === 0 && (
            <div className="profile-note">기록이 없습니다.</div>
          )}
          {Object.keys(gameStats).length > 0 && (
            <div className="profile-list profile-stats-grid">
              {Object.entries(gameStats).map(([gameType, stats]) => {
                const plays = stats?.plays || 0;
                const wins = stats?.wins || 0;
                const rate = plays ? Math.round((wins / plays) * 100) : 0;
                return (
                  <div key={gameType} className="profile-list-item">
                    <div className="profile-list-game">
                      {GAME_LABELS[gameType] || gameType}
                    </div>
                    <div className="profile-list-rank">
                      1위 {wins}회 / {plays}판 ({rate}%)
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default UserProfileModal;
