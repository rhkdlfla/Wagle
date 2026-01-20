// 게임 컴포넌트 레지스트리
// 새로운 게임을 추가할 때는 여기에 등록하기만 하면 됩니다.

import ClickBattle from "../components/ClickBattle";
import AppleBattle from "../components/AppleBattle";
import DrawGuess from "../components/DrawGuess";
import NumberRush from "../components/NumberRush";
import QuizBattle from "../components/QuizBattle";
import LiarGame from "../components/LiarGame";
import TicTacToe from "../components/TicTacToe";
import MemoryGame from "../components/MemoryGame";
import TicTacToe from "../components/TicTacToe";

// 게임 컴포넌트 맵핑
// gameType (서버에서 사용하는 ID) -> React 컴포넌트
export const GAME_COMPONENTS = {
  clickBattle: ClickBattle,
  appleBattle: AppleBattle,
  drawGuess: DrawGuess,
  numberRush: NumberRush,
  quizBattle: QuizBattle,
  liarGame: LiarGame,
  ticTacToe: TicTacToe,
  memoryGame: MemoryGame,
  ticTacToe: TicTacToe,
  // 새로운 게임을 추가할 때 여기에 추가:
  // newGame: NewGameComponent,
};

// 게임 메타데이터 (로비에서 게임 선택 시 사용)
// 이 목록은 서버의 GAME_CONFIGS와 동기화되어야 합니다.
export const GAME_METADATA = [
  {
    id: "clickBattle",
    name: "클릭 대결",
    description: "일정 시간 동안 최대한 많이 클릭하세요!",
    icon: "👆",
    minPlayers: 1,
    defaultDuration: 30, // 초 단위
    minDuration: 5,
    maxDuration: 300,
    durationPresets: [10, 30, 60, 120, 300],
    supportsDuration: true,
    supportsRelayMode: true, // 이어달리기 모드 지원 여부
  },
  {
    id: "appleBattle",
    name: "사과배틀",
    description: "합이 10이 되는 사과를 선택해 땅따먹기!",
    icon: "🍎",
    minPlayers: 1,
    defaultDuration: 120, // 초 단위
    minDuration: 30,
    maxDuration: 300,
    durationPresets: [30, 60, 120, 180, 300],
    supportsDuration: true,
    supportsRelayMode: true,
  },
  {
    id: "drawGuess",
    name: "그림 맞히기",
    description: "그림을 보고 제시어를 맞혀보세요!",
    icon: "🎨",
    minPlayers: 2,
    defaultDuration: 90, // 초 단위
    minDuration: 30,
    maxDuration: 180,
    durationPresets: [60, 90, 120, 150, 180],
    supportsDuration: true,
    supportsRelayMode: false,
  },
  {
    id: "quizBattle",
    name: "퀴즈 배틀",
    description: "다양한 퀴즈를 풀어보세요!",
    icon: "🧩",
    minPlayers: 1,
    defaultDuration: 600, // 초 단위
    minDuration: 60,
    maxDuration: 1800,
    durationPresets: [300, 600, 900, 1200],
    supportsDuration: true,
    supportsRelayMode: false,
  },
  {
    id: "numberRush",
    name: "넘버 러시",
    description: "1부터 N까지 순서대로 공을 클릭하세요! 5라운드 대결!",
    icon: "🔢",
    minPlayers: 1,
    defaultDuration: 60, // 초 단위 (라운드 기반이지만 전체 시간 제한)
    minDuration: 10,
    maxDuration: 300,
    durationPresets: [30, 60, 120, 180, 300],
    supportsDuration: true,
    supportsRelayMode: false, // 이어달리기 모드 미지원
  },
  {
    id: "liarGame",
    name: "라이어 게임",
    description: "제시어를 공유하고 라이어를 찾아보세요!",
    icon: "🕵️",
    minPlayers: 2,
    defaultDuration: 600, // 초 단위 (전역 타이머 사용 안 함)
    minDuration: 60,
    maxDuration: 1800,
    durationPresets: [300, 600, 900],
    supportsDuration: false,
    supportsRelayMode: false,
  },
  {
    id: "ticTacToe",
    name: "(2인용) 틱택토",
    description: "3줄을 먼저 완성하면 승리!",
    icon: "🎯",
    minPlayers: 2,
    defaultDuration: 300, // 초 단위
    minDuration: 60,
    maxDuration: 900,
    durationPresets: [60, 120, 180, 300],
  },
  {
    id: "memoryGame",
    name: "기억력 게임",
    description: "패턴을 기억하고 순서대로 입력하세요!",
    icon: "🧠",
    minPlayers: 1,
    defaultDuration: 300, // 초 단위 (라운드 기반이므로 사용 안 함)
    minDuration: 60,
    maxDuration: 600,
    durationPresets: [180, 300, 450, 600],
    supportsDuration: false,
    supportsRelayMode: false,
  },
  {
    id: "ticTacToe",
    name: "(2인용) 틱택토",
    description: "3줄을 먼저 완성하면 승리!",
    icon: "🎯",
    minPlayers: 2,
    defaultDuration: 300, // 초 단위
    minDuration: 60,
    maxDuration: 900,
    durationPresets: [60, 120, 180, 300],
    supportsDuration: false,
    supportsRelayMode: false,
  },
  // 새로운 게임을 추가할 때 여기에 추가:
  // {
  //   id: "newGame",
  //   name: "새 게임",
  //   description: "게임 설명",
  //   icon: "🎮",
  //   ...
  // },
];

// 게임 컴포넌트 가져오기 (헬퍼 함수)
export function getGameComponent(gameType) {
  const Component = GAME_COMPONENTS[gameType];
  if (!Component) {
    console.error(`게임 컴포넌트를 찾을 수 없습니다: ${gameType}`);
    // 기본값으로 ClickBattle 반환
    return GAME_COMPONENTS.clickBattle || null;
  }
  return Component;
}

// 게임 메타데이터 가져오기 (헬퍼 함수)
export function getGameMetadata(gameId) {
  return GAME_METADATA.find((game) => game.id === gameId) || GAME_METADATA[0];
}

// 모든 게임 ID 목록 반환
export function getAllGameIds() {
  return GAME_METADATA.map((game) => game.id);
}
