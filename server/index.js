const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // 리액트 주소
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`유저 접속됨: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log("유저 접속 끊김", socket.id);
  });
});

server.listen(4000, () => {
  console.log("서버가 4000번 포트에서 돌아가고 있어요!");
});