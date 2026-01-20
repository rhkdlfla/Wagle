import React, { useEffect, useState, useRef } from "react";
import GameScoreboard from "./GameScoreboard";
import GameResults from "./GameResults";
import "./TypingRacing.css";

function TypingRacing({ socket, room, onBackToLobby }) {
  const [gameState, setGameState] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [results, setResults] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [attackWarning, setAttackWarning] = useState(null); // 공격 경고
  const [countdownEndTime, setCountdownEndTime] = useState(null); // 게임 종료 카운트다운
  const canvasRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const isHost = room?.players?.[0]?.id === socket.id;

  // 8자 루프 경로 계산 (Lemniscate of Bernoulli)
  const getEightLoopPosition = (progress, width, height) => {
    // progress는 0~1 사이
    const t = progress * 2 * Math.PI;
    const scale = Math.min(width, height) * 0.3;
    const x = scale * Math.cos(t) / (1 + Math.sin(t) * Math.sin(t));
    const y = scale * Math.sin(t) * Math.cos(t) / (1 + Math.sin(t) * Math.sin(t));
    return {
      x: x + width / 2,
      y: y + height / 2
    };
  };

  // 미니맵 그리기
  const drawMinimap = () => {
    const canvas = canvasRef.current;
    if (!canvas || !gameState) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // 캔버스 초기화
    ctx.clearRect(0, 0, width, height);

    // 8자 루프 경로 그리기
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let t = 0; t <= 2 * Math.PI; t += 0.1) {
      const pos = getEightLoopPosition(t / (2 * Math.PI), width, height);
      if (t === 0) {
        ctx.moveTo(pos.x, pos.y);
      } else {
        ctx.lineTo(pos.x, pos.y);
      }
    }
    ctx.stroke();

    // 아이템 박스 표시 (더 눈에 띄게)
    if (gameState.itemBoxes) {
      gameState.itemBoxes.forEach((boxPos) => {
        const pos = getEightLoopPosition(boxPos, width, height);
        
        // 외곽 글로우 효과
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 15;
        
        // 아이템 박스 배경 (큰 박스)
        ctx.fillStyle = '#fbbf24';
        ctx.strokeStyle = '#ff8c00';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.rect(pos.x - 12, pos.y - 12, 24, 24);
        ctx.fill();
        ctx.stroke();
        
        // 아이템 아이콘 (🎁)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 0;
        ctx.fillText('🎁', pos.x, pos.y);
      });
    }

    // 플레이어 위치 표시
    if (gameState.playerProgress && room?.players) {
      room.players.forEach((player, index) => {
        const progress = gameState.playerProgress[player.id] || 0;
        const pos = getEightLoopPosition(progress, width, height);
        
        // 플레이어 색상
        const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
        const color = colors[index % colors.length];
        
        ctx.fillStyle = player.id === socket.id ? '#ffffff' : color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 8, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // 플레이어 이름 표시
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.name.substring(0, 3), pos.x, pos.y - 12);
      });
    }
  };

  // 텍스트를 왼쪽으로 이동시키기 위한 ref
  const textDisplayRef = useRef(null);

  useEffect(() => {
    // 미니맵 그리기
    if (gameState) {
      drawMinimap();
    }
  }, [gameState]);

  useEffect(() => {
    // 게임 시작 수신
    const handleGameStarted = ({ gameState: gs, room: gameRoom }) => {
      if (!gs || gs.gameType !== "typingRacing") return;
      
      setIsActive(true);
      setGameState(null);
      setResults(null);
      
      // 타이머 시작
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - gs.startTime;
        const remaining = Math.max(0, (gs.duration || 120000) - elapsed);
        setTimeRemaining(remaining);
        
        if (remaining <= 0) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }, 100);
    };
    
    socket.on("gameStarted", handleGameStarted);

    // 공격 알림 수신
    const handleAttackIncoming = ({ sourceName, effectType, remainingSeconds }) => {
      // 공격 알림을 상태로 저장하여 표시
      setAttackWarning({ sourceName, effectType, remainingSeconds });
      
      // 남은 시간이 있으면 타이머 시작
      if (remainingSeconds > 0) {
        let countdown = remainingSeconds;
        const warningInterval = setInterval(() => {
          countdown--;
          setAttackWarning(prev => prev ? { ...prev, remainingSeconds: countdown } : null);
          
          if (countdown <= 0) {
            clearInterval(warningInterval);
            // 발동 후 1초 뒤에 알림 제거
            setTimeout(() => setAttackWarning(null), 1000);
          }
        }, 1000);
      } else {
        // 이미 발동된 경우 3초 후 제거
        setTimeout(() => setAttackWarning(null), 3000);
      }
    };
    
    socket.on("attackIncoming", handleAttackIncoming);
    
    // 카운트다운 시작 수신
    const handleCountdownStarted = ({ endTime }) => {
      setCountdownEndTime(endTime);
    };
    
    socket.on("countdownStarted", handleCountdownStarted);

    // 게임 업데이트 수신
    socket.on("typingRacingUpdate", (data) => {
      setGameState(data);
      // countdownEndTime이 gameState에 포함되어 있으면 업데이트
      if (data.countdownEndTime) {
        setCountdownEndTime(data.countdownEndTime);
      }
    });

    // 아이템 획득 알림
    socket.on("itemReceived", ({ item }) => {
      console.log("아이템 획득:", item);
    });

    // 플레이어 완주 알림
    socket.on("playerFinished", ({ playerId, playerName, rank }) => {
      console.log(`${playerName}이(가) ${rank}등으로 완주했습니다!`);
    });

    // 게임 종료 수신
    socket.on("gameEnded", ({ results: gameResults }) => {
      setIsActive(false);
      setResults(gameResults);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    });

    return () => {
      socket.off("gameStarted", handleGameStarted);
      socket.off("typingRacingUpdate");
      socket.off("itemReceived");
      socket.off("playerFinished");
      socket.off("gameEnded");
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [socket]);

  // 한글 입력을 위한 숨겨진 input 필드
  const hiddenInputRef = useRef(null);
  const [isComposing, setIsComposing] = useState(false);
  const [composingText, setComposingText] = useState(''); // 조합 중인 텍스트
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [countdownRemaining, setCountdownRemaining] = useState(null);
  
  // 현재 시간 실시간 업데이트 (효과 타이머용)
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 100); // 0.1초마다 업데이트
    
    return () => clearInterval(interval);
  }, []);
  
  // 카운트다운 계산 (실시간 업데이트)
  useEffect(() => {
    if (!countdownEndTime) {
      setCountdownRemaining(null);
      return;
    }
    
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((countdownEndTime - Date.now()) / 1000));
      setCountdownRemaining(remaining);
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 100);
    
    return () => clearInterval(interval);
  }, [countdownEndTime]);

  // 키보드 입력 처리 (한글 지원)
  useEffect(() => {
    if (!isActive || !gameState || results) return;

    const hiddenInput = hiddenInputRef.current;
    if (!hiddenInput) return;

    // 포커스 유지
    hiddenInput.focus();

    const handleCompositionStart = (e) => {
      setIsComposing(true);
      setComposingText('');
    };

    const handleCompositionUpdate = (e) => {
      // 조합 중인 텍스트 업데이트
      setComposingText(e.data || '');
    };

    const handleCompositionEnd = (e) => {
      setIsComposing(false);
      setComposingText('');
      const text = e.data || hiddenInput.value;
      if (text && text.length > 0) {
        // 마지막 글자만 사용
        const char = text[text.length - 1];
        handleTyping(char);
        // 입력 초기화
        hiddenInput.value = '';
      }
    };

    const handleInput = (e) => {
      // 조합 중이 아닐 때만 처리
      if (!isComposing) {
        const text = hiddenInput.value;
        if (text && text.length > 0) {
          // 마지막 글자만 사용
          const char = text[text.length - 1];
          handleTyping(char);
          // 입력 초기화
          hiddenInput.value = '';
        }
      }
    };

    const handleKeyDown = (e) => {
      // 백스페이스는 무시
      if (e.key === 'Backspace') {
        e.preventDefault();
        hiddenInput.value = '';
        return;
      }

      // 특수 키는 무시
      if (e.key.length > 1 && !['Enter', 'Space'].includes(e.key)) {
        return;
      }

      // 영문/숫자/특수문자는 바로 처리
      if (e.key.length === 1 && !isComposing) {
        const char = e.key;
        handleTyping(char);
        hiddenInput.value = '';
        e.preventDefault();
      }
    };

    const handleTyping = (char) => {
      // 항상 타이핑 이벤트 전송 (서버에서 아이템 단어 체크)
      socket.emit("gameAction", {
        roomId: room.id,
        action: "typing",
        data: { char }
      });
    };

    hiddenInput.addEventListener('compositionstart', handleCompositionStart);
    hiddenInput.addEventListener('compositionupdate', handleCompositionUpdate);
    hiddenInput.addEventListener('compositionend', handleCompositionEnd);
    hiddenInput.addEventListener('input', handleInput);
    hiddenInput.addEventListener('keydown', handleKeyDown);
    
    return () => {
      hiddenInput.removeEventListener('compositionstart', handleCompositionStart);
      hiddenInput.removeEventListener('compositionupdate', handleCompositionUpdate);
      hiddenInput.removeEventListener('compositionend', handleCompositionEnd);
      hiddenInput.removeEventListener('input', handleInput);
      hiddenInput.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, gameState, results, socket, room, isComposing]);

  // 아이템 활성화
  const activateItem = (itemType) => {
    socket.emit("gameAction", {
      roomId: room.id,
      action: "activateItem",
      data: { itemType }
    });
  };

  const handleEndGame = () => {
    if (isHost) {
      socket.emit("endGame", { roomId: room.id });
    }
  };

  const handleLeaveGame = () => {
    socket.emit("leaveRoom", { roomId: room.id });
    onBackToLobby();
  };

  if (results) {
    return (
      <div className="typing-racing-container">
        <div className="game-header">
          <div className="game-header-content">
            <div>
              <h1>⌨️ 타이핑 레이싱</h1>
              <p>게임 결과</p>
            </div>
            <div className="game-header-actions">
              <button onClick={onBackToLobby} className="leave-game-button">
                🚪 로비로
              </button>
            </div>
          </div>
        </div>
        <GameResults 
          results={results} 
          teams={room.teams}
          myPlayerId={socket.id}
          teamMode={room.teamMode}
        />
      </div>
    );
  }

  if (!isActive || !gameState) {
    return (
      <div className="typing-racing-container">
        <div className="waiting-message">게임 시작을 기다리는 중...</div>
      </div>
    );
  }

  const myProgress = gameState.playerProgress?.[socket.id] || 0;
  const myPosition = gameState.playerPosition?.[socket.id] || 0;
  const myItems = gameState.playerItems?.[socket.id] || [];
  const myItemTyping = gameState.playerItemTyping?.[socket.id] || {};
  const myItemWordMap = gameState.playerItemWordMap?.[socket.id] || {};
  const itemWords = gameState.itemWords || {};
  
  // 현재 적용 중인 효과 (실시간 업데이트)
  const myEffects = gameState.effects?.[socket.id] || [];
  const activeEffects = myEffects.filter(effect => {
    return effect.endTime && currentTime < effect.endTime;
  }).map(effect => ({
    type: effect.type,
    remainingTime: Math.max(0, Math.ceil((effect.endTime - currentTime) / 1000))
  }));
  
  // 현재 입력 중인 아이템 찾기 (입력 진행도가 있는 아이템)
  // 서버에서는 "itemTyping_${itemId}" 형식으로 저장
  const activeItemTyping = Object.entries(myItemTyping).find(([key, typed]) => {
    if (!typed || typed.length === 0) return false;
    // "itemTyping_"로 시작하는 키인지 확인
    return key.startsWith('itemTyping_');
  });
  const activeItemId = activeItemTyping ? activeItemTyping[0].replace('itemTyping_', '') : null;
  const activeItemWord = activeItemId ? itemWords[activeItemId] : null;
  const itemTyping = activeItemTyping ? activeItemTyping[1] : '';
  
  // 활성 아이템 타입 찾기 (아이템 ID로부터)
  let activeItemType = null;
  if (activeItemId) {
    // myItemWordMap에서 해당 itemId를 가진 아이템 찾기
    for (const [mapKey, itemId] of Object.entries(myItemWordMap)) {
      if (itemId === activeItemId) {
        const [itemType] = mapKey.split('_');
        activeItemType = itemType;
        break;
      }
    }
  }

  return (
    <div className="typing-racing-container">
      {/* 공격 경고 표시 */}
      {attackWarning && (
        <div className="attack-warning">
          <div className="attack-warning-content">
            <span className="attack-warning-icon">⚠️</span>
            <div className="attack-warning-text">
              <div className="attack-warning-source">{attackWarning.sourceName}</div>
              <div className="attack-warning-effect">
                {getAttackEffectName(attackWarning.effectType)}
                {attackWarning.remainingSeconds > 0 && (
                  <span className="attack-warning-timer"> {attackWarning.remainingSeconds}초 후 발동</span>
                )}
                {attackWarning.remainingSeconds === 0 && (
                  <span className="attack-warning-active"> 발동됨!</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="game-header">
        <div className="game-header-content">
          <div>
            <h1>⌨️ 타이핑 레이싱</h1>
            <p>빠르고 정확하게 타이핑해서 1등에 도달하세요!</p>
          </div>
          <div className="game-header-actions">
            {isHost && isActive && (
              <button onClick={handleEndGame} className="end-game-button">
                🛑 게임 종료
              </button>
            )}
            <button onClick={handleLeaveGame} className="leave-game-button">
              🚪 나가기
            </button>
          </div>
        </div>
      </div>

      <div className="typing-racing-main">
        {/* 왼쪽: 타이핑 영역 */}
        <div className="typing-area">
          <div className="text-display-container">
            <div className="text-display">
              {(() => {
                // 텍스트 수정 확인 (easyType 효과)
                let text = gameState.text || '';
                const textMod = gameState.playerTextModifications?.[socket.id];
                if (textMod && textMod.modifiedText) {
                  text = textMod.modifiedText;
                }
                
                const textArray = text.split('');
                const startIndex = Math.max(0, myPosition - 6);
                const endIndex = Math.min(textArray.length, myPosition + 20);
                const displayText = textArray.slice(startIndex, endIndex);
                
                // 아이템 박스 위치 계산 (텍스트 인덱스 기준)
                const itemBoxPositions = [];
                if (gameState.itemBoxes && gameState.text) {
                  gameState.itemBoxes.forEach((boxProgress) => {
                    const boxIndex = Math.floor(boxProgress * gameState.text.length);
                    if (boxIndex >= startIndex && boxIndex <= endIndex) {
                      itemBoxPositions.push(boxIndex);
                    }
                  });
                }
                
                // 다른 플레이어들의 위치 정보
                const otherPlayers = room?.players?.filter(p => p.id !== socket.id) || [];
                const playerPositions = {};
                otherPlayers.forEach((player, idx) => {
                  const pos = gameState.playerPosition?.[player.id] || 0;
                  if (pos >= startIndex && pos <= endIndex) {
                    playerPositions[pos] = playerPositions[pos] || [];
                    playerPositions[pos].push({ player, index: idx });
                  }
                });
                
                return (
                  <>
                    {startIndex > 0 && (
                      <span className="text-prefix">...</span>
                    )}
                    {displayText.map((char, displayIndex) => {
                      const actualIndex = startIndex + displayIndex;
                      let className = 'char';
                      if (actualIndex < myPosition) {
                        className += ' completed';
                      } else if (actualIndex === myPosition) {
                        className += ' current';
                        // 조합 중인 텍스트가 있으면 표시
                        if (isComposing && composingText) {
                          return (
                            <span key={actualIndex} className={className + ' composing'}>
                              {composingText}
                            </span>
                          );
                        }
                      }
                      // 띄어쓰기는 특별한 스타일 적용
                      if (char === ' ') {
                        className += ' space';
                      }
                      
                      // 다른 플레이어들의 커서 표시
                      const playersAtThisPosition = playerPositions[actualIndex] || [];
                      
                      // 아이템 박스 표시 여부
                      const isItemBox = itemBoxPositions.includes(actualIndex);
                      
                      return (
                        <span key={actualIndex} className={`char-wrapper ${actualIndex === myPosition ? 'my-position' : ''} ${isItemBox ? 'item-box-position' : ''}`}>
                          {isItemBox && (
                            <span className="item-box-marker" title="아이템 박스">
                              🎁
                            </span>
                          )}
                          <span className={className}>
                            {char === ' ' ? '\u00A0' : char}
                          </span>
                          {playersAtThisPosition.map(({ player, index }) => (
                            <span
                              key={player.id}
                              className="other-player-cursor-wrapper"
                              style={{
                                '--player-color': getPlayerColor(index)
                              }}
                            >
                              <span className="other-player-cursor">|</span>
                              <span className="other-player-name">{player.name}</span>
                            </span>
                          ))}
                        </span>
                      );
                    })}
                    {endIndex < textArray.length && (
                      <span className="text-suffix">...</span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* 아이템 단어 입력 모드 */}
          {activeItemType && activeItemWord && (
            <div className="item-typing-mode">
              <div className="item-typing-label">
                아이템 사용 중: {activeItemType} - "{activeItemWord}" 입력 ({itemTyping.length}/{activeItemWord.length})
              </div>
              <div className="item-word-display">
                {activeItemWord.split('').map((char, index) => {
                  let className = 'char';
                  if (index < itemTyping.length) {
                    className += ' completed';
                  } else if (index === itemTyping.length) {
                    className += ' current';
                  }
                  return <span key={index} className={className}>{char}</span>;
                })}
              </div>
            </div>
          )}
          
          {/* 보유한 아이템 목록 표시 */}
          {myItems.length > 0 && !activeItemType && (
            <div className="items-hint">
              보유 아이템: {myItems.map((item, idx) => {
                const mapKey = `${item}_${idx}`;
                const itemId = myItemWordMap[mapKey];
                const itemWord = itemId ? itemWords[itemId] : '로딩중...';
                return `${getItemIcon(item)} ${itemWord}`;
              }).join(', ')}
              <br />
              <small>아이템 단어를 입력하면 자동으로 사용됩니다</small>
            </div>
          )}

          <div className="typing-hint">
            키보드를 눌러서 타이핑하세요
          </div>
          
          {/* 한글 입력을 위한 숨겨진 input */}
          <input
            ref={hiddenInputRef}
            type="text"
            className="hidden-input"
            autoFocus
            autoComplete="off"
            spellCheck="false"
          />

          {/* 진행도 표시 */}
          <div className="progress-info">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${myProgress * 100}%` }}
              />
            </div>
            <div className="progress-text">
              {myPosition} / {gameState.text?.length || 0} 글자
            </div>
          </div>
          
          {/* 카운트다운 표시 */}
          {countdownRemaining !== null && countdownRemaining > 0 && (
            <div className="countdown-display">
              <div className="countdown-label">첫 번째 완주!</div>
              <div className="countdown-number">{countdownRemaining}</div>
              <div className="countdown-label">초 후 게임 종료</div>
            </div>
          )}

          {/* 현재 적용 중인 효과 */}
          {activeEffects.length > 0 && (
            <div className="active-effects">
              <div className="effects-label">적용 중인 효과:</div>
              <div className="effects-list">
                {activeEffects.map((effect, index) => {
                  const effectInfo = getEffectInfo(effect.type);
                  return (
                    <div key={index} className="effect-display" title={effectInfo.description}>
                      <span className="effect-icon">{effectInfo.icon}</span>
                      <span className="effect-name">{effectInfo.name}</span>
                      <span className="effect-timer">{effect.remainingTime}초</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 아이템 인벤토리 */}
          <div className="items-inventory">
            <div className="items-label">보유 아이템:</div>
            <div className="items-list">
              {myItems.map((item, index) => {
                const mapKey = `${item}_${index}`;
                const itemId = myItemWordMap[mapKey];
                const itemWord = itemId ? itemWords[itemId] : '';
                const typingKey = itemId ? `itemTyping_${itemId}` : '';
                const itemTypingProgress = typingKey ? (myItemTyping[typingKey] || '') : '';
                const isTyping = itemTypingProgress.length > 0;
                
                return (
                  <div
                    key={index}
                    className={`item-display ${isTyping ? 'typing' : ''}`}
                    title={`${item}: "${itemWord || '로딩중...'}" 입력하면 사용`}
                  >
                    <span className="item-icon">{getItemIcon(item)}</span>
                    {itemWord && (
                      <span className="item-word">{itemWord}</span>
                    )}
                    {isTyping && (
                      <span className="item-progress">
                        {itemTypingProgress.length}/{itemWord.length}
                      </span>
                    )}
                  </div>
                );
              })}
              {myItems.length === 0 && (
                <span className="no-items">아이템 없음</span>
              )}
            </div>
          </div>
        </div>

        {/* 오른쪽: 미니맵 및 순위 */}
        <div className="racing-sidebar">
          {/* 미니맵 */}
          <div className="minimap-container">
            <h3>레이스 트랙</h3>
            <canvas
              ref={canvasRef}
              width={400}
              height={300}
              className="minimap-canvas"
            />
          </div>

          {/* 순위표 */}
          <div className="rankings-container">
            <h3>순위</h3>
            <div className="rankings-list">
              {gameState.rankings?.map((player, index) => (
                <div
                  key={player.id}
                  className={`ranking-item ${player.id === socket.id ? 'me' : ''}`}
                >
                  <span className="rank-number">{index + 1}</span>
                  <span className="rank-name">{player.name}</span>
                  <span className="rank-progress">
                    {Math.floor(player.progress * 100)}%
                  </span>
                </div>
              ))}
              {gameState.finishedRankings?.map((player) => (
                <div
                  key={player.id}
                  className={`ranking-item finished ${player.id === socket.id ? 'me' : ''}`}
                >
                  <span className="rank-number">🏁 {player.rank}</span>
                  <span className="rank-name">{player.name}</span>
                  <span className="rank-progress">완주</span>
                </div>
              ))}
            </div>
          </div>

          {/* 스코어보드 */}
          <GameScoreboard
            players={room.players}
            scores={gameState.rankings?.reduce((acc, p, idx) => {
              acc[p.id] = (gameState.rankings.length - idx) * 100;
              return acc;
            }, {})}
            teams={room.teams}
            teamMode={room.teamMode}
            myPlayerId={socket.id}
          />
        </div>
      </div>
    </div>
  );
}

// 아이템 아이콘
function getItemIcon(itemType) {
  const icons = {
    'easyType': '✨',
    'autoType': '🤖',
    'confuseText': '🌀',
    'freezeEven': '❄️',
    'blockFirst': '🔒',
    'shield': '🛡️',
    'reflect': '🪞'
  };
  return icons[itemType] || '❓';
}

// 효과 정보 가져오기
function getEffectInfo(effectType) {
  const effects = {
    'easyType': { icon: '✨', name: '쉬운 타이핑', description: '모든 글자가 가나다라마바사아자차카타파하로 변경됨' },
    'autoType': { icon: '🤖', name: '자동 타이핑', description: '자동으로 타이핑 중' },
    'confuseText': { icon: '🌀', name: '텍스트 혼란', description: '글자가 어려운 단어로 변경됨' },
    'freezeEven': { icon: '❄️', name: '짝수칸 정지', description: '짝수칸에서 멈춤' },
    'keyboardLock': { icon: '🔒', name: '타이핑 봉쇄', description: '타이핑을 할 수 없음' },
    'shield': { icon: '🛡️', name: '방패', description: '공격에 면역' },
    'reflect': { icon: '🪞', name: '반사', description: '공격을 반사함' }
  };
  return effects[effectType] || { icon: '❓', name: '알 수 없음', description: '' };
}

// 공격 효과 이름 가져오기
function getAttackEffectName(effectType) {
  const names = {
    'confuseText': '텍스트 혼란',
    'freezeEven': '짝수칸 정지',
    'blockFirst': '1등 봉쇄'
  };
  return names[effectType] || '공격';
}

// 플레이어 색상
function getPlayerColor(index) {
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  return colors[index % colors.length];
}

export default TypingRacing;
