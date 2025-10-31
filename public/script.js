const goBtn = document.getElementById("goBtn");
const saveBtn = document.getElementById("saveBtn");
const downloadBtn = document.getElementById("downloadBtn");
const urlInput = document.getElementById("url");
const iframe = document.getElementById("browserFrame");
const logPanel = document.getElementById("logPanel");

const wsProto = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(wsProto + "://" + location.host);

ws.onopen = () => appendLog("WebSocket connected");
ws.onmessage = (ev) => {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === "log") {
      const p = msg.payload;
      if (p.source === "proxy" && p.type === "request") {
        appendLog(`[PROXY] ${p.method} ${p.url} → ${p.response && p.response.status}`);
      } else if (p.source === "proxy" && p.type === "resource") {
        appendLog(`[PROXY] resource ${p.url} → ${p.status}`);
      } else if (p.source === "client") {
        appendLog(`[CLIENT] ${p.event || p.data && p.data.event || ''} ${p.data && (p.data.url || '')}`);
      } else {
        appendLog(JSON.stringify(p).slice(0,200));
      }
    } else if (msg.type === "hello") {
      appendLog("Server: " + msg.payload);
    }
  } catch (e) {
    appendLog("WS parse error");
  }
};

function appendLog(text) {
  const el = document.createElement("div");
  el.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logPanel.appendChild(el);
  logPanel.scrollTop = logPanel.scrollHeight;
}

goBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (!url || !url.startsWith("http")) {
    alert("Enter a full URL (https://...)");
    return;
  }
  iframe.src = `/proxy?url=${encodeURIComponent(url)}`;
  appendLog(`Navigating → ${url}`);
});

saveBtn.addEventListener("click", async () => {
  const r = await fetch("/save-logs");
  const j = await r.json();
  if (j.success) appendLog("Logs saved on server: " + j.file);
  else appendLog("Save failed: " + (j.err||"unknown"));
});

// direct download (mobile/desktop)
downloadBtn.addEventListener("click", () => {
  window.location.href = "/download-logs";
});
