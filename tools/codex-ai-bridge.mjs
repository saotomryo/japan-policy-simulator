import http from "node:http";

const bridgePort = Number(process.env.CODEX_AI_BRIDGE_PORT || 45124);
const codexUrl = process.env.CODEX_APP_SERVER_URL || "ws://127.0.0.1:45123";
const codexRequestTimeoutMs = Number(process.env.CODEX_AI_BRIDGE_TIMEOUT_MS || 900000);
const defaultAllowedOrigins = [
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://[::1]:4173",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://[::1]:5173",
  "https://saotomryo.github.io",
];
const allowedOrigins = new Set([
  ...defaultAllowedOrigins,
  ...(process.env.CODEX_AI_BRIDGE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

function codexHttpUrl(pathname) {
  const url = new URL(codexUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function codexReadyStatus() {
  try {
    const response = await fetch(codexHttpUrl("/readyz"), { method: "GET" });
    if (!response.ok) {
      return { codexReady: false, codexError: `Codex App Server readyz failed: ${response.status}` };
    }
    return { codexReady: true };
  } catch (error) {
    return { codexReady: false, codexError: error.message };
  }
}

function corsOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return "http://127.0.0.1:4173";
  if (allowedOrigins.has(origin)) return origin;
  try {
    const url = new URL(origin);
    if ((url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1") && ["http:", "https:"].includes(url.protocol)) {
      return origin;
    }
  } catch {
    return "null";
  }
  return "null";
}

function sendJson(request, response, status, body) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": corsOrigin(request),
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function parseJsonFromText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return JSON.parse(match[1]);
  throw new Error(`Codex response did not contain JSON: ${trimmed.slice(0, 240) || "(empty)"}`);
}

function extractAgentText(turn, streamedText) {
  const messages = turn?.items
    ?.filter((item) => item.type === "agentMessage" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean);
  return messages?.length ? messages.at(-1) : streamedText.trim();
}

function extractRawResponseText(rawItems) {
  const texts = [];
  for (const item of rawItems) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text.trim());
      }
    }
  }
  return texts.filter(Boolean).at(-1) || "";
}

function normalizeSchemaForCodex(value) {
  if (Array.isArray(value)) return value.map(normalizeSchemaForCodex);
  if (!value || typeof value !== "object") return value;
  const next = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$schema" && key !== "$id")
      .map(([key, child]) => [key, normalizeSchemaForCodex(child)]),
  );
  if (next.type === "object" && next.properties && typeof next.properties === "object") {
    next.required = Object.keys(next.properties);
    next.additionalProperties = false;
  }
  return next;
}

function codexRequest({ schemaName, prompt, schema, model }) {
  const codexSchema = normalizeSchemaForCodex(schema);
  const jsonPrompt = [
    "あなたは日本版仮想政策シミュレーターの熟議支援AIです。",
    "次の入力を読み、指定されたJSON Schemaに従うJSONだけを返してください。",
    "Markdown、説明文、コードフェンスは不要です。",
    "",
    `Schema name: ${schemaName}`,
    JSON.stringify({ schema: codexSchema, input: JSON.parse(prompt) }, null, 2),
  ].join("\n");

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(codexUrl);
    const pending = new Map();
    let nextId = 1;
    let streamedText = "";
    let activeThreadId = null;
    let waitForTurnCompleted = null;
    const completedItems = [];
    const rawItems = [];
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Codex app server request timed out after ${Math.round(codexRequestTimeoutMs / 60000)} minutes`));
    }, codexRequestTimeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      pending.clear();
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }

    function request(method, params) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((requestResolve, requestReject) => {
        pending.set(id, { resolve: requestResolve, reject: requestReject });
      });
    }

    socket.addEventListener("error", () => {
      cleanup();
      reject(new Error(`Codex app server is not reachable: ${codexUrl}`));
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "item/agentMessage/delta") {
        streamedText += message.params?.delta || "";
        return;
      }
      if (message.method === "turn/completed" && message.params?.threadId === activeThreadId && waitForTurnCompleted) {
        waitForTurnCompleted(message.params.turn);
        waitForTurnCompleted = null;
        return;
      }
      if (message.method === "item/completed" && message.params?.threadId === activeThreadId) {
        completedItems.push(message.params.item);
        return;
      }
      if (message.method === "rawResponseItem/completed" && message.params?.threadId === activeThreadId) {
        rawItems.push(message.params.item);
        return;
      }
      if (!message.id || !pending.has(message.id)) return;
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        handlers.reject(new Error(message.error.message || "Codex app server request failed"));
      } else {
        handlers.resolve(message.result);
      }
    });

    socket.addEventListener("open", async () => {
      try {
        await request("initialize", {
          clientInfo: { name: "national-policy-simulator", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        });
        const threadStart = await request("thread/start", {
          model: model || null,
          cwd: null,
          approvalPolicy: "never",
          sandbox: "read-only",
          ephemeral: true,
          experimentalRawEvents: true,
          persistExtendedHistory: false,
        });
        activeThreadId = threadStart.thread.id;
        const turnStart = await request("turn/start", {
          threadId: activeThreadId,
          input: [{ type: "text", text: jsonPrompt, text_elements: [] }],
          outputSchema: codexSchema,
          approvalPolicy: "never",
        });
        const completedTurn =
          turnStart.turn?.status === "completed"
            ? turnStart.turn
            : await new Promise((turnResolve) => {
                waitForTurnCompleted = turnResolve;
              });
        const rawText =
          extractAgentText({ ...completedTurn, items: completedItems.length ? completedItems : completedTurn.items }, streamedText) ||
          extractRawResponseText(rawItems);
        if (!rawText.trim()) {
          throw new Error(
            `Codex completed without text: status=${completedTurn.status}; error=${completedTurn.error?.message || "none"}; streamed=${streamedText.length}; items=${completedItems.length}; rawItems=${rawItems.length}`,
          );
        }
        cleanup();
        resolve(parseJsonFromText(rawText));
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }
  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(request, response, 200, { ok: true, codexUrl, ...(await codexReadyStatus()) });
    return;
  }
  if (request.method !== "POST" || request.url !== "/codex-json") {
    sendJson(request, response, 404, { error: "not_found" });
    return;
  }
  try {
    const payload = JSON.parse(await readBody(request));
    const result = await codexRequest(payload);
    sendJson(request, response, 200, { result });
  } catch (error) {
    sendJson(request, response, 500, { error: error.message });
  }
});

server.listen(bridgePort, "127.0.0.1", () => {
  console.log(`codex-ai-bridge listening on http://127.0.0.1:${bridgePort}`);
  console.log(`using codex app server ${codexUrl}`);
  console.log(`codex app server request timeout ${Math.round(codexRequestTimeoutMs / 60000)} minutes`);
});
