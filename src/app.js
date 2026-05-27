let appData;
let saveStatus = "未保存";
let aiNotice = "";
let activeView = "dashboard";
let activeVoiceChart = "map";
let activeAnnualChart = "metrics";
let selectedAnnualMetricIds = ["support", "academic", "rule", "participation"];
let activeDashboardAnalysis = "related";
let activeVoiceEffectAxis = "income";
let activePolicyEffectAxis = "income";
let activeResultEffectAxis = "related";
let activePolicyPanel = "cost";
let activeFreePolicyScale = "standard";
let freePolicyDraftText = "";

const providerPresets = {
  sample: { label: "固定サンプル", baseUrl: "", model: "sample" },
  codex_app_server: { label: "Codex App Server (local bridge)", baseUrl: "http://127.0.0.1:45124/codex-json", model: "" },
  openai_responses: { label: "OpenAI Responses", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  openai_compatible_chat: { label: "OpenAI互換 Chat Completions", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
};

function loadStoredAiConfig() {
  const stored = JSON.parse(localStorage.getItem("national-policy-ai-config") || localStorage.getItem("school-sim-ai-config") || "{}");
  const preset = providerPresets[stored.provider] || providerPresets.sample;
  return {
    provider: stored.provider || "sample",
    baseUrl: stored.baseUrl || preset.baseUrl,
    model: stored.model || preset.model,
    apiKey: sessionStorage.getItem("national-policy-ai-key") || sessionStorage.getItem("school-sim-ai-key") || "",
  };
}

let aiConfig = loadStoredAiConfig();

const saveDb = {
  name: "national-policy-simulator",
  version: 1,
  store: "saveFiles",
  defaultId: "default",
};

function currentTurn(data = appData) {
  return data.turn || { year: 1, term: 1 };
}

function termLabel(turn = currentTurn()) {
  if (appData?.scenario?.id === "national") return "単発実行";
  return `${turn.term}学期`;
}

function nextTurnValue(turn = currentTurn()) {
  if (turn.term >= 3) {
    return { year: turn.year + 1, term: 1 };
  }
  return { year: turn.year, term: turn.term + 1 };
}

async function loadDashboardData() {
  const response = await fetch(`./data/scenarios/national/dashboard.json?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load dashboard data: ${response.status}`);
  }
  const data = await response.json();
  return prepareInitialNationalFlow(data);
}

function emptyPolicyDraft() {
  return {
    title: "政策案未生成",
    summary: "",
    budget: 0,
    cashUse: 0,
    financePlan: "政策ターゲット決定後に生成",
    covers: [],
    implementationDetails: [],
    expectedEffects: [],
    concerns: [],
    beneficiaryGroups: [],
    lowBenefitGroups: [],
    shortTermEffects: {},
    longTermEffects: {},
    risks: [],
    effects: [],
    costBreakdown: [],
  };
}

function prepareInitialNationalFlow(data) {
  if (data?.scenario?.id !== "national") return data;
  return {
    ...data,
    targetMockData: buildInitialTargetMockData(data),
    voices: [],
    voiceAnalysis: null,
    issueSelectionChat: {
      title: "政策分析チャット",
      messages: [
        {
          role: "assistant",
          text: "政策ターゲットを選択または自由記述で追加し、「声の分析へ進む」で仮想データと初期政策案を生成します。",
        },
      ],
      selectedIssueId: null,
    },
    policy: emptyPolicyDraft(),
    policyChat: {
      title: "政策案をチャットで調整",
      messages: [
        {
          role: "assistant",
          text: "政策ターゲット決定後に、初期政策案を生成してから調整できます。",
        },
      ],
    },
    lastSimulationResult: null,
    memory: null,
    hiddenScoreValues: {},
    annualReport: null,
  };
}

function buildInitialTargetMockData(data) {
  const targetId = data.issueSelectionChat?.selectedIssueId;
  if (!targetId) return {};
  const hasPreparedMock = data.voices?.length || data.voiceAnalysis || data.policy?.effects?.length;
  if (!hasPreparedMock) return {};
  return {
    [targetId]: deepClone({
      voices: data.voices || [],
      voiceAnalysis: data.voiceAnalysis || null,
      policy: data.policy || emptyPolicyDraft(),
      policyChat: data.policyChat || null,
      segmentEffects: data.segmentEffects || {},
    }),
  };
}

function openSaveDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(saveDb.name, saveDb.version);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(saveDb.store)) {
        db.createObjectStore(saveDb.store, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function withSaveStore(mode, callback) {
  const db = await openSaveDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(saveDb.store, mode);
    const store = transaction.objectStore(saveDb.store);
    const result = callback(store);
    transaction.addEventListener("complete", () => {
      db.close();
      resolve(result);
    });
    transaction.addEventListener("error", () => {
      db.close();
      reject(transaction.error);
    });
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function mapMetrics(metrics) {
  return Object.fromEntries(metrics.map((metric) => [metric.id, metric.value]));
}

function mapMetricDeltas(metrics) {
  return Object.fromEntries(metrics.map((metric) => [metric.id, metric.delta || 0]));
}

function mapFinance(financeMetrics) {
  return Object.fromEntries(financeMetrics.map((metric) => [metric.id, metric.value]));
}

function mapFinanceDeltas(financeMetrics) {
  return Object.fromEntries(financeMetrics.map((metric) => [metric.id, metric.delta || 0]));
}

function currentSeasonalEvents(data = appData, turn = currentTurn(data)) {
  return (data.seasonalEvents || []).filter((event) => !event.term || event.term === turn.term);
}

function buildGroupMemory(data) {
  if (data.memory?.groupMemory?.length) {
    return data.memory.groupMemory;
  }
  return data.groups.map((group) => ({
    groupId: group.id,
    support: group.positive,
    frustration: group.negative,
    trust: Math.max(0, Math.min(100, group.positive - group.negative + 50)),
    voiceActivity: Math.round((group.positive + group.negative) / 2),
    concerns: data.issues
      .filter((issue) => issue.summary.includes(group.label.replace("層", "")) || issue.metrics.includes("公平感"))
      .map((issue) => issue.title)
      .slice(0, 3),
    lastChangeReason: `${data.scenario.termLabel}開始時点のペルソナ発話と課題候補から推定`,
    relatedEventIds: ["event_initial_opinions", "event_initial_issues"],
  }));
}

function currentHiddenScores(data) {
  return Object.fromEntries(data.hiddenScores.map((score) => [score.id, data.hiddenScoreValues?.[score.id] || 0]));
}

function formatSignedValue(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

function hiddenScoreTone(scoreId, value) {
  if (scoreId === "polarization" || scoreId === "fatigue") {
    if (value > 5) return "risk";
    if (value > 0) return "warn";
    return "good";
  }
  if (value < -5) return "risk";
  if (value < 1) return "warn";
  return "good";
}

function buildInitialMemory(data) {
  const visibleMetrics = mapMetrics(data.metrics.filter((metric) => metric.visible));
  const allMetrics = mapMetrics(data.metrics);
  const hiddenScores = currentHiddenScores(data);
  const finance = mapFinance(data.financeMetrics);
  const groupDeltas = Object.fromEntries(data.groups.map((group) => [group.id, group.positive - group.negative]));
  const now = new Date().toISOString();
  return {
    timeline: [
      {
        turnId: "year1-term1",
        label: data.scenario.termLabel,
        startSnapshot: {
          visibleMetrics,
          allMetrics,
          hiddenScores,
          finance,
          groups: buildGroupMemory(data),
        },
        endSnapshot: {
          visibleMetrics,
          allMetrics,
          hiddenScores,
          finance,
          groups: buildGroupMemory(data),
        },
        metricDeltas: mapMetricDeltas(data.metrics),
        hiddenScoreDeltas: {},
        financeDelta: mapFinanceDeltas(data.financeMetrics),
        groupDeltas,
        policyId: data.policy?.title ? "current_policy" : null,
        summary: "初期データから作成したメモリースナップショット",
      },
    ],
    eventLog: [
      {
        id: "event_initial_opinions",
        turnId: "year1-term1",
        type: "opinion_generated",
        createdAt: now,
        summary: "初期ペルソナ発話を保存",
        payload: { voices: data.voices },
      },
      {
        id: "event_initial_issues",
        turnId: "year1-term1",
        type: "issue_extracted",
        createdAt: now,
        summary: "初期課題候補を保存",
        payload: { issues: data.issues },
      },
      {
        id: "event_issue_chat",
        turnId: "year1-term1",
        type: "issue_chat",
        createdAt: now,
        summary: "課題選択チャット履歴を保存",
        payload: { issueSelectionChat: data.issueSelectionChat },
      },
    ],
    groupMemory: buildGroupMemory(data),
    memorySummary: {
      operationPattern: "初期状態。生徒会はキャッシュ制約を意識しながら、服装自由度、公平性、自習環境を主要論点として扱っている。",
      successfulPolicies: data.policy?.title ? [data.policy.title] : [],
      remainingSideEffects: ["公平感の低下", "教師負担の増加リスク"],
      groupRisks: data.groups
        .filter((group) => group.negative > group.positive)
        .map((group) => `${group.label}の不満が表面化しやすい`),
      nextTurnConsiderations: ["キャッシュ残高", "少数派への説明", "施策運用の負担"],
    },
  };
}

function getMemory(data) {
  return data.memory || buildInitialMemory(data);
}

function buildIssueSelectionChatSnapshot(data) {
  return {
    title: data.issueSelectionChat?.title || "課題選択チャット",
    selectedIssueId: data.issueSelectionChat?.selectedIssueId || null,
    messages: (data.issueSelectionChat?.messages || []).map((message) => ({
      role: message.role,
      text: message.text,
    })),
  };
}

function buildPolicyChatSnapshot(data) {
  return {
    messages: (data.policyChat?.messages || []).map((message) => ({
      role: message.role,
      text: message.text,
    })),
  };
}

function buildPolicySnapshot(data) {
  return data.policy ? JSON.parse(JSON.stringify(data.policy)) : null;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildEventLogForSave(memory, data, exportedAt) {
  const issueChatEvent = {
    id: "event_issue_chat_current",
    turnId: `year${currentTurn(data).year}-term${currentTurn(data).term}`,
    type: "issue_chat",
    createdAt: exportedAt,
    summary: isNationalScenario(data) ? "保存時点の政策ターゲットチャット履歴" : "保存時点の課題選択チャット履歴",
    payload: { issueSelectionChat: buildIssueSelectionChatSnapshot(data) },
  };
  return [...memory.eventLog.filter((event) => event.id !== issueChatEvent.id), issueChatEvent];
}

function assertSaveFileHasNoSecrets(saveFile) {
  const serialized = JSON.stringify(saveFile);
  if (/apiKey|authorization|bearer|codex/i.test(serialized)) {
    throw new Error("保存データに認証情報らしき文字列が含まれています");
  }
}

function buildSaveFile(data) {
  const visibleMetrics = mapMetrics(data.metrics.filter((metric) => metric.visible));
  const allMetrics = mapMetrics(data.metrics);
  const hiddenScores = currentHiddenScores(data);
  const finance = mapFinance(data.financeMetrics);
  const memory = getMemory(data);
  const now = new Date().toISOString();

  const saveFile = {
    schemaVersion: "1.0.0",
    app: {
      scenarioId: data.scenario.id,
      stateType: isNationalScenario(data) ? "national-policy-simulation-state" : "school-simulation-state",
      exportedAt: now,
      appVersion: "0.1.0",
    },
    currentState: {
      year: currentTurn(data).year,
      term: currentTurn(data).term,
      seed: data.scenario.seed,
      baseYear: data.scenario.baseYear || null,
      status: data.scenario.status || null,
      visibleMetrics,
      allMetrics,
      hiddenScores,
      finance,
      metrics: deepClone(data.metrics),
      financeMetrics: deepClone(data.financeMetrics),
      seasonalEvents: deepClone(data.seasonalEvents || []),
      voices: deepClone(data.voices),
      voiceAnalysis: deepClone(data.voiceAnalysis),
      issues: deepClone(data.issues),
      policyTargets: deepClone(data.policyTargets || []),
      targetMockData: deepClone(data.targetMockData || {}),
      selectedIssueId: data.issueSelectionChat.selectedIssueId || null,
      selectedPolicyTargetId: data.issueSelectionChat.selectedIssueId || null,
      issueSelectionChat: buildIssueSelectionChatSnapshot(data),
      policyDraft: buildPolicySnapshot(data),
      policyChat: buildPolicyChatSnapshot(data),
      activePolicyDraftId: data.policy?.title ? "current_policy" : null,
      populationSegments: deepClone(data.populationSegments || []),
      internationalRelations: deepClone(data.internationalRelations || []),
      segmentEffects: deepClone(data.segmentEffects || {}),
      lastSimulationResult: deepClone(data.lastSimulationResult || null),
      hiddenScoreValues: deepClone(data.hiddenScoreValues || {}),
    },
    timeline: memory.timeline,
    eventLog: buildEventLogForSave(memory, data, now),
    groupMemory: memory.groupMemory,
    memorySummary: memory.memorySummary,
    annualReport: data.annualReport || null,
  };
  assertSaveFileHasNoSecrets(saveFile);
  return saveFile;
}

function validateSaveFile(saveFile) {
  if (!saveFile || saveFile.schemaVersion !== "1.0.0") {
    throw new Error("対応していない保存データです");
  }
  for (const key of ["app", "currentState", "timeline", "eventLog", "groupMemory", "memorySummary"]) {
    if (!(key in saveFile)) {
      throw new Error(`保存データに ${key} がありません`);
    }
  }
  return saveFile;
}

async function saveToBrowserCache() {
  const saveFile = buildSaveFile(appData);
  await withSaveStore("readwrite", (store) => store.put({ id: saveDb.defaultId, saveFile, updatedAt: saveFile.app.exportedAt }));
  localStorage.setItem("national-policy-last-save-id", saveDb.defaultId);
  localStorage.removeItem("school-sim-last-save-id");
  saveStatus = `ブラウザ保存済み ${new Date(saveFile.app.exportedAt).toLocaleString("ja-JP")}`;
  App(appData);
}

async function loadFromBrowserCache() {
  const record = await withSaveStore("readonly", (store) => requestToPromise(store.get(saveDb.defaultId)));
  if (!record?.saveFile) {
    throw new Error("ブラウザ内に保存データがありません");
  }
  applySaveFile(record.saveFile);
  saveStatus = `ブラウザ保存から復元 ${new Date(record.updatedAt).toLocaleString("ja-JP")}`;
  App(appData);
}

async function clearBrowserCache() {
  await withSaveStore("readwrite", (store) => store.delete(saveDb.defaultId));
  localStorage.removeItem("national-policy-last-save-id");
  localStorage.removeItem("school-sim-last-save-id");
  saveStatus = "ブラウザ保存を削除しました";
  App(appData);
}

function exportSaveFile() {
  const saveFile = buildSaveFile(appData);
  const blob = new Blob([JSON.stringify(saveFile, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${isNationalScenario() ? "national-policy-simulator" : "school-simulator"}-${saveFile.app.exportedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  saveStatus = "JSONを書き出しました";
  App(appData);
}

function applySaveFile(saveFile) {
  validateSaveFile(saveFile);
  if (saveFile.app?.scenarioId) {
    appData.scenario.id = saveFile.app.scenarioId;
  }
  if (saveFile.currentState?.year && saveFile.currentState?.term) {
    appData.turn = { year: saveFile.currentState.year, term: saveFile.currentState.term };
    appData.scenario.termLabel = termLabel(appData.turn);
  }
  if (saveFile.currentState?.baseYear) {
    appData.scenario.baseYear = saveFile.currentState.baseYear;
  }
  if (saveFile.currentState?.status) {
    appData.scenario.status = saveFile.currentState.status;
  }
  const latestTimeline = saveFile.timeline.at(-1);
  const metricSnapshot = saveFile.currentState?.allMetrics || latestTimeline?.endSnapshot?.allMetrics || latestTimeline?.endSnapshot?.visibleMetrics;
  if (metricSnapshot) {
    appData.metrics = appData.metrics.map((metric) => ({
      ...metric,
      value: metricSnapshot[metric.id] ?? metric.value,
      delta: latestTimeline?.metricDeltas?.[metric.id] ?? metric.delta,
    }));
  }
  if (saveFile.currentState?.metrics) {
    appData.metrics = saveFile.currentState.metrics;
  }
  if (latestTimeline?.endSnapshot?.finance) {
    appData.financeMetrics = appData.financeMetrics.map((metric) => ({
      ...metric,
      value: latestTimeline.endSnapshot.finance[metric.id] ?? metric.value,
      delta: latestTimeline?.financeDelta?.[metric.id] ?? metric.delta,
    }));
  }
  if (saveFile.currentState?.financeMetrics) {
    appData.financeMetrics = saveFile.currentState.financeMetrics;
  }
  if (saveFile.currentState?.voices) {
    appData.voices = saveFile.currentState.voices;
  }
  if (saveFile.currentState?.voiceAnalysis) {
    appData.voiceAnalysis = saveFile.currentState.voiceAnalysis;
  }
  if (saveFile.currentState?.issues) {
    appData.issues = saveFile.currentState.issues;
  }
  if (saveFile.currentState?.policyTargets) {
    appData.policyTargets = saveFile.currentState.policyTargets;
  }
  if (saveFile.currentState?.targetMockData) {
    appData.targetMockData = saveFile.currentState.targetMockData;
  }
  if (saveFile.currentState?.populationSegments) {
    appData.populationSegments = saveFile.currentState.populationSegments;
  }
  if (saveFile.currentState?.internationalRelations) {
    appData.internationalRelations = saveFile.currentState.internationalRelations;
  }
  if (saveFile.currentState?.segmentEffects) {
    appData.segmentEffects = saveFile.currentState.segmentEffects;
  }
  if ("lastSimulationResult" in (saveFile.currentState || {})) {
    appData.lastSimulationResult = saveFile.currentState.lastSimulationResult;
  }
  if (saveFile.currentState?.hiddenScoreValues) {
    appData.hiddenScoreValues = saveFile.currentState.hiddenScoreValues;
  }
  if (saveFile.currentState?.seasonalEvents) {
    appData.seasonalEvents = saveFile.currentState.seasonalEvents;
  }
  if (saveFile.currentState?.selectedPolicyTargetId || saveFile.currentState?.selectedIssueId) {
    appData.issueSelectionChat.selectedIssueId = saveFile.currentState.selectedPolicyTargetId || saveFile.currentState.selectedIssueId;
  }
  const savedIssueChat =
    saveFile.currentState?.issueSelectionChat ||
    saveFile.eventLog
      ?.slice()
      .reverse()
      .find((event) => event.type === "issue_chat" && event.payload?.issueSelectionChat)?.payload.issueSelectionChat;
  if (savedIssueChat?.messages?.length) {
    appData.issueSelectionChat = {
      title: savedIssueChat.title || "課題選択チャット",
      selectedIssueId: savedIssueChat.selectedIssueId || saveFile.currentState?.selectedPolicyTargetId || saveFile.currentState?.selectedIssueId || null,
      messages: savedIssueChat.messages,
    };
  }
  if (saveFile.currentState?.policyDraft) {
    appData.policy = saveFile.currentState.policyDraft;
  }
  if (saveFile.currentState?.policyChat?.messages?.length) {
    appData.policyChat = saveFile.currentState.policyChat;
  }
  appData.memory = {
    timeline: saveFile.timeline,
    eventLog: saveFile.eventLog,
    groupMemory: saveFile.groupMemory,
    memorySummary: saveFile.memorySummary,
  };
  appData.annualReport = saveFile.annualReport || null;
}

async function importSaveFile(file) {
  const text = await file.text();
  applySaveFile(JSON.parse(text));
  saveStatus = `JSONから復元 ${new Date().toLocaleString("ja-JP")}`;
  App(appData);
}

async function loadSchema(name) {
  const response = await fetch(`./data/schemas/${name}.schema.json?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load schema: ${name}`);
  }
  return response.json();
}

function providerRequiresApiKey(provider = aiConfig.provider) {
  return provider !== "sample" && provider !== "codex_app_server";
}

function hasAiConnection() {
  if (aiConfig.provider === "sample") return false;
  if (providerRequiresApiKey()) return Boolean(aiConfig.apiKey);
  return Boolean(aiConfig.baseUrl);
}

function saveAiConfig(formData) {
  const provider = formData.get("provider") || "sample";
  const preset = providerPresets[provider] || providerPresets.sample;
  aiConfig = {
    provider,
    baseUrl: formData.get("baseUrl") || preset.baseUrl,
    model: formData.get("model") || preset.model,
    apiKey: formData.get("apiKey") || "",
  };
  if (aiConfig.apiKey) {
    sessionStorage.setItem("national-policy-ai-key", aiConfig.apiKey);
    sessionStorage.removeItem("school-sim-ai-key");
  } else {
    sessionStorage.removeItem("national-policy-ai-key");
    sessionStorage.removeItem("school-sim-ai-key");
  }
  localStorage.setItem(
    "national-policy-ai-config",
    JSON.stringify({
      provider: aiConfig.provider,
      baseUrl: aiConfig.baseUrl,
      model: aiConfig.model,
    }),
  );
  localStorage.removeItem("school-sim-ai-config");
  aiNotice = "";
}

function extractResponseText(responseJson) {
  if (typeof responseJson.output_text === "string") {
    return responseJson.output_text;
  }
  const output = responseJson.output || [];
  for (const item of output) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

function validateRequiredFields(schema, value) {
  if (!value || typeof value !== "object") {
    throw new Error("AI response is not an object");
  }
  for (const key of schema.required || []) {
    if (!(key in value)) {
      throw new Error(`AI response missing required field: ${key}`);
    }
  }
  return value;
}

function parseJsonFromText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    return JSON.parse(match[1]);
  }
  throw new Error("AI response did not contain JSON");
}

function providerLabel() {
  return providerPresets[aiConfig.provider]?.label || aiConfig.provider;
}

function aiStatusText() {
  if (!hasAiConnection()) {
    return "固定サンプル fallback";
  }
  if (aiConfig.provider === "codex_app_server") {
    return `${providerLabel()} / ${aiConfig.baseUrl}`;
  }
  return `${providerLabel()} / ${aiConfig.model}`;
}

function setAiFallbackNotice(error) {
  aiNotice = `${providerLabel()} に接続できなかったため固定サンプルにfallbackしました: ${error.message}`;
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function callOpenAIResponsesJson({ schemaName, prompt, schema }) {
  const response = await fetch(`${aiConfig.baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: aiConfig.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "あなたは学園自治シミュレーターの熟議支援AIです。必ず指定されたJSON Schemaに従って日本語で返してください。",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: schema.title || schemaName.replaceAll("-", "_"),
          schema,
          strict: false,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI request failed: ${response.status} ${body.slice(0, 160)}`);
  }

  const rawText = extractResponseText(await response.json());
  return validateRequiredFields(schema, parseJsonFromText(rawText));
}

async function callOpenAICompatibleChatJson({ schemaName, prompt, schema }) {
  const response = await fetch(`${aiConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: aiConfig.model,
      messages: [
        {
          role: "system",
          content: "あなたは学園自治シミュレーターの熟議支援AIです。必ず指定されたJSON Schemaに従ってJSONだけを返してください。",
        },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schema.title || schemaName.replaceAll("-", "_"),
          schema,
          strict: false,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI request failed: ${response.status} ${body.slice(0, 160)}`);
  }

  const data = await response.json();
  return validateRequiredFields(schema, parseJsonFromText(data.choices?.[0]?.message?.content || ""));
}

function extractAgentText(turn, streamedText) {
  const messages = turn?.items
    ?.filter((item) => item.type === "agentMessage" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean);
  if (messages?.length) {
    return messages.at(-1);
  }
  return streamedText.trim();
}

async function callCodexAppServerJson({ schemaName, prompt, schema }) {
  const endpoint = aiConfig.baseUrl || providerPresets.codex_app_server.baseUrl;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schemaName, prompt, schema, model: aiConfig.model || null }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Codex local bridge failed: ${response.status}`);
  }
  return validateRequiredFields(schema, data.result);
}

async function callProviderJson({ schemaName, prompt }) {
  const schema = await loadSchema(schemaName);
  if (aiConfig.provider === "codex_app_server") {
    return callCodexAppServerJson({ schemaName, prompt, schema });
  }
  if (aiConfig.provider === "openai_responses") {
    return callOpenAIResponsesJson({ schemaName, prompt, schema });
  }
  if (aiConfig.provider === "openai_compatible_chat") {
    return callOpenAICompatibleChatJson({ schemaName, prompt, schema });
  }
  throw new Error(`Provider is not implemented: ${aiConfig.provider}`);
}

function sampleIssueSelectionResponse(userText) {
  if (isNationalScenario()) {
    return {
      message: `「${userText}」については、選択政策の関連指標と推奨ビューを確認します。消費税減税では所得別・世代別の便益差と財源補填が中心で、国際関係は該当性が低めです。`,
      recommendedIssueIds: [selectedPolicyTarget()?.id || "consumption_tax_cut"],
      reasoning: ["relatedMetricIdsに税負担感・家計可処分所得・財政余力が含まれる", "recommendedViewsで所得別と世代別が優先される", "財源制約は警告として扱う"],
      questionsToUser: ["所得別、世代別、財政影響のどれを先に確認しますか？"],
      financeAssessment: { cashFeasibleIssueIds: [selectedPolicyTarget()?.id || "consumption_tax_cut"], requiresBudgetReallocationIssueIds: [], notes: ["初期政策案は現実的な財源制約を意識して生成します。"] },
    };
  }
  return {
    message: `「${userText}」については、キャッシュ42000の範囲なら服装自由度と公平性を主課題にするのが現実的です。低価格推奨服と相談導線を組み合わせると、自由度を上げつつ格差不安を抑えられます。`,
    recommendedIssueIds: ["uniform"],
    reasoning: [
      "生徒支持と校則納得の両方に影響する",
      "18000規模ならキャッシュ内で実行できる",
      "少数派の不安を補完策へ変換しやすい"
    ],
    questionsToUser: ["教師負担を抑える運用ルールも同時に検討しますか？"],
    financeAssessment: {
      cashFeasibleIssueIds: ["uniform", "study"],
      requiresBudgetReallocationIssueIds: ["club"],
      notes: ["部活動予算の偏りは他予算の調整が必要になる可能性があります。"]
    }
  };
}

function formatIssueFit(issue) {
  const fit = Number(issue.fit || 0);
  return fit > 0 && fit <= 1 ? Math.round(fit * 100) : Math.round(fit);
}

function sampleIssueDetailResponse(issue) {
  const cash = appData.financeMetrics.find((metric) => metric.id === "cash")?.value || 0;
  const metrics = issue.metrics?.join(" / ") || "関連指標未設定";
  if (isNationalScenario()) {
    const policyTarget = (appData.policyTargets || []).find((target) => target.id === issue.id) || issue;
    return {
      message: `政策「${issue.title}」を選択しました。関連指標は ${metrics} です。推奨ビューは ${(policyTarget.recommendedViews || ["関連指標"]).join(" / ")} で、政策内容に応じて表示軸を切り替えながら影響を確認します。財源上の注意: ${policyTarget.fundingNote || "政策案生成時に確認します。"}`,
      recommendedIssueIds: [issue.id],
      reasoning: ["政策ごとに関連指標を優先表示する", "世代別・所得別などの効果軸は固定せず切り替える", "該当性が低い効果軸は理由を表示する"],
      questionsToUser: ["この政策で声の分析に進みますか？"],
      financeAssessment: { cashFeasibleIssueIds: [issue.id], requiresBudgetReallocationIssueIds: [], notes: [`短期財源余地${cash}を参考に、財源懸念は警告として扱います。`] },
    };
  }
  return {
    message: `「${issue.title}」を選択しました。この課題は ${metrics} に関係し、代表発話からは不便さだけでなく公平感や参加しやすさへの不安も読み取れます。適合度は${formatIssueFit(issue)}%で、今学期のキャッシュ${cash}の範囲で小さく試せる施策に落とし込みやすい候補です。次は、どの属性に効かせるか、運用負担をどこまで許容するか、他の課題も同時に軽くできるかを確認すると施策案に進みやすくなります。`,
    recommendedIssueIds: [issue.id],
    reasoning: [
      "表示されている関連指標に直接影響しやすい",
      "代表発話から具体的な施策条件へ変換しやすい",
      "キャッシュ制約の中で試行しやすい",
    ],
    questionsToUser: ["この課題を主課題として、施策検討に進めますか？"],
    financeAssessment: {
      cashFeasibleIssueIds: [issue.id],
      requiresBudgetReallocationIssueIds: [],
      notes: [`現時点のキャッシュ${cash}を前提に、まず小規模施策として検討できます。`],
    },
  };
}

async function discussIssueSelection(userText) {
  const prompt = JSON.stringify(
    {
      task: "課題候補を深掘りし、今学期に扱う課題選択を支援してください。",
      userMessage: userText,
      simulation: {
        scenario: appData.scenario,
        visibleMetrics: appData.metrics.filter((metric) => metric.visible),
        financeMetrics: appData.financeMetrics,
        voices: appData.voices,
        issueCandidates: appData.issues,
      },
      constraints: [
        "1学期に実施する施策は1つ",
        "基本はキャッシュの範囲内で実施",
        "他予算充当が必要な場合は副作用も述べる",
        "最終決定はユーザーが行う",
      ],
    },
    null,
    2,
  );

  if (!hasAiConnection()) {
    return sampleIssueSelectionResponse(userText);
  }

  try {
    return await withTimeout(
      callProviderJson({
        schemaName: "issue-selection-chat-response",
        prompt,
      }),
      30000,
      "課題選択チャットのAI応答が30秒以内に返りませんでした",
    );
  } catch (error) {
    console.warn(error);
    setAiFallbackNotice(error);
    if (aiConfig.provider !== "sample") {
      return {
        message: `AI接続に失敗しました。固定サンプル応答は使っていません。${error.message}`,
        recommendedIssueIds: [appData.issueSelectionChat.selectedIssueId].filter(Boolean),
        reasoning: ["Codex App Server / AI Bridge の接続またはJSON応答を確認してください"],
        questionsToUser: ["ローカルの codex:app-server と codex:ai-bridge は起動していますか？"],
        financeAssessment: {
          cashFeasibleIssueIds: [],
          requiresBudgetReallocationIssueIds: [],
          notes: ["AI接続失敗のため財務評価は未実行です。"],
        },
      };
    }
    return sampleIssueSelectionResponse(userText);
  }
}

async function explainIssueSelection(issue) {
  const prompt = JSON.stringify(
    {
      task: "ユーザーが画面上の課題候補を選択しました。チャット欄に表示するため、選択課題の意味、背景、関連する声、指標、財務制約、次に確認すべき論点を説明してください。",
      selectedIssue: issue,
      simulation: {
        scenario: appData.scenario,
        visibleMetrics: appData.metrics.filter((metric) => metric.visible),
        financeMetrics: appData.financeMetrics,
        voices: appData.voices,
        voiceAnalysis: appData.voiceAnalysis,
        issueCandidates: appData.issues,
        memorySummary: getMemory(appData).memorySummary,
      },
      constraints: [
        "この時点では施策を決定しない",
        "1学期に実施する施策は1つ",
        "基本はキャッシュ範囲内で検討する",
        "生徒会が次に深掘りできる問いを含める",
      ],
    },
    null,
    2,
  );

  if (!hasAiConnection()) {
    return sampleIssueDetailResponse(issue);
  }

  try {
    return await withTimeout(
      callProviderJson({
        schemaName: "issue-selection-chat-response",
        prompt,
      }),
      30000,
      "課題詳細説明のAI応答が30秒以内に返りませんでした",
    );
  } catch (error) {
    console.warn(error);
    setAiFallbackNotice(error);
    if (aiConfig.provider !== "sample") {
      return {
        message: `課題「${issue.title}」を選択しましたが、AI接続に失敗したため詳細説明は生成できませんでした。${error.message}`,
        recommendedIssueIds: [issue.id],
        reasoning: ["Codex App Server / AI Bridge の接続またはJSON応答を確認してください"],
        questionsToUser: ["接続復旧後に、この課題の詳細説明を再生成しますか？"],
        financeAssessment: {
          cashFeasibleIssueIds: [],
          requiresBudgetReallocationIssueIds: [],
          notes: ["AI接続失敗のため財務評価は未実行です。"],
        },
      };
    }
    return sampleIssueDetailResponse(issue);
  }
}

function selectedIssue() {
  const issue = appData.issues.find((candidate) => candidate.id === appData.issueSelectionChat.selectedIssueId);
  return isNationalScenario() ? issue || null : issue || appData.issues[0];
}

function groupLabel(groupId) {
  return appData.groups.find((group) => group.id === groupId)?.label || groupId;
}

function policyChat() {
  if (!appData.policyChat) {
    appData.policyChat = {
      messages: [
        {
          role: "assistant",
          text: "施策案を生成すると、実施内容・効果・懸念点・属性別影響を見ながらチャットで修正できます。",
        },
      ],
    };
  }
  return appData.policyChat;
}

function samplePolicyDraft() {
  const issue = selectedIssue();
  if (issue?.id === "study_space") {
    return {
      id: "exam_week_study_rooms",
      title: "テスト前2週間の放課後自習室拡張",
      summary: "空き教室と図書室の一部をテスト前だけ自習スペースとして開放し、見回り負担を当番制で抑える。",
      primaryIssueId: issue.id,
      secondaryIssueIds: ["rule_operation"],
      budget: 12000,
      cashUse: 12000,
      financePlan: "キャッシュ内で実施。備品購入と掲示物作成に限定する。",
      implementationDetails: [
        "テスト前2週間だけ、空き教室2室と図書室の一角を放課後90分開放する。",
        "静音ルール、利用上限、席の予約方法を1枚の案内にまとめる。",
        "見回りは生徒会当番と担当教員の短時間確認を組み合わせる。",
      ],
      expectedEffects: [
        "学習場所不足への不満を下げ、成績指標と参加率の改善を狙う。",
        "受験重視層にも生徒会施策の意味が伝わりやすくなる。",
      ],
      concerns: ["静音ルールの運用負担", "利用者が受験重視層に偏る可能性"],
      beneficiaryGroups: [{ groupId: "exam", label: groupLabel("exam"), reason: "放課後に静かに学べる場所が増えるため、直接的なメリットが大きい。" }],
      lowBenefitGroups: [{ groupId: "club", label: groupLabel("club"), reason: "部活動時間と重なるため、利用機会が限られる可能性がある。" }],
      shortTermEffects: { academic: 5, participation: 4, support: 2 },
      longTermEffects: { trust: 2, fatigue: 1 },
      risks: ["静音ルールの運用負担", "利用者が受験重視層に偏る可能性"],
    };
  }
  if (issue?.id === "participation_cost") {
    return {
      id: "no_purchase_uniform_guideline",
      title: "購入不要を明記した選択制服ガイド",
      summary: "手持ち服で参加できる基準を明文化し、購入を前提にしない例示と相談導線を追加する。",
      primaryIssueId: issue.id,
      secondaryIssueIds: ["rule_operation"],
      budget: 6000,
      cashUse: 6000,
      financePlan: "キャッシュ内で掲示物と説明会だけを実施する。",
      implementationDetails: [
        "購入不要で参加できる服装例を明記し、既存の服で満たせる基準を示す。",
        "相談フォームと相談窓口を案内し、困りごとを匿名でも出せるようにする。",
      ],
      expectedEffects: ["経済的負担への不安を下げ、自由化への参加ハードルを下げる。", "基準が見えることで校則納得を少し改善する。"],
      concerns: ["説明が細かくなりすぎると自由度の印象が弱まる", "相談対応の負担が増える"],
      beneficiaryGroups: [{ groupId: "lowIncome", label: groupLabel("lowIncome"), reason: "購入を前提にしないことで参加しやすくなる。" }],
      lowBenefitGroups: [{ groupId: "freedom", label: groupLabel("freedom"), reason: "自由化そのものの拡大ではないため、物足りなく見える可能性がある。" }],
      shortTermEffects: { fairness: 4, rule: 3, support: 2 },
      longTermEffects: { trust: 3, polarization: -2 },
      risks: ["基準が細かくなりすぎると制度疲労が増える"],
    };
  }
  return {
    id: "uniform_operation_guideline",
    title: "選択制服の運用ルール明文化",
    summary: "選択制服の利用日、相談先、注意基準を1枚にまとめ、教師確認の手順を簡素化する。",
    primaryIssueId: issue?.id || "rule_operation",
    secondaryIssueIds: ["participation_cost"],
    budget: 8000,
    cashUse: 8000,
    financePlan: "キャッシュ内で実施。掲示、説明会、相談フォーム整備に使う。",
    implementationDetails: [
      "選択制服の利用日、注意基準、相談先を1枚の運用ガイドにまとめる。",
      "生徒会が説明会を行い、質問を集めてFAQとして更新する。",
      "教師確認は例外ケースだけに寄せ、日常運用を簡素化する。",
    ],
    expectedEffects: ["校則納得を上げながら、自由化施策への不安を下げる。", "相談導線により少数派の不安を早めに拾える。"],
    concerns: ["ルール説明が硬くなりすぎると自由度の印象が下がる", "教師側の確認負担が残る"],
    beneficiaryGroups: [{ groupId: "rule", label: groupLabel("rule"), reason: "運用基準が明確になり、不公平感や混乱への不安が下がる。" }],
    lowBenefitGroups: [{ groupId: "exam", label: groupLabel("exam"), reason: "学習環境への直接効果は小さいため、優先度が低く見える可能性がある。" }],
    shortTermEffects: { rule: 5, support: 2, participation: 1 },
    longTermEffects: { trust: 3, fatigue: -1, publicValue: 2 },
    risks: ["ルール説明が硬くなりすぎると自由度の印象が下がる"],
  };
}

function normalizePolicyGroupItems(items = []) {
  return items.map((item) => ({
    groupId: item.groupId,
    label: item.label || groupLabel(item.groupId),
    reason: item.reason,
  }));
}

function applyPolicyDraft(draft, options = {}) {
  appData.policy = {
    id: draft.id,
    title: draft.title,
    summary: draft.summary,
    budget: draft.budget,
    cashUse: draft.cashUse,
    financePlan: draft.financePlan,
    costBreakdown: draft.costBreakdown || appData.policy?.costBreakdown || [],
    implementationDetails: draft.implementationDetails?.length ? draft.implementationDetails : [draft.summary],
    expectedEffects: draft.expectedEffects?.length
      ? draft.expectedEffects
      : Object.entries(draft.shortTermEffects || {}).map(([label, value]) => `${label}: ${value > 0 ? "+" : ""}${value}`),
    concerns: draft.concerns?.length ? draft.concerns : draft.risks || [],
    beneficiaryGroups: normalizePolicyGroupItems(draft.beneficiaryGroups),
    lowBenefitGroups: normalizePolicyGroupItems(draft.lowBenefitGroups),
    shortTermEffects: draft.shortTermEffects || {},
    longTermEffects: draft.longTermEffects || {},
    risks: draft.risks || [],
    covers: [
      selectedIssue()?.title || draft.primaryIssueId,
      ...(draft.secondaryIssueIds || [])
        .map((issueId) => appData.issues.find((issue) => issue.id === issueId)?.title || issueId)
        .slice(0, 2),
    ],
    effects: Object.entries(draft.shortTermEffects).map(([label, value]) => ({
      label,
      value,
      tone: value >= 0 ? "good" : "warn",
    })),
  };
  const chat = policyChat();
  if (options.resetChat) {
    appData.policyChat = {
      messages: [
        {
          role: "assistant",
          text: `施策案「${draft.title}」を作成しました。実施内容、効果、懸念点、属性別の影響を見ながら修正できます。`,
        },
      ],
    };
  } else {
    chat.messages.push({ role: "assistant", text: `施策案を「${draft.title}」として更新しました。` });
  }
  const memoryBefore = getMemory(appData);
  const now = new Date().toISOString();
  const turnId = `year${currentTurn().year}-term${currentTurn().term}`;
  appData.memory = {
    ...memoryBefore,
    eventLog: [
      ...memoryBefore.eventLog,
      {
        id: `event_policy_draft_${memoryBefore.eventLog.length + 1}`,
        turnId,
        type: "policy_draft_updated",
        createdAt: now,
        summary: draft.title,
        payload: { draft },
      },
    ],
  };
  saveStatus = "施策ドラフトを作成しました";
}

async function generatePolicyDraft() {
  const prompt = JSON.stringify(
    {
      task: "選択された課題に対して、今学期に1つだけ実行する施策ドラフトを作成してください。",
      simulation: {
        scenario: appData.scenario,
        selectedIssue: selectedIssue(),
        issueCandidates: appData.issues,
        visibleMetrics: appData.metrics.filter((metric) => metric.visible),
        allMetrics: appData.metrics,
        financeMetrics: appData.financeMetrics,
        seasonalEvents: currentSeasonalEvents(),
        groupMemory: getMemory(appData).groupMemory,
        memorySummary: getMemory(appData).memorySummary,
      },
      constraints: [
        "基本はキャッシュ範囲内",
        "1つの施策で複数課題に対応してよい",
        "ガードレール上のリスクをrisksに入れる",
        "implementationDetailsには実施内容を3件程度入れる",
        "costBreakdownには実施内容ごとのコスト項目、amount、target、calculation、fundingSource、detailsを入れる",
        "expectedEffectsには想定する効果を2件以上入れる",
        "concernsには懸念点を2件以上入れる",
        "beneficiaryGroupsにはメリットを享受する対象属性を入れる",
        "lowBenefitGroupsにはメリットが薄い、またはややデメリットになる対象属性を入れる",
        "shortTermEffectsは現在のmetric idをキーにする",
      ],
    },
    null,
    2,
  );

  if (!hasAiConnection()) {
    return samplePolicyDraft();
  }

  try {
    return await withTimeout(callProviderJson({ schemaName: "policy-draft", prompt }), 45000, "施策案生成のAI応答が45秒以内に返りませんでした");
  } catch (error) {
    console.warn(error);
    setAiFallbackNotice(error);
    return samplePolicyDraft();
  }
}

async function createPolicyDraftFromSelection() {
  const draft = await generatePolicyDraft();
  applyPolicyDraft(draft, { resetChat: true });
  App(appData);
}

function sampleRevisedPolicyDraft(userText) {
  const current = appData.policy;
  return {
    id: current.id || "revised_policy",
    title: current.title,
    summary: `${current.summary || current.title} 修正要望「${userText}」を反映し、実施範囲と説明を少し明確にしました。`,
    primaryIssueId: selectedIssue()?.id || "selected_issue",
    secondaryIssueIds: [],
    budget: current.budget || 0,
    cashUse: current.cashUse || 0,
    financePlan: current.financePlan || "キャッシュ範囲内で調整",
    implementationDetails: [
      ...(current.implementationDetails || []),
      "修正要望を踏まえ、対象者への事前説明と意見回収を追加する。",
    ].slice(-4),
    expectedEffects: current.expectedEffects?.length ? current.expectedEffects : ["対象課題への納得感を高める。"],
    concerns: [...(current.concerns || current.risks || []), "修正後の説明が増えすぎると実行速度が落ちる可能性がある。"].slice(-4),
    beneficiaryGroups: current.beneficiaryGroups?.length ? current.beneficiaryGroups : [{ groupId: "rule", label: groupLabel("rule"), reason: "説明が明確になることで不安が下がる。" }],
    lowBenefitGroups: current.lowBenefitGroups?.length ? current.lowBenefitGroups : [{ groupId: "exam", label: groupLabel("exam"), reason: "学習環境への直接効果は限定的。" }],
    shortTermEffects: current.shortTermEffects || Object.fromEntries((current.effects || []).map((effect) => [effect.label, effect.value])),
    longTermEffects: current.longTermEffects || { trust: 1 },
    risks: [...(current.risks || current.concerns || []), "運用負担の増加"].slice(-4),
  };
}

async function revisePolicyDraft(userText) {
  const prompt = JSON.stringify(
    {
      task: "現在の施策案を、ユーザーのチャット指示に基づいて修正してください。修正後の施策案全体を返してください。",
      userMessage: userText,
      simulation: {
        scenario: appData.scenario,
        selectedIssue: selectedIssue(),
        currentPolicy: appData.policy,
        policyChat: policyChat().messages,
        visibleMetrics: appData.metrics.filter((metric) => metric.visible),
        allMetrics: appData.metrics,
        financeMetrics: appData.financeMetrics,
        seasonalEvents: currentSeasonalEvents(),
        groups: appData.groups,
        groupMemory: getMemory(appData).groupMemory,
      },
      constraints: [
        "1学期に実施する施策は1つのままにする",
        "実施内容、想定効果、懸念点、メリットを享受する属性、メリットが薄い属性を必ず更新する",
        "costBreakdownを更新し、何に対してどうコストがかかるかをdetailsまで示す",
        "キャッシュ範囲を大きく超える場合はfinancePlanとconcernsで明記する",
        "shortTermEffectsは現在のmetric idをキーにする",
      ],
    },
    null,
    2,
  );

  if (!hasAiConnection()) {
    return sampleRevisedPolicyDraft(userText);
  }

  try {
    return await withTimeout(callProviderJson({ schemaName: "policy-draft", prompt }), 45000, "施策案修正のAI応答が45秒以内に返りませんでした");
  } catch (error) {
    console.warn(error);
    setAiFallbackNotice(error);
    return sampleRevisedPolicyDraft(userText);
  }
}

async function revisePolicyDraftFromChat(userText) {
  const draft = await revisePolicyDraft(userText);
  applyPolicyDraft(draft);
  App(appData);
}

async function generateInitialStateWithAi() {
  const prompt = JSON.stringify(
    {
      task: "学園自治シミュレーターの1学期開始時点の初期データを生成してください。",
      requirements: [
        "表示する発話は代表例であり、背後に生徒数分の声がある想定にする",
        "voiceAnalysisには意見クラスター、距離、階層クラスタを含める",
        "metricsのidは support, happiness, academic, fairness, rule, participation, externalReputation, externalAchievements, teacherSatisfaction, fiscalCapacity, socialSecurity, economicRipple, importIndustryImpact, exportIndustryImpact, manufacturingImpact, agricultureImpact, financeIndustryImpact を使う",
        "externalReputation, externalAchievements, teacherSatisfaction は visible:false にする",
        "financeMetricsのidは budget, cash を使う",
        "issuesは3件以上",
        "assistantMessageは課題選択チャットの最初のAI発話にする",
        "日本語で返す",
      ],
      baseScenario: {
        player: "生徒会",
        term: "1学期",
        policyLimit: "1学期に実施する施策は1つ",
        guardrail: "生徒は自由に提案してよいが、学校運営上認めにくい内容は背景ニーズへ変換する",
      },
    },
    null,
    2,
  );
  return callProviderJson({ schemaName: "initial-state-generation", prompt });
}

function resetTrendFromMetrics() {
  const metricValue = (id) => appData.metrics.find((metric) => metric.id === id)?.value || 50;
  appData.trend = [
    { term: "前々学期", support: clamp(metricValue("support") - 10), happiness: clamp(metricValue("happiness") - 8), fairness: clamp(metricValue("fairness") + 4) },
    { term: "前学期", support: clamp(metricValue("support") - 4), happiness: clamp(metricValue("happiness") - 3), fairness: clamp(metricValue("fairness") + 2) },
    { term: "今学期", support: metricValue("support"), happiness: metricValue("happiness"), fairness: metricValue("fairness") },
  ];
}

function applyInitialStateGeneration(generation) {
  appData.turn = { year: 1, term: 1 };
  appData.scenario = {
    ...appData.scenario,
    termLabel: "1学期",
    seed: `AI-${new Date().toISOString().slice(0, 10)}`,
  };
  appData.metrics = generation.metrics;
  appData.financeMetrics = generation.financeMetrics;
  appData.groups = generation.groups;
  appData.voices = generation.voices;
  appData.voiceAnalysis = generation.voiceAnalysis;
  appData.issues = generation.issues;
  appData.issueSelectionChat = {
    title: "課題選択チャット",
    messages: [{ role: "assistant", text: generation.assistantMessage }],
    selectedIssueId: generation.issues[0]?.id || null,
  };
  appData.policy = {
    title: "施策案をチャットで作成",
    budget: 0,
    cashUse: 0,
    financePlan: "課題選択後に検討",
    covers: ["未確定"],
    effects: [],
  };
  appData.policyChat = {
    messages: [
      {
        role: "assistant",
        text: "次学期の課題に合わせて施策案を作成できます。",
      },
    ],
  };
  appData.hiddenScoreValues = {};
  appData.lastSimulationResult = null;
  appData.annualReport = null;
  appData.memory = null;
  resetTrendFromMetrics();
  appData.memory = buildInitialMemory(appData);
  saveStatus = "AIで初期データを生成しました";
}

async function initializeWithAi() {
  if (!hasAiConnection()) {
    aiNotice = "AI Providerが選択されていないため、AI初期化は実行できません。";
    App(appData);
    return;
  }
  try {
    const generation = await generateInitialStateWithAi();
    applyInitialStateGeneration(generation);
    activeView = "dashboard";
  } catch (error) {
    console.warn(error);
    setAiFallbackNotice(error);
  }
  App(appData);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function samplePolicySimulationResult() {
  if (isNationalScenario()) {
    const cashUse = appData.policy.cashUse || 0;
    return {
      summary: `${appData.policy.title}により、短期的には家計負担感と政策納得度が改善した。一方で、財源補填と社会保障持続性への懸念は長期予想として残る。`,
      visibleMetricDeltas: {
        support: 6,
        happiness: 4,
        academic: 8,
        fairness: -3,
        rule: -11,
        participation: 2,
        externalReputation: 0,
        externalAchievements: 1,
        teacherSatisfaction: -2,
        fiscalCapacity: -7,
        socialSecurity: -4,
        economicRipple: 5,
        importIndustryImpact: 4,
        exportIndustryImpact: 1,
        manufacturingImpact: 3,
        agricultureImpact: 2,
        financeIndustryImpact: -2,
      },
      hiddenScoreDeltas: {
        trust: -2,
        polarization: 3,
        fatigue: 2,
        publicValue: -1,
      },
      financeDelta: {
        budget: 0,
        cash: -cashUse,
      },
      groupImpacts: [
        { groupId: "low_income", summary: "物価負担感の改善を強く実感", scoreDelta: 15 },
        { groupId: "middle_income", summary: "日用品・食品支出への効果を評価", scoreDelta: 11 },
        { groupId: "fiscal_conservative", summary: "財源補填が弱い点に反発", scoreDelta: -8 },
        { groupId: "indifferent", summary: "制度変更の実感が伝われば関心が上がる", scoreDelta: 3 },
      ],
      randomEvents: ["物価高への関心が続き、短期的な支持は想定より広がった"],
      nextIssues: ["財源補填の説明", "社会保障持続性の観測", "時限措置終了時の出口戦略"],
    };
  }
  const effects = appData.policy.effects || [];
  const metricDeltas = Object.fromEntries(effects.map((effect) => [effect.label, effect.value]));
  const cashUse = appData.policy.cashUse || 0;
  return {
    summary: `${appData.policy.title}により、主対象の課題には一定の改善が出た。一方で、運用負担と少数派への説明は次学期にも残った。`,
    visibleMetricDeltas: {
      support: metricDeltas.support ?? 3,
      academic: metricDeltas.academic ?? 1,
      rule: metricDeltas.rule ?? 2,
      participation: metricDeltas.participation ?? 2,
    },
    hiddenScoreDeltas: {
      trust: 4,
      polarization: -2,
      fatigue: 3,
      publicValue: 2,
    },
    financeDelta: {
      budget: 0,
      cash: -cashUse,
    },
    groupImpacts: [
      { groupId: "freedom", summary: "自由度の拡大を前向きに受け止めた", scoreDelta: 10 },
      { groupId: "exam", summary: "学習環境への直接効果は薄く、反応は小さい", scoreDelta: 1 },
      { groupId: "club", summary: "部活動予算への影響が少ないため中立", scoreDelta: 0 },
      { groupId: "rule", summary: "校則運用が曖昧になる懸念が残る", scoreDelta: -4 },
      { groupId: "lowIncome", summary: "低価格推奨服で不安は軽減したが完全には消えていない", scoreDelta: 3 },
    ],
    randomEvents: ["猛暑日が続き、選択制服の利用率が想定より高くなった"],
    nextIssues: ["施策運用の負担軽減", "少数派への説明", "次の優先課題の絞り込み"],
  };
}

async function simulatePolicyResult() {
  const prompt = JSON.stringify(
    {
      task: "採用施策の実行結果を1学期単位でシミュレーションしてください。",
      simulation: {
        scenario: appData.scenario,
        visibleMetrics: appData.metrics.filter((metric) => metric.visible),
        allMetrics: appData.metrics,
        hiddenScores: currentHiddenScores(appData),
        financeMetrics: appData.financeMetrics,
        groups: appData.groups,
        selectedIssueId: appData.issueSelectionChat.selectedIssueId,
        policy: appData.policy,
        seasonalEvents: currentSeasonalEvents(),
        memorySummary: getMemory(appData).memorySummary,
      },
      constraints: [
        "1学期に実行する施策は1つ",
        "指標変更は論理的な帰結を基本にし、軽いランダム要素を1つ加える",
        "見える指標、見えない内部スコア、財務、属性別影響を分ける",
        "キャッシュ消費と副作用を必ず扱う",
      ],
    },
    null,
    2,
  );

  if (!hasAiConnection()) {
    return samplePolicySimulationResult();
  }

  try {
    return await callProviderJson({
      schemaName: "ai-simulation-result",
      prompt,
    });
  } catch (error) {
    console.warn(error);
    setAiFallbackNotice(error);
    return samplePolicySimulationResult();
  }
}

function updateMetricSeriesAfterSimulation() {
  const row = {
    term: "実行後",
    support: appData.metrics.find((metric) => metric.id === "support")?.value || 0,
    happiness: appData.metrics.find((metric) => metric.id === "happiness")?.value || 0,
    fairness: appData.metrics.find((metric) => metric.id === "fairness")?.value || 0,
  };
  appData.trend = [...appData.trend.slice(-2), row];
}

function applySimulationResult(result) {
  const memoryBefore = getMemory(appData);
  const startSnapshot = {
    visibleMetrics: mapMetrics(appData.metrics.filter((metric) => metric.visible)),
    allMetrics: mapMetrics(appData.metrics),
    hiddenScores: currentHiddenScores(appData),
    finance: mapFinance(appData.financeMetrics),
    groups: buildGroupMemory(appData),
  };

  appData.metrics = appData.metrics.map((metric) => {
    const delta = result.visibleMetricDeltas[metric.id] || 0;
    if (!delta) return metric;
    return {
      ...metric,
      value: clamp(metric.value + delta),
      delta,
      tone: delta > 0 ? "good" : delta < 0 ? "warn" : metric.tone,
    };
  });

  appData.hiddenScoreValues = {
    ...currentHiddenScores(appData),
    ...Object.fromEntries(
      appData.hiddenScores.map((score) => {
        const current = appData.hiddenScoreValues?.[score.id] || 0;
        return [score.id, clamp(current + (result.hiddenScoreDeltas[score.id] || 0), -100, 100)];
      }),
    ),
  };

  appData.financeMetrics = appData.financeMetrics.map((metric) => {
    const delta = result.financeDelta[metric.id] || 0;
    const nextValue = metric.value + delta;
    return {
      ...metric,
      value: Math.max(0, nextValue),
      delta,
      tone: metric.id === "cash" && nextValue < 20000 ? "risk" : metric.tone,
    };
  });

  const impactsByGroup = Object.fromEntries(result.groupImpacts.map((impact) => [impact.groupId, impact]));
  appData.groups = appData.groups.map((group) => {
    const delta = impactsByGroup[group.id]?.scoreDelta || 0;
    return {
      ...group,
      positive: clamp(group.positive + Math.max(0, delta)),
      negative: clamp(group.negative + Math.min(0, delta) * -1),
      neutral: clamp(100 - clamp(group.positive + Math.max(0, delta)) - clamp(group.negative + Math.min(0, delta) * -1)),
    };
  });
  updateMetricSeriesAfterSimulation();

  const now = new Date().toISOString();
  const turnId = `year${currentTurn().year}-term${currentTurn().term}-result-${memoryBefore.eventLog.length + 1}`;
  const groupMemory = buildGroupMemory(appData).map((memory) => {
    const impact = impactsByGroup[memory.groupId];
    if (!impact) return memory;
    return {
      ...memory,
      support: clamp(memory.support + Math.max(0, impact.scoreDelta)),
      frustration: clamp(memory.frustration + Math.min(0, impact.scoreDelta) * -1),
      trust: clamp(memory.trust + impact.scoreDelta),
      lastChangeReason: impact.summary,
      relatedEventIds: [...(memory.relatedEventIds || []), `event_policy_simulated_${memoryBefore.eventLog.length + 1}`],
    };
  });
  const endSnapshot = {
    visibleMetrics: mapMetrics(appData.metrics.filter((metric) => metric.visible)),
    allMetrics: mapMetrics(appData.metrics),
    hiddenScores: currentHiddenScores(appData),
    finance: mapFinance(appData.financeMetrics),
    groups: groupMemory,
  };

  appData.lastSimulationResult = result;
  appData.memory = {
    timeline: [
      ...memoryBefore.timeline,
      {
        turnId,
        label: `${appData.scenario.termLabel} ${isNationalScenario() ? "政策実行後" : "施策実行後"}`,
        startSnapshot,
        endSnapshot,
        metricDeltas: result.visibleMetricDeltas,
        hiddenScoreDeltas: result.hiddenScoreDeltas,
        financeDelta: result.financeDelta,
        groupDeltas: Object.fromEntries(result.groupImpacts.map((impact) => [impact.groupId, impact.scoreDelta])),
        policyId: "current_policy",
        summary: result.summary,
      },
    ],
    eventLog: [
      ...memoryBefore.eventLog,
      {
        id: `event_policy_adopted_${memoryBefore.eventLog.length + 1}`,
        turnId,
        type: "policy_adopted",
        createdAt: now,
        summary: appData.policy.title,
        payload: { policy: appData.policy },
      },
      {
        id: `event_policy_simulated_${memoryBefore.eventLog.length + 2}`,
        turnId,
        type: "policy_simulated",
        createdAt: now,
        summary: result.summary,
        payload: result,
      },
    ],
    groupMemory,
    memorySummary: {
      operationPattern: `${memoryBefore.memorySummary.operationPattern} ${isNationalScenario() ? "政策実行後、短期効果と長期予想を分けて確認した。" : "施策実行後、キャッシュ制約内での小規模改善を優先した。"}`,
      successfulPolicies: [...memoryBefore.memorySummary.successfulPolicies, appData.policy.title],
      remainingSideEffects: [...new Set([...memoryBefore.memorySummary.remainingSideEffects, ...result.nextIssues])],
      groupRisks: groupMemory.filter((group) => group.frustration > group.support).map((group) => `${group.groupId} の不満が残っている`),
      nextTurnConsiderations: [...new Set([...memoryBefore.memorySummary.nextTurnConsiderations, ...result.nextIssues])],
    },
  };
  saveStatus = isNationalScenario() ? "政策実行結果をメモリーに追記しました" : "施策結果をメモリーに追記しました";
}

async function executePolicyTurn() {
  const result = await simulatePolicyResult();
  applySimulationResult(result);
  if (isNationalScenario()) activeView = "result";
  App(appData);
}

function createVoiceAnalysisFromVoicesAndIssues(voices, issues) {
  const sampledOpinionCount = Math.max(voices.length * 28, 90);
  const clusters = issues.map((issue, index) => {
    const voice = voices[index % voices.length];
    const angle = (Math.PI * 2 * index) / Math.max(issues.length, 1);
    return {
      id: issue.id,
      label: issue.title,
      size: Math.max(18, Math.round(issue.fit * 1.4)),
      sentiment: index === 0 ? -0.28 : index === 1 ? -0.08 : 0.04,
      x: Math.round(Math.cos(angle) * 70),
      y: Math.round(Math.sin(angle) * 52),
      keywords: issue.metrics.slice(0, 3),
      summary: issue.summary,
      representativeVoiceIds: [voice?.id].filter(Boolean),
    };
  });
  return {
    populationSize: appData.voiceAnalysis?.populationSize || 720,
    sampledOpinionCount,
    embeddingModel: "sample-turn-transition",
    clusters,
    distances: clusters.slice(1).map((cluster, index) => ({
      from: clusters[index].id,
      to: cluster.id,
      distance: Number((0.34 + index * 0.12).toFixed(2)),
      label: "前ターン施策後に近接する論点",
    })),
    hierarchy: {
      label: "次学期の声",
      size: sampledOpinionCount,
      children: [
        {
          label: "残った副作用",
          size: Math.round(sampledOpinionCount * 0.52),
          clusterId: null,
          children: clusters.slice(0, 2).map((cluster) => ({
            label: cluster.label,
            size: cluster.size,
            clusterId: cluster.id,
            children: [],
          })),
        },
        {
          label: "新しく浮上した論点",
          size: Math.round(sampledOpinionCount * 0.48),
          clusterId: null,
          children: clusters.slice(2).map((cluster) => ({
            label: cluster.label,
            size: cluster.size,
            clusterId: cluster.id,
            children: [],
          })),
        },
      ],
    },
  };
}

function sampleNextTurnGeneration(turn) {
  const voices = [
      {
        id: `voice_next_${turn.year}_${turn.term}_haru`,
        name: "陽菜",
        group: "校則重視層",
        mood: "懸念",
        text: "服装の選択制はよかったけれど、日によって基準が違うように見える。次は運用ルールをわかりやすくしてほしい。",
        avatar: { slot: "green", label: "陽" },
      },
      {
        id: `voice_next_${turn.year}_${turn.term}_sora`,
        name: "空",
        group: "受験重視層",
        mood: "要望",
        text: "服装の話は進んだけど、自習室の席不足はそのまま。テスト前だけでも静かな場所を増やしてほしい。",
        avatar: { slot: "sky", label: "空" },
      },
      {
        id: `voice_next_${turn.year}_${turn.term}_mei`,
        name: "芽衣",
        group: "経済的に厳しい層",
        mood: "少数意見",
        text: "低価格推奨服は助かったけれど、購入が必要に見える空気は少し気になる。持っている服でも安心して参加したい。",
        avatar: { slot: "rose", label: "芽" },
      },
    ];
  const issues = [
      {
        id: "rule_operation",
        title: "選択制服の運用ルール",
        fit: 82,
        metrics: ["校則納得", "教師負担", "信頼"],
        summary: "前学期施策の効果は出たが、運用基準の曖昧さが校則重視層と教師側の負担として残っている。",
      },
      {
        id: "study_space",
        title: "テスト前の自習環境不足",
        fit: 78,
        metrics: ["成績", "参加率"],
        summary: "受験重視層から、服装施策より学習環境を優先してほしいという声が強まっている。",
      },
      {
        id: "participation_cost",
        title: "参加コストと同調圧力",
        fit: 69,
        metrics: ["公平感", "幸福度"],
        summary: "選択制服の導入により自由度は上がった一方、購入や見た目への同調圧力を心配する少数意見が残っている。",
      },
    ];
  return {
    voices,
    voiceAnalysis: createVoiceAnalysisFromVoicesAndIssues(voices, issues),
    issues,
    assistantMessage:
      "前学期の施策で自由度と校則納得は改善しました。次は、運用ルールの明確化、自習環境不足、参加コストのどれを今学期の主課題にするかを検討できます。",
  };
}

async function generateNextTurnStart(turn) {
  const prompt = JSON.stringify(
    {
      task: "次学期開始時点の生徒発話、声の分析、課題候補を生成してください。",
      nextTurn: turn,
      simulation: {
        scenario: appData.scenario,
        previousPolicy: appData.policy,
        previousVoices: appData.voices,
        previousVoiceAnalysis: appData.voiceAnalysis,
        previousIssues: appData.issues,
        visibleMetrics: appData.metrics.filter((metric) => metric.visible),
        allMetrics: appData.metrics,
        hiddenScores: currentHiddenScores(appData),
        financeMetrics: appData.financeMetrics,
        seasonalEvents: currentSeasonalEvents(appData, turn),
        groups: appData.groups,
        groupMemory: getMemory(appData).groupMemory,
        memorySummary: getMemory(appData).memorySummary,
        lastSimulationResult: appData.lastSimulationResult,
      },
      constraints: [
        "前学期施策の結果を踏まえる",
        "前回施策がうまく効いた論点は、声量・課題優先度・クラスターサイズを下げる",
        "前回施策の副作用、取り残された属性、未対応分野から新しい声を出す",
        "voiceAnalysis.clustersのsizeは、次学期時点の声量の相対差を表す",
        "voiceAnalysis.representativeVoiceIdsはvoices内のidを参照する",
        "課題候補は3つ",
        "生徒中心の発話にする",
        "一般に認めにくい提案は課題候補にせず、背景ニーズへ変換する",
      ],
    },
    null,
    2,
  );

  if (!hasAiConnection()) {
    return sampleNextTurnGeneration(turn);
  }

  try {
    return await withTimeout(
      callProviderJson({
        schemaName: "turn-start-generation",
        prompt,
      }),
      45000,
      "次ターン生成のAI応答が45秒以内に返りませんでした",
    );
  } catch (error) {
    console.warn(error);
    setAiFallbackNotice(error);
    return sampleNextTurnGeneration(turn);
  }
}

function applyNextTurnStart(turn, generation) {
  const memoryBefore = getMemory(appData);
  const now = new Date().toISOString();
  const turnId = `year${turn.year}-term${turn.term}`;

  appData.turn = turn;
  appData.scenario.termLabel = termLabel(turn);
  appData.voices = generation.voices;
  appData.voiceAnalysis = generation.voiceAnalysis || createVoiceAnalysisFromVoicesAndIssues(generation.voices, generation.issues);
  appData.issues = generation.issues;
  appData.issueSelectionChat = {
    title: "課題選択チャット",
    messages: [{ role: "assistant", text: generation.assistantMessage }],
    selectedIssueId: generation.issues[0]?.id || null,
  };
  appData.lastSimulationResult = null;
  appData.policy = {
    ...appData.policy,
    title: "次学期の施策案をチャットで作成",
    budget: 0,
    cashUse: 0,
    financePlan: "課題選択後に検討",
    covers: ["未確定"],
    effects: [],
  };

  const snapshot = {
    visibleMetrics: mapMetrics(appData.metrics.filter((metric) => metric.visible)),
    allMetrics: mapMetrics(appData.metrics),
    hiddenScores: currentHiddenScores(appData),
    finance: mapFinance(appData.financeMetrics),
    groups: buildGroupMemory(appData),
  };

  appData.memory = {
    timeline: [
      ...memoryBefore.timeline,
      {
        turnId,
        label: `${termLabel(turn)} 開始`,
        startSnapshot: snapshot,
        endSnapshot: snapshot,
        metricDeltas: {},
        hiddenScoreDeltas: {},
        financeDelta: { budget: 0, cash: 0 },
        groupDeltas: {},
        policyId: null,
        summary: generation.assistantMessage,
      },
    ],
    eventLog: [
      ...memoryBefore.eventLog,
      {
        id: `event_opinions_${turnId}`,
        turnId,
        type: "opinion_generated",
        createdAt: now,
        summary: `${termLabel(turn)}の初期発話を生成`,
        payload: { voices: generation.voices, voiceAnalysis: appData.voiceAnalysis },
      },
      {
        id: `event_issues_${turnId}`,
        turnId,
        type: "issue_extracted",
        createdAt: now,
        summary: `${termLabel(turn)}の課題候補を生成`,
        payload: { issues: generation.issues },
      },
    ],
    groupMemory: buildGroupMemory(appData),
    memorySummary: {
      ...memoryBefore.memorySummary,
      operationPattern: `${memoryBefore.memorySummary.operationPattern} ${termLabel(turn)}では前学期の副作用を踏まえて課題を再抽出した。`,
      nextTurnConsiderations: generation.issues.map((issue) => issue.title),
    },
  };
  saveStatus = `${termLabel(turn)}を開始しました`;
}

async function advanceToNextTurn() {
  const turn = nextTurnValue();
  const generation = await generateNextTurnStart(turn);
  applyNextTurnStart(turn, generation);
  App(appData);
}

function metricLabel(metricId) {
  return appData.metrics.find((metric) => metric.id === metricId)?.label || metricId;
}

function annualMetricSeries(memory) {
  return memory.timeline
    .filter((item) => item.endSnapshot?.visibleMetrics || item.endSnapshot?.allMetrics)
    .map((item) => ({
      label: item.label,
      visibleMetrics: item.endSnapshot.visibleMetrics || {},
      allMetrics: item.endSnapshot.allMetrics || item.endSnapshot.visibleMetrics || {},
      hiddenScores: item.endSnapshot.hiddenScores || {},
      finance: item.endSnapshot.finance || {},
      metricDeltas: item.metricDeltas || {},
      hiddenScoreDeltas: item.hiddenScoreDeltas || {},
      financeDelta: item.financeDelta || {},
    }));
}

function voicesBeforeEvent(events, eventIndex) {
  for (let index = eventIndex; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "opinion_generated" && event.payload?.voices?.length) {
      return event.payload.voices.slice(0, 3);
    }
  }
  return appData.voices.slice(0, 3);
}

function buildPolicyResultRecords(memory) {
  const events = memory.eventLog;
  return events
    .map((event, index) => {
      if (event.type !== "policy_adopted") return null;
      const simulation = events.slice(index + 1).find((candidate) => candidate.type === "policy_simulated" && candidate.turnId === event.turnId);
      const timeline = memory.timeline.find((item) => item.turnId === event.turnId);
      return {
        id: event.id,
        turnId: event.turnId,
        label: timeline?.label || event.turnId,
        policy: event.payload?.policy || { title: event.summary },
        result: simulation?.payload || null,
        summary: simulation?.summary || "結果未記録",
        metricDeltas: timeline?.metricDeltas || simulation?.payload?.visibleMetricDeltas || {},
        financeDelta: timeline?.financeDelta || simulation?.payload?.financeDelta || {},
        groupImpacts: simulation?.payload?.groupImpacts || [],
        voices: voicesBeforeEvent(events, index),
      };
    })
    .filter(Boolean);
}

function metricRankings(metricSeries) {
  const first = metricSeries[0]?.allMetrics || {};
  const last = metricSeries.at(-1)?.allMetrics || {};
  const rankings = Object.keys(last)
    .map((id) => ({
      id,
      label: metricLabel(id),
      start: first[id] ?? null,
      end: last[id] ?? null,
      delta: (last[id] ?? 0) - (first[id] ?? 0),
    }))
    .filter((item) => item.start !== null && item.end !== null);
  return {
    up: rankings.filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta),
    down: rankings.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta),
  };
}

function createAnnualReport() {
  const memory = getMemory(appData);
  const visibleEnd = mapMetrics(appData.metrics.filter((metric) => metric.visible));
  const hidden = currentHiddenScores(appData);
  const policyResults = buildPolicyResultRecords(memory);
  const metricSeries = annualMetricSeries(memory);
  const rankings = metricRankings(metricSeries);
  const adoptedPolicies = policyResults.map((record) => record.policy.title || record.summary);
  const riskGroups = memory.groupMemory.filter((group) => group.frustration > group.support).map((group) => group.groupId);
  const hiddenTotal = Object.values(hidden).reduce((sum, value) => sum + value, 0);
  const grade = visibleEnd.support >= 75 && hiddenTotal >= 0 ? "A" : visibleEnd.support >= 65 ? "B" : "C";
  const finalVoices = appData.voices.slice(0, 4);
  const metricHighlights = metricSeries.at(-1)?.visibleMetrics || visibleEnd;

  appData.annualReport = {
    title: `${currentTurn().year}年目 年度末運営レポート`,
    grade,
    summary: `年間で${policyResults.length}件の施策を実施しました。見える成果では生徒支持が${visibleEnd.support}まで推移し、内部評価では信頼の蓄積と制度疲労のバランスが次年度の焦点です。`,
    operationSummary: [
      `生徒会は各学期で1施策ずつ実行し、${adoptedPolicies.join("、") || "施策未記録"}を中心に運営しました。`,
      `年度末時点の主要指標は、生徒支持${metricHighlights.support ?? "-"}、成績${metricHighlights.academic ?? "-"}、校則納得${metricHighlights.rule ?? "-"}、参加率${metricHighlights.participation ?? "-"}です。`,
      `残った論点は ${memory.memorySummary.nextTurnConsiderations.slice(0, 4).join("、")} です。`,
    ],
    metricSeries,
    metricRankings: rankings,
    adoptedPolicies,
    policyResults,
    finalVoices,
    visibleHighlights: [
      `生徒支持: ${visibleEnd.support}`,
      `校則納得: ${visibleEnd.rule}`,
      `参加率: ${visibleEnd.participation}`,
      `キャッシュ残高: ${mapFinance(appData.financeMetrics).cash}`,
    ],
    hiddenFindings: [
      `信頼の蓄積: ${hidden.trust || 0}`,
      `分断リスク: ${hidden.polarization || 0}`,
      `制度疲労: ${hidden.fatigue || 0}`,
      `長期公共性: ${hidden.publicValue || 0}`,
    ],
    minorityImpact: riskGroups.length ? `${riskGroups.join("、")} に不満が残っています。` : "大きく孤立した属性は見られません。",
    nextYearIssues: memory.memorySummary.nextTurnConsiderations.slice(0, 4),
  };

  appData.memory = {
    ...memory,
    eventLog: [
      ...memory.eventLog,
      {
        id: `event_annual_report_${memory.eventLog.length + 1}`,
        turnId: `year${currentTurn().year}-annual`,
        type: "annual_report_generated",
        createdAt: new Date().toISOString(),
        summary: appData.annualReport.summary,
        payload: appData.annualReport,
      },
    ],
  };
  saveStatus = "年度末レポートを作成しました";
  activeView = "result";
  App(appData);
}

function icon(name) {
  const paths = {
    dashboard: "M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-5H4v5Z",
    voices: "M5 5h14v10H8l-3 3V5Z",
    issue: "M12 3 3 8l9 5 9-5-9-5Zm-7 9 7 4 7-4M5 16l7 4 7-4",
    policy: "M7 3h10l3 5v13H4V3h3Zm0 0v6h13",
    result: "M4 19V5m0 14h16M8 16v-5m4 5V8m4 8v-7",
    save: "M5 4h12l2 2v14H5V4Zm3 0v6h8V4M8 17h8",
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}

function MetricTile(metric) {
  const unit = metric.id === "budget" || metric.id === "cash" ? "" : metric.unit || "";
  const tone = metricTone(metric);
  return `
    <article class="metric-tile ${tone}">
      <div>
        <span>${metric.label}</span>
        <strong>${metric.value}${unit ? `<b>${unit}</b>` : ""}</strong>
      </div>
      <small>${metric.delta > 0 ? "+" : ""}${metric.delta}</small>
    </article>
  `;
}

function isNationalScenario(data = appData) {
  return data?.scenario?.id === "national";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => (
    {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char]
  ));
}

function selectedPolicyTarget() {
  const selectedId = appData.issueSelectionChat?.selectedIssueId;
  const target = (appData.policyTargets || appData.issues || []).find((candidate) => candidate.id === selectedId);
  return isNationalScenario() ? target || null : target || (appData.policyTargets || appData.issues || [])[0];
}

function effectAxisFromRecommended(views = []) {
  const supported = ["income", "generation", "industry", "regional", "international", "fiscal", "implementation", "digital_access"];
  return views.find((view) => supported.includes(view)) || "income";
}

function resetPolicyDrivenViews(policyTarget = selectedPolicyTarget()) {
  const axis = effectAxisFromRecommended(policyTarget?.recommendedViews || []);
  activeDashboardAnalysis = ["implementation", "industry", "fiscal", "international", "social"].includes(axis) ? axis : "related";
  activeVoiceEffectAxis = axis;
  activePolicyEffectAxis = axis;
  activeResultEffectAxis = "related";
  activePolicyPanel = "cost";
}

function buildFreePolicyTarget(text, scale = activeFreePolicyScale) {
  const scaleLabels = {
    small: "小規模",
    standard: "標準",
    large: "大規模",
  };
  const scaleLabel = scaleLabels[scale] || scaleLabels.standard;
  const trimmedText = text.trim();
  const title = trimmedText.length > 30 ? `${trimmedText.slice(0, 30)}...` : trimmedText;
  return {
    id: `free_policy_${Date.now()}`,
    title,
    fit: scale === "large" ? 61 : scale === "small" ? 68 : 64,
    metrics: ["政策納得度", "経済波及効果", "財政余力", "行政現場負荷"],
    summary: `${trimmedText}。自由記述から作成した${scaleLabel}規模の政策ターゲットです。初期段階では、関連指標と国民・ステークホルダー反応を仮説として分析します。`,
    field: "自由記述・AI生成分野",
    relatedMetricIds: ["support", "economicRipple", "fiscalCapacity", "teacherSatisfaction"],
    recommendedViews: scale === "large" ? ["fiscal", "industry", "generation", "clusters"] : ["industry", "income", "fiscal", "clusters"],
    fundingNote: scale === "large"
      ? "大規模政策として、財源規模・実施体制・移行期間の制約を強めに確認します。"
      : "詳細な財源規模は政策案生成時に確認します。",
  };
}

function upsertFreePolicyTarget(policyTarget) {
  const removeFreeTargets = (item) => !item.id?.startsWith("free_policy_");
  appData.policyTargets = [policyTarget, ...(appData.policyTargets || []).filter(removeFreeTargets)];
  appData.issues = [
    {
      id: policyTarget.id,
      title: policyTarget.title,
      fit: policyTarget.fit,
      metrics: policyTarget.metrics,
      summary: policyTarget.summary,
    },
    ...(appData.issues || []).filter(removeFreeTargets),
  ];
  appData.issueSelectionChat.selectedIssueId = policyTarget.id;
  clearNationalGeneratedOutputs();
  appData.issueSelectionChat.messages.push({ role: "user", text: `自由記述政策「${policyTarget.title}」を追加しました。` });
  appData.issueSelectionChat.messages.push({
    role: "assistant",
    text: `自由記述を政策ターゲット化しました。関連指標は ${policyTarget.metrics.join(" / ")}、推奨ビューは ${policyTarget.recommendedViews.join(" / ")} です。${policyTarget.fundingNote}`,
  });
  resetPolicyDrivenViews(policyTarget);
}

function hasNationalAnalysisStarted() {
  return !isNationalScenario() || Boolean(appData.voiceAnalysis || appData.voices?.length || appData.policy?.effects?.length);
}

function clearNationalGeneratedOutputs() {
  if (!isNationalScenario()) return;
  appData.voices = [];
  appData.voiceAnalysis = null;
  appData.policy = emptyPolicyDraft();
  appData.policyChat = {
    title: "政策案をチャットで調整",
    messages: [
      {
        role: "assistant",
        text: "政策ターゲット決定後に、初期政策案を生成してから調整できます。",
      },
    ],
  };
  appData.lastSimulationResult = null;
  appData.memory = null;
}

function sampleNationalVoices(policyTarget) {
  const title = policyTarget?.title || "この政策";
  return [
    {
      id: "voice_household_support",
      name: "都市部の40代中間層",
      group: "中間層・生活防衛志向",
      mood: "条件付き賛成",
      text: `${title}で生活費や手続き負担が下がるなら期待したい。ただ、対象が広すぎると本当に困っている層に届くのかは気になる。`,
      avatar: { slot: "sky", label: "中" },
    },
    {
      id: "voice_fiscal_conservative",
      name: "財政規律を重視する保守層",
      group: "保守層・財政規律重視",
      mood: "慎重",
      text: `${title}の必要性は分かるが、恒久財源や出口戦略が曖昧なまま進めると将来世代への負担になる。`,
      avatar: { slot: "rose", label: "財" },
    },
    {
      id: "voice_progressive",
      name: "都市部のリベラル層",
      group: "リベラル層・再分配重視",
      mood: "賛成",
      text: `${title}は格差や不安に対応する政策として評価できる。所得別・世代別に効果が偏らない設計にしてほしい。`,
      avatar: { slot: "green", label: "リ" },
    },
    {
      id: "voice_business",
      name: "製造業の経営者",
      group: "産業界・実務層",
      mood: "中立",
      text: `${title}そのものより、制度変更の準備期間や事務コストが読めるかが重要。業界ごとの差も見て判断したい。`,
      avatar: { slot: "sky", label: "産" },
    },
    {
      id: "voice_indifferent",
      name: "政治ニュースをあまり追わない20代",
      group: "無関心層",
      mood: "低関心",
      text: `${title}と言われても、自分の生活にいつ何が起きるのか分かりにくい。説明が簡単なら少しは関心を持てる。`,
      avatar: { slot: "green", label: "無" },
    },
  ];
}

function sampleNationalVoiceAnalysis(policyTarget, voices) {
  const title = policyTarget?.title || "対象政策";
  return {
    populationSize: 125000000,
    sampledOpinionCount: 1200,
    embeddingModel: "national-policy-target-mock",
    clusters: [
      {
        id: "benefit_expectation",
        label: "生活改善期待",
        size: 320,
        sentiment: 0.58,
        x: 76,
        y: 72,
        keywords: ["生活", "負担軽減", "即効性", title],
        summary: "短期的な生活改善や制度利用のしやすさを評価する層。",
        representativeVoiceIds: ["voice_household_support", "voice_progressive"],
      },
      {
        id: "fiscal_warning",
        label: "財源・将来負担懸念",
        size: 240,
        sentiment: -0.52,
        x: 146,
        y: 134,
        keywords: ["財源", "将来世代", "恒久化", "出口戦略"],
        summary: "政策目的よりも財源制約と長期負担を重く見る層。",
        representativeVoiceIds: ["voice_fiscal_conservative"],
      },
      {
        id: "implementation_cost",
        label: "実務負荷・業界影響",
        size: 210,
        sentiment: -0.08,
        x: 278,
        y: 96,
        keywords: ["事務負担", "制度変更", "産業別", "準備期間"],
        summary: "業界別の影響や現場実装コストを見て態度を決める層。",
        representativeVoiceIds: ["voice_business"],
      },
      {
        id: "low_attention",
        label: "無関心・低理解",
        size: 190,
        sentiment: -0.04,
        x: 326,
        y: 158,
        keywords: ["分かりにくい", "実感", "広報", "手続き"],
        summary: "政策内容よりも説明の分かりやすさと生活実感で反応が変わる層。",
        representativeVoiceIds: ["voice_indifferent"],
      },
    ],
    distances: [
      { from: "benefit_expectation", to: "fiscal_warning", distance: 0.68, label: "財源説明で接近" },
      { from: "benefit_expectation", to: "implementation_cost", distance: 0.42, label: "制度設計への期待が近い" },
      { from: "implementation_cost", to: "low_attention", distance: 0.57, label: "説明コストが共通論点" },
      { from: "fiscal_warning", to: "low_attention", distance: 0.74, label: "関心軸が離れる" },
    ],
    hierarchy: {
      label: `${title}への反応`,
      size: 1200,
      children: [
        {
          label: "賛成・条件付き支持",
          size: 610,
          children: [
            { label: "生活改善期待", clusterId: "benefit_expectation", size: 320 },
            { label: "実務条件次第", clusterId: "implementation_cost", size: 210 },
          ],
        },
        {
          label: "慎重・低関心",
          size: 590,
          children: [
            { label: "財源懸念", clusterId: "fiscal_warning", size: 240 },
            { label: "無関心・低理解", clusterId: "low_attention", size: 190 },
          ],
        },
      ],
    },
  };
}

function sampleNationalPolicyDraft(policyTarget = selectedPolicyTarget()) {
  const title = policyTarget?.title || "対象政策";
  const isDx = policyTarget?.id === "gov_dx";
  const isChild = policyTarget?.id === "child_support";
  const budget = isDx ? 8200 : isChild ? 26000 : 42000;
  const directLabel = isDx ? "共通基盤・システム整備" : isChild ? "対象世帯への給付拡充" : `${title}の時限実施`;
  const supportLabel = isDx ? "自治体・行政現場の移行支援" : isChild ? "申請・給付事務" : "低所得層への補完策";
  return {
    id: `initial_${policyTarget?.id || "free_policy"}`,
    title: `${title}の初期実施案`,
    summary: `${title}を短期実行する前提で、対象範囲・財源補完・実施負荷を分けて検討する初期案。`,
    primaryIssueId: policyTarget?.id || appData.issueSelectionChat.selectedIssueId,
    secondaryIssueIds: [],
    budget,
    cashUse: Math.round(budget * 0.46),
    financePlan: "短期は既存予算の組替えと国債・予備費を組み合わせ、恒久化は別途財源を精査する。",
    costBreakdown: [
      {
        id: "core_policy_cost",
        label: directLabel,
        amount: Math.round(budget * 0.62),
        unit: "億円",
        costType: isDx ? "システム投資" : "直接支出・税収影響",
        target: isDx ? "国・自治体の行政基盤" : "主対象世帯・事業者",
        calculation: "対象範囲と1年分の実施規模から概算",
        fundingSource: "既存予算組替え、予備費、短期国債",
        details: [
          { label: "主施策実施費", amount: Math.round(budget * 0.44), unit: "億円", memo: "政策効果の中心となる費用" },
          { label: "制度移行費", amount: Math.round(budget * 0.18), unit: "億円", memo: "施行準備・周知・移行対応" },
        ],
      },
      {
        id: "support_cost",
        label: supportLabel,
        amount: Math.round(budget * 0.24),
        unit: "億円",
        costType: "補完策",
        target: "不利益・低便益が出やすい層",
        calculation: "対象者・自治体事務・相談対応をまとめて概算",
        fundingSource: "予備費と省庁横断の組替え",
        details: [
          { label: "重点支援枠", amount: Math.round(budget * 0.15), unit: "億円", memo: "所得・地域・世代差への補正" },
          { label: "相談・広報・事務", amount: Math.round(budget * 0.09), unit: "億円", memo: "低理解層と現場負荷への対応" },
        ],
      },
      {
        id: "fiscal_buffer",
        label: "財源補填・出口対策",
        amount: Math.round(budget * 0.14),
        unit: "億円",
        costType: "財源補填",
        target: "財政余力・長期持続性",
        calculation: "短期実行後の反動と恒久化圧力を抑えるための調整枠",
        fundingSource: "歳出見直しと制度終了時の調整財源",
        details: [
          { label: "出口戦略準備", amount: Math.round(budget * 0.08), unit: "億円", memo: "時限措置終了時の反動を抑える" },
          { label: "財源説明・検証", amount: Math.round(budget * 0.06), unit: "億円", memo: "国会説明と政策評価のための枠" },
        ],
      },
    ],
    implementationDetails: [
      `${title}の対象範囲、実施期間、除外条件を最初に明文化する。`,
      "所得別・世代別・産業別の影響を毎月モニタリングする。",
      "低便益または不利益が出やすい層には補完策と説明導線を用意する。",
    ],
    expectedEffects: [
      "短期的な政策納得度と生活・事務負担の改善を狙う。",
      "産業別・所得別の効果差を見える化し、修正余地を残す。",
    ],
    concerns: [
      "財源補填が弱いと財政余力への懸念が強まる。",
      "対象範囲が曖昧だと無関心層や実務層に伝わりにくい。",
    ],
    beneficiaryGroups: [
      { groupId: "middle_income", label: "中間層", reason: "生活・手続き負担の改善を比較的広く実感しやすい。" },
      { groupId: "progressive", label: "リベラル層", reason: "再分配や制度改善の方向性を評価しやすい。" },
    ],
    lowBenefitGroups: [
      { groupId: "fiscal_conservative", label: "財政規律重視層", reason: "財源補填と恒久化リスクへの懸念が残る。" },
      { groupId: "indifferent", label: "無関心層", reason: "生活上の変化が分かりにくいと関心を持ちにくい。" },
    ],
    shortTermEffects: {
      support: 5,
      economicRipple: isDx ? 4 : 6,
      fiscalCapacity: -4,
      teacherSatisfaction: isDx ? 6 : -1,
      importIndustryImpact: 2,
      exportIndustryImpact: 1,
      manufacturingImpact: isDx ? 4 : 2,
      agricultureImpact: isChild ? 3 : 1,
      financeIndustryImpact: isDx ? 5 : -1,
    },
    longTermEffects: { trust: 2, polarization: -1, fatigue: 1, publicValue: 3 },
    risks: ["財源補填不足", "対象範囲の説明不足", "実施現場の負荷増"],
  };
}

function applyPreparedTargetMock(policyTarget) {
  const prepared = appData.targetMockData?.[policyTarget?.id];
  if (!prepared) return false;
  appData.voices = deepClone(prepared.voices || []);
  appData.voiceAnalysis = deepClone(prepared.voiceAnalysis || null);
  appData.segmentEffects = deepClone(prepared.segmentEffects || appData.segmentEffects || {});
  applyPolicyDraft(deepClone(prepared.policy || emptyPolicyDraft()), { resetChat: true });
  if (prepared.policyChat?.messages?.length) {
    appData.policyChat = deepClone(prepared.policyChat);
  }
  return true;
}

function generatePolicyTargetInitialData() {
  const policyTarget = selectedPolicyTarget();
  if (!policyTarget) {
    saveStatus = "政策ターゲットを選択してください";
    App(appData);
    return;
  }
  const usedPreparedMock = applyPreparedTargetMock(policyTarget);
  if (!usedPreparedMock) {
    appData.voices = sampleNationalVoices(policyTarget);
    appData.voiceAnalysis = sampleNationalVoiceAnalysis(policyTarget, appData.voices);
    applyPolicyDraft(sampleNationalPolicyDraft(policyTarget), { resetChat: true });
  }
  appData.issueSelectionChat.messages.push({
    role: "assistant",
    text: `「${policyTarget.title}」について${usedPreparedMock ? "用意済みモックデータ" : "仮想の国民・ステークホルダーの声と初期政策案"}を生成しました。声の分析画面でクラスターを確認できます。`,
  });
  saveStatus = usedPreparedMock ? "用意済みモックデータで声の分析と初期政策案を生成しました" : "声の分析と初期政策案を生成しました";
  activeView = "voices";
  App(appData);
}

function SourceTypeLabel(sourceType) {
  const labels = {
    official_stat: "実統計値",
    official_stat_reference: "実統計参考値",
    fixed_virtual: "仮想指標",
    ai_estimated: "AI推定",
  };
  return labels[sourceType] || sourceType || "固定値";
}

function AnalysisViewTabs(active = "related") {
  const tabs = [
    ["related", "関連指標"],
    ["all", "全体"],
    ["industry", "産業別"],
    ["fiscal", "財政"],
    ["international", "国際関係"],
    ["social", "社会影響"],
    ["implementation", "実装リスク"],
  ];
  return `
    <div class="chart-tabs compact" role="tablist" aria-label="分析ビュー切替">
      ${tabs.map(([id, label]) => `<button class="${active === id ? "active" : ""}" type="button" data-dashboard-analysis="${id}">${label}</button>`).join("")}
    </div>
  `;
}

function EffectAxisTabs(active, datasetName = "effectAxis", options = {}) {
  const tabs = [
    ...(options.includeRelated ? [["related", "関連指標"]] : []),
    ["income", "所得別"],
    ["generation", "世代別"],
    ["industry", "産業別"],
    ["regional", "地域別"],
    ["international", "国際関係"],
    ["fiscal", "財政影響"],
    ["implementation", "実装リスク"],
    ["digital_access", "デジタル利用度"],
  ];
  const attr = datasetName.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
  return `
    <div class="chart-tabs compact" role="tablist" aria-label="効果軸切替">
      ${tabs.map(([id, label]) => `<button class="${active === id ? "active" : ""}" type="button" data-${attr}="${id}">${label}</button>`).join("")}
    </div>
  `;
}

function effectAxisTitle(axis) {
  const titles = {
    income: "所得別",
    generation: "世代別",
    industry: "産業別",
    regional: "地域別",
    international: "国際関係",
    fiscal: "財政影響",
    implementation: "実装リスク",
    digital_access: "デジタル利用度",
  };
  return titles[axis] || axis;
}

function dashboardMetricsFor(view) {
  const targetMetricIds = selectedPolicyTarget()?.relatedMetricIds || [];
  const categories = {
    fiscal: ["finance"],
    social: ["social"],
    international: ["international"],
    industry: ["industry", "economy"],
    implementation: ["implementation"],
    digital_access: ["implementation"],
  };
  if (view === "all") return appData.metrics;
  if (view === "related") {
    const relatedMetrics = targetMetricIds.map((id) => appData.metrics.find((metric) => metric.id === id)).filter(Boolean);
    return relatedMetrics.length ? relatedMetrics : appData.metrics.filter((metric) => metric.visible);
  }
  const allowedCategories = categories[view] || [];
  const categoryMetrics = appData.metrics.filter((metric) => allowedCategories.includes(metric.category));
  return categoryMetrics.length ? categoryMetrics : appData.metrics.filter((metric) => targetMetricIds.includes(metric.id));
}

function MetricDetailList(view = activeDashboardAnalysis) {
  const metrics = dashboardMetricsFor(view);
  if (!metrics.length) return `<div class="empty-note">この政策では、${effectAxisTitle(view)}に対応する指標はまだ生成されていません。</div>`;
  return `
    <div class="metric-table">
      ${metrics
        .slice(0, 6)
        .map(
          (metric) => `
            <div class="metric-row ${metricTone(metric)}">
              <span>${metric.label}</span>
              <div class="bar ${metricTone(metric) === "risk" ? "danger" : metricTone(metric) === "warn" ? "warning" : ""}">
                <i style="width:${Math.max(4, Math.min(100, Number(metric.value) || 0))}%"></i>
              </div>
              <strong>${metric.value}${metric.unit || ""}</strong>
              <em>${SourceTypeLabel(metric.sourceType)}</em>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function metricById(id) {
  return [...appData.metrics, ...appData.financeMetrics].find((metric) => metric.id === id);
}

function NationalSummaryGrid() {
  const items = [
    metricById("happiness"),
    metricById("rule"),
    metricById("fiscalCapacity"),
    metricById("externalReputation"),
  ].filter(Boolean);
  return `
    <div class="summary-grid">
      ${items
        .map(
          (metric) => `
            <article class="summary-panel ${metricTone(metric)}">
              <span class="metric-label">${metric.label}</span>
              <strong>${metric.value}${metric.unit || ""}</strong>
              <small>${SourceTypeLabel(metric.sourceType)} / ${metric.unit || "score"}</small>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function segmentRatio(axis, id) {
  return appData.populationSegments?.find((segment) => segment.axis === axis && segment.id === id)?.ratio || 0;
}

function PopulationSummaryPanel() {
  const age18to29 = segmentRatio("generation", "age_18_29");
  const age30to49 = segmentRatio("generation", "age_30_49");
  const age50to64 = segmentRatio("generation", "age_50_64");
  const age65Plus = segmentRatio("generation", "age_65_plus");
  const incomeLow = segmentRatio("income", "income_low");
  const incomeMiddle = segmentRatio("income", "income_middle");
  const incomeHigh = segmentRatio("income", "income_high");
  return `
    <article class="panel population-panel">
      <div class="panel-head">
        <h3>人口構成サマリー</h3>
      </div>
      <div class="stack-list">
        <div class="stack-item">
          <span>世代構成</span>
          <div class="stacked-bar" aria-hidden="true">
            <i style="width:${age18to29}%; background:#3b82f6"></i>
            <i style="width:${age30to49}%; background:#14b8a6"></i>
            <i style="width:${age50to64}%; background:#f59e0b"></i>
            <i style="width:${age65Plus}%; background:#64748b"></i>
          </div>
          <small>18-29歳 ${age18to29} / 30-49歳 ${age30to49} / 50-64歳 ${age50to64} / 65歳以上 ${age65Plus}</small>
        </div>
        <div class="stack-item">
          <span>所得階層</span>
          <div class="stacked-bar" aria-hidden="true">
            <i style="width:${incomeLow}%; background:#ef4444"></i>
            <i style="width:${incomeMiddle}%; background:#22c55e"></i>
            <i style="width:${incomeHigh}%; background:#2563eb"></i>
          </div>
          <small>低 ${incomeLow} / 中 ${incomeMiddle} / 高 ${incomeHigh}</small>
        </div>
        <div class="stack-item">
          <span>地域構成</span>
          <div class="stacked-bar" aria-hidden="true">
            <i style="width:61%; background:#0ea5e9"></i>
            <i style="width:39%; background:#84cc16"></i>
          </div>
          <small>都市 61 / 地方 39</small>
        </div>
      </div>
    </article>
  `;
}

function SegmentEffectList(axis) {
  const effects = appData.segmentEffects?.[axis] || [];
  if (!effects.length) {
    return `<div class="empty-note">この政策では、${effectAxisTitle(axis)}の効果は該当性が低いか、まだ生成されていません。</div>`;
  }
  return `
    <div class="segment-effect-list">
      ${effects
        .map((effect) => {
          const score = effect.effectScore === null || effect.effectScore === undefined ? "N/A" : `${effect.effectScore > 0 ? "+" : ""}${effect.effectScore}`;
          return `
            <div class="segment-effect-row ${effect.applicability || "applicable"}">
              <span>${effect.segmentLabel}</span>
              <strong>${score}</strong>
              <p>${effect.summary}</p>
              <small>${effect.applicability === "applicable" ? effect.reason : `該当性が低い: ${effect.reason}`}</small>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function NationalRelationPanel() {
  const relations = appData.internationalRelations || [];
  if (!relations.length) return "";
  return `
    <article class="panel national-relations-panel">
      <div class="panel-header">
        <div>
          <span class="section-label">国際関係</span>
          <h2>国・地域クラスター別スコア</h2>
        </div>
        <small>政策反応の初期値</small>
      </div>
      <div class="relation-grid">
        ${relations
          .map(
            (relation) => `
              <section class="relation-card">
                <strong>${relation.label}</strong>
                <span>関係 ${relation.relationScore}</span>
                <small>経済依存 ${relation.economicDependency} / 安保感度 ${relation.securitySensitivity}</small>
                <p>${relation.reactionMemo}</p>
              </section>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function ResultEffectContent(axis = activeResultEffectAxis) {
  if (axis === "related") {
    return `
      <section>
        <h3>関連指標の短期効果</h3>
        <div class="impact-list">
          ${(appData.policy.effects || [])
            .map((effect) => `<span class="${effect.tone}">${effect.label} ${effect.value > 0 ? "+" : ""}${effect.value}</span>`)
            .join("")}
        </div>
      </section>
    `;
  }
  return `
    <section>
      <h3>${effectAxisTitle(axis)}の短期効果</h3>
      ${SegmentEffectList(axis)}
    </section>
  `;
}

function metricTone(metric) {
  if (metric.id === "budget") return "good";
  if (metric.id === "cash") {
    const budget = appData.financeMetrics.find((item) => item.id === "budget")?.value || 1;
    const ratio = metric.value / budget;
    if (ratio < 0.15) return "risk";
    if (ratio < 0.35) return "warn";
    return "good";
  }
  const value = Number(metric.value || 0);
  if (value < 45) return "risk";
  if (value < 60) return "warn";
  return "good";
}

function SimpleDashboard() {
  const visibleMetrics = appData.metrics.filter((metric) => metric.visible);
  const policyTarget = selectedPolicyTarget();
  if (isNationalScenario()) {
    return `
      <section class="simple-dashboard national-dashboard">
        <div class="simple-main">
          <span class="section-label">ダッシュボード</span>
          <h2>日本の政策判断に使う初期状態</h2>
          <p>実統計参考値、仮想指標、AI推定を区別しながら、選択政策に関連する指標を優先表示します。</p>
          ${policyTarget ? `<small>選択政策: ${policyTarget.title} / 推奨ビュー: ${(policyTarget.recommendedViews || []).join("、") || "関連指標"}</small>` : ""}
        </div>
        <div class="simple-metrics">${[...appData.financeMetrics, ...visibleMetrics].map(MetricTile).join("")}</div>
        <article class="annual-report-preview">
          <span class="section-label">分析ビュー</span>
          <h3>政策ごとに表示軸を切り替え</h3>
          ${AnalysisViewTabs("related")}
        </article>
      </section>
    `;
  }
  return `
    <section class="simple-dashboard">
      <div class="simple-main">
        <span class="section-label">簡易ダッシュボード</span>
        <h2>生徒会から見える学園状況</h2>
        <p>予算、キャッシュ、アンケート、成績、参加率など、通常の運営で把握できる指標だけを表示します。</p>
      </div>
      <div class="simple-metrics">${[...appData.financeMetrics, ...visibleMetrics].map(MetricTile).join("")}</div>
      <article class="annual-report-preview">
        <span class="section-label">年度末レポート</span>
        ${AnnualReportPreview()}
      </article>
    </section>
  `;
}

function AnnualReportPreview() {
  if (!appData.annualReport) {
    return `
      <h3>内部スコアは年度末に総合評価へ反映</h3>
      <div class="annual-signal-list">
        ${appData.annualSignals
          .map(
            (signal) => `
            <div>
              <strong>${signal.value}</strong>
              <span>${signal.label}</span>
              <small>${signal.text}</small>
            </div>
          `,
          )
          .join("")}
      </div>
    `;
  }
  return `
    <h3>${appData.annualReport.title}</h3>
    <div class="annual-report-card">
      <strong>${appData.annualReport.grade}</strong>
      <p>${appData.annualReport.summary}</p>
      <small>${appData.annualReport.minorityImpact}</small>
    </div>
  `;
}

function AnnualReportFull() {
  const report = appData.annualReport;
  if (!report) return AnnualReportPreview();
  return `
    <div class="annual-report-full">
      ${AnnualReportPreview()}
      <section class="annual-section">
        <h3>年間の運営のまとめ</h3>
        ${(report.operationSummary || []).map((text) => `<p>${text}</p>`).join("")}
      </section>
      <section class="annual-section">
        <div class="panel-header compact">
          <div>
            <span class="section-label">年間の各指標変動</span>
            <h3>指標推移</h3>
          </div>
        </div>
        <div class="chart-tabs" role="tablist" aria-label="年度末レポート図表切替">
          ${[
            ["metrics", "主要指標"],
            ["finance", "財務"],
          ]
            .map(([id, label]) => `<button class="${activeAnnualChart === id ? "active" : ""}" type="button" data-annual-chart="${id}">${label}</button>`)
            .join("")}
        </div>
        <div id="annual-chart" class="annual-chart" role="img" aria-label="年間指標推移"></div>
        ${AnnualMetricSelector()}
        ${AnnualMetricRankings(report.metricRankings)}
      </section>
      <section class="annual-section">
        <h3>最終的な生徒の声</h3>
        <div class="annual-voice-list">${(report.finalVoices || []).map(AnnualVoiceItem).join("")}</div>
      </section>
    </div>
  `;
}

function AnnualMetricSelector() {
  return `
    <div class="annual-metric-selector" aria-label="表示する指標">
      ${appData.metrics
        .map((metric) => {
          const checked = selectedAnnualMetricIds.includes(metric.id);
          return `<button class="${checked ? "active" : ""}" type="button" data-annual-metric="${metric.id}" aria-pressed="${checked}">${metric.label}</button>`;
        })
        .join("")}
    </div>
  `;
}

function AnnualMetricRankings(rankings = { up: [], down: [] }) {
  return `
    <div class="annual-ranking-grid">
      ${AnnualRankingList("上がった指標", rankings.up, "good")}
      ${AnnualRankingList("下がった指標", rankings.down, "warn")}
    </div>
  `;
}

function AnnualRankingList(title, items = [], tone = "good") {
  return `
    <section class="annual-ranking ${tone}">
      <h4>${title}</h4>
      ${
        items.length
          ? items
              .slice(0, 5)
              .map((item, index) => `<div><span>${index + 1}</span><strong>${item.label}</strong><b>${item.delta > 0 ? "+" : ""}${item.delta}</b><small>${item.start} → ${item.end}</small></div>`)
              .join("")
          : `<p>該当なし</p>`
      }
    </section>
  `;
}

function AnnualVoiceItem(voice) {
  return `
    <article class="annual-voice-item">
      <strong>${voice.name}<span>${voice.group}</span></strong>
      <p>${voice.text}</p>
    </article>
  `;
}

function RadarChart() {
  const radarMetricIds = ["support", "happiness", "academic", "fairness", "rule", "participation"];
  const radarMetrics = appData.metrics.filter((metric) => radarMetricIds.includes(metric.id));
  const center = 105;
  const max = 82;
  const points = radarMetrics.map((metric, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / radarMetrics.length;
    const radius = (metric.value / 100) * max;
    return [center + Math.cos(angle) * radius, center + Math.sin(angle) * radius];
  });
  const polygon = points.map((point) => point.join(",")).join(" ");
  const axes = radarMetrics
    .map((metric, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / radarMetrics.length;
      const x = center + Math.cos(angle) * max;
      const y = center + Math.sin(angle) * max;
      const lx = center + Math.cos(angle) * (max + 20);
      const ly = center + Math.sin(angle) * (max + 20);
      return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" /><text x="${lx}" y="${ly}">${metric.label}</text>`;
    })
    .join("");

  return `
    <svg class="radar" viewBox="0 0 210 210" role="img" aria-label="学園状態のレーダーチャート">
      <polygon class="radar-grid" points="105,23 176,64 176,146 105,187 34,146 34,64" />
      <polygon class="radar-grid inner" points="105,56 148,80 148,130 105,154 62,130 62,80" />
      <g class="radar-axis">${axes}</g>
      <polygon class="radar-area" points="${polygon}" />
      ${points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" />`).join("")}
    </svg>
  `;
}

function LineChart() {
  const width = 340;
  const height = 170;
  const pad = 26;
  const toPath = (key) =>
    appData.trend
      .map((row, index) => {
        const x = pad + (index * (width - pad * 2)) / (appData.trend.length - 1);
        const y = height - pad - (row[key] / 100) * (height - pad * 2);
        return `${index === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="支持率推移">
      <g class="chart-grid">
        <line x1="${pad}" y1="36" x2="${width - pad}" y2="36" />
        <line x1="${pad}" y1="86" x2="${width - pad}" y2="86" />
        <line x1="${pad}" y1="136" x2="${width - pad}" y2="136" />
      </g>
      <path class="line support" d="${toPath("support")}" />
      <path class="line happiness" d="${toPath("happiness")}" />
      <path class="line fairness" d="${toPath("fairness")}" />
      <g class="chart-labels">
        ${appData.trend.map((row, index) => `<text x="${pad + (index * (width - pad * 2)) / 2}" y="162">${row.term}</text>`).join("")}
      </g>
    </svg>
  `;
}

function SentimentRows() {
  return appData.groups
    .map(
      (group) => `
      <div class="sentiment-row">
        <span>${group.label}</span>
        <div class="stacked-bar" aria-label="${group.label}の感情分布">
          <i class="positive" style="width:${group.positive}%"></i>
          <i class="neutral" style="width:${group.neutral}%"></i>
          <i class="negative" style="width:${group.negative}%"></i>
        </div>
      </div>
    `,
    )
    .join("");
}

function SeasonalEventsPanel() {
  const events = currentSeasonalEvents();
  return `
    <article class="panel seasonal-events-panel">
      <div class="panel-header">
        <div>
          <span class="section-label">季節イベント</span>
          <h2>${termLabel()}の運営イベント</h2>
        </div>
        <small>${events.length}件</small>
      </div>
      <div class="seasonal-event-list">
        ${
          events.length
            ? events
                .map(
                  (event) => `
                  <section class="seasonal-event-card">
                    <div>
                      <strong>${event.title}</strong>
                      <span>${event.status}</span>
                    </div>
                    <p>${event.summary}</p>
                    <small>${event.impactMetrics.join(" / ")}</small>
                  </section>
                `,
                )
                .join("")
            : `<p class="empty-note">この学期の大きな季節イベントはまだ設定されていません。</p>`
        }
      </div>
    </article>
  `;
}

function HiddenScorePanel() {
  const revealed = Boolean(appData.annualReport);
  const hiddenValues = currentHiddenScores(appData);
  return `
    <article class="panel hidden-score-panel">
      <div class="panel-header">
        <div>
          <span class="section-label">内部評価</span>
          <h2>${revealed ? "年度末に公開された内部評価" : "通常は見えないスコア"}</h2>
        </div>
        <small>${revealed ? "年度末レポート反映済み" : "年度末に反映"}</small>
      </div>
      <div class="hidden-score-list">
        ${appData.hiddenScores
          .map((score) => {
            const value = hiddenValues[score.id] || 0;
            const tone = hiddenScoreTone(score.id, value);
            return `
            <div class="hidden-score-row ${revealed ? "revealed" : ""}">
              <span>${score.label}</span>
              ${
                revealed
                  ? `<div class="revealed-score ${tone}" aria-label="${score.label}は${value}">${formatSignedValue(value)}</div>`
                  : `<div class="masked-score" aria-label="${score.label}は非公開">••••</div>`
              }
              <small>${score.hint}</small>
            </div>
          `;
          })
          .join("")}
      </div>
    </article>
  `;
}

function VoiceCard(voice, index) {
  const cluster = appData.voiceAnalysis?.clusters?.find((item) => item.representativeVoiceIds?.includes(voice.id));
  const avatarTone = voice.avatar?.slot ?? ["sky", "green", "rose"][index % 3];
  const avatarLabel = voice.avatar?.label ?? voice.name.slice(0, 1);
  return `
    <article class="voice-card">
      <div class="avatar-slot ${avatarTone}">
        <span>${avatarLabel}</span>
      </div>
      <div>
        <header>
          <strong>${voice.name}</strong>
          <span>${voice.group}</span>
          <em>${voice.mood}</em>
        </header>
        <p>${voice.text}</p>
        ${
          cluster
            ? `<small>代表クラスター: ${cluster.label} / ${cluster.size}件相当</small>`
            : `<small>代表発話例</small>`
        }
      </div>
    </article>
  `;
}

function VoiceClusterMap() {
  const analysis = appData.voiceAnalysis;
  if (!analysis?.clusters?.length) return "";
  const clusterById = Object.fromEntries(analysis.clusters.map((cluster) => [cluster.id, cluster]));
  return `
    <div class="chart-stage">
      <div id="voice-chart" class="framework-chart" role="img" aria-label="意見クラスター間の距離"></div>
      <div class="distance-list">
        ${analysis.distances
          .slice(0, 4)
          .map((edge) => `<span>${clusterById[edge.from]?.label} - ${clusterById[edge.to]?.label}: ${edge.distance.toFixed(2)} / ${edge.label}</span>`)
          .join("")}
      </div>
    </div>
  `;
}

function HierarchyNode(node, depth = 0) {
  const cluster = node.clusterId ? appData.voiceAnalysis?.clusters?.find((item) => item.id === node.clusterId) : null;
  return `
    <li style="--depth:${depth}">
      <div>
        <strong>${node.label}</strong>
        <span>${node.size}件${cluster ? ` / ${cluster.keywords.join("・")}` : ""}</span>
      </div>
      ${node.children?.length ? `<ul>${node.children.map((child) => HierarchyNode(child, depth + 1)).join("")}</ul>` : ""}
    </li>
  `;
}

function VoiceHierarchy() {
  const hierarchy = appData.voiceAnalysis?.hierarchy;
  if (!hierarchy) return "";
  return `
    <div class="chart-stage">
      <div id="voice-chart" class="framework-chart" role="img" aria-label="声の階層クラスタリング"></div>
      <div class="voice-hierarchy compact-tree">
        <ul>${HierarchyNode(hierarchy)}</ul>
      </div>
    </div>
  `;
}

function VoiceRepresentatives() {
  return `
    <div class="chart-stage representative-stage">
      <div class="voice-list">${appData.voices.map(VoiceCard).join("")}</div>
    </div>
  `;
}

function VoiceAnalysisViewer() {
  const analysis = appData.voiceAnalysis;
  if (!analysis) return `<div class="voice-list">${appData.voices.map(VoiceCard).join("")}</div>`;
  const tabs = [
    ["map", "距離マップ"],
    ["hierarchy", "階層"],
    ["voices", "代表発話"],
  ];
  const content = {
    map: VoiceClusterMap,
    hierarchy: VoiceHierarchy,
    voices: VoiceRepresentatives,
  };
  return `
    <div class="voice-analysis">
      <div class="analysis-summary">
        <div><strong>${analysis.populationSize}</strong><span>${isNationalScenario() ? "想定人口" : "想定生徒数"}</span></div>
        <div><strong>${analysis.sampledOpinionCount}</strong><span>分析対象の声</span></div>
        <div><strong>${analysis.clusters.length}</strong><span>意見クラスター</span></div>
      </div>
      <div class="chart-tabs" role="tablist" aria-label="声の分析表示切替">
        ${tabs.map(([id, label]) => `<button class="${activeVoiceChart === id ? "active" : ""}" type="button" data-voice-chart="${id}">${label}</button>`).join("")}
      </div>
      ${(content[activeVoiceChart] || VoiceClusterMap)()}
    </div>
  `;
}

function EmptyWorkflowPanel(title, message, actionLabel = "政策ターゲットへ進む") {
  return `
    <div class="turn-result-preview empty workflow-empty">
      <span>${title}</span>
      <p>${message}</p>
      <button class="primary" type="button" data-jump-view="issues">${actionLabel}</button>
    </div>
  `;
}

function IssueMap() {
  return `
    <div class="issue-map">
      <svg viewBox="0 0 420 210" role="img" aria-label="ペルソナ発話から抽出された課題候補">
        <path d="M78 62 C138 40 180 48 220 82" />
        <path d="M82 142 C142 158 190 148 255 122" />
        <path d="M278 88 C320 76 350 82 382 112" />
        <circle class="node voice" cx="72" cy="60" r="26" />
        <circle class="node voice" cx="72" cy="145" r="26" />
        <circle class="node issue-main" cx="236" cy="92" r="38" />
        <circle class="node issue-sub" cx="275" cy="134" r="27" />
        <circle class="node policy" cx="378" cy="112" r="31" />
        <text x="72" y="65">声</text>
        <text x="236" y="88">課題</text>
        <text x="236" y="103">候補</text>
        <text x="275" y="139">副論点</text>
        <text x="378" y="117">施策</text>
      </svg>
    </div>
  `;
}

function IssueList() {
  return appData.issues
    .map((issue) => {
      const isSelected = issue.id === appData.issueSelectionChat.selectedIssueId;
      return `
      <button class="issue-row ${isSelected ? "selected" : ""}" type="button" data-issue-id="${issue.id}" aria-pressed="${isSelected}">
        <span>${issue.title}</span>
        <strong>${formatIssueFit(issue)}%</strong>
        <small>${issue.metrics.join(" / ")}</small>
      </button>
    `;
    })
    .join("");
}

function FreePolicyTargetForm() {
  const scales = [
    ["standard", "標準"],
    ["small", "小規模"],
    ["large", "大規模"],
  ];
  return `
    <div class="free-policy-form">
      <label class="input-label" for="free-policy-input">自由記述で追加</label>
      <textarea id="free-policy-input" rows="5" placeholder="例: 最低賃金を全国一律で大きく引き上げる政策を検討したい">${escapeHtml(freePolicyDraftText)}</textarea>
      <div class="segmented-control" aria-label="政策規模">
        ${scales
          .map(
            ([value, label]) => `
              <button class="${activeFreePolicyScale === value ? "active" : ""}" type="button" data-free-policy-scale="${value}" aria-pressed="${activeFreePolicyScale === value}">
                ${label}
              </button>
            `,
          )
          .join("")}
      </div>
      <button id="structure-free-policy" class="primary" type="button">政策ターゲット化</button>
      <p>入力内容から関連指標と推奨ビューを仮生成し、政策ターゲットとして選択します。</p>
    </div>
  `;
}

function IssueSelectionChat(context = "issues") {
  const chat = appData.issueSelectionChat;
  const currentIssue = selectedIssue();
  if (isNationalScenario()) {
    const title = context === "analysis" ? "クラスター分析を深掘りする" : "政策効果を確認する";
    return `
      <article class="panel issue-chat-panel">
        <div class="panel-header">
          <div>
            <span class="section-label">政策分析チャット</span>
            <h2>${title}</h2>
          </div>
          <small>選択中: ${currentIssue?.title || "未選択"}</small>
        </div>
        <div class="chat-thread">
          ${chat.messages
            .map(
              (message) => `
              <div class="chat-message ${message.role}">
                <span>${message.role === "user" ? "ユーザー" : "AI"}</span>
                <p>${message.text}</p>
              </div>
            `,
            )
            .join("")}
        </div>
        <div class="chat-input-preview">
          <input id="issue-chat-input" type="text" value="この政策で不利益が出やすい層は？" aria-label="政策分析チャット入力" />
          <button id="issue-chat-send" type="button">送信</button>
        </div>
      </article>
    `;
  }
  const title = context === "analysis" ? "分析を見ながら課題を明確にする" : "候補を深掘りして選ぶ";
  const placeholder =
    context === "analysis"
      ? "距離マップを見ると、どの論点を今学期の課題にすべき？"
      : "キャッシュ内で扱うなら、どの課題が一番現実的？";
  return `
    <article class="panel issue-chat-panel">
      <div class="panel-header">
        <div>
          <span class="section-label">課題選択チャット</span>
          <h2>${title}</h2>
        </div>
        <small>選択中: ${currentIssue?.title || "未選択"}</small>
      </div>
      <div class="chat-thread">
        ${chat.messages
          .map(
            (message) => `
            <div class="chat-message ${message.role}">
              <span>${message.role === "user" ? "生徒会" : "AI"}</span>
              <p>${message.text}</p>
            </div>
          `,
          )
          .join("")}
      </div>
      <div class="chat-input-preview">
        <input id="issue-chat-input" type="text" value="${placeholder}" aria-label="課題選択チャット入力" />
        <button id="issue-chat-send" type="button">送信</button>
      </div>
    </article>
  `;
}

function PolicyPreview() {
  const { policy } = appData;
  if (isNationalScenario() && !hasNationalAnalysisStarted()) {
    return `
      <article class="policy-preview">
        ${EmptyWorkflowPanel("政策案は未生成", "政策ターゲットを決定して「声の分析へ進む」を押すと、仮想の声と同時に初期政策案を生成します。")}
      </article>
    `;
  }
  const hasDraft = policy.effects.length > 0;
  const policyExecuted = Boolean(appData.lastSimulationResult);
  const canCreateAnnual = policyExecuted && currentTurn().term >= 3 && !appData.annualReport;
  const availableCash = appData.financeMetrics.find((metric) => metric.id === "cash")?.value || policy.cashUse || 1;
  const budgetAngle = Math.min(360, Math.round((policy.cashUse / Math.max(availableCash, 1)) * 270));
  const nationalPolicyAction = isNationalScenario()
    ? hasDraft && !policyExecuted
      ? `<button id="execute-policy" class="primary-button" type="button">政策を実行して結果を見る</button>`
      : hasDraft
        ? `<div class="turn-complete-note compact">この政策は実行済みです。</div>`
        : ""
    : "";
  return `
    <article class="policy-preview">
      <div class="policy-preview-header">
        <div>
          <span class="section-label">${isNationalScenario() ? "政策案" : "今学期の施策案"}</span>
          <h3>${policy.title}</h3>
          <p>${policy.summary || `${policy.covers.join("、")}に同時対応する単一施策。${policy.financePlan}。`}</p>
        </div>
        ${nationalPolicyAction}
      </div>
      <div class="budget-ring" style="--value:${budgetAngle}deg">
        <strong>${policy.budget}</strong>
        <span>予算</span>
      </div>
      <div class="finance-note">${isNationalScenario() ? "短期財源使用" : "キャッシュ使用"}: ${policy.cashUse}</div>
      ${
        isNationalScenario() && hasDraft
          ? `${PolicyPanelTabs()}${PolicyPanelContent(policy)}`
          : hasDraft
            ? PolicyDetailSections(policy)
            : ""
      }
      ${
        isNationalScenario()
          ? ""
          : hasDraft && !policyExecuted
            ? `<button id="execute-policy" class="primary" type="button">施策を実行して結果を見る</button>`
            : hasDraft
              ? `<div class="turn-complete-note">この学期の施策は実行済みです。</div>`
              : `<button id="create-policy-draft" class="primary" type="button">選択課題から施策案を作成</button>`
      }
      ${TurnResultPreview()}
      ${!isNationalScenario() && canCreateAnnual ? `<button class="create-annual-report primary" type="button">年度末レポートを作成</button>` : ""}
      ${!isNationalScenario() && appData.annualReport ? `<div class="turn-complete-note">年度末レポート作成済みです。</div>` : ""}
    </article>
  `;
}

function PolicyPanelTabs() {
  const tabs = [
    ["cost", "コスト"],
    ["implementation", "実施内容"],
    ["effects", "効果"],
    ["groups", "対象属性"],
  ];
  return `
    <div class="policy-panel-tabs" role="tablist" aria-label="政策案の表示切替">
      ${tabs.map(([id, label]) => `<button class="${activePolicyPanel === id ? "active" : ""}" type="button" data-policy-panel="${id}">${label}</button>`).join("")}
    </div>
  `;
}

function PolicyPanelContent(policy) {
  const panels = {
    cost: PolicyCostBreakdown(policy),
    implementation: PolicyImplementationSections(policy),
    effects: PolicyEffectPanel(policy),
    groups: PolicyGroupSections(policy),
  };
  return `<div class="policy-panel-content">${panels[activePolicyPanel] || panels.cost}</div>`;
}

function PolicyImplementationSections(policy) {
  return `
    <div class="policy-detail-grid">
      ${PolicyListSection("実施内容", policy.implementationDetails)}
      ${PolicyListSection("想定する効果", policy.expectedEffects)}
      ${PolicyListSection("懸念点", policy.concerns)}
    </div>
  `;
}

function PolicyEffectPanel(policy) {
  return `
    ${EffectAxisTabs(activePolicyEffectAxis, "policyEffectAxis")}
    <div class="policy-target-meta">
      <div><strong>表示中の効果軸</strong><span>${effectAxisTitle(activePolicyEffectAxis)}</span></div>
      <div><strong>想定効果</strong><span>${(appData.segmentEffects?.[activePolicyEffectAxis] || []).map((effect) => `${effect.segmentLabel}: ${effect.effectScore ?? "N/A"}`).join(" / ") || "この軸は該当性が低いか、まだ生成されていません。"}</span></div>
      <div><strong>長期影響</strong><span>確定結果ではなく予想として表示</span></div>
    </div>
    <div class="impact-list">
      ${policy.effects.map((effect) => `<span class="${effect.tone}">${effect.label} ${effect.value > 0 ? "+" : ""}${effect.value}</span>`).join("")}
    </div>
  `;
}

function PolicyGroupSections(policy) {
  return `
    <div class="policy-group-grid">
      ${PolicyGroupSection("メリットを享受する対象属性", policy.beneficiaryGroups, "good")}
      ${PolicyGroupSection("メリットが薄い・ややデメリットになる対象属性", policy.lowBenefitGroups, "warn")}
    </div>
  `;
}

function formatCostAmount(item) {
  return `${Number(item.amount || 0).toLocaleString("ja-JP")}${item.unit || ""}`;
}

function PolicyCostBreakdown(policy) {
  const breakdown = policy.costBreakdown || [];
  if (!breakdown.length) {
    return `
      <section class="policy-cost-panel">
        <div class="panel-head">
          <h3>コスト試算</h3>
          <span class="data-chip">内訳未生成</span>
        </div>
        <p>この政策案では、実施内容ごとのコスト内訳がまだ生成されていません。</p>
      </section>
    `;
  }
  const total = breakdown.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return `
    <section class="policy-cost-panel">
      <div class="panel-head">
        <h3>実施内容別コスト試算</h3>
        <span class="data-chip">合計 ${total.toLocaleString("ja-JP")}${breakdown[0]?.unit || ""}</span>
      </div>
      <p>何に対してコストが発生するかを、税収減・直接給付・財源補填などの実施内容ごとに分けて表示します。</p>
      <div class="cost-summary-grid">
        <div><strong>${formatCostAmount({ amount: policy.budget, unit: "億円" })}</strong><span>政策総額</span></div>
        <div><strong>${formatCostAmount({ amount: policy.cashUse, unit: "億円" })}</strong><span>短期財源使用</span></div>
        <div><strong>${policy.financePlan}</strong><span>財源方針</span></div>
      </div>
      <div class="cost-breakdown-list">
        ${breakdown.map(CostBreakdownItem).join("")}
      </div>
    </section>
  `;
}

function CostBreakdownItem(item) {
  return `
    <details class="cost-breakdown-item">
      <summary>
        <span>
          <strong>${item.label}</strong>
          <small>${item.costType || "費用"} / 対象: ${item.target || "未設定"}</small>
        </span>
        <b>${formatCostAmount(item)}</b>
      </summary>
      <div class="cost-breakdown-body">
        <p>${item.calculation || ""}</p>
        <div class="cost-meta-grid">
          <div><strong>財源</strong><span>${item.fundingSource || "未設定"}</span></div>
          <div><strong>費用種別</strong><span>${item.costType || "未設定"}</span></div>
        </div>
        <div class="cost-detail-list">
          ${(item.details || [])
            .map(
              (detail) => `
                <div>
                  <span>${detail.label}</span>
                  <strong>${formatCostAmount(detail)}</strong>
                  <small>${detail.memo || ""}</small>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    </details>
  `;
}

function PolicyDetailSections(policy) {
  return `
    <div class="policy-detail-grid">
      ${PolicyListSection("実施内容", policy.implementationDetails)}
      ${PolicyListSection("想定する効果", policy.expectedEffects)}
      ${PolicyListSection("懸念点", policy.concerns)}
    </div>
    <div class="policy-group-grid">
      ${PolicyGroupSection("メリットを享受する対象属性", policy.beneficiaryGroups, "good")}
      ${PolicyGroupSection("メリットが薄い・ややデメリットになる対象属性", policy.lowBenefitGroups, "warn")}
    </div>
  `;
}

function PolicyListSection(title, items = []) {
  return `
    <section class="policy-detail-section">
      <h4>${title}</h4>
      <ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>
    </section>
  `;
}

function PolicyGroupSection(title, items = [], tone = "good") {
  return `
    <section class="policy-group-section ${tone}">
      <h4>${title}</h4>
      ${items
        .map(
          (item) => `
          <div>
            <strong>${item.label || groupLabel(item.groupId)}</strong>
            <p>${item.reason}</p>
          </div>
        `,
        )
        .join("")}
    </section>
  `;
}

function PolicyRevisionChat() {
  const chat = policyChat();
  const hasDraft = appData.policy.effects?.length > 0;
  return `
    <article class="panel issue-chat-panel policy-chat-panel">
      <div class="panel-header">
        <div>
          <span class="section-label">施策修正チャット</span>
          <h2>${isNationalScenario() ? "政策案を深掘りして調整" : "施策案を深掘りして調整"}</h2>
        </div>
        <small>${hasDraft ? "編集中" : "施策案未作成"}</small>
      </div>
      <div class="chat-thread">
        ${chat.messages
          .map(
            (message) => `
            <div class="chat-message ${message.role}">
              <span>${message.role === "user" ? "生徒会" : "AI"}</span>
              <p>${message.text}</p>
            </div>
          `,
          )
          .join("")}
      </div>
      <div class="chat-input-preview">
        <input id="policy-chat-input" type="text" value="${hasDraft ? (isNationalScenario() ? "財源懸念を抑える補完策を入れてください" : "懸念が大きい属性への補完策を入れてください") : "まず政策案を作成してください"}" aria-label="政策案チャット入力" ${hasDraft ? "" : "disabled"} />
        <button id="policy-chat-send" type="button" ${hasDraft ? "" : "disabled"}>送信</button>
      </div>
    </article>
  `;
}

function TurnResultPreview() {
  const result = appData.lastSimulationResult;
  if (!result) {
    return `
      <div class="turn-result-preview empty">
        <span>実行結果</span>
        <p>${isNationalScenario() ? "政策実行後、短期結果・長期予想・クラスター別影響を表示します。" : "施策実行後、AIシミュレーション結果を指標・財務・属性メモリーへ反映します。"}</p>
      </div>
    `;
  }
  return `
    <div class="turn-result-preview">
      <span>実行結果</span>
      <p>${result.summary}</p>
      <div class="result-delta-list">
        ${Object.entries(result.visibleMetricDeltas)
          .map(([key, value]) => `<b>${key} ${value > 0 ? "+" : ""}${value}</b>`)
          .join("")}
        <b>cash ${result.financeDelta.cash > 0 ? "+" : ""}${result.financeDelta.cash}</b>
      </div>
      <small>${result.randomEvents.join(" / ")}</small>
      ${isNationalScenario() ? `<span class="turn-end-label">単発実行は完了しました</span>` : currentTurn().term >= 3 ? `<span class="turn-end-label">年度末処理へ進めます</span>` : `<button id="advance-turn" type="button">次学期へ進む</button>`}
    </div>
  `;
}

function PolicyHistoryList(records = buildPolicyResultRecords(getMemory(appData))) {
  if (!records.length) {
    return `<div class="turn-result-preview empty"><span>施策履歴</span><p>実行済みの施策はまだありません。</p></div>`;
  }
  return `
    <div class="policy-history-list">
      ${records.map(PolicyHistoryCard).join("")}
    </div>
  `;
}

function PolicyHistoryCard(record, index) {
  const metricEntries = Object.entries(record.metricDeltas || {});
  const financeEntries = Object.entries(record.financeDelta || {}).filter(([, value]) => value);
  return `
    <article class="policy-history-card">
      <header>
        <span>${record.label || `${index + 1}件目`}</span>
        <h3>${record.policy.title || "施策"}</h3>
      </header>
      <p>${record.policy.summary || record.summary}</p>
      <div class="policy-history-result">
        <strong>結果</strong>
        <p>${record.summary}</p>
      </div>
      <div class="result-delta-list">
        ${metricEntries.map(([key, value]) => `<b>${metricLabel(key)} ${value > 0 ? "+" : ""}${value}</b>`).join("")}
        ${financeEntries.map(([key, value]) => `<b>${key} ${value > 0 ? "+" : ""}${value}</b>`).join("")}
      </div>
      <div class="annual-voice-list compact">
        ${record.voices.map(AnnualVoiceItem).join("")}
      </div>
    </article>
  `;
}

function DashboardView() {
  if (isNationalScenario()) {
    return `
      <section class="national-dashboard-view">
        <div class="section-head">
          <div>
            <h2>ダッシュボード</h2>
            <p>政策を決める前に、日本の初期状態とシミュレーション前提を確認します。</p>
          </div>
          <button class="primary-button" type="button" data-jump-view="issues">政策ターゲットへ進む</button>
        </div>
        ${NationalSummaryGrid()}
        <div class="dashboard-layout">
          <article class="panel wide-panel">
            <div class="panel-head">
              <h3>政策関連指標</h3>
              ${AnalysisViewTabs(activeDashboardAnalysis)}
            </div>
            <p class="panel-note">表示中の指標は、選択政策の relatedMetricIds と選択中の分析ビューから自動で優先表示します。</p>
            ${MetricDetailList(activeDashboardAnalysis)}
          </article>
          ${PopulationSummaryPanel()}
        </div>
        ${NationalRelationPanel()}
      </section>
    `;
  }
  return `
    ${SimpleDashboard()}
    <section class="overview-grid">
      <div class="metric-strip">${appData.metrics.map(MetricTile).join("")}</div>
      ${SeasonalEventsPanel()}
      <article class="panel radar-panel">
        <div class="panel-header">
          <div>
            <span class="section-label">学園状態</span>
            <h2>初期指標の揺らぎ</h2>
          </div>
          <small>seed: ${appData.scenario.seed}</small>
        </div>
        ${RadarChart()}
      </article>
      <article class="panel trend-panel">
        <div class="panel-header">
          <div>
            <span class="section-label">推移</span>
            <h2>支持率・幸福度・公平感</h2>
          </div>
        </div>
        ${LineChart()}
        <div class="legend"><span class="support">生徒支持</span><span class="happiness">幸福度</span><span class="fairness">公平感</span></div>
      </article>
      <article class="panel sentiment-panel">
        <div class="panel-header">
          <div>
            <span class="section-label">属性別反応</span>
            <h2>生徒グループの温度差</h2>
          </div>
        </div>
        ${SentimentRows()}
      </article>
      ${HiddenScorePanel()}
    </section>
  `;
}

function VoicesView() {
  if (isNationalScenario()) {
    if (!hasNationalAnalysisStarted()) {
      return `
        <section class="single-view">
          <article class="panel voice-panel">
            <div class="panel-header">
              <div>
                <span class="section-label">声の分析</span>
                <h2>国民・ステークホルダーの反応</h2>
              </div>
              <small>未生成</small>
            </div>
            ${EmptyWorkflowPanel("声の分析は未生成", "政策ターゲットを選択または自由記述で追加し、政策ターゲット画面の「声の分析へ進む」から仮想データを生成します。")}
          </article>
        </section>
      `;
    }
    return `
      <section class="single-view">
        <article class="panel voice-panel">
          <div class="panel-header">
            <div>
              <span class="section-label">声の分析</span>
              <h2>国民・ステークホルダーの反応</h2>
            </div>
            <small>${appData.voiceAnalysis?.sampledOpinionCount || appData.voices.length}件から代表例</small>
          </div>
          ${VoiceAnalysisViewer()}
        </article>
        <article class="panel">
          <div class="panel-header">
            <div>
              <span class="section-label">効果軸切替</span>
              <h2>政策内容に応じた推奨ビュー</h2>
            </div>
            <small>recommendedViews</small>
          </div>
          ${EffectAxisTabs(activeVoiceEffectAxis, "voiceEffectAxis")}
          <div class="effect-grid">
            <section>
              <h3>${effectAxisTitle(activeVoiceEffectAxis)}の想定効果</h3>
              ${SegmentEffectList(activeVoiceEffectAxis)}
            </section>
          </div>
        </article>
      </section>
    `;
  }
  return `
    <section class="single-view">
      <article class="panel voice-panel">
        <div class="panel-header">
          <div>
            <span class="section-label">収集した声の分析</span>
            <h2>代表発話と意見空間</h2>
          </div>
          <small>${appData.voiceAnalysis?.sampledOpinionCount || appData.voices.length}件から代表例</small>
        </div>
        ${VoiceAnalysisViewer()}
      </article>
      ${IssueSelectionChat("analysis")}
    </section>
  `;
}

function IssuesView() {
  if (isNationalScenario()) {
    const policyTarget = selectedPolicyTarget();
    return `
      <section class="two-column-view">
        <article class="panel issue-panel">
          <div class="panel-header">
            <div>
              <span class="section-label">政策ターゲット</span>
              <h2>分析対象の政策を選ぶ</h2>
            </div>
            <small>MVPプリセット / 自由記述</small>
          </div>
          <div class="issue-list">${IssueList()}</div>
          ${FreePolicyTargetForm()}
        </article>
        <article class="panel issue-chat-panel">
          <div class="panel-header">
            <div>
              <span class="section-label">AI構造化結果</span>
              <h2>${policyTarget?.title || "政策未選択"}</h2>
            </div>
            <div class="panel-header-action">
              <button id="generate-target-analysis" class="primary-button" type="button" ${policyTarget ? "" : "disabled"}>声の分析へ進む</button>
              <small>${policyTarget?.field || "AI生成分野"}</small>
            </div>
          </div>
          <p>${policyTarget?.summary || ""}</p>
          <div class="policy-target-meta">
            <div><strong>関連指標</strong><span>${(policyTarget?.metrics || []).join(" / ")}</span></div>
            <div><strong>推奨ビュー</strong><span>${(policyTarget?.recommendedViews || []).join(" / ")}</span></div>
            <div><strong>財源上の注意</strong><span>${policyTarget?.fundingNote || "政策案生成時に確認"}</span></div>
          </div>
          ${IssueSelectionChat()}
        </article>
      </section>
    `;
  }
  return `
    <section class="two-column-view">
      <article class="panel issue-panel">
        <div class="panel-header">
          <div>
            <span class="section-label">課題設定</span>
            <h2>声から浮かぶ論点</h2>
          </div>
        </div>
        ${IssueMap()}
        <div class="issue-list">${IssueList()}</div>
      </article>
      ${IssueSelectionChat()}
    </section>
  `;
}

function PolicyView() {
  return `
    <section class="two-column-view">
      ${PolicyPreview()}
      ${PolicyRevisionChat()}
    </section>
  `;
}

function ResultView() {
  if (isNationalScenario()) {
    const result = appData.lastSimulationResult;
    return `
      <section class="result-view">
        <article class="panel">
          <div class="panel-header">
            <div>
              <span class="section-label">実行結果</span>
              <h2>短期結果と長期予想</h2>
            </div>
            <small>単発実行</small>
          </div>
          ${TurnResultPreview()}
          ${EffectAxisTabs(activeResultEffectAxis, "resultEffectAxis", { includeRelated: true })}
          <div class="effect-grid">
            ${ResultEffectContent(activeResultEffectAxis)}
          </div>
        </article>
        ${NationalRelationPanel()}
        <article class="panel">
          <div class="panel-header">
            <div>
              <span class="section-label">長期予想</span>
              <h2>確定結果ではなく観測対象</h2>
            </div>
          </div>
          <div class="policy-target-meta">
            <div><strong>長期リスク</strong><span>恒久化した場合、財政余力と社会保障持続性が低下する可能性があります。</span></div>
            <div><strong>観測すべき指標</strong><span>税収、消費動向、社会保障財源、政策納得度、将来世代への負担感。</span></div>
            <div><strong>変動要因</strong><span>物価、賃金、景気循環、国際的な金融環境。</span></div>
          </div>
        </article>
      </section>
    `;
  }
  return `
    <section class="result-view">
      <article class="panel">
        <div class="panel-header">
          <div>
            <span class="section-label">結果</span>
            <h2>各学期の施策結果とメモリー</h2>
          </div>
          <small>${getMemory(appData).timeline.length} snapshots</small>
        </div>
        ${PolicyHistoryList()}
      </article>
      <article class="panel">
        <div class="panel-header">
          <div>
            <span class="section-label">年度末レポート</span>
            <h2>内部評価を含む総括</h2>
          </div>
        </div>
        ${AnnualReportFull()}
        ${appData.lastSimulationResult && currentTurn().term >= 3 && !appData.annualReport ? `<button class="create-annual-report primary" type="button">年度末レポートを作成</button>` : ""}
      </article>
    </section>
  `;
}

function ActiveView() {
  const views = {
    dashboard: DashboardView,
    voices: VoicesView,
    issues: IssuesView,
    policy: PolicyView,
    result: ResultView,
  };
  return (views[activeView] || DashboardView)();
}

function normalizeChartPositions(clusters) {
  const width = 760;
  const height = 380;
  const padding = 76;
  const xs = clusters.map((cluster) => Number(cluster.x) || 0);
  const ys = clusters.map((cluster) => Number(cluster.y) || 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = (value, min, max, outMin, outMax) => (max === min ? (outMin + outMax) / 2 : outMin + ((value - min) / (max - min)) * (outMax - outMin));
  return clusters.map((cluster) => ({
    ...cluster,
    x: scale(Number(cluster.x) || 0, minX, maxX, padding, width - padding),
    y: scale(Number(cluster.y) || 0, minY, maxY, padding, height - padding),
  }));
}

function hierarchyToEcharts(node) {
  return {
    name: `${node.label}\n${node.size}件`,
    value: node.size,
    children: node.children?.map(hierarchyToEcharts) || [],
  };
}

function renderVoiceChart() {
  const chartElement = document.querySelector("#voice-chart");
  const analysis = appData?.voiceAnalysis;
  if (!chartElement || !analysis || !window.echarts) {
    if (chartElement) {
      chartElement.innerHTML = `<div class="chart-fallback">チャートライブラリを読み込めませんでした。距離リストと階層リストを表示しています。</div>`;
    }
    return;
  }
  const chart = window.echarts.init(chartElement, null, { renderer: "canvas" });
  if (activeVoiceChart === "hierarchy") {
    chart.setOption({
      tooltip: { trigger: "item", triggerOn: "mousemove" },
      series: [
        {
          type: "tree",
          data: [hierarchyToEcharts(analysis.hierarchy)],
          top: 24,
          left: 24,
          bottom: 24,
          right: 160,
          symbolSize: 10,
          orient: "LR",
          label: { position: "left", verticalAlign: "middle", align: "right", fontSize: 12, fontWeight: 700 },
          leaves: { label: { position: "right", verticalAlign: "middle", align: "left" } },
          lineStyle: { color: "#9db7ba", width: 2, curveness: 0.45 },
          itemStyle: { color: "#0f7c80", borderColor: "#ffffff", borderWidth: 2 },
          expandAndCollapse: true,
          animationDuration: 250,
          animationDurationUpdate: 250,
        },
      ],
    });
    return;
  }
  const positioned = normalizeChartPositions(analysis.clusters);
  const clusterById = Object.fromEntries(positioned.map((cluster) => [cluster.id, cluster]));
  chart.setOption({
    tooltip: {
      formatter: (params) => {
        if (params.dataType === "edge") return params.data.label;
        return `${params.data.name}<br/>${params.data.value}件<br/>${params.data.summary}`;
      },
    },
    series: [
      {
        type: "graph",
        layout: "none",
        roam: true,
        draggable: true,
        data: positioned.map((cluster) => ({
          id: cluster.id,
          name: cluster.label,
          value: cluster.size,
          x: cluster.x,
          y: cluster.y,
          symbolSize: Math.max(46, Math.min(96, Math.sqrt(cluster.size) * 4.2)),
          summary: cluster.summary,
          itemStyle: { color: cluster.sentiment < -0.3 ? "#f4d5d5" : cluster.sentiment > 0.3 ? "#cfeedd" : "#dfe9ea" },
          label: { show: true, formatter: `${cluster.label}\n${cluster.size}件`, fontWeight: 800, color: "#182124" },
        })),
        links: analysis.distances
          .filter((edge) => clusterById[edge.from] && clusterById[edge.to])
          .map((edge) => ({
            source: edge.from,
            target: edge.to,
            label: edge.label,
            lineStyle: { width: Math.max(1, 5 - edge.distance * 5), color: "rgba(98,113,116,0.42)", curveness: 0.08 },
          })),
        emphasis: { focus: "adjacency" },
      },
    ],
  });
  window.addEventListener("resize", () => chart.resize(), { once: true });
}

function renderAnnualChart() {
  const chartElement = document.querySelector("#annual-chart");
  const report = appData?.annualReport;
  if (!chartElement || !report) return;
  const series = report.metricSeries || [];
  if (!window.echarts) {
    chartElement.innerHTML = `<div class="chart-fallback">${series.map((row) => `${row.label}: ${JSON.stringify(activeAnnualChart === "finance" ? row.finance : row.allMetrics || row.visibleMetrics)}`).join("<br/>")}</div>`;
    return;
  }
  const chart = window.echarts.init(chartElement, null, { renderer: "canvas" });
  const labels = series.map((row) => row.label);
  if (activeAnnualChart === "finance") {
    chart.setOption({
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      grid: { left: 46, right: 24, top: 42, bottom: 42 },
      xAxis: { type: "category", data: labels },
      yAxis: { type: "value" },
      series: ["budget", "cash"].map((key) => ({
        name: key,
        type: "line",
        smooth: true,
        data: series.map((row) => row.finance?.[key] ?? null),
      })),
    });
    return;
  }
  const metricKeys = selectedAnnualMetricIds.filter((id) => appData.metrics.some((metric) => metric.id === id));
  chart.setOption({
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 42, right: 24, top: 42, bottom: 42 },
    xAxis: { type: "category", data: labels },
    yAxis: { type: "value", min: 0, max: 100 },
    series: metricKeys.map((key) => ({
      name: metricLabel(key),
      type: "line",
      smooth: true,
      data: series.map((row) => row.allMetrics?.[key] ?? row.visibleMetrics?.[key] ?? null),
    })),
  });
  window.addEventListener("resize", () => chart.resize(), { once: true });
}

function NavLink(view, label, iconName) {
  return `<a class="${activeView === view ? "active" : ""}" href="#" data-view="${view}">${icon(iconName)}<span>${label}</span></a>`;
}

function NationalNavLink(view, label) {
  return `<a class="${activeView === view ? "active" : ""}" href="#" data-view="${view}"><span>${label}</span></a>`;
}

function App(data) {
  appData = data;
  const turn = currentTurn();
  const national = isNationalScenario();
  const statusTitle = appData.scenario.selectedPolicyTitle || appData.policy?.title || "政策未選択";
  document.querySelector("#app").innerHTML = `
    <div class="app-shell ${national ? "national-shell" : ""}">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark">${national ? "政" : "学"}</span>
          <div class="brand-copy">
            <strong>${national ? "政策シミュレーター" : "School Democracy Lab"}</strong>
            ${national ? "<small>Japan Policy Lab</small>" : ""}
          </div>
        </div>
        <nav class="${national ? "nav-tabs" : ""}">
          ${
            national
              ? `
                ${NationalNavLink("dashboard", "ダッシュボード")}
                ${NationalNavLink("issues", "政策ターゲット")}
                ${NationalNavLink("voices", "声の分析")}
                ${NationalNavLink("policy", "政策案")}
                ${NationalNavLink("result", "実行結果")}
              `
              : `
                ${NavLink("dashboard", "ダッシュボード", "dashboard")}
                ${NavLink("voices", "声の分析", "voices")}
                ${NavLink("issues", "課題設定", "issue")}
                ${NavLink("policy", "施策検討", "policy")}
                ${NavLink("result", "結果", "result")}
                <a id="save-settings" href="#">${icon("save")}<span>保存</span></a>
              `
          }
        </nav>
        ${
          national
            ? `
              <div class="sidebar-actions">
                <a id="save-settings" href="#">保存</a>
                <button id="ai-settings" type="button">AI設定</button>
              </div>
            `
            : ""
        }
      </aside>

      <main>
        <header class="topbar">
          <div>
            ${
              national
                ? `<p class="screen-kicker">MVP screen mock</p>`
                : `<div class="term-badge"><span>現在</span><strong>${turn.year}年目 ${termLabel(turn)}</strong></div>`
            }
            <h1>${appData.scenario.title || (national ? "国版 政策シミュレーター" : "学園自治シミュレーター")}</h1>
            <p>${national ? "対象政策に応じて、関連指標・国民の声・効果軸を切り替えながら単発政策の影響を確認します。" : `${appData.scenario.termLabel}開始時点の指標から、生徒の声と課題候補をAIで抽出します。`}</p>
          </div>
          ${
            national
              ? `
                <div class="status-strip" aria-label="進行状態">
                  <span>基準年 ${appData.scenario.baseYear || 2025}</span>
                  <span>${appData.scenario.status || "政策検討中"}</span>
                  <strong>${statusTitle}</strong>
                </div>
              `
              : `
                <div class="top-actions">
                  <div class="view-switch" aria-label="ダッシュボード表示切替">
                    <button class="active" type="button">簡易</button>
                    <button type="button">詳細</button>
                  </div>
                  <button id="ai-settings" type="button">AI設定</button>
                  <button id="ai-initialize" class="primary" type="button" ${hasAiConnection() ? "" : "disabled"}>AIで初期化</button>
                </div>
              `
          }
        </header>

        <div class="ai-status ${national ? "national-ai-status" : ""} ${hasAiConnection() ? "connected" : ""}">
          AI: ${aiStatusText()}。${national ? "まずは固定モックデータで動作確認し、後続で実AI接続へ切り替えます。" : "公開Webでは利用者のAPIキー、ローカルではCodex App Serverも選べます。"}
          ${aiNotice ? `<div class="ai-warning">${aiNotice}</div>` : ""}
        </div>
        ${ActiveView()}
      </main>
      ${AiSettingsModal()}
      ${SaveModal()}
    </div>
  `;
  bindInteractions();
  renderVoiceChart();
  renderAnnualChart();
}

function AiSettingsModal() {
  return `
    <div id="ai-settings-modal" class="modal-backdrop" hidden>
      <form id="ai-settings-form" class="modal">
        <div class="panel-header">
          <div>
            <span class="section-label">AI設定</span>
            <h2>AI接続設定</h2>
          </div>
          <button id="ai-settings-close" type="button">閉じる</button>
        </div>
        <p>公開Webではユーザー自身のAPIキーを使います。キーは保存ファイルには含めず、ブラウザのセッション内だけに保持します。ローカルではCodex App Serverを選ぶとAPIキーなしで接続します。</p>
        <button id="use-codex-local" type="button">Codexローカルを使う</button>
        <label>
          <span>Provider</span>
          <select name="provider">
            ${Object.entries(providerPresets)
              .map(([value, preset]) => `<option value="${value}" ${aiConfig.provider === value ? "selected" : ""}>${preset.label}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>Base URL</span>
          <input name="baseUrl" type="text" value="${aiConfig.baseUrl}" placeholder="https://api.openai.com/v1 または ws://127.0.0.1:45123" />
        </label>
        <label>
          <span>Model</span>
          <input name="model" type="text" value="${aiConfig.model}" />
        </label>
        <label>
          <span>API Key</span>
          <input name="apiKey" type="password" value="${aiConfig.apiKey}" placeholder="Codex App Serverでは不要" />
        </label>
        <div class="modal-actions">
          <button id="ai-settings-clear" type="button">クリア</button>
          <button class="primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  `;
}

function SaveModal() {
  const memory = appData.memory;
  const timelineCount = memory?.timeline?.length || 1;
  const eventCount = memory?.eventLog?.length || 3;
  const groupCount = memory?.groupMemory?.length || appData.groups.length;
  return `
    <div id="save-modal" class="modal-backdrop" hidden>
      <section class="modal save-modal" role="dialog" aria-modal="true" aria-labelledby="save-modal-title">
        <div class="panel-header">
          <div>
            <span class="section-label">保存/読込</span>
            <h2 id="save-modal-title">メモリー管理</h2>
          </div>
          <button id="save-close" type="button">閉じる</button>
        </div>
        <p>ブラウザ内保存とJSONファイルで国版シミュレーション状態を保持します。APIキーやCodex認証情報は保存データに含めません。</p>
        <div class="memory-summary-grid">
          <div><strong>${timelineCount}</strong><span>${isNationalScenario() ? "政策スナップショット" : "学期スナップショット"}</span></div>
          <div><strong>${eventCount}</strong><span>イベントログ</span></div>
          <div><strong>${groupCount}</strong><span>属性メモリー</span></div>
        </div>
        <div class="save-status">${saveStatus}</div>
        <div class="save-actions">
          <button id="cache-save" class="primary" type="button">ブラウザに保存</button>
          <button id="cache-load" type="button">ブラウザから読込</button>
          <button id="export-save" type="button">JSONエクスポート</button>
          <button id="import-save" type="button">JSONインポート</button>
          <button id="cache-clear" class="danger" type="button">ブラウザ保存を削除</button>
        </div>
        <input id="import-save-file" type="file" accept="application/json,.json" hidden />
      </section>
    </div>
  `;
}

function bindInteractions() {
  document.querySelectorAll("nav a[data-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      activeView = event.currentTarget.dataset.view;
      App(appData);
    });
  });
  document.querySelectorAll("[data-voice-chart]").forEach((button) => {
    button.addEventListener("click", (event) => {
      activeVoiceChart = event.currentTarget.dataset.voiceChart;
      App(appData);
    });
  });
  document.querySelectorAll("[data-annual-chart]").forEach((button) => {
    button.addEventListener("click", (event) => {
      activeAnnualChart = event.currentTarget.dataset.annualChart;
      App(appData);
    });
  });
  document.querySelectorAll("[data-annual-metric]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const metricId = event.currentTarget.dataset.annualMetric;
      if (selectedAnnualMetricIds.includes(metricId)) {
        selectedAnnualMetricIds = selectedAnnualMetricIds.filter((id) => id !== metricId);
      } else {
        selectedAnnualMetricIds = [...selectedAnnualMetricIds, metricId];
      }
      if (!selectedAnnualMetricIds.length) selectedAnnualMetricIds = [metricId];
      activeAnnualChart = "metrics";
      App(appData);
    });
  });
  document.querySelectorAll("[data-dashboard-analysis]").forEach((button) => {
    button.addEventListener("click", (event) => {
      activeDashboardAnalysis = event.currentTarget.dataset.dashboardAnalysis;
      App(appData);
    });
  });
  document.querySelectorAll("[data-voice-effect-axis]").forEach((button) => {
    button.addEventListener("click", (event) => {
      activeVoiceEffectAxis = event.currentTarget.dataset.voiceEffectAxis;
      App(appData);
    });
  });
  document.querySelectorAll("[data-policy-effect-axis]").forEach((button) => {
    button.addEventListener("click", (event) => {
      activePolicyEffectAxis = event.currentTarget.dataset.policyEffectAxis;
      App(appData);
    });
  });
  document.querySelectorAll("[data-policy-panel]").forEach((button) => {
    button.addEventListener("click", (event) => {
      activePolicyPanel = event.currentTarget.dataset.policyPanel;
      App(appData);
    });
  });
  document.querySelectorAll("[data-result-effect-axis]").forEach((button) => {
    button.addEventListener("click", (event) => {
      activeResultEffectAxis = event.currentTarget.dataset.resultEffectAxis;
      App(appData);
    });
  });
  document.querySelectorAll("[data-free-policy-scale]").forEach((button) => {
    button.addEventListener("click", (event) => {
      freePolicyDraftText = document.querySelector("#free-policy-input")?.value || freePolicyDraftText;
      activeFreePolicyScale = event.currentTarget.dataset.freePolicyScale;
      App(appData);
    });
  });
  document.querySelector("#structure-free-policy")?.addEventListener("click", () => {
    const input = document.querySelector("#free-policy-input");
    const text = input?.value.trim() || "";
    if (!text) {
      saveStatus = "自由記述の政策内容を入力してください";
      App(appData);
      return;
    }
    freePolicyDraftText = text;
    upsertFreePolicyTarget(buildFreePolicyTarget(text));
    App(appData);
  });
  document.querySelector("#generate-target-analysis")?.addEventListener("click", () => {
    generatePolicyTargetInitialData();
  });
  document.querySelectorAll("[data-jump-view]").forEach((button) => {
    button.addEventListener("click", (event) => {
      activeView = event.currentTarget.dataset.jumpView;
      App(appData);
    });
  });
  document.querySelector("#save-settings")?.addEventListener("click", (event) => {
    event.preventDefault();
    document.querySelector("#save-modal").hidden = false;
  });
  document.querySelector("#save-close")?.addEventListener("click", () => {
    document.querySelector("#save-modal").hidden = true;
  });
  document.querySelector("#cache-save")?.addEventListener("click", async () => {
    try {
      await saveToBrowserCache();
    } catch (error) {
      saveStatus = `保存失敗: ${error.message}`;
      App(appData);
    }
  });
  document.querySelector("#cache-load")?.addEventListener("click", async () => {
    try {
      await loadFromBrowserCache();
    } catch (error) {
      saveStatus = `読込失敗: ${error.message}`;
      App(appData);
    }
  });
  document.querySelector("#cache-clear")?.addEventListener("click", async () => {
    if (!window.confirm("ブラウザ内の保存データを削除します。続けますか？")) return;
    try {
      await clearBrowserCache();
    } catch (error) {
      saveStatus = `削除失敗: ${error.message}`;
      App(appData);
    }
  });
  document.querySelector("#export-save")?.addEventListener("click", exportSaveFile);
  document.querySelector("#import-save")?.addEventListener("click", () => {
    document.querySelector("#import-save-file")?.click();
  });
  document.querySelector("#import-save-file")?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      await importSaveFile(file);
    } catch (error) {
      saveStatus = `インポート失敗: ${error.message}`;
      App(appData);
    }
  });
  document.querySelector("#execute-policy")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "シミュレーション中";
    try {
      await executePolicyTurn();
    } catch (error) {
      saveStatus = `施策実行失敗: ${error.message}`;
      App(appData);
    }
  });
  document.querySelector("#create-policy-draft")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "施策案を生成中";
    try {
      await createPolicyDraftFromSelection();
    } catch (error) {
      saveStatus = `施策案生成失敗: ${error.message}`;
      App(appData);
    }
  });
  document.querySelector("#policy-chat-send")?.addEventListener("click", async () => {
    const input = document.querySelector("#policy-chat-input");
    const sendButton = document.querySelector("#policy-chat-send");
    const text = input.value.trim();
    if (!text) return;

    sendButton.disabled = true;
    sendButton.textContent = "修正中";
    policyChat().messages.push({ role: "user", text });
    const loadingMessageIndex = policyChat().messages.push({ role: "assistant", text: "施策案の実施内容、効果、懸念、属性別影響を見直しています。" }) - 1;
    App(appData);
    try {
      await revisePolicyDraftFromChat(text);
    } catch (error) {
      policyChat().messages[loadingMessageIndex] = { role: "assistant", text: `施策案の修正に失敗しました。${error.message}` };
      App(appData);
    }
  });
  document.querySelector("#advance-turn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "次学期を生成中";
    try {
      await advanceToNextTurn();
    } catch (error) {
      saveStatus = `次学期生成失敗: ${error.message}`;
      App(appData);
    }
  });
  document.querySelectorAll(".create-annual-report").forEach((button) => {
    button.addEventListener("click", createAnnualReport);
  });
  document.querySelector("#ai-initialize")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "AI初期化中";
    await initializeWithAi();
  });
  document.querySelector("#ai-settings")?.addEventListener("click", () => {
    document.querySelector("#ai-settings-modal").hidden = false;
  });
  document.querySelector("#ai-settings-close")?.addEventListener("click", () => {
    document.querySelector("#ai-settings-modal").hidden = true;
  });
  document.querySelector("#ai-settings-clear")?.addEventListener("click", () => {
    sessionStorage.removeItem("national-policy-ai-key");
    sessionStorage.removeItem("school-sim-ai-key");
    localStorage.removeItem("national-policy-ai-config");
    localStorage.removeItem("school-sim-ai-config");
    aiConfig.apiKey = "";
    aiConfig.provider = "sample";
    aiConfig.baseUrl = "";
    aiConfig.model = "sample";
    aiNotice = "";
    App(appData);
  });
  document.querySelector("#use-codex-local")?.addEventListener("click", () => {
    const preset = providerPresets.codex_app_server;
    aiConfig = {
      provider: "codex_app_server",
      baseUrl: preset.baseUrl,
      model: preset.model,
      apiKey: "",
    };
    sessionStorage.removeItem("national-policy-ai-key");
    sessionStorage.removeItem("school-sim-ai-key");
    localStorage.setItem(
      "national-policy-ai-config",
      JSON.stringify({
        provider: aiConfig.provider,
        baseUrl: aiConfig.baseUrl,
        model: aiConfig.model,
      }),
    );
    localStorage.removeItem("school-sim-ai-config");
    aiNotice = "";
    App(appData);
  });
  document.querySelector("#ai-settings-form select[name='provider']")?.addEventListener("change", (event) => {
    const preset = providerPresets[event.currentTarget.value] || providerPresets.sample;
    const form = event.currentTarget.form;
    form.elements.baseUrl.value = preset.baseUrl;
    form.elements.model.value = preset.model;
    if (!providerRequiresApiKey(event.currentTarget.value)) {
      form.elements.apiKey.value = "";
    }
  });
  document.querySelector("#ai-settings-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveAiConfig(new FormData(event.currentTarget));
    App(appData);
  });
  document.querySelector("#issue-chat-send")?.addEventListener("click", async () => {
    const input = document.querySelector("#issue-chat-input");
    const sendButton = document.querySelector("#issue-chat-send");
    const text = input.value.trim();
    if (!text) return;

    sendButton.disabled = true;
    sendButton.textContent = "送信中";
    appData.issueSelectionChat.messages.push({ role: "user", text });
    try {
      const result = await discussIssueSelection(text);
      appData.issueSelectionChat.messages.push({ role: "assistant", text: result.message });
      const previousIssueId = appData.issueSelectionChat.selectedIssueId;
      appData.issueSelectionChat.selectedIssueId = result.recommendedIssueIds?.[0] || appData.issueSelectionChat.selectedIssueId;
      if (isNationalScenario() && previousIssueId !== appData.issueSelectionChat.selectedIssueId) {
        clearNationalGeneratedOutputs();
      }
      resetPolicyDrivenViews(selectedPolicyTarget());
    } finally {
      App(appData);
    }
  });
  document.querySelectorAll(".issue-row[data-issue-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const issueId = event.currentTarget.dataset.issueId;
      const issue = appData.issues.find((candidate) => candidate.id === issueId);
      if (!issue) return;

      const previousIssueId = appData.issueSelectionChat.selectedIssueId;
      appData.issueSelectionChat.selectedIssueId = issue.id;
      if (isNationalScenario() && previousIssueId !== issue.id) {
        clearNationalGeneratedOutputs();
      }
      resetPolicyDrivenViews((appData.policyTargets || []).find((target) => target.id === issue.id) || issue);
      appData.issueSelectionChat.messages.push({ role: "user", text: `課題「${issue.title}」を選択しました。内容を詳しく説明してください。` });
      const loadingMessageIndex = appData.issueSelectionChat.messages.push({ role: "assistant", text: `「${issue.title}」の背景と関連指標を分析しています。` }) - 1;
      App(appData);
      try {
        const result = await explainIssueSelection(issue);
        appData.issueSelectionChat.messages[loadingMessageIndex] = { role: "assistant", text: result.message };
        const previousIssueId = appData.issueSelectionChat.selectedIssueId;
        appData.issueSelectionChat.selectedIssueId = result.recommendedIssueIds?.[0] || issue.id;
        if (isNationalScenario() && previousIssueId !== appData.issueSelectionChat.selectedIssueId) {
          clearNationalGeneratedOutputs();
        }
        resetPolicyDrivenViews(selectedPolicyTarget());
      } finally {
        App(appData);
      }
    });
  });
}

async function init() {
  try {
    App(await loadDashboardData());
  } catch (error) {
    document.querySelector("#app").innerHTML = `
      <main class="load-error">
        <h1>データを読み込めませんでした</h1>
        <p>${error.message}</p>
      </main>
    `;
  }
}

init();
