const goBtn = document.getElementById("goBtn");
const saveBtn = document.getElementById("saveBtn");
const urlInput = document.getElementById("url");
const iframe = document.getElementById("browserFrame");
const logPanel = document.getElementById("logPanel");

let ws = new WebSocket(
  location.origin.replace(/^http/, "ws")
);

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "log") {
    addLog(`[${msg.payload.status}] ${msg.payload.url}`);
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

  // Instead of directly loading target, we load via our proxy
  const proxied = `/proxy?url=${encodeURIComponent(target)}`;
  iframe.src = proxied;
  addLog(`Navigating: ${target}`);
});

saveBtn.addEventListener("click", async () => {
  const res = await fetch("/save-logs");
  const data = await res.json();
  if (data.success) {
    addLog(`✅ Logs saved to ${data.file}`);
  }
});
