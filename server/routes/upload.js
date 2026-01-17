const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 업로드 디렉토리 확인
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const imagesDir = path.join(uploadDir, "images");
const audioDir = path.join(uploadDir, "audio");

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

// 이미지 파일 저장 설정
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imagesDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `image-${uniqueSuffix}${ext}`);
  },
});

// 오디오 파일 저장 설정
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, audioDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `audio-${uniqueSuffix}${ext}`);
  },
});

// 파일 필터 - 이미지
const imageFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error("이미지 파일만 업로드 가능합니다 (jpeg, jpg, png, gif, webp)"));
  }
};

// 파일 필터 - 오디오
const audioFilter = (req, file, cb) => {
  const allowedTypes = /mp3|wav|ogg|m4a/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error("오디오 파일만 업로드 가능합니다 (mp3, wav, ogg, m4a)"));
  }
};

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: imageFilter,
});

const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: audioFilter,
});

// 이미지 업로드
router.post("/image", uploadImage.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "이미지 파일이 없습니다." });
    }

    const fileUrl = `/api/uploads/images/${req.file.filename}`;
    res.json({ success: true, url: fileUrl });
  } catch (error) {
    console.error("이미지 업로드 오류:", error);
    res.status(500).json({ error: "이미지 업로드에 실패했습니다." });
  }
});

// 오디오 업로드
router.post("/audio", uploadAudio.single("audio"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "오디오 파일이 없습니다." });
    }

    const fileUrl = `/api/uploads/audio/${req.file.filename}`;
    res.json({ success: true, url: fileUrl });
  } catch (error) {
    console.error("오디오 업로드 오류:", error);
    res.status(500).json({ error: "오디오 업로드에 실패했습니다." });
  }
});

module.exports = router;
