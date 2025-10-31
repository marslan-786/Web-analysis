import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import fs from "fs";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const LOG_PATH = "./data/logs.json";

// Ensure log folder exists
fs.mkdirSync("./data", { recursive: true });

// Store logs temporarily
let liveLogs = [];

app.use(express.static("public"));

app.get("/save-logs", (req, res) => {
  const logsToSave = JSON.stringify(liveLogs, null, 2);
  fs.writeFileSync(LOG_PATH, logsToSave);
  return res.json({ success: true, message: "Logs saved", file: "data/logs.json" });
});

wss.on("connection", (ws) => {
  console.log("WebSocket connected!");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "log") {
        liveLogs.push(data.payload);
      }
    } catch (err) {
      console.error("Invalid WS message:", err);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
