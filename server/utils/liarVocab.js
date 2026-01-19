const fs = require("fs");
const path = require("path");

function parseLiarVocab() {
  try {
    const vocabPath = path.join(__dirname, "../../liar_vocab.csv");
    const raw = fs.readFileSync(vocabPath, "utf8");
    const entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [categoryRaw, ...wordParts] = line.split(",");
        const category = (categoryRaw || "").trim();
        const word = (wordParts.join(",") || "").trim();
        if (!category || !word) return null;
        return { category, word };
      })
      .filter(Boolean);

    const wordsByCategory = {};
    entries.forEach(({ category, word }) => {
      if (!wordsByCategory[category]) {
        wordsByCategory[category] = [];
      }
      wordsByCategory[category].push(word);
    });

    const categories = Object.keys(wordsByCategory).sort();
    return { entries, categories, wordsByCategory };
  } catch (error) {
    console.warn("[LiarVocab] 단어 목록 로드 실패:", error.message);
    const fallbackEntries = [
      { category: "음식", word: "사과" },
      { category: "탈것", word: "자동차" },
      { category: "동물", word: "고양이" },
      { category: "장소", word: "학교" },
      { category: "탈것", word: "비행기" },
    ];
    return {
      entries: fallbackEntries,
      categories: ["동물", "음식", "장소", "탈것"],
      wordsByCategory: {
        동물: ["고양이"],
        음식: ["사과"],
        장소: ["학교"],
        탈것: ["자동차", "비행기"],
      },
    };
  }
}

function getLiarVocab() {
  return parseLiarVocab();
}

module.exports = { getLiarVocab };
