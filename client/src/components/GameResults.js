import React from "react";
import "./GameScoreboard.css";

/**
 * 게임 결과 화면 컴포넌트
 * @param {Object} props
 * @param {Array} props.results - 결과 배열 [{ id, name, photo, score, teamId, teamScore, isWinner }]
 * @param {Array} props.teams - 팀 목록 (팀전 모드일 때)
 * @param {string} props.myPlayerId - 내 플레이어 ID
 * @param {boolean} props.teamMode - 팀전 모드 여부
 * @param {string} props.scoreUnit - 점수 단위 ("회", "칸" 등)
 */
function GameResults({
  results = [],
  teams = [],
  myPlayerId = null,
  teamMode = false,
  scoreUnit = "점",
}) {
  // 팀전 모드
  if (
    teamMode &&
    results.length > 0 &&
    results[0]?.teamScore !== undefined &&
    teams &&
    teams.length > 0
  ) {
    const teamsWithPlayers = teams
      .map((team) => {
        const teamResult = results.find((r) => r.teamId === team.id);
        const teamScore = teamResult?.teamScore || 0;
        const isWinner = results.some(
          (r) => r.teamId === team.id && r.isWinner
        );
        return {
          ...team,
          score: teamScore,
          isWinner,
          players: results
            .filter((r) => r.teamId === team.id)
            .sort((a, b) => b.score - a.score),
        };
      })
      .sort((a, b) => b.score - a.score);

    // 최고 점수 계산 (그래프용)
    const maxScore = Math.max(
      ...teamsWithPlayers.map((team) =>
        Math.max(team.score, ...team.players.map((p) => p.score || 0))
      ),
      1
    );

    return (
      <div className="results-container">
        <h3>결과</h3>
        <div className="results-team-list">
          {teamsWithPlayers.map((team, teamIndex) => (
            <div
              key={team.id}
              className={`results-team-group ${team.isWinner ? "winner" : ""}`}
            >
              <div className="results-team-header">
                <div className="results-team-rank">
                  {teamIndex === 0 && team.isWinner ? "👑" : teamIndex + 1}
                </div>
                <div
                  className="results-team-color"
                  style={{ backgroundColor: team.color }}
                />
                <span className="results-team-name">
                  {team.name}
                  {team.isWinner && <span className="winner-badge">승리팀!</span>}
                </span>
                <span className="results-team-value">
                  ({team.score}{scoreUnit})
                </span>
              </div>
              <div className="results-team-players">
                {team.players.map((player) => {
                  const percentage =
                    maxScore > 0
                      ? ((player.score || 0) / maxScore) * 100
                      : 0;
                  return (
                    <div
                      key={player.id}
                      className={`results-player-item ${
                        player.isWinner ? "winner" : ""
                      } ${player.id === myPlayerId ? "me" : ""}`}
                    >
                      {player.photo && (
                        <img
                          src={player.photo}
                          alt={player.name}
                          className="results-player-avatar"
                        />
                      )}
                      <div className="results-player-info">
                        <div className="results-player-name">
                          {player.name}
                          {player.isWinner && (
                            <span className="winner-badge">승자!</span>
                          )}
                          {player.id === myPlayerId && (
                            <span className="me-badge">나</span>
                          )}
                        </div>
                        <div className="results-player-score-bar-container">
                          <div
                            className="results-player-score-bar"
                            style={{
                              width: `${percentage}%`,
                              backgroundColor: team.color,
                            }}
                          />
                          <span className="results-player-score-value">
                            {player.score || 0}{scoreUnit}
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
  const sortedResults = [...results].sort((a, b) => b.score - a.score);
  const maxScore = Math.max(...results.map((r) => r.score || 0), 1);

  return (
    <div className="results-container">
      <h3>순위</h3>
      <div className="results-player-list">
        {sortedResults.map((result, index) => {
          const percentage =
            maxScore > 0 ? ((result.score || 0) / maxScore) * 100 : 0;
          return (
            <div
              key={result.id}
              className={`results-player-item ${result.isWinner ? "winner" : ""} ${
                result.id === myPlayerId ? "me" : ""
              }`}
            >
              <div className="results-player-rank">
                {index === 0 && result.isWinner ? "👑" : index + 1}
              </div>
              {result.photo && (
                <img
                  src={result.photo}
                  alt={result.name}
                  className="results-player-avatar"
                />
              )}
              <div className="results-player-info">
                <div className="results-player-name">
                  {result.name}
                  {result.isWinner && <span className="winner-badge">승자!</span>}
                  {result.id === myPlayerId && <span className="me-badge">나</span>}
                </div>
                <div className="results-player-score-bar-container">
                  <div
                    className="results-player-score-bar"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: "#ffc107",
                    }}
                  />
                  <span className="results-player-score-value">
                    {result.score || 0}{scoreUnit}
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

export default GameResults;
