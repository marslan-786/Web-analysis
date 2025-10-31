const goBtn = document.getElementById("goBtn");
const saveBtn = document.getElementById("saveBtn");
const downloadBtn = document.getElementById("downloadBtn");
const urlInput = document.getElementById("url");
const iframe = document.getElementById("browserFrame");
const logPanel = document.getElementById("logPanel");

let ws = new WebSocket(location.origin.replace(/^http/, "ws"));

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "log") {
    const log = msg.payload;
    addLog(`${log.method} ${log.url} → ${log.status || log.error}`);
  }
};

function addLog(msg) {
  const div = document.createElement("div");
  div.textContent = msg;
  logPanel.appendChild(div);
  logPanel.scrollTop = logPanel.scrollHeight;
}

goBtn.addEventListener("click", async () => {
  const target = urlInput.value.trim();
  if (!target.startsWith("http")) {
    alert("Please include http:// or https://");
    return;
  }
  iframe.src = `/proxy?url=${encodeURIComponent(target)}`;
  addLog(`Navigating to ${target}`);
});

saveBtn.addEventListener("click", async () => {
  const res = await fetch("/save-logs");
  const data = await res.json();
  if (data.success) addLog("✅ Logs saved to server.");
});

// 📥 Download logs directly to mobile
downloadBtn.addEventListener("click", () => {
  window.location.href = "/download-logs";
});
