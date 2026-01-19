const express = require("express");
const { getLiarVocab } = require("../utils/liarVocab");

const router = express.Router();

router.get("/categories", (req, res) => {
  const vocab = getLiarVocab();
  res.json({ categories: vocab.categories || [] });
});

module.exports = router;
