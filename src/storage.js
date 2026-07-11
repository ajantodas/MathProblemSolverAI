import React, { useState, useRef, useEffect } from "react";
import * as math from "mathjs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Send, Paperclip, Plus, LogOut, Menu, X, CheckCircle2, AlertTriangle } from "lucide-react";

function demoHash(pw) {
  // NOTE: demo-only obfuscation, not real cryptographic security.
  return btoa(unescape(encodeURIComponent("salt::" + pw)));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const SYSTEM_PROMPT = `You are "Continuum", an AI assistant that chats naturally about anything but has world-class mathematical rigor and never makes arithmetic or logical errors in math.
The user may write in ANY language (Bangla, Banglish, English, etc.) — always understand them regardless of language, and reply in the same language/style they used, unless they ask for a translation.
For pure conversation, just answer normally and set has_steps to false.
For any math problem (arithmetic, algebra, geometry, trig, calculus, stats, linear algebra, word problems, proofs), set has_steps to true and give a complete, correct, step-by-step solution.
If a problem naturally involves a single-variable real function of x that would benefit from a visual, include a "plot" object; otherwise set plot to null.

Respond ONLY with strict JSON, no markdown fences, no text outside the JSON, in exactly this shape:
{
  "reply": string,
  "has_steps": boolean,
  "steps": [ { "title": string, "work": string, "note": string } ],
  "final_answer": string,
  "verify_expression": string,
  "plot": { "expression": string, "x_min": number, "x_max": number } | null
}

Rules:
- "reply" is always filled: for chat it's the full answer; for math it's a short one-line intro before the steps (e.g. "Here's the full solution:").
- Plain text math notation only: * / ^ sqrt() × ÷ √ π ≤ ≥ etc. No LaTeX like \\frac.
- "verify_expression": if final answer is a single numeric value from a closed-form expression, give it in mathjs syntax so it can be independently recomputed. Otherwise empty string.
- "plot.expression" must be valid mathjs syntax in terms of x only (e.g. "x^2 - 3*x + 2"), and only include it when a visual genuinely helps.
- Never invent facts. If ambiguous, state your interpretation in "reply" and proceed.`;

export default function ContinuumApp() {
  const [screen, setScreen] = useState("auth");
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [currentUser, setCurrentUser] = useState(null);
  const [convIndex, setConvIndex] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [attachedImage, setAttachedImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function handleAuth() {
    const username = authForm.username.trim().toLowerCase();
    const password = authForm.password;
    if (!username || !password) {
      setAuthError("Enter a username and password.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      if (authMode === "signup") {
        let exists = null;
        try {
          exists = await window.storage.get(`user:${username}`, true);
        } catch {
          exists = null;
        }
        if (exists) {
          setAuthError("That username is already taken.");
          setAuthBusy(false);
          return;
        }
        await window.storage.set(`user:${username}`, JSON.stringify({ passwordHash: demoHash(password), createdAt: Date.now() }), true);
        await window.storage.set(`convindex:${username}`, JSON.stringify([]), true);
        await loginSuccess(username);
      } else {
        let record = null;
        try {
          const res = await window.storage.get(`user:${username}`, true);
          record = res ? JSON.parse(res.value) : null;
        } catch {
          record = null;
        }
        if (!record || record.passwordHash !== demoHash(password)) {
          setAuthError("Incorrect username or password.");
          setAuthBusy(false);
          return;
        }
        await loginSuccess(username);
      }
    } catch (e) {
      setAuthError("Something went wrong. Try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function loginSuccess(username) {
    setCurrentUser(username);
    let idx = [];
    try {
      const res = await window.storage.get(`convindex:${username}`, true);
      idx = res ? JSON.parse(res.value) : [];
    } catch {
      idx = [];
    }
    setConvIndex(idx);
    if (idx.length > 0) {
      await loadConversation(username, idx[0].id);
    } else {
      startNewConversation();
    }
    setScreen("app");
  }

  function startNewConversation() {
    setActiveConvId(null);
    setMessages([]);
    setAttachedImage(null);
  }

  async function loadConversation(username, id) {
    try {
      const res = await window.storage.get(`conv:${username}:${id}`, true);
      const msgs = res ? JSON.parse(res.value) : [];
      setMessages(msgs);
      setActiveConvId(id);
    } catch {
      setMessages([]);
      setActiveConvId(id);
    }
  }

  async function persistConversation(username, id, msgs, titleHint) {
    await window.storage.set(`conv:${username}:${id}`, JSON.stringify(msgs), true);
    setConvIndex((prev) => {
      const exists = prev.find((c) => c.id === id);
      let next;
      if (exists) {
        next = prev.map((c) => (c.id === id ? { ...c, updatedAt: Date.now() } : c));
      } else {
        next = [{ id, title: titleHint.slice(0, 48), updatedAt: Date.now() }, ...prev];
      }
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      window.storage.set(`convindex:${username}`, JSON.stringify(next), true).catch(() => {});
      return next;
    });
  }

  function handleFilePick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAttachedImage({ dataUrl: reader.result, mediaType: file.type });
    reader.readAsDataURL(file);
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && !attachedImage) || loading) return;

    const userMsg = { role: "user", text, image: attachedImage?.dataUrl || null };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setAttachedImage(null);
    setLoading(true);

    try {
      const apiMessages = newMessages.map((m) => {
        if (m.image) {
          const base64 = m.image.split(",")[1];
          const mediaType = m.image.substring(5, m.image.indexOf(";"));
          return {
            role: m.role,
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: m.text || "Solve this." },
            ],
          };
        }
        return { role: m.role, content: m.text };
      });

      const response = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          messages: apiMessages,
        }),
      });
      const data = await response.json();
      const raw = data.content?.map((c) => c.text || "").join("") || "{}";
      const clean = raw.replace(/```json|```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch {
        parsed = { reply: raw, has_steps: false, steps: [], final_answer: "", verify_expression: "", plot: null };
      }

      let verification = null;
      if (parsed.verify_expression && parsed.verify_expression.trim()) {
        try {
          const computed = math.evaluate(parsed.verify_expression);
          verification = { ok: true, value: computed.toString(), expr: parsed.verify_expression };
        } catch {
          verification = { ok: false, value: null, expr: parsed.verify_expression };
        }
      }

      let plotData = null;
      if (parsed.plot && parsed.plot.expression) {
        try {
          const { expression, x_min, x_max } = parsed.plot;
          const pts = [];
          const steps = 60;
          for (let i = 0; i <= steps; i++) {
            const x = x_min + ((x_max - x_min) * i) / steps;
            let y = null;
            try {
              y = math.evaluate(expression, { x });
              if (typeof y !== "number" || !isFinite(y)) y = null;
            } catch {
              y = null;
            }
            pts.push({ x: Number(x.toFixed(3)), y: y !== null ? Number(y.toFixed(3)) : null });
          }
          plotData = { expression, points: pts };
        } catch {
          plotData = null;
        }
      }

      const assistantMsg = {
        role: "assistant",
        text: parsed.reply || "",
        hasSteps: !!parsed.has_steps,
        steps: parsed.steps || [],
        finalAnswer: parsed.final_answer || "",
        verification,
        plot: plotData,
      };

      const finalMessages = [...newMessages, assistantMsg];
      setMessages(finalMessages);

      const convId = activeConvId || newId();
      if (!activeConvId) setActiveConvId(convId);
      const titleHint = text || "Image question";
      await persistConversation(currentUser, convId, finalMessages, titleHint);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: "Something went wrong reaching the AI. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setCurrentUser(null);
    setMessages([]);
    setConvIndex([]);
    setActiveConvId(null);
    setScreen("auth");
    setAuthForm({ username: "", password: "" });
  }

  if (screen === "auth") {
    return (
      <div className="cx-root">
        <GlobalStyles />
        <div className="auth-wrap">
          <div className="auth-brand">
            <span className="auth-logo">∞</span>
            <div>
              <div className="auth-name">Continuum</div>
              <div className="auth-tag">an AI that talks, and never gets the math wrong</div>
            </div>
          </div>
          <div className="auth-card">
            <div className="auth-tabs">
              <button className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAuthError(""); }}>Log in</button>
              <button className={authMode === "signup" ? "active" : ""} onClick={() => { setAuthMode("signup"); setAuthError(""); }}>Sign up</button>
            </div>
            <input
              placeholder="Username"
              value={authForm.username}
              onChange={(e) => setAuthForm((f) => ({ ...f, username: e.target.value }))}
            />
            <input
              placeholder="Password"
              type="password"
              value={authForm.password}
              onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            {authError && <div className="auth-error">{authError}</div>}
            <button className="auth-submit" onClick={handleAuth} disabled={authBusy}>
              {authBusy ? "Please wait…" : authMode === "login" ? "Log in" : "Create account"}
            </button>
            <div className="auth-note">Demo account system — for real use, don't reuse a sensitive password here.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cx-root">
      <GlobalStyles />
      <div className={`app-shell ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="sidebar">
          <div className="sidebar-top">
            <button className="new-chat" onClick={startNewConversation}>
              <Plus size={16} /> New chat
            </button>
            <button className="icon-btn only-mobile" onClick={() => setSidebarOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="conv-list">
            {convIndex.map((c) => (
              <div
                key={c.id}
                className={`conv-item ${c.id === activeConvId ? "active" : ""}`}
                onClick={() => loadConversation(currentUser, c.id)}
              >
                {c.title || "Untitled"}
              </div>
            ))}
            {convIndex.length === 0 && <div className="conv-empty">No saved chats yet</div>}
          </div>
          <div className="sidebar-bottom">
            <div className="user-pill">{currentUser}</div>
            <button className="icon-btn" onClick={logout}><LogOut size={15} /></button>
          </div>
        </div>

        <div className="main-col">
          <div className="topbar">
            <button className="icon-btn" onClick={() => setSidebarOpen((s) => !s)}><Menu size={17} /></button>
            <div className="topbar-title">Continuum</div>
            <div style={{ width: 17 }} />
          </div>

          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-glyph">∑</div>
                <div className="empty-title">Ask anything, in any language.</div>
                <div className="empty-sub">Chat normally, or drop a math problem — even a photo of one.</div>
              </div>
            )}
            {messages.map((m, i) => (
              <MessageBubble key={i} msg={m} />
            ))}
            {loading && <div className="thinking">Continuum is thinking…</div>}
          </div>

          <div className="input-bar">
            {attachedImage && (
              <div className="attach-preview">
                <img src={attachedImage.dataUrl} alt="attached" />
                <button onClick={() => setAttachedImage(null)}><X size={12} /></button>
              </div>
            )}
            <div className="input-row">
              <button className="icon-btn" onClick={() => fileRef.current?.click()}><Paperclip size={17} /></button>
              <input type="file" accept="image/*" ref={fileRef} style={{ display: "none" }} onChange={handleFilePick} />
              <input
                className="chat-input"
                placeholder="Message Continuum…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
              />
              <button className="send-btn" onClick={handleSend} disabled={loading}><Send size={16} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`bubble-row ${isUser ? "user" : "assistant"}`}>
      <div className={`bubble ${isUser ? "user" : "assistant"}`}>
        {msg.image && <img className="msg-image" src={msg.image} alt="attachment" />}
        {msg.text && <div className="bubble-text">{msg.text}</div>}

        {!isUser && msg.hasSteps && (msg.steps || []).length > 0 && (
          <div className="steps-block">
            {msg.steps.map((s, i) => (
              <div className="step" key={i}>
                <div className="step-num">{i + 1}</div>
                <div className="step-body">
                  <div className="step-title">{s.title}</div>
                  <div className="step-work">{s.work}</div>
                  {s.note && <div className="step-note">{s.note}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {!isUser && msg.finalAnswer && (
          <div className="final-box">
            <div className="final-label">FINAL ANSWER</div>
            <div className="final-answer">{msg.finalAnswer}</div>
            {msg.verification && (
              <div className={`verify-row ${msg.verification.ok ? "ok" : "bad"}`}>
                {msg.verification.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                {msg.verification.ok
                  ? ` Verified: ${msg.verification.expr} = ${msg.verification.value}`
                  : ` Could not verify: ${msg.verification.expr}`}
              </div>
            )}
          </div>
        )}

        {!isUser && msg.plot && (
          <div className="plot-box">
            <div className="plot-label">y = {msg.plot.expression}</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={msg.plot.points}>
                <CartesianGrid stroke="#2A3548" strokeDasharray="3 3" />
                <XAxis dataKey="x" stroke="#8B96A8" fontSize={11} />
                <YAxis stroke="#8B96A8" fontSize={11} />
                <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #2A3548", fontSize: 12 }} />
                <Line type="monotone" dataKey="y" stroke="#E8A33D" dot={false} strokeWidth={2} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      .cx-root {
        --bg: #0E1116;
        --panel: #161B22;
        --panel-2: #1C2330;
        --border: #2A3548;
        --text: #E9ECF1;
        --muted: #8B96A8;
        --amber: #E8A33D;
        --violet: #8B7FD1;
        --green: #4C9A6A;
        --red: #C1584A;
        font-family: 'IBM Plex Sans', Inter, sans-serif;
        background: var(--bg);
        color: var(--text);
        min-height: 100vh;
      }

      .auth-wrap { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; gap: 34px; }
      .auth-brand { display: flex; align-items: center; gap: 14px; }
      .auth-logo { font-size: 34px; color: var(--amber); font-family: 'Source Serif Pro', Georgia, serif; }
      .auth-name { font-family: 'Source Serif Pro', Georgia, serif; font-size: 24px; font-weight: 700; }
      .auth-tag { color: var(--muted); font-size: 13px; }
      .auth-card { background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 26px; width: 340px; display: flex; flex-direction: column; gap: 12px; }
      .auth-tabs { display: flex; gap: 6px; background: var(--panel-2); border-radius: 10px; padding: 4px; margin-bottom: 6px; }
      .auth-tabs button { flex: 1; background: transparent; border: none; color: var(--muted); padding: 8px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; }
      .auth-tabs button.active { background: var(--amber); color: #14100a; }
      .auth-card input { background: var(--panel-2); border: 1px solid var(--border); color: var(--text); padding: 11px 14px; border-radius: 9px; font-size: 14px; outline: none; }
      .auth-card input:focus { border-color: var(--amber); }
      .auth-error { color: var(--red); font-size: 12.5px; }
      .auth-submit { background: var(--amber); color: #14100a; border: none; padding: 11px; border-radius: 9px; font-weight: 700; cursor: pointer; margin-top: 4px; }
      .auth-submit:disabled { opacity: 0.6; }
      .auth-note { color: var(--muted); font-size: 11px; text-align: center; margin-top: 4px; line-height: 1.4; }

      .app-shell { display: grid; grid-template-columns: 260px 1fr; height: 100vh; }
      .app-shell.collapsed { grid-template-columns: 0px 1fr; }
      .sidebar { background: var(--panel); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
      .sidebar-top { display: flex; gap: 8px; padding: 14px; }
      .new-chat { flex: 1; display: flex; align-items: center; gap: 8px; justify-content: center; background: var(--panel-2); border: 1px solid var(--border); color: var(--text); padding: 10px; border-radius: 9px; cursor: pointer; font-size: 13.5px; font-weight: 600; }
      .new-chat:hover { border-color: var(--amber); }
      .only-mobile { display: none; }
      .icon-btn { background: transparent; border: none; color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 6px; border-radius: 7px; }
      .icon-btn:hover { color: var(--text); background: var(--panel-2); }
      .conv-list { flex: 1; overflow-y: auto; padding: 6px 10px; }
      .conv-item { padding: 9px 10px; border-radius: 8px; font-size: 13px; color: var(--muted); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .conv-item:hover { background: var(--panel-2); color: var(--text); }
      .conv-item.active { background: var(--panel-2); color: var(--amber); }
      .conv-empty { color: var(--muted); font-size: 12.5px; padding: 10px; }
      .sidebar-bottom { display: flex; align-items: center; justify-content: space-between; padding: 14px; border-top: 1px solid var(--border); }
      .user-pill { font-size: 13px; color: var(--text); font-family: 'IBM Plex Mono', monospace; }

      .main-col { display: flex; flex-direction: column; height: 100vh; }
      .topbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--border); }
      .topbar-title { font-family: 'Source Serif Pro', Georgia, serif; font-size: 15px; color: var(--muted); }

      .chat-scroll { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
      .empty-state { margin: auto; text-align: center; color: var(--muted); }
      .empty-glyph { font-size: 40px; color: var(--violet); font-family: 'Source Serif Pro', Georgia, serif; margin-bottom: 10px; }
      .empty-title { font-size: 16px; color: var(--text); font-weight: 600; margin-bottom: 4px; }
      .empty-sub { font-size: 13px; }

      .bubble-row { display: flex; }
      .bubble-row.user { justify-content: flex-end; }
      .bubble { max-width: 74%; padding: 13px 16px; border-radius: 14px; font-size: 14.5px; line-height: 1.55; }
      .bubble.user { background: var(--amber); color: #14100a; border-bottom-right-radius: 4px; }
      .bubble.assistant { background: var(--panel); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
      .msg-image { max-width: 220px; border-radius: 10px; margin-bottom: 8px; display: block; }
      .thinking { color: var(--muted); font-family: 'IBM Plex Mono', monospace; font-size: 12px; }

      .steps-block { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
      .step { display: flex; gap: 10px; }
      .step-num { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background: var(--violet); color: #fff; font-family: 'IBM Plex Mono', monospace; font-size: 11px; display: flex; align-items: center; justify-content: center; }
      .step-title { font-weight: 600; font-size: 13.5px; margin-bottom: 3px; }
      .step-work { font-family: 'IBM Plex Mono', monospace; font-size: 13.5px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 7px; padding: 8px 11px; white-space: pre-wrap; }
      .step-note { color: var(--muted); font-size: 11.5px; margin-top: 3px; }

      .final-box { margin-top: 12px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
      .final-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 1.5px; color: var(--muted); margin-bottom: 4px; }
      .final-answer { font-family: 'IBM Plex Mono', monospace; font-size: 16px; font-weight: 700; color: var(--amber); }
      .verify-row { margin-top: 6px; font-size: 11.5px; display: flex; align-items: center; gap: 5px; }
      .verify-row.ok { color: var(--green); }
      .verify-row.bad { color: var(--red); }

      .plot-box { margin-top: 12px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px; }
      .plot-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); margin-bottom: 6px; }

      .input-bar { border-top: 1px solid var(--border); padding: 14px 20px 20px; }
      .attach-preview { display: inline-flex; align-items: center; gap: 6px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 6px; margin-bottom: 8px; }
      .attach-preview img { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; }
      .attach-preview button { background: transparent; border: none; color: var(--muted); cursor: pointer; }
      .input-row { display: flex; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 6px 8px; }
      .chat-input { flex: 1; background: transparent; border: none; outline: none; color: var(--text); font-size: 14.5px; padding: 8px; }
      .send-btn { background: var(--amber); border: none; color: #14100a; width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
      .send-btn:disabled { opacity: 0.5; }

      @media (max-width: 760px) {
        .app-shell { grid-template-columns: 1fr; }
        .sidebar { position: fixed; inset: 0 30% 0 0; z-index: 20; }
        .app-shell.collapsed .sidebar { display: none; }
        .only-mobile { display: flex; }
        .bubble { max-width: 88%; }
      }
    `}</style>
  );
}
