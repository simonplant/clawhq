/**
 * Mock LLM server — Ollama-compatible API for demo mode.
 *
 * Provides /api/chat and /api/tags endpoints so the demo works
 * without Ollama installed. Returns context-aware responses that
 * showcase what a configured agent would do.
 */

import { createServer, type Server } from "node:http";

const MOCK_MODEL = "demo-agent";

const DEMO_RESPONSES: readonly string[] = [
  "Good morning! I've triaged your inbox — 4 emails need your attention, 12 were routine (archived). Your first meeting is at 10am with the product team. Focus block 2-4pm is protected. Want me to draft replies for the flagged emails?",
  "I found 3 articles relevant to your research query. Here's a summary:\n\n1. **Local-first AI agents** — covers privacy-preserving architectures\n2. **Sovereign computing trends** — market analysis of self-hosted solutions\n3. **Agent orchestration patterns** — technical deep-dive on multi-tool agents\n\nWant me to create a detailed digest?",
  "I've checked your calendar for the week:\n- Monday: 2 meetings, 3hr focus time\n- Tuesday: Clear until 2pm standup\n- Wednesday: Client call at 11am (prep notes ready)\n- Thursday: All-day deep work blocked\n- Friday: Weekly review at 4pm\n\nShould I reschedule anything?",
  "Task list updated. You have 6 items due this week:\n- [HIGH] Finalize proposal draft (due Tuesday)\n- [HIGH] Review security audit results (due Wednesday)\n- [MED] Update team documentation (due Thursday)\n- [MED] Prepare weekly metrics (due Friday)\n- [LOW] Organize shared drive folders\n- [LOW] Update profile settings\n\nI can help draft the proposal if you'd like to start there.",
  "I noticed your email from John about Thursday's standup — it conflicts with your client call at 11am. I've drafted a reschedule suggestion for your approval:\n\n> \"Hi John, could we move Thursday's standup to 9am? I have a client call at the current time. Thanks!\"\n\nApprove, edit, or skip?",
];

let responseIndex = 0;

function getNextResponse(): string {
  const resp = DEMO_RESPONSES[responseIndex % DEMO_RESPONSES.length] ?? DEMO_RESPONSES[0] ?? "";
  responseIndex++;
  return resp;
}

interface OllamaChatMessage {
  role: string;
  content: string;
}

interface OllamaChatRequest {
  model?: string;
  messages?: OllamaChatMessage[];
  stream?: boolean;
}

function buildChatResponse(content: string): string {
  return JSON.stringify({
    model: MOCK_MODEL,
    created_at: new Date().toISOString(),
    message: { role: "assistant", content },
    done: true,
    total_duration: 850_000_000,
    load_duration: 10_000_000,
    prompt_eval_count: 42,
    eval_count: content.length,
    eval_duration: 800_000_000,
  });
}

function buildTagsResponse(): string {
  return JSON.stringify({
    models: [
      {
        name: MOCK_MODEL,
        modified_at: new Date().toISOString(),
        size: 1_000_000,
        digest: "demo0000000000000000000000000000000000000000000000000000000000",
        details: {
          format: "demo",
          family: "clawhq-demo",
          parameter_size: "0B",
          quantization_level: "none",
        },
      },
    ],
  });
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Start the mock LLM server on the given port.
 * Returns the running server and a close function.
 */
export async function startMockLlm(
  port: number,
): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (req, res) => {
      const url = req.url ?? "/";

      // CORS headers for browser requests
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      // GET /api/tags — list models
      if (url === "/api/tags" && req.method === "GET") {
        res.writeHead(200);
        res.end(buildTagsResponse());
        return;
      }

      // POST /api/chat — chat completion
      if (url === "/api/chat" && req.method === "POST") {
        try {
          const body = await readBody(req);
          const parsed = JSON.parse(body) as OllamaChatRequest;

          // Use last user message to pick a contextual response
          const userMsg = parsed.messages
            ?.filter((m) => m.role === "user")
            .pop()?.content ?? "";

          let response: string;
          if (/hello|hi|hey|morning/i.test(userMsg)) {
            response = DEMO_RESPONSES[0] ?? "";
          } else if (/research|article|search|find/i.test(userMsg)) {
            response = DEMO_RESPONSES[1] ?? "";
          } else if (/calendar|schedule|meeting|week/i.test(userMsg)) {
            response = DEMO_RESPONSES[2] ?? "";
          } else if (/task|todo|list|due/i.test(userMsg)) {
            response = DEMO_RESPONSES[3] ?? "";
          } else if (/email|mail|inbox|draft/i.test(userMsg)) {
            response = DEMO_RESPONSES[4] ?? "";
          } else {
            response = getNextResponse();
          }

          if (parsed.stream === false) {
            res.writeHead(200);
            res.end(buildChatResponse(response));
          } else {
            // Streaming: send one chunk then done
            res.writeHead(200, { "Content-Type": "application/x-ndjson" });
            // Send content in a single chunk for simplicity
            res.write(
              JSON.stringify({
                model: MOCK_MODEL,
                created_at: new Date().toISOString(),
                message: { role: "assistant", content: response },
                done: false,
              }) + "\n",
            );
            res.end(
              JSON.stringify({
                model: MOCK_MODEL,
                created_at: new Date().toISOString(),
                message: { role: "assistant", content: "" },
                done: true,
                total_duration: 850_000_000,
                eval_count: response.length,
              }) + "\n",
            );
          }
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid request" }));
        }
        return;
      }

      // Fallback
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port,
        close: () => { server.close(); },
      });
    });
  });
}
