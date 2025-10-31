import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import fs from "fs";
import fetch from "node-fetch";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;
const LOG_PATH = "./data/logs.json";

fs.mkdirSync("./data", { recursive: true });

let liveLogs = [];

app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🧩 Proxy for GET & POST
app.all("/proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");

  const method = req.method;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;

  const options = {
    method,
    headers,
  };

  if (req.method !== "GET" && req.body) {
    options.body = JSON.stringify(req.body);
    headers["content-type"] = "application/json";
  }

  try {
    const response = await fetch(target, options);
    const text = await response.text();

    const log = {
      time: new Date().toISOString(),
      url: target,
      method,
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers),
    };
    liveLogs.push(log);

    // Send live update to frontend
    wss.clients.forEach((client) => {
      if (client.readyState === 1)
        client.send(JSON.stringify({ type: "log", payload: log }));
    });

    res.status(response.status).send(text);
  } catch (err) {
    const log = {
      time: new Date().toISOString(),
      url: target,
      method,
      error: err.message,
    };
    liveLogs.push(log);

    wss.clients.forEach((client) => {
      if (client.readyState === 1)
        client.send(JSON.stringify({ type: "log", payload: log }));
    });

    res.status(500).send("Proxy Error: " + err.message);
  }
});

// 💾 Save logs locally
app.get("/save-logs", (req, res) => {
  fs.writeFileSync(LOG_PATH, JSON.stringify(liveLogs, null, 2));
  res.json({ success: true, file: "data/logs.json" });
});

// 💾 Download logs as JSON
app.get("/download-logs", (req, res) => {
  res.setHeader("Content-Disposition", "attachment; filename=logs.json");
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(liveLogs, null, 2));
});

server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
