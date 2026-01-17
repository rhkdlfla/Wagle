const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: imageFilter,
});

const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: audioFilter,
});

// 이미지 업로드
router.post("/image", (req, res, next) => {
  uploadImage.single("image")(req, res, (err) => {
    if (err) {
      console.error("이미지 업로드 multer 오류:", err);
      return res.status(400).json({ error: err.message || "이미지 업로드에 실패했습니다." });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "이미지 파일이 없습니다." });
    }

    const originalPath = req.file.path;
    const originalSize = req.file.size;
    
    // 이미지 최적화: 최대 너비 1920px, 품질 85%
    try {
      const metadata = await sharp(originalPath).metadata().catch(() => null);
      
      // sharp가 처리할 수 있는 형식인지 확인
      if (!metadata || !['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format)) {
        console.log(`이미지 최적화 건너뜀: ${metadata?.format || 'unknown'} 형식`);
        // 최적화할 수 없는 형식(GIF 등)은 원본 그대로 사용
      } else {
        const optimizedPath = originalPath.replace(path.extname(originalPath), '_optimized' + path.extname(originalPath));
        const maxWidth = 1920;
        const maxHeight = 1920;
        
        let sharpInstance = sharp(originalPath);
        
        // 크기가 큰 경우 리사이징
        if (metadata.width > maxWidth || metadata.height > maxHeight) {
          sharpInstance = sharpInstance.resize(maxWidth, maxHeight, {
            fit: 'inside',
            withoutEnlargement: true
          });
        }
        
        // JPEG/PNG/WebP 최적화
        if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
          await sharpInstance
            .jpeg({ quality: 85, mozjpeg: true })
            .toFile(optimizedPath);
        } else if (metadata.format === 'png') {
          await sharpInstance
            .png({ quality: 85, compressionLevel: 9 })
            .toFile(optimizedPath);
        } else if (metadata.format === 'webp') {
          await sharpInstance
            .webp({ quality: 85 })
            .toFile(optimizedPath);
        }
        
        // 최적화된 파일 크기 확인
        const optimizedStats = await fs.promises.stat(optimizedPath);
        
        // 원본 파일 삭제하고 최적화된 파일을 원본 이름으로 변경
        await fs.promises.unlink(originalPath);
        await fs.promises.rename(optimizedPath, originalPath);
        
        console.log(`이미지 최적화 완료: ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(optimizedStats.size / 1024 / 1024).toFixed(2)}MB`);
      }
    } catch (optimizeError) {
      console.error("이미지 최적화 오류:", optimizeError);
      // 최적화 실패해도 원본 파일 사용
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
