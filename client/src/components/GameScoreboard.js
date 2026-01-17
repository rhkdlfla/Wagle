import React from "react";
import "./GameScoreboard.css";

/**
 * 게임 중 스코어 보드 컴포넌트
 * @param {Object} props
 * @param {Array} props.teams - 팀 목록 (팀전 모드일 때)
 * @param {Object} props.teamScores - 팀별 점수 { teamId: score }
 * @param {Array} props.players - 플레이어 목록
 * @param {Object} props.scores - 플레이어별 점수 { playerId: score } 또는 클릭 수 { playerId: clicks }
 * @param {string} props.myPlayerId - 내 플레이어 ID
 * @param {boolean} props.teamMode - 팀전 모드 여부
 * @param {string} props.scoreUnit - 점수 단위 ("회", "칸" 등)
 * @param {Function} props.getPlayerScore - 플레이어 점수 가져오기 함수 (선택적)
 */
function GameScoreboard({
  teams = [],
  teamScores = null,
  players = [],
  scores = {},
  myPlayerId = null,
  teamMode = false,
  scoreUnit = "점",
  getPlayerScore = null,
}) {
  // 팀전 모드
  if (teamMode && teams && teams.length > 0) {
    const teamsWithPlayers = teams
      .map((team) => ({
        ...team,
        score: teamScores && teamScores[team.id] ? teamScores[team.id] : 0,
        players: players
          .map((player) => {
            const score = getPlayerScore
              ? getPlayerScore(player.id)
              : scores[player.id] || 0;
            return { ...player, score };
          })
          .filter((player) => player.teamId === team.id)
          .sort((a, b) => b.score - a.score),
      }))
      .sort((a, b) => b.score - a.score);

    // 최고 점수 계산 (그래프용)
    const maxScore = Math.max(
      ...teamsWithPlayers.map((team) =>
        Math.max(team.score, ...team.players.map((p) => p.score))
      ),
      1
    );

    return (
      <div className="game-scoreboard">
        <h3>점수</h3>
        <div className="scoreboard-team-list">
          {teamsWithPlayers.map((team) => (
            <div key={team.id} className="scoreboard-team-group">
              <div className="scoreboard-team-header">
                <div
                  className="scoreboard-team-color"
                  style={{ backgroundColor: team.color }}
                />
                <span className="scoreboard-team-name">{team.name}</span>
                <span className="scoreboard-team-value">({team.score}{scoreUnit})</span>
              </div>
              <div className="scoreboard-team-players">
                {team.players.map((player) => {
                  const playerPercentage = maxScore > 0 ? (player.score / maxScore) * 100 : 0;
                  return (
                    <div
                      key={player.id}
                      className={`scoreboard-player-item ${
                        player.id === myPlayerId ? "me" : ""
                      }`}
                    >
                      {player.photo && (
                        <img
                          src={player.photo}
                          alt={player.name}
                          className="scoreboard-player-avatar"
                        />
                      )}
                      <div className="scoreboard-player-info">
                        <div className="scoreboard-player-name">
                          {player.name}
                          {player.id === myPlayerId && <span className="me-badge">나</span>}
                        </div>
                        <div className="scoreboard-player-score-bar-container">
                          <div
                            className="scoreboard-player-score-bar"
                            style={{
                              width: `${playerPercentage}%`,
                              backgroundColor: team.color,
                            }}
                          />
                          <span className="scoreboard-player-score-value">
                            {player.score}{scoreUnit}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 개인전 모드
  const playersData = players
    .map((player) => {
      const score = getPlayerScore
        ? getPlayerScore(player.id)
        : scores[player.id] || 0;
      return { ...player, score };
    })
    .sort((a, b) => b.score - a.score);

  const maxScore = Math.max(...playersData.map((p) => p.score), 1);

  return (
    <div className="game-scoreboard">
      <h3>순위</h3>
      <div className="scoreboard-player-list">
        {playersData.map((player, index) => {
          const percentage = maxScore > 0 ? (player.score / maxScore) * 100 : 0;
          return (
            <div
              key={player.id}
              className={`scoreboard-player-item ${
                player.id === myPlayerId ? "me" : ""
              } ${index === 0 ? "first" : ""}`}
            >
              <div className="scoreboard-player-rank">{index + 1}</div>
              {player.photo && (
                <img
                  src={player.photo}
                  alt={player.name}
                  className="scoreboard-player-avatar"
                />
              )}
              <div className="scoreboard-player-info">
                <div className="scoreboard-player-name">
                  {player.name}
                  {player.id === myPlayerId && <span className="me-badge">나</span>}
                </div>
                <div className="scoreboard-player-score-bar-container">
                  <div
                    className="scoreboard-player-score-bar"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: "#ffc107",
                    }}
                  />
                  <span className="scoreboard-player-score-value">
                    {player.score}{scoreUnit}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default GameScoreboard;
