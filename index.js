import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import fs from "fs";
import fetch from "node-fetch";
import url from "url";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;
const LOG_PATH = "./data/logs.json";

// Ensure folder exists
fs.mkdirSync("./data", { recursive: true });

let liveLogs = [];

app.use(express.static("public"));

// 🧠 Proxy Endpoint — requests sent by frontend will go here
app.get("/proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  try {
    const parsed = new URL(target);
    const headers = {};

    // Fetch target content
    const response = await fetch(parsed.toString(), { headers });
    const data = await response.text();

    // Save log entry
    const log = {
      time: new Date().toISOString(),
      method: "GET",
      url: parsed.toString(),
      status: response.status,
      headers: Object.fromEntries(response.headers),
    };
    liveLogs.push(log);

    // Broadcast via WebSocket (optional)
    wss.clients.forEach((client) => {
      if (client.readyState === 1)
        client.send(JSON.stringify({ type: "log", payload: log }));
    });

    // Return response back to frontend
    res.send(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Proxy Error");
  }
});

// Save logs manually
app.get("/save-logs", (req, res) => {
  fs.writeFileSync(LOG_PATH, JSON.stringify(liveLogs, null, 2));
  res.json({ success: true, file: "data/logs.json" });
});

wss.on("connection", (ws) => {
  console.log("WS Connected");
});

server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
