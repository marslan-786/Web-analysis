import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import fetch from "node-fetch";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;
const LOG_PATH = "./data/logs.json";

fs.mkdirSync("./data", { recursive: true });

// in-memory logs (append-only for session)
let liveLogs = [];

/** ---------- Helpers ---------- **/

const TRIM_LIMIT = 20000;

function safeTruncate(s) {
  if (typeof s !== "string") return s;
  if (s.length > TRIM_LIMIT) return s.slice(0, TRIM_LIMIT) + "\n[TRIMMED]";
  return s;
}

function redactHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const kl = k.toLowerCase();
    if (kl.includes("authorization") || kl.includes("cookie") || kl.includes("set-cookie") || kl.includes("token") || kl.includes("secret") || kl.includes("x-api-key")) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function redactSensitiveValuesInBody(obj) {
  // If string, try parse JSON; otherwise traverse object keys to redact known names
  try {
    if (typeof obj === "string") {
      const js = JSON.parse(obj);
      return redactSensitiveValuesInBody(js);
    }
  } catch (e) {
    // not JSON
  }
  if (obj && typeof obj === "object") {
    const out = Array.isArray(obj) ? [] : {};
    for (const k of Object.keys(obj)) {
      const val = obj[k];
      const kl = k.toLowerCase();
      if (kl.includes("password") || kl.includes("auth") || kl.includes("token") || kl.includes("cookie") || kl.includes("secret") || kl.includes("otp") || kl.includes("pin")) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSensitiveValuesInBody(val);
      }
    }
    return out;
  }
  return obj;
}

function appendLog(entry) {
  entry._ts = new Date().toISOString();
  liveLogs.push(entry);
  // notify WS clients
  const msg = JSON.stringify({ type: "log", payload: entry });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

/** ---------- Middleware & static ---------- **/

app.use(express.static("public"));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

/** ---------- Client logs endpoint (from injected script) ---------- **/
app.post("/client-log", (req, res) => {
  try {
    const payload = req.body;
    // redact sensitive in payload.request/response if present
    if (payload && payload.request && payload.request.headers) {
      payload.request.headers = redactHeaders(payload.request.headers);
    }
    if (payload && payload.request && payload.request.body) {
      // keep a truncated preview and a redacted parsed version if JSON
      payload.request.bodyPreview = safeTruncate(typeof payload.request.body === "string" ? payload.request.body : JSON.stringify(payload.request.body || ""));
      try {
        payload.request.bodyRedacted = redactSensitiveValuesInBody(payload.request.body);
      } catch { payload.request.bodyRedacted = "[UNPARSEABLE]"; }
      delete payload.request.body; // avoid duplicate large data
    }
    appendLog({ source: "client", event: payload.event || "client-event", data: payload });
    res.json({ ok: true });
  } catch (e) {
    console.error("client-log error", e);
    res.status(500).json({ ok: false, err: e.message });
  }
});

/** ---------- Proxy endpoint (handles all methods) ---------- **/
app.all("/proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing ?url=");
  const method = req.method;
  const incomingHeaders = { ...req.headers };
  delete incomingHeaders.host;
  delete incomingHeaders.origin;
  // build fetch options
  const options = { method, headers: incomingHeaders };

  // forward body for non-GET methods (support JSON & form)
  if (method !== "GET" && method !== "HEAD") {
    if (req.is("application/json") || typeof req.body === "object") {
      options.body = JSON.stringify(req.body);
      options.headers = { ...options.headers, "content-type": "application/json" };
    } else {
      // fallback: raw body not parsed - try to read text
      // express parsed body already; if empty, nothing to forward
    }
  }

  // perform fetch
  try {
    const response = await fetch(target, options);
    // clone text (we need it for injection & logging)
    const contentType = response.headers.get("content-type") || "";
    let text = null;
    let isHtml = contentType.includes("text/html");
    try {
      if (isHtml || contentType.includes("application/json") || contentType.includes("text/")) {
        text = await response.text();
      } else {
        // binary or other -> buffer
        const b = await response.buffer();
        // return binary directly
        // but we still want to log minimal info
        appendLog({
          source: "proxy",
          type: "resource",
          method,
          url: target,
          status: response.status,
          headers: redactHeaders(Object.fromEntries(response.headers)),
          bodyPreview: "[BINARY_OR_NON_TEXT_RESPONSE]"
        });
        // forward binary
        res.set("content-type", contentType);
        return res.status(response.status).send(b);
      }
    } catch (e) {
      text = "[FAILED_TO_READ_BODY]";
    }

    // Log request+response with body previews & redaction
    let reqBodyPreview = null;
    let reqBodyRedacted = null;
    if (options.body) {
      reqBodyPreview = safeTruncate(options.body);
      try { reqBodyRedacted = redactSensitiveValuesInBody(JSON.parse(options.body)); } catch { reqBodyRedacted = "[UNPARSEABLE]"; }
    }

    appendLog({
      source: "proxy",
      type: "request",
      method,
      url: target,
      request: {
        headers: redactHeaders(options.headers || {}),
        bodyPreview: reqBodyPreview,
        bodyRedacted: reqBodyRedacted
      },
      response: {
        status: response.status,
        headers: redactHeaders(Object.fromEntries(response.headers)),
        bodyPreview: safeTruncate(text || "")
      }
    });

    // If HTML, inject client-side monitoring script before returning
    if (isHtml && typeof text === "string") {
      const injection = `
<!-- INJECTED WEB-ANALYZER SCRIPT -->
<script>
(function(){
  // small id to avoid multiple injections
  if (window.__WEB_ANALYZER_INJECTED) return;
  window.__WEB_ANALYZER_INJECTED = true;

  // safe post helper
  function post(obj){
    try{
      navigator.sendBeacon('/client-log', JSON.stringify(obj));
    }catch(e){
      fetch('/client-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)}).catch(()=>{});
    }
  }

  function safePreview(v, limit=20000){
    try {
      if (typeof v === 'string') return v.length>limit ? v.slice(0,limit)+'\\n[TRIMMED]' : v;
      return JSON.stringify(v).slice(0, limit);
    } catch(e){ return '[UNSERIALIZABLE]'; }
  }

  // override fetch
  const _fetch = window.fetch;
  window.fetch = async function(input, init){
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    const abs = new URL(url, location.href).toString();
    const start = Date.now();
    let requestBody = init && init.body ? init.body : null;
    let stack = (new Error()).stack;
    try {
      const resp = await _fetch(input, init);
      let clone = resp.clone();
      let bodyText = '[UNREADABLE]';
      try { bodyText = await clone.text(); } catch(e){}
      post({ event:'fetch', url:abs, method: (init && init.method) || 'GET', request:{ headers: init && init.headers, body: safePreview(requestBody) }, response:{ status: resp.status, bodyPreview: safePreview(bodyText) }, stack });
      return resp;
    } catch (e) {
      post({ event:'fetch-error', url:abs, method: (init && init.method) || 'GET', request:{ headers: init && init.headers, body: safePreview(requestBody) }, error: String(e), stack });
      throw e;
    }
  };

  // override XHR
  (function(){
    const Orig = window.XMLHttpRequest;
    function ProxyXHR(){
      const xhr = new Orig();
      let _method = null, _url = null, _sentBody = null, _stack = null;
      const origOpen = xhr.open;
      xhr.open = function(method, url){
        _method = method; _url = new URL(url, location.href).toString();
        _stack = (new Error()).stack;
        return origOpen.apply(xhr, arguments);
      };
      const origSend = xhr.send;
      xhr.send = function(body){
        _sentBody = body;
        try { post({ event:'xhr-send', url: _url, method: _method, request:{ body: safePreview(body) }, stack: _stack }); } catch(e){}
        return origSend.apply(xhr, arguments);
      };
      xhr.addEventListener('load', function(){ try{ post({ event:'xhr-load', url:_url, method:_method, status: xhr.status, responsePreview: safePreview(xhr.responseText), stack:_stack }); }catch(e){} });
      xhr.addEventListener('error', function(){ try{ post({ event:'xhr-error', url:_url, method:_method, status: xhr.status, stack:_stack }); }catch(e){} });
      return xhr;
    }
    window.XMLHttpRequest = ProxyXHR;
  })();

  // wrap WebSocket to capture frames (preview only)
  (function(){
    const OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols){
      const ws = new OrigWS(url, protocols);
      const id = 'ws-'+Math.random().toString(36).slice(2,8);
      ws.addEventListener('message', (ev)=>{ try{ post({ event:'ws-message', id, url, dataPreview: safePreview(ev.data, 2000) }); }catch(e){} });
      const origSend = ws.send;
      ws.send = function(data){ try{ post({ event:'ws-send', id, url, dataPreview: safePreview(data,2000) }); }catch(e){}; return origSend.apply(ws, [data]); };
      return ws;
    };
  })();

  // wrap console
  ['log','warn','error','info'].forEach(fn=>{
    const orig = console[fn];
    console[fn] = function(...args){
      try{ post({ event:'console', level: fn, args: args.map(a=> typeof a==='object' ? JSON.stringify(a) : String(a)).slice(0,20) }); } catch(e) {}
      orig.apply(console, args);
    };
  });

  // wrap crypto functions to detect client-side hashing/randomness
  try {
    const origGRV = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = function(arr){
      const out = origGRV(arr);
      try{ post({ event:'crypto-getRandomValues', length: arr.length, sample: Array.prototype.slice.call(out,0,10) }); }catch(e){}
      return out;
    };
    if (crypto.subtle && crypto.subtle.digest) {
      const origDigest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = async function(alg, data){
        try{ post({ event:'crypto-digest-start', alg: typeof alg==='string'?alg:JSON.stringify(alg), inputBytes: data && data.byteLength ? data.byteLength : null }); }catch(e){}
        const res = await origDigest(alg, data);
        try{ post({ event:'crypto-digest-end', alg: typeof alg==='string'?alg:JSON.stringify(alg), outputBytes: res.byteLength }); }catch(e){}
        return res;
      };
    }
  } catch(e){}

})();
</script>
<!-- END INJECT -->
      `;
      // inject before </body>
      text = text.replace(/<\/body>/i, injection + "\n</body>");
    }

    // forward content-type and status
    if (typeof text === "string") {
      res.set("content-type", contentType || "text/html; charset=utf-8");
      return res.status(response.status).send(text);
    } else {
      // fallback
      res.set("content-type", contentType || "text/plain");
      return res.status(response.status).send(safeTruncate(String(text || "")));
    }
  } catch (err) {
    console.error("proxy error", err);
    appendLog({ source: "proxy", type: "error", url: target, method, error: err.message });
    return res.status(500).send("Proxy Error: " + err.message);
  }
});

/** ---------- Save / Download logs ---------- **/
app.get("/save-logs", (req, res) => {
  try {
    fs.writeFileSync(LOG_PATH, JSON.stringify(liveLogs, null, 2), "utf8");
    return res.json({ success: true, file: LOG_PATH });
  } catch (e) {
    return res.status(500).json({ success: false, err: e.message });
  }
});

app.get("/download-logs", (req, res) => {
  res.setHeader("Content-Disposition", "attachment; filename=logs.json");
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(liveLogs, null, 2));
});

/** ---------- WebSocket server (simple notifications) ---------- **/
wss.on("connection", (ws) => {
  console.log("WS connected");
  ws.send(JSON.stringify({ type: "hello", payload: "connected" }));
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
