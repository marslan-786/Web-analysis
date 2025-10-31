const goBtn = document.getElementById("goBtn");
const saveBtn = document.getElementById("saveBtn");
const urlInput = document.getElementById("url");
const iframe = document.getElementById("browserFrame");
const logPanel = document.getElementById("logPanel");

let ws = new WebSocket(`wss://${location.host}`.replace("https", "wss").replace("http", "ws"));

ws.onopen = () => console.log("Connected to WS");
ws.onclose = () => console.log("Disconnected from WS");

function addLog(msg, type = "info") {
  const el = document.createElement("div");
  el.className = type;
  el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logPanel.appendChild(el);
  logPanel.scrollTop = logPanel.scrollHeight;
}

// Inject network logging script (if possible)
iframe.addEventListener("load", () => {
  addLog(`Loaded: ${iframe.src}`);
});

goBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (!url.startsWith("http")) {
    alert("Please enter a valid URL with http/https");
    return;
  }
  iframe.src = url;
  addLog(`Navigating to ${url}`);
});

saveBtn.addEventListener("click", async () => {
  const res = await fetch("/save-logs");
  const data = await res.json();
  if (data.success) {
    addLog("Logs saved. Go to Replit 'data/logs.json' to view.");
  }
});
