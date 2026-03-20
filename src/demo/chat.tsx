/**
 * Demo chat UI — standalone web page for the demo experience.
 *
 * Self-contained HTML with embedded CSS/JS. No external dependencies
 * beyond the Ollama-compatible API endpoint. Renders a clean chat
 * interface that showcases agent interaction.
 */

/** Full-page chat UI. Inlined styles + JS so it works standalone. */
export function DemoChatPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ClawHQ Demo — Talk to Your Agent</title>
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #0f0f14;
            color: #e0e0e8;
            height: 100vh;
            display: flex;
            flex-direction: column;
          }
          header {
            background: #1a1a24;
            border-bottom: 1px solid #2a2a3a;
            padding: 0.75rem 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }
          header .logo {
            font-size: 1.25rem;
            font-weight: 700;
            background: linear-gradient(135deg, #6366f1, #a855f7);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          header .badge {
            background: #22c55e22;
            color: #22c55e;
            padding: 0.2rem 0.6rem;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
          }
          header .info {
            margin-left: auto;
            color: #666;
            font-size: 0.8rem;
          }
          #messages {
            flex: 1;
            overflow-y: auto;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }
          .msg {
            max-width: 72ch;
            padding: 0.75rem 1rem;
            border-radius: 12px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-wrap: break-word;
          }
          .msg.user {
            align-self: flex-end;
            background: #3730a3;
            color: #e0e7ff;
            border-bottom-right-radius: 4px;
          }
          .msg.assistant {
            align-self: flex-start;
            background: #1e1e2e;
            border: 1px solid #2a2a3a;
            border-bottom-left-radius: 4px;
          }
          .msg.system {
            align-self: center;
            color: #888;
            font-size: 0.85rem;
            font-style: italic;
            background: none;
            padding: 0.25rem;
          }
          .msg strong { color: #a78bfa; }
          .msg code {
            background: #ffffff10;
            padding: 0.1rem 0.3rem;
            border-radius: 3px;
            font-size: 0.9em;
          }
          #input-area {
            background: #1a1a24;
            border-top: 1px solid #2a2a3a;
            padding: 1rem 1.5rem;
            display: flex;
            gap: 0.75rem;
          }
          #input-area input {
            flex: 1;
            background: #0f0f14;
            border: 1px solid #2a2a3a;
            color: #e0e0e8;
            padding: 0.75rem 1rem;
            border-radius: 8px;
            font-size: 1rem;
            outline: none;
            transition: border-color 0.2s;
          }
          #input-area input:focus { border-color: #6366f1; }
          #input-area input::placeholder { color: #555; }
          #input-area button {
            background: linear-gradient(135deg, #6366f1, #7c3aed);
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
          }
          #input-area button:hover { opacity: 0.9; }
          #input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
          .typing { color: #888; font-style: italic; }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
          .typing-dot { animation: pulse 1.2s infinite; }
        `}</style>
      </head>
      <body>
        <header>
          <span class="logo">ClawHQ</span>
          <span class="badge">DEMO</span>
          <span class="info">Replace ChatGPT Plus blueprint &middot; Press Ctrl+C in terminal to exit</span>
        </header>

        <div id="messages">
          <div class="msg system">Welcome to ClawHQ demo. This agent runs locally — zero data leaves your machine.</div>
          <div class="msg assistant">Hi! I'm your personal agent, running the <strong>Replace ChatGPT Plus</strong> blueprint. I can help with research, email triage, calendar management, and task tracking. Everything stays on your machine. Try asking me something!</div>
        </div>

        <div id="input-area">
          <input
            id="chat-input"
            type="text"
            placeholder="Type a message... (try: check my calendar, search for articles, show my tasks)"
            autocomplete="off"
          />
          <button id="send-btn" type="button">Send</button>
        </div>

        <script>{`
          const messages = [];
          const msgContainer = document.getElementById("messages");
          const input = document.getElementById("chat-input");
          const sendBtn = document.getElementById("send-btn");

          function renderMarkdown(text) {
            return text
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")
              .replace(/\`(.+?)\`/g, "<code>$1</code>")
              .replace(/\\n/g, "<br>");
          }

          function addMsg(role, content) {
            const div = document.createElement("div");
            div.className = "msg " + role;
            div.innerHTML = renderMarkdown(content);
            msgContainer.appendChild(div);
            msgContainer.scrollTop = msgContainer.scrollHeight;
            return div;
          }

          async function send() {
            const text = input.value.trim();
            if (!text) return;

            input.value = "";
            addMsg("user", text);
            messages.push({ role: "user", content: text });

            sendBtn.disabled = true;
            const typingDiv = addMsg("assistant", '<span class="typing"><span class="typing-dot">Thinking...</span></span>');

            try {
              const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: "demo-agent",
                  messages: messages,
                  stream: false,
                }),
              });
              const data = await res.json();
              const reply = data.message?.content || "I couldn't process that request.";
              messages.push({ role: "assistant", content: reply });
              typingDiv.innerHTML = renderMarkdown(reply);
            } catch (err) {
              typingDiv.innerHTML = '<span style="color: #ef4444;">Connection error. Is the demo still running?</span>';
            }
            sendBtn.disabled = false;
            input.focus();
            msgContainer.scrollTop = msgContainer.scrollHeight;
          }

          sendBtn.addEventListener("click", send);
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          });
          input.focus();
        `}</script>
      </body>
    </html>
  );
}
