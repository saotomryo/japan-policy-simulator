let appData;
let saveStatus = "未保存";
let aiNotice = "";
let aiErrorDialog = null;
let aiConnectionTest = null;
let aiSettingsModalOpen = false;
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
let nationalGenerationNotice = "";
let isNationalGenerating = false;
const showLongTermResultSection = false;
const AI_CHAT_TIMEOUT_MS = 300000;
const AI_GENERATION_TIMEOUT_MS = 900000;
const AI_CONNECTION_TEST_TIMEOUT_MS = 30000;

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
  if (appData?.scenario?.id === "national") return "政策検討";
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

function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString("ja-JP") : "-";
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
  return data.policy ? sanitizeGeneratedPolicyDraft(JSON.parse(JSON.stringify(data.policy))) : null;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

const generatedOutputMetaPatterns = [
  /既存プリセット/,
  /固定テンプレート/,
  /テンプレートに落と/,
  /AI生成時/,
  /AIが.*推論/,
  /policyTarget/i,
  /designIssues/i,
  /context\./i,
  /JSON Schema/i,
  /プロンプト/,
  /出力前に自己レビュー/,
];

function containsGeneratedMetaText(value) {
  return typeof value === "string" && generatedOutputMetaPatterns.some((pattern) => pattern.test(value));
}

function sanitizeGeneratedStringList(items = []) {
  return items.filter((item) => typeof item === "string" && item.trim() && !containsGeneratedMetaText(item));
}

function sanitizeGeneratedPolicyDraft(draft = {}) {
  return {
    ...draft,
    implementationDetails: sanitizeGeneratedStringList(draft.implementationDetails),
    expectedEffects: sanitizeGeneratedStringList(draft.expectedEffects),
    concerns: sanitizeGeneratedStringList(draft.concerns),
    risks: sanitizeGeneratedStringList(draft.risks),
  };
}

function sanitizeEventForSave(event) {
  const next = deepClone(event);
  if (next.payload?.draft) {
    next.payload.draft = sanitizeGeneratedPolicyDraft(next.payload.draft);
  }
  if (next.payload?.policy) {
    next.payload.policy = sanitizeGeneratedPolicyDraft(next.payload.policy);
  }
  return next;
}

function sanitizePolicyTargetForSave(target) {
  const next = deepClone(target);
  if (Array.isArray(next.metrics)) {
    next.metrics = next.metrics.filter((metric) => !containsGeneratedMetaText(metric));
  }
  if (containsGeneratedMetaText(next.summary)) {
    next.summary = `${next.title}。政策分野、関連指標、対象層、財源規模を確認します。`;
  }
  if (containsGeneratedMetaText(next.fundingNote)) {
    next.fundingNote = "財源規模、対象範囲、実装主体を確認します。";
  }
  if (Array.isArray(next.designIssues)) {
    next.designIssues = next.designIssues.filter((issue) => ![issue.title, issue.axisA, issue.axisB, issue.description].some(containsGeneratedMetaText));
  }
  return next;
}

function sanitizeIssueForSave(issue) {
  const next = deepClone(issue);
  if (Array.isArray(next.metrics)) {
    next.metrics = next.metrics.filter((metric) => !containsGeneratedMetaText(metric));
  }
  if (containsGeneratedMetaText(next.summary)) {
    next.summary = `${next.title}。関連指標、対象層、財源規模を確認します。`;
  }
  return next;
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
  return [...memory.eventLog.filter((event) => event.id !== issueChatEvent.id).map(sanitizeEventForSave), issueChatEvent];
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
      issues: (data.issues || []).map(sanitizeIssueForSave),
      policyTargets: (data.policyTargets || []).map(sanitizePolicyTargetForSave),
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

function reportValue(value, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  return escapeHtml(value);
}

function reportList(items = [], itemRenderer = (item) => item) {
  if (!items?.length) return `<p class="empty">該当データはありません。</p>`;
  return `<ul>${items.map((item) => `<li>${itemRenderer(item)}</li>`).join("")}</ul>`;
}

function reportMetricTable(metrics = []) {
  if (!metrics.length) return `<p class="empty">指標はありません。</p>`;
  return `
    <table>
      <thead><tr><th>指標</th><th>値</th><th>種別</th><th>説明</th></tr></thead>
      <tbody>
        ${metrics
          .map(
            (metric) => `
              <tr>
                <td>${reportValue(metric.label || metric.id)}</td>
                <td><strong>${reportValue(metric.value)}${metric.unit ? reportValue(metric.unit, "") : ""}</strong></td>
                <td>${SourceTypeLabel(metric.sourceType || metric.source)}</td>
                <td>${reportValue(metric.description || metric.note || "")}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function reportSegmentEffects(segmentEffects = {}) {
  const axes = Object.entries(segmentEffects || {});
  if (!axes.length) return `<p class="empty">属性別効果は未生成です。</p>`;
  return axes
    .map(
      ([axis, effects]) => `
        <h4>${effectAxisTitle(axis)}</h4>
        <div class="effect-grid">
          ${(effects || [])
            .map((effect) => {
              const score = effect.effectScore === null || effect.effectScore === undefined ? "N/A" : `${effect.effectScore > 0 ? "+" : ""}${effect.effectScore}`;
              return `
                <article>
                  <div><strong>${reportValue(effect.segmentLabel)}</strong><b>${score}</b></div>
                  <p>${reportValue(effect.summary)}</p>
                  <small>${effect.applicability === "low_relevance" ? "該当性が低い: " : ""}${reportValue(effect.reason)}</small>
                </article>
              `;
            })
            .join("")}
        </div>
      `,
    )
    .join("");
}

function reportCostBreakdown(items = []) {
  if (!items.length) return `<p class="empty">コスト内訳は未生成です。</p>`;
  return `
    <div class="cost-grid">
      ${items
        .map(
          (item) => `
            <article>
              <header><strong>${reportValue(item.label)}</strong><b>${reportValue(item.amount)}${reportValue(item.unit, "")}</b></header>
              <p>${reportValue(item.costType)} / ${reportValue(item.target)}</p>
              <small>${reportValue(item.calculation)}</small>
              <small>財源: ${reportValue(item.fundingSource)}</small>
              ${reportList(item.details || [], (detail) => `${reportValue(detail.label)}: ${reportValue(detail.amount)}${reportValue(detail.unit, "")} - ${reportValue(detail.memo)}`)}
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function reportResultSection(result = appData.lastSimulationResult) {
  if (!result) {
    return `
      <section>
        <h2>実行結果</h2>
        <p class="empty">政策はまだ実行されていません。</p>
      </section>
    `;
  }
  return `
    <section>
      <h2>実行結果</h2>
      <p>${reportValue(result.summary)}</p>
      <h3>指標変化</h3>
      <div class="delta-grid">
        ${Object.entries(result.visibleMetricDeltas || {})
          .map(([key, value]) => `<div><span>${metricLabel(key)}</span><strong class="${value >= 0 ? "good" : "warn"}">${value > 0 ? "+" : ""}${value}</strong></div>`)
          .join("")}
      </div>
      <h3>属性別影響</h3>
      ${reportList(result.groupImpacts || [], (impact) => `<strong>${groupLabel(impact.groupId)}</strong>: ${reportValue(impact.summary)} <b>${impact.scoreDelta > 0 ? "+" : ""}${impact.scoreDelta}</b>`)}
      <h3>次の論点</h3>
      ${reportList(result.nextIssues || [])}
    </section>
  `;
}

function buildReportHtml(data = appData) {
  const exportedAt = new Date();
  const target = selectedPolicyTarget();
  const policy = data.policy || emptyPolicyDraft();
  const analysis = data.voiceAnalysis;
  const statusTitle = policy.title && policy.title !== "政策案未生成" ? policy.title : target?.title || "政策未選択";
  const visibleMetrics = data.metrics?.filter((metric) => metric.visible) || [];
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${reportValue(data.scenario?.title || "日本版　仮想政策シミュレーター")} レポート</title>
  <style>
    :root { color-scheme: light; --ink:#111827; --muted:#64748b; --line:#d9e2ec; --bg:#f5f7fb; --panel:#fff; --accent:#0f4c50; --good:#047857; --warn:#dc2626; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 56px; }
    header.hero { margin-bottom: 24px; }
    h1 { font-size: 34px; margin: 0 0 8px; letter-spacing: 0; }
    h2 { font-size: 24px; margin: 0 0 14px; }
    h3 { font-size: 18px; margin: 22px 0 10px; }
    h4 { margin: 18px 0 8px; }
    section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 22px; margin: 18px 0; box-shadow: 0 10px 24px rgba(15, 23, 42, .06); }
    .meta, .pill-row, .summary-grid, .delta-grid, .effect-grid, .cost-grid, .cluster-grid, .voice-grid { display: grid; gap: 10px; }
    .meta { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); color: var(--muted); }
    .summary-grid, .delta-grid { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
    .summary-grid div, .delta-grid div, .effect-grid article, .cost-grid article, .cluster-grid article, .voice-grid article { border: 1px solid var(--line); border-radius: 8px; padding: 14px; background: #fbfdff; }
    .summary-grid span, .delta-grid span, small, .empty { color: var(--muted); }
    .summary-grid strong, .delta-grid strong { display: block; font-size: 24px; }
    .pill-row { grid-template-columns: repeat(auto-fit, minmax(140px, max-content)); }
    .pill-row span { border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; color: var(--muted); font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--line); padding: 9px 8px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 13px; }
    ul { margin: 8px 0 0; padding-left: 20px; }
    .effect-grid, .cost-grid, .cluster-grid, .voice-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .effect-grid article div, .cost-grid header { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .good { color: var(--good); } .warn { color: var(--warn); }
    .kicker { color: #0e7490; font-weight: 900; text-transform: uppercase; margin: 0; }
    @media print { body { background: #fff; } main { max-width: none; padding: 16px; } section { break-inside: avoid; box-shadow: none; } }
  </style>
</head>
<body>
  <main>
    <header class="hero">
      <p class="kicker">National Policy Simulator Report</p>
      <h1>${reportValue(data.scenario?.title || "日本版　仮想政策シミュレーター")}</h1>
      <div class="meta">
        <div>出力日時: ${exportedAt.toLocaleString("ja-JP")}</div>
        <div>基準年: ${reportValue(data.scenario?.baseYear || 2025)}</div>
        <div>対象政策: ${reportValue(statusTitle)}</div>
      </div>
    </header>

    <section>
      <h2>ダッシュボード</h2>
      <div class="summary-grid">
        ${visibleMetrics.slice(0, 8).map((metric) => `<div><span>${reportValue(metric.label)}</span><strong>${reportValue(metric.value)}${metric.unit ? reportValue(metric.unit, "") : ""}</strong><small>${SourceTypeLabel(metric.sourceType || metric.source)}</small></div>`).join("")}
      </div>
      <h3>主要指標</h3>
      ${reportMetricTable(visibleMetrics)}
      <h3>国際関係スコア</h3>
      ${reportList(data.internationalRelations || [], (item) => `<strong>${reportValue(item.label || item.name)}</strong>: ${reportValue(item.score ?? item.value)} ${reportValue(item.note || item.description || "")}`)}
    </section>

    <section>
      <h2>政策ターゲット</h2>
      <h3>${reportValue(target?.title || "未選択")}</h3>
      <p>${reportValue(target?.summary || "")}</p>
      <div class="pill-row">
        <span>分析適合度 ${reportValue(target?.fit || "-")}</span>
        ${(target?.recommendedViews || []).map((view) => `<span>${effectAxisTitle(view)}</span>`).join("")}
      </div>
      <h3>関連指標</h3>
      ${reportList(target?.metrics || [])}
      <h3>関連指標と効果軸</h3>
      ${reportList(policyTargetMetricBindings(target), (binding) => `<strong>${reportValue(binding.metricLabel)}</strong>: ${reportValue(binding.axisLabel)}。${reportValue(binding.description)}`)}
      <h3>制度設計上の争点</h3>
      ${reportList(target?.designIssues || [], (issue) => `<strong>${reportValue(issue.title)}</strong>: ${reportValue(issue.axisA)} vs ${reportValue(issue.axisB)}。${reportValue(issue.description)}`)}
    </section>

    <section>
      <h2>声の分析</h2>
      <div class="summary-grid">
        <div><span>${isNationalScenario() ? "推定母集団" : "想定人口"}</span><strong>${formatCount(analysis?.populationSize || "-")}</strong></div>
        <div><span>${isNationalScenario() ? "推定アンケート母数" : "分析対象の声"}</span><strong>${formatCount(analysis?.sampledOpinionCount || data.voices?.length || 0)}</strong></div>
        ${isNationalScenario() ? `<div><span>代表発話</span><strong>${formatCount(data.voices?.length || 0)}</strong></div>` : ""}
        <div><span>意見クラスター</span><strong>${reportValue(analysis?.clusters?.length || 0)}</strong></div>
      </div>
      <h3>クラスター</h3>
      <div class="cluster-grid">
        ${(analysis?.clusters || []).map((cluster) => `<article><strong>${reportValue(cluster.label)}</strong><p>${reportValue(cluster.summary)}</p><small>${reportValue(cluster.size)}件相当 / sentiment ${reportValue(cluster.sentiment)}</small></article>`).join("") || `<p class="empty">クラスターは未生成です。</p>`}
      </div>
      <h3>代表発話</h3>
      <div class="voice-grid">
        ${(data.voices || []).map((voice) => `<article><strong>${reportValue(voice.name)}</strong><small>${reportValue(voice.group)} / ${reportValue(voice.mood)}</small><p>${reportValue(voice.text)}</p></article>`).join("") || `<p class="empty">代表発話は未生成です。</p>`}
      </div>
      <h3>効果軸</h3>
      ${reportSegmentEffects(data.segmentEffects)}
    </section>

    <section>
      <h2>政策案</h2>
      <h3>${reportValue(policy.title)}</h3>
      <p>${reportValue(policy.summary)}</p>
      <div class="summary-grid">
        <div><span>予算</span><strong>${reportValue(policy.budget)}億円</strong></div>
        <div><span>短期財源使用</span><strong>${reportValue(policy.cashUse)}億円</strong></div>
      </div>
      <h3>財源方針</h3>
      <p>${reportValue(policy.financePlan)}</p>
      <h3>実施内容</h3>
      ${reportList(policy.implementationDetails || [])}
      <h3>実施内容別コスト</h3>
      ${reportCostBreakdown(policy.costBreakdown || [])}
      <h3>想定効果</h3>
      ${reportList(policy.expectedEffects || [])}
      <h3>懸念</h3>
      ${reportList(policy.concerns || policy.risks || [])}
      <h3>対象属性</h3>
      ${reportList(policy.beneficiaryGroups || [], (item) => `<strong>${reportValue(item.label)}</strong>: ${reportValue(item.reason)}`)}
      <h3>メリットが薄い・ややデメリットになる対象属性</h3>
      ${reportList(policy.lowBenefitGroups || [], (item) => `<strong>${reportValue(item.label)}</strong>: ${reportValue(item.reason)}`)}
    </section>

    ${reportResultSection(data.lastSimulationResult)}
  </main>
</body>
</html>`;
}

function exportReportHtml() {
  const html = buildReportHtml(appData);
  const now = new Date().toISOString().slice(0, 10);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${isNationalScenario() ? "national-policy-report" : "school-simulator-report"}-${now}.html`;
  link.click();
  URL.revokeObjectURL(url);
  saveStatus = "HTMLレポートを書き出しました";
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
    appData.voiceAnalysis = normalizeNationalVoiceAnalysis(saveFile.currentState.voiceAnalysis, appData.voices || saveFile.currentState?.voices || []);
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
    appData.policy = sanitizeGeneratedPolicyDraft(saveFile.currentState.policyDraft);
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

function usesFixedSampleProvider() {
  return aiConfig.provider === "sample";
}

function hasAiConnection() {
  if (usesFixedSampleProvider()) return false;
  if (providerRequiresApiKey()) return Boolean(aiConfig.apiKey);
  return Boolean(aiConfig.baseUrl);
}

function assertAiConnection() {
  if (!hasAiConnection()) {
    throw new Error(`${providerLabel()} の接続設定が未完了です。AI設定でBase URLまたはAPI Keyを確認してください。`);
  }
}

function aiConfigFromFormData(formData) {
  const provider = formData.get("provider") || "sample";
  const preset = providerPresets[provider] || providerPresets.sample;
  return {
    provider,
    baseUrl: formData.get("baseUrl") || preset.baseUrl,
    model: formData.get("model") || preset.model,
    apiKey: formData.get("apiKey") || "",
  };
}

function saveAiConfig(formData) {
  aiConfig = aiConfigFromFormData(formData);
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
  aiConnectionTest = null;
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
    return aiConfig.provider === "sample" ? "固定サンプル mode" : "未接続";
  }
  if (aiConfig.provider === "codex_app_server") {
    return `${providerLabel()} / ${aiConfig.baseUrl}`;
  }
  return `${providerLabel()} / ${aiConfig.model}`;
}

function buildCodexHealthUrl(baseUrl) {
  const url = new URL(baseUrl || providerPresets.codex_app_server.baseUrl);
  url.pathname = "/healthz";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function openAiModelsUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, "")}/models`;
}

async function testCodexAppServerConnection(config) {
  const response = await fetch(buildCodexHealthUrl(config.baseUrl), { method: "GET", cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Codex local bridge health check failed: ${response.status}`);
  }
  if (body.codexReady === false) {
    throw new Error(body.codexError || "Codex App Server is not ready");
  }
  return body.codexReady === true ? "CodexローカルブリッジとCodex App Serverに接続できました。" : "Codexローカルブリッジに接続できました。";
}

async function testOpenAiModelsConnection(config) {
  if (!config.baseUrl) throw new Error("Base URLが未入力です。");
  if (providerRequiresApiKey(config.provider) && !config.apiKey) throw new Error("API Keyが未入力です。");
  const response = await fetch(openAiModelsUrl(config.baseUrl), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Models endpoint failed: ${response.status} ${body.slice(0, 160)}`);
  }
  const data = await response.json().catch(() => ({}));
  const count = Array.isArray(data.data) ? data.data.length : 0;
  return count ? `APIに接続できました。取得モデル数: ${count}` : "APIに接続できました。";
}

async function testAiConnection(config) {
  if (config.provider === "sample") {
    return "固定サンプルは外部接続を使いません。";
  }
  if (config.provider === "codex_app_server") {
    return testCodexAppServerConnection(config);
  }
  if (config.provider === "openai_responses" || config.provider === "openai_compatible_chat") {
    return testOpenAiModelsConnection(config);
  }
  throw new Error(`Provider is not implemented: ${config.provider}`);
}

function setAiErrorNotice(error) {
  aiNotice = `${providerLabel()} のAI接続に失敗しました: ${error.message}`;
}

function showAiErrorDialog({ title = "AI接続エラー", error, message, retry, cancel }) {
  const errorMessage = error?.message || message || "AI接続に失敗しました。";
  setAiErrorNotice({ message: errorMessage });
  aiErrorDialog = {
    title,
    message: message || "AI処理を完了できませんでした。接続設定、ローカルサーバー、APIキー、またはJSON Schema応答を確認してください。",
    detail: errorMessage,
    retry,
    cancel,
  };
  App(appData);
}

function clearAiErrorDialog() {
  aiErrorDialog = null;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
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
              text: "あなたは政策シミュレーターの熟議支援AIです。国版シナリオでは日本の政策効果、国民・ステークホルダー反応、財源制約を扱います。必ず指定されたJSON Schemaに従って日本語で返してください。",
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
          content: "あなたは政策シミュレーターの熟議支援AIです。国版シナリオでは日本の政策効果、国民・ステークホルダー反応、財源制約を扱います。必ず指定されたJSON Schemaに従ってJSONだけを返してください。",
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
  const national = isNationalScenario();
  const prompt = JSON.stringify(
    {
      task: national ? "政策ターゲットを深掘りし、政策影響分析を支援してください。" : "課題候補を深掘りし、今学期に扱う課題選択を支援してください。",
      userMessage: userText,
      simulation: {
        scenario: appData.scenario,
        visibleMetrics: appData.metrics.filter((metric) => metric.visible),
        financeMetrics: appData.financeMetrics,
        voices: appData.voices,
        issueCandidates: appData.issues,
      },
      constraints: national
        ? [
            "この時点では政策案を決定しない",
            "関連指標、効果軸、利害関係者、財源上の注意を述べる",
            "最終決定はユーザーが行う",
          ]
        : [
            "1学期に実施する施策は1つ",
            "基本はキャッシュの範囲内で実施",
            "他予算充当が必要な場合は副作用も述べる",
            "最終決定はユーザーが行う",
          ],
    },
    null,
    2,
  );

  if (usesFixedSampleProvider()) {
    return sampleIssueSelectionResponse(userText);
  }
  assertAiConnection();

  try {
    return await withTimeout(
      callProviderJson({
        schemaName: "issue-selection-chat-response",
        prompt,
      }),
      AI_CHAT_TIMEOUT_MS,
      `${isNationalScenario() ? "政策分析チャット" : "課題選択チャット"}のAI応答が5分以内に返りませんでした`,
    );
  } catch (error) {
    console.warn(error);
    setAiErrorNotice(error);
    throw error;
  }
}

async function explainIssueSelection(issue) {
  const national = isNationalScenario();
  const prompt = JSON.stringify(
    {
      task: national
        ? "ユーザーが画面上の政策ターゲットを選択しました。チャット欄に表示するため、選択政策の意味、背景、関連する声、指標、財源制約、次に確認すべき論点を説明してください。"
        : "ユーザーが画面上の課題候補を選択しました。チャット欄に表示するため、選択課題の意味、背景、関連する声、指標、財務制約、次に確認すべき論点を説明してください。",
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
      constraints: national
        ? [
            "この時点では政策案を決定しない",
            "政策ターゲットに関連する指標と効果軸を明示する",
            "財源上の注意があれば明記する",
            "ユーザーが次に深掘りできる問いを含める",
          ]
        : [
            "この時点では施策を決定しない",
            "1学期に実施する施策は1つ",
            "基本はキャッシュ範囲内で検討する",
            "生徒会が次に深掘りできる問いを含める",
          ],
    },
    null,
    2,
  );

  if (usesFixedSampleProvider()) {
    return sampleIssueDetailResponse(issue);
  }
  assertAiConnection();

  try {
    return await withTimeout(
      callProviderJson({
        schemaName: "issue-selection-chat-response",
        prompt,
      }),
      AI_CHAT_TIMEOUT_MS,
      "課題詳細説明のAI応答が5分以内に返りませんでした",
    );
  } catch (error) {
    console.warn(error);
    setAiErrorNotice(error);
    throw error;
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

function normalizePolicyDraftForRevision(draft = {}) {
  return {
    ...draft,
    implementationDetails: draft.implementationDetails?.length ? [...draft.implementationDetails] : [],
    expectedEffects: draft.expectedEffects?.length ? [...draft.expectedEffects] : [],
    concerns: draft.concerns?.length ? [...draft.concerns] : [],
    costBreakdown: draft.costBreakdown?.length ? deepClone(draft.costBreakdown) : [],
    beneficiaryGroups: draft.beneficiaryGroups?.length ? deepClone(draft.beneficiaryGroups) : [],
    lowBenefitGroups: draft.lowBenefitGroups?.length ? deepClone(draft.lowBenefitGroups) : [],
    risks: draft.risks?.length ? [...draft.risks] : [],
  };
}

function applyFoodReducedTaxRevision(draft, userText) {
  const revised = normalizePolicyDraftForRevision(draft);
  const foodRateMatch = userText.match(/(?:食料品|食品)[^\d]*(\d{1,2})\s*%/);
  const foodRate = foodRateMatch?.[1] || "5";
  revised.summary = `${revised.summary || revised.title} 修正要望「${userText}」を反映し、食料品は軽減税率${foodRate}%、その他対象は原案の税率を前提に分けて設計しました。`;
  revised.implementationDetails = [
    `食料品には軽減税率${foodRate}%を適用し、外食・酒類・高額嗜好品などの除外条件を明文化する。`,
    "標準税率対象、軽減税率対象、非課税・給付補完対象を分け、事業者向けの判定表を公開する。",
    "低所得層・子育て世帯・年金生活者には、食料品軽減税率と給付・還付を組み合わせて負担増を抑える。",
    "小売・飲食・EC事業者のレジ改修、価格表示、インボイス処理の移行期間と相談窓口を設ける。",
  ];
  revised.expectedEffects = [
    `食料品を${foodRate}%に抑えることで、低所得層と固定収入層の生活必需品負担を緩和する。`,
    "標準税率部分では財政余力と社会保障財源の改善を狙う。",
    "対象品目を明確にすることで、事業者と消費者の混乱を抑える。",
  ];
  revised.concerns = [
    "軽減税率の対象線引きが複雑になると、事業者の事務負担と制度不信が増える。",
    "食料品以外の生活必需サービスでは負担増が残る。",
    "税率区分が増えることで、価格表示・会計・監査の運用コストが上がる。",
  ];
  revised.risks = [...new Set([...(revised.risks || []), "軽減税率対象の線引き争い", "小売・飲食事業者の事務負担増"])];
  revised.lowBenefitGroups = [
    { groupId: "retail_food_service", label: "小売・飲食事業者", reason: "複数税率の判定、レジ改修、価格表示対応が増える。" },
    { groupId: "low_income_non_food", label: "食料品以外の支出が大きい低所得層", reason: "光熱費・交通・通信などの負担増は残る。" },
  ];
  revised.beneficiaryGroups = [
    { groupId: "low_income", label: "低所得層", reason: `食料品の税率を${foodRate}%に抑えることで生活必需品の負担増を緩和できる。` },
    { groupId: "pensioner", label: "年金生活者", reason: "固定収入の中で食費負担の上昇を抑えられる。" },
  ];
  revised.shortTermEffects = {
    ...(revised.shortTermEffects || {}),
    support: Math.min(0, revised.shortTermEffects?.support ?? -2),
    fairness: (revised.shortTermEffects?.fairness ?? -4) + 2,
    fiscalCapacity: revised.shortTermEffects?.fiscalCapacity ?? 6,
    economicRipple: Math.min(-2, revised.shortTermEffects?.economicRipple ?? -4),
    importIndustryImpact: Math.min(-1, revised.shortTermEffects?.importIndustryImpact ?? -2),
  };
  revised.costBreakdown = revised.costBreakdown?.length ? revised.costBreakdown : sampleNationalPolicyDraft(selectedPolicyTarget()).costBreakdown;
  revised.costBreakdown = [
    {
      id: "reduced_food_tax_system",
      label: `食料品軽減税率${foodRate}%の制度対応`,
      amount: Math.round((revised.budget || 42000) * 0.12),
      unit: "億円",
      costType: "制度設計・システム対応",
      target: "国税庁、自治体、小売・飲食・EC事業者",
      calculation: "複数税率対応の周知、判定表、システム改修支援を概算",
      fundingSource: "増収分の一部と既存デジタル化予算の組替え",
      details: [
        { label: "対象品目判定・周知", amount: Math.round((revised.budget || 42000) * 0.03), unit: "億円", memo: "食品分類、FAQ、消費者説明" },
        { label: "レジ・会計改修支援", amount: Math.round((revised.budget || 42000) * 0.07), unit: "億円", memo: "中小事業者の複数税率対応" },
        { label: "相談・監査体制", amount: Math.round((revised.budget || 42000) * 0.02), unit: "億円", memo: "誤適用と問い合わせ対応" },
      ],
    },
    ...revised.costBreakdown.filter((item) => item.id !== "reduced_food_tax_system").slice(0, 3),
  ];
  return revised;
}

function applyPolicyDraft(draft, options = {}) {
  const sanitizedDraft = sanitizeGeneratedPolicyDraft(draft);
  appData.policy = {
    id: sanitizedDraft.id,
    title: sanitizedDraft.title,
    summary: sanitizedDraft.summary,
    budget: sanitizedDraft.budget,
    cashUse: sanitizedDraft.cashUse,
    financePlan: sanitizedDraft.financePlan,
    costBreakdown: sanitizedDraft.costBreakdown || appData.policy?.costBreakdown || [],
    implementationDetails: sanitizedDraft.implementationDetails?.length ? sanitizedDraft.implementationDetails : [sanitizedDraft.summary],
    expectedEffects: sanitizedDraft.expectedEffects?.length
      ? sanitizedDraft.expectedEffects
      : Object.entries(sanitizedDraft.shortTermEffects || {}).map(([label, value]) => `${label}: ${value > 0 ? "+" : ""}${value}`),
    concerns: sanitizedDraft.concerns?.length ? sanitizedDraft.concerns : sanitizedDraft.risks || [],
    beneficiaryGroups: normalizePolicyGroupItems(sanitizedDraft.beneficiaryGroups),
    lowBenefitGroups: normalizePolicyGroupItems(sanitizedDraft.lowBenefitGroups),
    shortTermEffects: sanitizedDraft.shortTermEffects || {},
    longTermEffects: sanitizedDraft.longTermEffects || {},
    risks: sanitizedDraft.risks || [],
    covers: [
      selectedIssue()?.title || sanitizedDraft.primaryIssueId,
      ...(sanitizedDraft.secondaryIssueIds || [])
        .map((issueId) => appData.issues.find((issue) => issue.id === issueId)?.title || issueId)
        .slice(0, 2),
    ],
    effects: Object.entries(sanitizedDraft.shortTermEffects || {}).map(([label, value]) => ({
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
          text: `${isNationalScenario() ? "政策案" : "施策案"}「${sanitizedDraft.title}」を作成しました。実施内容、効果、懸念点、属性別の影響を見ながら修正できます。`,
        },
      ],
    };
  } else {
    chat.messages.push({ role: "assistant", text: `${isNationalScenario() ? "政策案" : "施策案"}を「${sanitizedDraft.title}」として更新しました。` });
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
        summary: sanitizedDraft.title,
        payload: { draft: sanitizedDraft },
      },
    ],
  };
  saveStatus = isNationalScenario() ? "政策案を作成しました" : "施策ドラフトを作成しました";
}

async function generatePolicyDraft() {
  const national = isNationalScenario();
  const prompt = JSON.stringify(
    {
      task: national ? "選択された政策ターゲットに対して、政策案ドラフトを作成してください。" : "選択された課題に対して、今学期に1つだけ実行する施策ドラフトを作成してください。",
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
        national ? "1つの政策案で複数の関連論点に対応してよい" : "1つの施策で複数課題に対応してよい",
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

  if (usesFixedSampleProvider()) {
    return samplePolicyDraft();
  }
  assertAiConnection();

  try {
    return await withTimeout(callProviderJson({ schemaName: "policy-draft", prompt }), AI_GENERATION_TIMEOUT_MS, `${isNationalScenario() ? "政策案" : "施策案"}生成のAI応答が15分以内に返りませんでした`);
  } catch (error) {
    console.warn(error);
    setAiErrorNotice(error);
    throw error;
  }
}

async function createPolicyDraftFromSelection() {
  const draft = await generatePolicyDraft();
  applyPolicyDraft(draft, { resetChat: true });
  App(appData);
}

function sampleRevisedPolicyDraft(userText) {
  const current = appData.policy;
  if (/(食料品|食品).*(\d{1,2})\s*%|(\d{1,2})\s*%.*(食料品|食品)/.test(userText)) {
    return applyFoodReducedTaxRevision(current, userText);
  }
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
      `修正要望「${userText}」を実施条件に反映し、対象範囲・税率・除外条件を明文化する。`,
      ...(current.implementationDetails || []).filter((detail) => !detail.includes("修正要望")).slice(0, 3),
    ],
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
  const national = isNationalScenario();
  const prompt = JSON.stringify(
    {
      task: national
        ? "現在の政策案を、ユーザーのチャット指示に基づいて修正してください。修正後の政策案全体を返してください。"
        : "現在の施策案を、ユーザーのチャット指示に基づいて修正してください。修正後の施策案全体を返してください。",
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
        national ? "政策案は1つの政策実行として扱う" : "1学期に実施する施策は1つのままにする",
        "ユーザー指示に税率、対象品目、対象属性、除外条件、補償策が含まれる場合は、summaryだけでなくimplementationDetailsへ具体的に反映する",
        "食料品を5%にする等の軽減税率指示では、implementationDetailsに食料品税率、標準税率対象、除外条件、事業者対応を必ず書く",
        "実施内容、想定効果、懸念点、メリットを享受する属性、メリットが薄い属性を必ず更新する",
        "costBreakdownを更新し、何に対してどうコストがかかるかをdetailsまで示す",
        "キャッシュ範囲を大きく超える場合はfinancePlanとconcernsで明記する",
        "shortTermEffectsは現在のmetric idをキーにする",
      ],
    },
    null,
    2,
  );

  if (usesFixedSampleProvider()) {
    return sampleRevisedPolicyDraft(userText);
  }
  assertAiConnection();

  try {
    return await withTimeout(callProviderJson({ schemaName: "policy-draft", prompt }), AI_GENERATION_TIMEOUT_MS, `${isNationalScenario() ? "政策案" : "施策案"}修正のAI応答が15分以内に返りませんでした`);
  } catch (error) {
    console.warn(error);
    setAiErrorNotice(error);
    throw error;
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
    setAiErrorNotice(error);
    showAiErrorDialog({
      title: "AI初期化エラー",
      error,
      retry: () => initializeWithAi(),
      cancel: () => App(appData),
    });
    return;
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
      summary: `${appData.policy.title}により、短期的には家計負担感と政策納得度が改善した。一方で、財源補填と社会保障持続性への懸念は今後の検討課題として残る。`,
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

  if (usesFixedSampleProvider()) {
    return samplePolicySimulationResult();
  }
  assertAiConnection();

  try {
    return await callProviderJson({
      schemaName: "ai-simulation-result",
      prompt,
    });
  } catch (error) {
    console.warn(error);
    setAiErrorNotice(error);
    throw error;
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
      operationPattern: `${memoryBefore.memorySummary.operationPattern} ${isNationalScenario() ? "政策実行後、短期効果と属性別影響を確認した。" : "施策実行後、キャッシュ制約内での小規模改善を優先した。"}`,
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

  if (usesFixedSampleProvider()) {
    return sampleNextTurnGeneration(turn);
  }
  assertAiConnection();

  try {
    return await withTimeout(
      callProviderJson({
        schemaName: "turn-start-generation",
        prompt,
      }),
      AI_GENERATION_TIMEOUT_MS,
      "次ターン生成のAI応答が15分以内に返りませんでした",
    );
  } catch (error) {
    console.warn(error);
    setAiErrorNotice(error);
    throw error;
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

function designIssuesForPolicy(policyTarget = selectedPolicyTarget()) {
  return policyTarget?.designIssues || [];
}

function effectAxisFromRecommended(views = []) {
  const supported = ["income", "generation", "industry", "regional", "international", "fiscal", "implementation", "digital_access"];
  return views.find((view) => supported.includes(view)) || "income";
}

function metricAxisForMetric(metricId, metric) {
  const axisByMetricId = {
    academic: "income",
    fairness: "generation",
    rule: "fiscal",
    fiscalCapacity: "fiscal",
    socialSecurity: "fiscal",
    economicRipple: "industry",
    importIndustryImpact: "industry",
    exportIndustryImpact: "industry",
    manufacturingImpact: "industry",
    agricultureImpact: "industry",
    financeIndustryImpact: "industry",
    externalReputation: "international",
    externalAchievements: "international",
    teacherSatisfaction: "implementation",
    implementationRisk: "implementation",
    safetyTrust: "implementation",
    digitalUtilization: "digital_access",
    regionalMobility: "regional",
    support: "clusters",
    happiness: "clusters",
    participation: "clusters",
  };
  if (axisByMetricId[metricId]) return axisByMetricId[metricId];
  const categoryAxis = {
    finance: "fiscal",
    economy: "industry",
    industry: "industry",
    international: "international",
    implementation: "implementation",
    digital: "digital_access",
    regional: "regional",
    social: "clusters",
  };
  return categoryAxis[metric?.category] || "clusters";
}

function policyTargetMetricBindings(policyTarget = selectedPolicyTarget()) {
  const metricIds = policyTarget?.relatedMetricIds || [];
  return metricIds.map((metricId) => {
    const metric = appData.metrics?.find((item) => item.id === metricId);
    return {
      metricId,
      metricLabel: metric?.label || metricId,
      axis: metricAxisForMetric(metricId, metric),
      axisLabel: effectAxisTitle(metricAxisForMetric(metricId, metric)),
      description: metric?.description || "",
    };
  });
}

function requiredEffectAxesForPolicy(policyTarget = selectedPolicyTarget()) {
  const axes = new Set((policyTarget?.recommendedViews || []).filter((axis) => axis !== "clusters"));
  policyTargetMetricBindings(policyTarget).forEach((binding) => {
    if (binding.axis !== "clusters") axes.add(binding.axis);
  });
  return [...axes];
}

function inferPolicyDomain(policyTarget) {
  const text = `${policyTarget?.sourceText || policyTarget?.title || ""} ${policyTarget?.sourceText ? "" : policyTarget?.summary || ""}`.toLowerCase();
  const includesAny = (patterns) => patterns.some((pattern) => text.includes(pattern));
  if (includesAny(["防衛", "安全保障", "自衛隊", "軍事", "兵器", "ドローン兵器", "ミサイル", "サイバー防衛", "抑止", "有事", "同盟"])) return "defense_security";
  if (includesAny(["消費税", "減税", "増税", "税率", "所得税", "法人税"])) return "tax_fiscal";
  if (includesAny(["子育て", "こども", "子供", "児童", "保育", "教育費", "給付"])) return "childcare_family";
  if (includesAny(["ai", "人工知能", "行政窓口", "問い合わせ", "自治体dx", "dx", "デジタル"])) return "digital_government";
  if (includesAny(["自動運転", "モビリティ", "交通", "バス", "タクシー", "物流"])) return "mobility_transport";
  return "general_policy";
}

function policyDomainGuidance(domain) {
  const guidance = {
    defense_security: {
      label: "防衛・安全保障",
      relevantAxes: ["international", "industry", "fiscal", "implementation", "clusters"],
      voiceFocus: [
        "抑止力、周辺国・同盟国との関係、防衛産業基盤、調達透明性、財政負担、平和主義・倫理、軍拡懸念、地域安全を主な争点にする",
        "生活費軽減、所得再分配、子育て支援のような家計便益は、政策本文に明記されない限り中心論点にしない",
        "ドローン兵器や自律兵器では、事故責任、AI判断、人間の関与、輸出管理、民生転用、サイバー脆弱性を扱う",
      ],
    },
    tax_fiscal: {
      label: "税制・財政",
      relevantAxes: ["income", "generation", "industry", "fiscal", "clusters"],
      voiceFocus: ["家計負担、所得階層、消費、財源、社会保障、事業者実務を主な争点にする"],
    },
    childcare_family: {
      label: "子育て・家族政策",
      relevantAxes: ["generation", "income", "fiscal", "implementation", "clusters"],
      voiceFocus: ["子どもの人数、所得制限、共働き・ひとり親、自治体事務、世代間公平を主な争点にする"],
    },
    digital_government: {
      label: "行政DX・AI利用",
      relevantAxes: ["implementation", "digital_access", "generation", "fiscal", "clusters"],
      voiceFocus: ["窓口品質、デジタル利用格差、個人情報、説明責任、職員負担、システム障害を主な争点にする"],
    },
    mobility_transport: {
      label: "交通・モビリティ",
      relevantAxes: ["regional", "implementation", "industry", "generation", "digital_access", "clusters"],
      voiceFocus: ["地域交通、事故責任、運転手不足、高齢者移動、物流、規制整備を主な争点にする"],
    },
    general_policy: {
      label: "AI自由推論（未分類）",
      relevantAxes: [],
      voiceFocus: [
        "固定分野のテンプレートに寄せず、政策本文から分野、利害関係者、関連指標、効果軸、制度設計上の争点を推論する",
        "税制、子育て、防衛、行政DX、交通など既知分野の論点を、本文に根拠がないまま流用しない",
      ],
    },
  };
  return guidance[domain] || guidance.general_policy;
}

function requiresAiFreeInference(policyTarget) {
  return Boolean(policyTarget?.id?.startsWith("free_policy_"));
}

function resetPolicyDrivenViews(policyTarget = selectedPolicyTarget()) {
  const axis = requiredEffectAxesForPolicy(policyTarget)[0] || effectAxisFromRecommended(policyTarget?.recommendedViews || []);
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
  const domain = inferPolicyDomain({ title: trimmedText, summary: trimmedText });
  const domainGuidance = policyDomainGuidance(domain);
  if (domain === "defense_security") {
    return {
      id: `free_policy_${Date.now()}`,
      title,
      sourceText: trimmedText,
      fit: scale === "large" ? 70 : scale === "small" ? 64 : 67,
      metrics: ["安全保障・抑止", "国際信頼度", "防衛産業基盤", "財政余力", "実装リスク"],
      summary: `${trimmedText}。自由記述から作成した${scaleLabel}規模の防衛・安全保障政策ターゲットです。抑止力、防衛産業、国際関係、財政負担、倫理・安全管理を中心に仮説分析します。`,
      field: domainGuidance.label,
      relatedMetricIds: ["support", "externalReputation", "externalAchievements", "manufacturingImpact", "economicRipple", "fiscalCapacity", "implementationRisk", "safetyTrust"],
      recommendedViews: ["international", "industry", "fiscal", "implementation", "clusters"],
      fundingNote: "防衛装備・研究開発・調達体制に継続的な予算が必要になりやすいため、財源規模、調達透明性、費用対効果を重点確認します。",
      designIssues: [
        {
          id: "deterrence_ethics",
          title: "抑止力と倫理",
          axisA: "抑止力・技術優位を優先する",
          axisB: "軍拡・自律兵器化の抑制を優先する",
          description: "防衛力強化の必要性と、兵器利用・自律判断・平和主義への懸念が対立しやすい争点です。",
          watchPoints: ["人間の関与", "使用基準", "説明責任"],
        },
        {
          id: "domestic_industry_procurement",
          title: "国内産業育成と調達透明性",
          axisA: "国内防衛産業を育成する",
          axisB: "費用対効果と透明な調達を優先する",
          description: "産業基盤の強化は期待される一方、随意契約、コスト膨張、既得権化への警戒が出やすくなります。",
          watchPoints: ["調達方式", "中小企業参加", "監査"],
        },
        {
          id: "alliance_regional_balance",
          title: "同盟強化と地域緊張",
          axisA: "米国など同盟国との連携を強める",
          axisB: "中国・近隣国との緊張拡大を抑える",
          description: "国際関係では、同盟国からの信頼向上と周辺国の警戒・報復リスクを分けて見る必要があります。",
          watchPoints: ["輸出管理", "外交説明", "危機管理"],
        },
      ],
    };
  }
  return {
    id: `free_policy_${Date.now()}`,
    title,
    sourceText: trimmedText,
    fit: scale === "large" ? 61 : scale === "small" ? 68 : 64,
    metrics: ["関連指標の確認", "効果軸の確認", "利害関係者の確認"],
    summary: `${trimmedText}。${scaleLabel}規模の政策ターゲットとして、分野、関連指標、国民やステークホルダー反応を確認します。`,
    field: domainGuidance.label,
    relatedMetricIds: [],
    recommendedViews: ["clusters"],
    fundingNote: "個別政策のため、生成前に財源規模、対象範囲、実装主体を確認します。",
    designIssues: [
      {
        id: "scope",
        title: "対象範囲と優先順位",
        axisA: "対象を狭く定義して効果を集中する",
        axisB: "対象を広く定義して波及を重視する",
        description: "対象範囲の取り方によって、便益を受ける層、反発する層、必要財源が変わります。",
        watchPoints: ["政策分野", "直接影響を受ける主体", "必要財源"],
      },
      {
        id: "validation",
        title: "分析軸の確認",
        axisA: "経済・財政効果を重視する",
        axisB: "公平性・実装負荷を重視する",
        description: "政策の見方によって、優先して確認すべき指標や効果軸が変わります。",
        watchPoints: ["関連指標", "対象層", "反発しやすい論点"],
      },
    ],
  };
}

function normalizeAiFreePolicyTarget(generation, sourceText, scale = activeFreePolicyScale) {
  const generatedTarget = generation.policyTarget || {};
  const fallback = buildFreePolicyTarget(sourceText, scale);
  const relatedMetricIds = [...new Set((generatedTarget.relatedMetricIds || []).filter((metricId) => nationalMetricIds().includes(metricId)))];
  const supportedViews = ["income", "generation", "industry", "regional", "international", "fiscal", "implementation", "digital_access", "clusters"];
  const recommendedViews = [...new Set((generatedTarget.recommendedViews || []).filter((view) => supportedViews.includes(view)))];
  return sanitizePolicyTargetForSave({
    ...fallback,
    ...generatedTarget,
    id: fallback.id,
    sourceText,
    title: generatedTarget.title || fallback.title,
    fit: Math.max(0, Math.min(100, Math.round(generatedTarget.fit ?? fallback.fit))),
    metrics: generatedTarget.metrics?.length ? generatedTarget.metrics : fallback.metrics,
    relatedMetricIds: relatedMetricIds.length ? relatedMetricIds : fallback.relatedMetricIds,
    recommendedViews: recommendedViews.length ? recommendedViews : fallback.recommendedViews,
    designIssues: generatedTarget.designIssues?.length ? generatedTarget.designIssues : fallback.designIssues,
    fundingNote: generatedTarget.fundingNote || fallback.fundingNote,
  });
}

async function generateFreePolicyTargetWithAi(text, scale = activeFreePolicyScale) {
  if (usesFixedSampleProvider() || !hasAiConnection()) {
    throw new Error("自由記述の政策ターゲット化はAI接続時のみ実行できます。AI設定でCodex App ServerまたはOpenAI接続を有効にしてください。");
  }
  assertAiConnection();
  const prompt = JSON.stringify(
    {
      task: "自由記述された政策本文を、国版政策シミュレーターの政策ターゲットとして構造化してください。この段階では声、クラスター、政策案は作成しません。",
      sourceText: text,
      requestedScale: scale,
      outputHygiene: userFacingOutputRules(),
      requirements: [
        "policyTarget.titleは政策内容が分かる短いタイトルにする",
        "policyTarget.fieldは政策分野名を日本語で書く",
        "policyTarget.metricsは画面に表示する関連指標名を3から6件入れる",
        "policyTarget.relatedMetricIdsはavailableMetricIdsから、政策内容に直接関係するものを3から8件選ぶ",
        "policyTarget.recommendedViewsはrecommendedViewOptionsから、政策効果を見るべき軸を2から5件選ぶ。必ずclustersも含める",
        "policyTarget.designIssuesは制度設計上の争点を2から4件作る。各争点は政策内容に固有の対立軸にする",
        "fundingNoteには財源、実装費、税 expenditure、行政・事業者負担など該当する注意点を書く",
        "本文にない既存政策分野へ無理に寄せない。ただしその説明を出力文へ書かず、政策そのものの分析として表現する",
      ],
      availableMetricIds: nationalMetricIds(),
      metricCatalog: [...appData.metrics, ...appData.financeMetrics].map((metric) => ({
        id: metric.id,
        label: metric.label,
        category: metric.category,
        description: metric.description,
      })),
      recommendedViewOptions: ["income", "generation", "industry", "regional", "international", "fiscal", "implementation", "digital_access", "clusters"],
    },
    null,
    2,
  );
  const generation = await withTimeout(
    callProviderJson({ schemaName: "national-policy-target-structure", prompt }),
    AI_CHAT_TIMEOUT_MS,
    "政策ターゲット構造化のAI応答が5分以内に返りませんでした",
  );
  return {
    policyTarget: normalizeAiFreePolicyTarget(generation, text, scale),
    assistantMessage: generation.assistantMessage || "自由記述を政策ターゲットとして構造化しました。",
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
    text: `自由記述を政策ターゲット化しました。関連指標は ${policyTarget.metrics.join(" / ")}、推奨ビューは ${policyTarget.recommendedViews.map(effectAxisTitle).join(" / ")} です。${policyTarget.fundingNote}`,
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
  appData.segmentEffects = {};
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

function inferPolicyDirection(policyTarget = selectedPolicyTarget()) {
  const text = `${policyTarget?.title || ""} ${policyTarget?.summary || ""}`.toLowerCase();
  const burdenIncreasePatterns = ["増税", "税率引き上げ", "税率を上げ", "負担増", "保険料増", "自己負担増", "給付削減", "減額"];
  const burdenDecreasePatterns = ["減税", "引き下げ", "負担軽減", "給付", "補助", "無償化", "支援"];
  if (burdenIncreasePatterns.some((pattern) => text.includes(pattern))) return "burden_increase";
  if (burdenDecreasePatterns.some((pattern) => text.includes(pattern))) return "burden_decrease";
  return "neutral_reform";
}

function sampleNationalVoices(policyTarget) {
  const title = policyTarget?.title || "この政策";
  if (inferPolicyDomain(policyTarget) === "defense_security") {
    return [
      {
        id: "voice_security_conservative",
        name: "地方都市の50代保守層",
        group: "保守層・安全保障重視・中間所得",
        mood: "条件付き支持",
        text: `${title}は周辺国の軍事的圧力を考えると必要性はある。攻撃目的ではなく抑止と隊員の安全確保が目的だと明確にし、調達費用を透明にしてほしい。`,
        avatar: { slot: "green", label: "保" },
      },
      {
        id: "voice_pacifist_progressive",
        name: "都市部の30代リベラル層",
        group: "リベラル層・平和主義・人権重視",
        mood: "反対",
        text: `${title}は軍拡競争や自律兵器化につながるのではないかと不安が強い。人間の判断を必ず残すのか、民間人被害をどう防ぐのかが見えないと支持できない。`,
        avatar: { slot: "rose", label: "平" },
      },
      {
        id: "voice_defense_industry",
        name: "防衛関連メーカーの技術者",
        group: "製造業・防衛産業・技術職",
        mood: "期待",
        text: `${title}で国内の技術開発や部品サプライチェーンが強くなる可能性はある。ただ、短期発注だけでは人材も設備も育たないので、輸出管理と長期調達計画をセットにしてほしい。`,
        avatar: { slot: "sky", label: "産" },
      },
      {
        id: "voice_fiscal_watchdog",
        name: "財政規律を重視する無党派層",
        group: "無党派・財政規律重視・高所得寄り",
        mood: "強い慎重",
        text: `${title}の必要性は否定しないが、防衛調達は費用が膨らみやすい。社会保障や教育を削ってまで進めるのか、費用対効果と監査の仕組みを先に示すべきだ。`,
        avatar: { slot: "rose", label: "財" },
      },
      {
        id: "voice_base_region",
        name: "基地周辺自治体の40代住民",
        group: "地方・基地周辺・生活安全重視",
        mood: "不安",
        text: `${title}で訓練や実証実験が地元に来るなら、事故、騒音、電波障害、情報漏えいが心配になる。地域説明と補償、安全基準がないまま進むのは困る。`,
        avatar: { slot: "rose", label: "地" },
      },
      {
        id: "voice_young_indifferent_security",
        name: "政治ニュースをあまり追わない20代",
        group: "若年層・低関心・安全保障不安",
        mood: "低関心",
        text: `${title}と言われても普段の生活とのつながりは分かりにくい。ただ、戦争に近づく政策なのか、日本を守る政策なのかは簡単に説明してほしい。`,
        avatar: { slot: "green", label: "若" },
      },
    ];
  }
  if (inferPolicyDirection(policyTarget) === "burden_increase") {
    return [
      {
        id: "voice_low_income_opposition",
        name: "地方都市の30代低所得世帯",
        group: "低所得層・子育て世帯・生活防衛志向",
        mood: "反対",
        text: `${title}は家計に直撃する。財政が厳しいのは分かるが、食品や日用品まで負担が増えるなら今の生活を削るしかない。`,
        avatar: { slot: "rose", label: "低" },
      },
      {
        id: "voice_middle_income_skeptic",
        name: "都市部の40代中間層会社員",
        group: "中間層・無党派・家計負担警戒",
        mood: "強い慎重",
        text: `${title}で社会保障が安定すると言われても、賃上げが追いつかない中では納得しにくい。使途と補償策がないと支持できない。`,
        avatar: { slot: "sky", label: "中" },
      },
      {
        id: "voice_pensioner_anxiety",
        name: "年金生活の70代",
        group: "高齢層・固定収入・医療介護依存",
        mood: "不安",
        text: `年金は大きく増えないのに${title}となると、食費や医療周辺の支出が重くなる。社会保障のためと言われても生活実感は厳しい。`,
        avatar: { slot: "rose", label: "高" },
      },
      {
        id: "voice_fiscal_conservative_support",
        name: "財政規律を重視する保守層",
        group: "保守層・財政規律重視・高所得寄り",
        mood: "条件付き支持",
        text: `${title}は将来世代への先送りを減らす意味では理解できる。ただし低所得層への還付や社会保障目的の明確化がなければ政治的に持たない。`,
        avatar: { slot: "green", label: "財" },
      },
      {
        id: "voice_retail_business_concern",
        name: "小売業の経営者",
        group: "中小企業・小売業・実務層",
        mood: "反対寄り",
        text: `${title}で消費が冷え込むのが怖い。価格転嫁、レジ改修、説明対応も発生し、現場負担と売上減が同時に来る可能性がある。`,
        avatar: { slot: "sky", label: "店" },
      },
      {
        id: "voice_indifferent_resigned",
        name: "政治ニュースをあまり追わない20代",
        group: "若年層・無関心層・低政治関与",
        mood: "諦め",
        text: `${title}と言われても止められない気がする。ただ、毎日の支払いが増えるなら不満はある。何に使われるかは正直よく分からない。`,
        avatar: { slot: "green", label: "無" },
      },
    ];
  }
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
    {
      id: "voice_local_operator",
      name: "地方自治体の実務担当者",
      group: "行政現場・地方・実装負担",
      mood: "条件付き慎重",
      text: `${title}を進めるなら、現場にどんな事務や説明責任が増えるのかを先に知りたい。国の制度設計が曖昧だと、問い合わせ対応だけが自治体に残る。`,
      avatar: { slot: "sky", label: "行" },
    },
  ];
}

function scaleNationalClusterSizes(clusters = [], sampledOpinionCount) {
  const currentTotal = clusters.reduce((sum, cluster) => sum + Number(cluster.size || 0), 0);
  if (!clusters.length || currentTotal >= 800) return clusters;
  let remaining = sampledOpinionCount;
  return clusters.map((cluster, index) => {
    const isLast = index === clusters.length - 1;
    const scaled = isLast ? remaining : Math.max(1, Math.round((Number(cluster.size || 1) / Math.max(currentTotal, 1)) * sampledOpinionCount));
    remaining -= scaled;
    return { ...cluster, size: scaled };
  });
}

function normalizeNationalHierarchySizes(node, clusterSizeById, sampledOpinionCount, isRoot = true) {
  if (!node) return node;
  const children = (node.children || []).map((child) => normalizeNationalHierarchySizes(child, clusterSizeById, sampledOpinionCount, false));
  const childTotal = children.reduce((sum, child) => sum + Number(child.size || 0), 0);
  const ownSize = node.clusterId && clusterSizeById[node.clusterId] ? clusterSizeById[node.clusterId] : isRoot ? sampledOpinionCount : childTotal || Number(node.size || 0);
  return { ...node, size: ownSize, children };
}

function normalizeNationalVoiceAnalysis(analysis, voices = []) {
  if (!analysis || !isNationalScenario()) return analysis;
  const representativeCount = voices.length || 10;
  const sampledOpinionCount = Number(analysis.sampledOpinionCount) >= 800 ? Math.round(Number(analysis.sampledOpinionCount)) : Math.max(1200, representativeCount * 120);
  const populationSize = Number(analysis.populationSize) >= 1000000 ? Math.round(Number(analysis.populationSize)) : 125000000;
  const clusters = scaleNationalClusterSizes(analysis.clusters || [], sampledOpinionCount);
  const clusterSizeById = Object.fromEntries(clusters.map((cluster) => [cluster.id, cluster.size]));
  return {
    ...analysis,
    populationSize,
    sampledOpinionCount,
    clusters,
    hierarchy: normalizeNationalHierarchySizes(analysis.hierarchy, clusterSizeById, sampledOpinionCount),
  };
}

function normalizeNationalGeneratedState() {
  if (isNationalScenario() && appData?.voiceAnalysis) {
    appData.voiceAnalysis = normalizeNationalVoiceAnalysis(appData.voiceAnalysis, appData.voices || []);
  }
}

function sampleNationalVoiceAnalysis(policyTarget, voices) {
  const title = policyTarget?.title || "対象政策";
  if (inferPolicyDomain(policyTarget) === "defense_security") {
    return {
      populationSize: 125000000,
      sampledOpinionCount: 1600,
      embeddingModel: "national-policy-target-mock",
      clusters: [
        {
          id: "deterrence_support",
          label: "抑止力強化への条件付き支持",
          size: 380,
          sentiment: 0.36,
          x: 84,
          y: 74,
          keywords: ["抑止力", "周辺国", "隊員安全", "同盟"],
          summary: "安全保障環境の悪化を前提に、防衛力強化を必要と見るが、目的限定と説明責任を求める層。",
          representativeVoiceIds: ["voice_security_conservative"],
        },
        {
          id: "pacifist_ethics_opposition",
          label: "軍拡・倫理への反対",
          size: 330,
          sentiment: -0.7,
          x: 140,
          y: 188,
          keywords: ["軍拡", "自律兵器", "平和主義", "民間人被害"],
          summary: "防衛ドローンの兵器化や自律判断が、平和主義・人権・国際緊張に反すると警戒する層。",
          representativeVoiceIds: ["voice_pacifist_progressive"],
        },
        {
          id: "industrial_base_expectation",
          label: "防衛産業基盤への期待",
          size: 260,
          sentiment: 0.42,
          x: 278,
          y: 82,
          keywords: ["防衛産業", "技術開発", "サプライチェーン", "人材"],
          summary: "国内製造業や技術基盤の強化を期待する一方、長期調達と輸出管理を条件にする層。",
          representativeVoiceIds: ["voice_defense_industry"],
        },
        {
          id: "fiscal_procurement_warning",
          label: "財政・調達透明性の懸念",
          size: 250,
          sentiment: -0.38,
          x: 306,
          y: 154,
          keywords: ["防衛費", "調達", "監査", "費用対効果"],
          summary: "必要性を一部認めつつ、防衛費の膨張、随意契約、他予算への圧迫を警戒する層。",
          representativeVoiceIds: ["voice_fiscal_watchdog"],
        },
        {
          id: "local_safety_concern",
          label: "地域安全・実証実験への不安",
          size: 210,
          sentiment: -0.46,
          x: 236,
          y: 232,
          keywords: ["基地周辺", "事故", "騒音", "補償"],
          summary: "訓練・実験・配備の現場になる地域で、安全基準、補償、説明を求める層。",
          representativeVoiceIds: ["voice_base_region"],
        },
        {
          id: "low_attention_security",
          label: "低関心・説明待ち",
          size: 170,
          sentiment: -0.08,
          x: 374,
          y: 214,
          keywords: ["分かりにくい", "戦争不安", "生活実感", "説明"],
          summary: "直接の生活影響が見えず関心は低いが、戦争リスクや目的の説明次第で反応が変わる層。",
          representativeVoiceIds: ["voice_young_indifferent_security"],
        },
      ],
      distances: [
        { from: "deterrence_support", to: "industrial_base_expectation", distance: 0.34, label: "防衛力強化と産業育成で近い" },
        { from: "deterrence_support", to: "pacifist_ethics_opposition", distance: 0.82, label: "抑止力と軍拡懸念で対立" },
        { from: "fiscal_procurement_warning", to: "industrial_base_expectation", distance: 0.46, label: "調達透明性で接続" },
        { from: "local_safety_concern", to: "pacifist_ethics_opposition", distance: 0.52, label: "安全・倫理への不安が近い" },
        { from: "low_attention_security", to: "deterrence_support", distance: 0.66, label: "目的説明で接近余地" },
      ],
      hierarchy: {
        label: `${title}への反応`,
        size: 1600,
        children: [
          {
            label: "安全保障・産業を評価",
            size: 640,
            children: [
              { label: "抑止力強化への条件付き支持", clusterId: "deterrence_support", size: 380 },
              { label: "防衛産業基盤への期待", clusterId: "industrial_base_expectation", size: 260 },
            ],
          },
          {
            label: "慎重・反対",
            size: 790,
            children: [
              { label: "軍拡・倫理への反対", clusterId: "pacifist_ethics_opposition", size: 330 },
              { label: "財政・調達透明性の懸念", clusterId: "fiscal_procurement_warning", size: 250 },
              { label: "地域安全・実証実験への不安", clusterId: "local_safety_concern", size: 210 },
            ],
          },
          {
            label: "低関心",
            size: 170,
            children: [
              { label: "低関心・説明待ち", clusterId: "low_attention_security", size: 170 },
            ],
          },
        ],
      },
    };
  }
  if (inferPolicyDirection(policyTarget) === "burden_increase") {
    return {
      populationSize: 125000000,
      sampledOpinionCount: 1200,
      embeddingModel: "national-policy-target-mock",
      clusters: [
        {
          id: "household_opposition",
          label: "家計負担への反対",
          size: 470,
          sentiment: -0.72,
          x: 72,
          y: 136,
          keywords: ["家計負担", "物価", "低所得", "子育て"],
          summary: "生活費の上昇を直接的な不利益として受け止め、補償策がなければ反対する層。",
          representativeVoiceIds: ["voice_low_income_opposition", "voice_middle_income_skeptic"],
        },
        {
          id: "fixed_income_anxiety",
          label: "固定収入層の不安",
          size: 230,
          sentiment: -0.64,
          x: 126,
          y: 198,
          keywords: ["年金", "医療", "介護", "固定収入"],
          summary: "年金や固定収入の中で日常支出が増えることに強い不安を持つ層。",
          representativeVoiceIds: ["voice_pensioner_anxiety"],
        },
        {
          id: "fiscal_conditional_support",
          label: "財政再建への条件付き支持",
          size: 210,
          sentiment: 0.18,
          x: 252,
          y: 94,
          keywords: ["財政規律", "将来世代", "使途明確化", "還付"],
          summary: "財政改善の必要性は認めるが、低所得層対策と使途限定を支持条件にする層。",
          representativeVoiceIds: ["voice_fiscal_conservative_support"],
        },
        {
          id: "business_consumption_concern",
          label: "消費冷え込み・実務負担",
          size: 170,
          sentiment: -0.48,
          x: 322,
          y: 148,
          keywords: ["消費減", "小売", "価格転嫁", "レジ対応"],
          summary: "売上減と制度変更コストを警戒する事業者・実務層。",
          representativeVoiceIds: ["voice_retail_business_concern"],
        },
        {
          id: "resigned_low_attention",
          label: "諦め・低理解",
          size: 120,
          sentiment: -0.28,
          x: 372,
          y: 222,
          keywords: ["分からない", "諦め", "使途不信", "政治不信"],
          summary: "強い賛否表明は少ないが、支払い増への不満と使途への不信を持つ層。",
          representativeVoiceIds: ["voice_indifferent_resigned"],
        },
      ],
      distances: [
        { from: "household_opposition", to: "fixed_income_anxiety", distance: 0.24, label: "生活防衛で近い" },
        { from: "household_opposition", to: "fiscal_conditional_support", distance: 0.72, label: "財政目的への評価が分かれる" },
        { from: "business_consumption_concern", to: "household_opposition", distance: 0.46, label: "消費冷え込みへの懸念が接続" },
        { from: "resigned_low_attention", to: "fixed_income_anxiety", distance: 0.58, label: "不満は近いが理解度が異なる" },
      ],
      hierarchy: {
        label: `${title}への反応`,
        size: 1200,
        children: [
          {
            label: "反対・慎重",
            size: 990,
            children: [
              { label: "家計負担への反対", clusterId: "household_opposition", size: 470 },
              { label: "固定収入層の不安", clusterId: "fixed_income_anxiety", size: 230 },
              { label: "消費冷え込み・実務負担", clusterId: "business_consumption_concern", size: 170 },
              { label: "諦め・低理解", clusterId: "resigned_low_attention", size: 120 },
            ],
          },
          {
            label: "条件付き支持",
            size: 210,
            children: [
              { label: "財政再建への条件付き支持", clusterId: "fiscal_conditional_support", size: 210 },
            ],
          },
        ],
      },
    };
  }
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
  const isDefense = inferPolicyDomain(policyTarget) === "defense_security";
  const isDx = policyTarget?.id === "gov_dx";
  const isChild = policyTarget?.id === "child_support";
  const isAutonomous = policyTarget?.id === "autonomous_driving";
  const isBurdenIncrease = inferPolicyDirection(policyTarget) === "burden_increase";
  if (isDefense) {
    const budget = 32000;
    return {
      id: `initial_${policyTarget?.id || "defense_policy"}`,
      title: `${title}の初期実施案`,
      summary: `${title}を防衛・安全保障政策として検討し、抑止力、防衛産業基盤、調達透明性、倫理・安全管理、国際関係への影響を分けて確認する初期案。`,
      primaryIssueId: policyTarget?.id || appData.issueSelectionChat.selectedIssueId,
      secondaryIssueIds: [],
      budget,
      cashUse: Math.round(budget * 0.58),
      financePlan: "短期は防衛関係費の重点配分と研究開発予算の組替えで始め、恒久化や量産段階では中期防衛力整備計画と歳出見直しで別途精査する。",
      costBreakdown: [
        {
          id: "defense_rd_procurement",
          label: "研究開発・試験調達",
          amount: 18500,
          unit: "億円",
          costType: "研究開発・装備調達",
          target: "防衛装備庁、自衛隊、防衛関連メーカー",
          calculation: "試験機、センサー、通信、管制、評価設備を含む初期調達規模から概算",
          fundingSource: "防衛関係費の重点配分、研究開発予算の組替え",
          details: [
            { label: "試験機・管制システム", amount: 9200, unit: "億円", memo: "実証機、地上管制、通信・暗号化基盤" },
            { label: "AI・センサー研究", amount: 5600, unit: "億円", memo: "識別、航法、サイバー耐性、人間レビュー支援" },
            { label: "評価・試験設備", amount: 3700, unit: "億円", memo: "安全試験、電波試験、ログ検証環境" },
          ],
        },
        {
          id: "governance_safety",
          label: "使用基準・安全管理・監査",
          amount: 5400,
          unit: "億円",
          costType: "制度設計・監査",
          target: "政府、国会、第三者評価機関、配備地域",
          calculation: "運用規程、監査、地域説明、事故対応、ログ保存体制を概算",
          fundingSource: "防衛省関連経費と内閣官房・総務省連携枠",
          details: [
            { label: "使用基準・人間関与ルール", amount: 1200, unit: "億円", memo: "自律判断の制限、停止基準、説明責任" },
            { label: "監査・ログ管理", amount: 1600, unit: "億円", memo: "調達監査、運用ログ、サイバー監査" },
            { label: "地域説明・事故対応", amount: 2600, unit: "億円", memo: "基地周辺説明、補償、緊急停止体制" },
          ],
        },
        {
          id: "industry_supply_chain",
          label: "国内産業・サプライチェーン支援",
          amount: 8100,
          unit: "億円",
          costType: "産業基盤投資",
          target: "製造業、電子部品、通信、ソフトウェア、中小企業",
          calculation: "重要部品の国内調達、技術人材、セキュリティ認証支援を概算",
          fundingSource: "経済安全保障関連予算、防衛産業支援枠",
          details: [
            { label: "重要部品の国内調達", amount: 3900, unit: "億円", memo: "センサー、半導体、通信部品の供給安定化" },
            { label: "中小企業参入支援", amount: 1700, unit: "億円", memo: "認証、品質管理、契約支援" },
            { label: "技術人材育成", amount: 2500, unit: "億円", memo: "AI、航空、サイバー、運用保守人材" },
          ],
        },
      ],
      implementationDetails: [
        "運用目的を抑止・偵察・隊員安全確保に限定し、攻撃判断に人間の関与を必須にする使用基準を先に定める。",
        "調達方式、費用対効果、随意契約の理由、第三者監査結果を公開できる範囲で定期公表する。",
        "米国・EU・アジア諸国への説明、輸出管理、周辺国への危機管理チャネルを外交面の実施内容に含める。",
        "基地周辺や実証地域では安全基準、事故補償、電波・騒音対策、住民説明を配備前条件にする。",
      ],
      expectedEffects: [
        "抑止力と隊員安全への期待、防衛産業の技術基盤強化、製造業・通信・ソフトウェアへの波及が見込まれる。",
        "同盟国からは役割分担の強化として評価されやすい一方、中国など周辺国からは警戒される可能性がある。",
      ],
      concerns: [
        "軍拡競争、自律兵器化、民間人被害への倫理的懸念が強く出やすい。",
        "防衛費の膨張、調達の不透明化、社会保障や教育など他予算への圧迫が批判されやすい。",
        "事故、サイバー乗っ取り、訓練地域の負担が発生すると安全・責任信頼度が下がる。",
      ],
      beneficiaryGroups: [
        { groupId: "security_conservative", label: "安全保障重視層", reason: "抑止力と隊員安全の向上を評価しやすい。" },
        { groupId: "defense_industry", label: "防衛産業・製造業", reason: "研究開発、部品供給、長期調達への期待がある。" },
      ],
      lowBenefitGroups: [
        { groupId: "pacifist_progressive", label: "平和主義・リベラル層", reason: "軍拡や自律兵器化への懸念が強い。" },
        { groupId: "base_region", label: "基地周辺・実証地域", reason: "事故、騒音、電波障害、補償への不安が出やすい。" },
      ],
      shortTermEffects: {
        support: -1,
        externalReputation: 2,
        externalAchievements: 4,
        fiscalCapacity: -6,
        economicRipple: 5,
        manufacturingImpact: 8,
        exportIndustryImpact: 3,
        financeIndustryImpact: 1,
        implementationRisk: -7,
        safetyTrust: -4,
      },
      longTermEffects: {},
      risks: ["軍拡批判", "調達費膨張", "自律兵器倫理", "地域安全不安", "周辺国の警戒"],
    };
  }
  const budget = isDx ? 8200 : isChild ? 26000 : isAutonomous ? 18000 : 42000;
  const directLabel = isDx ? "AI窓口基盤・回答管理システム" : isChild ? "対象世帯への給付拡充" : isAutonomous ? "自動運転実証・遠隔監視基盤" : `${title}の時限実施`;
  const supportLabel = isDx ? "自治体・行政現場の移行支援と人間レビュー" : isChild ? "申請・給付事務" : isAutonomous ? "安全審査・地域説明・事故対応体制" : "低所得層への補完策";
  return {
    id: `initial_${policyTarget?.id || "free_policy"}`,
    title: `${title}の初期実施案`,
    summary: isBurdenIncrease
      ? `${title}を検討する前提で、低所得層還付、使途限定、実施時期、消費冷え込み対策を同時に置く初期案。`
      : `${title}を短期実行する前提で、対象範囲・財源補完・実施負荷を分けて検討する初期案。`,
    primaryIssueId: policyTarget?.id || appData.issueSelectionChat.selectedIssueId,
    secondaryIssueIds: [],
    budget,
    cashUse: Math.round(budget * 0.46),
    financePlan: isBurdenIncrease
      ? "増収分は社会保障目的に限定し、低所得層への還付と小規模事業者の移行費を先に控除して財政改善分を試算する。"
      : "短期は既存予算の組替えと国債・予備費を組み合わせ、恒久化は別途財源を精査する。",
    costBreakdown: [
      {
        id: "core_policy_cost",
        label: directLabel,
        amount: Math.round(budget * 0.62),
        unit: "億円",
        costType: isDx ? "AIシステム投資" : isAutonomous ? "実証・インフラ投資" : "直接支出・税収影響",
        target: isDx ? "国・自治体の行政基盤" : isAutonomous ? "自治体・交通事業者・物流事業者" : "主対象世帯・事業者",
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
    implementationDetails: isDx
      ? [
          "住民向けAI回答は一次案内に限定し、給付・税・福祉など不利益が出る判断は職員確認を必須にする。",
          "誤回答、個人情報、ログ保存、委託先管理、人間レビュー範囲を運用規程として明文化する。",
          "高齢者・障害者・外国人・デジタル非利用層向けに、対面窓口と電話窓口を維持する。",
          "実装リスク、デジタル利用度、行政現場負荷、安全・責任信頼度を毎月レビューする。",
        ]
      : isAutonomous
        ? [
            "地方交通空白地と物流幹線を分け、走行区域、速度、天候条件、遠隔監視体制を段階的に設定する。",
            "事故時の責任分担、保険、ログ提出、運行停止基準を許認可条件に入れる。",
            "運転職の転換支援、自治体説明、住民試乗、苦情処理窓口を実証前に整備する。",
            "地域交通維持、安全・責任信頼度、実装リスク、産業別影響をレビューする。",
          ]
        : [
            `${title}の対象範囲、実施期間、除外条件を最初に明文化する。`,
            "所得別・世代別・産業別の影響を毎月モニタリングする。",
            "低便益または不利益が出やすい層には補完策と説明導線を用意する。",
          ],
    expectedEffects: isBurdenIncrease
      ? [
          "財政余力と社会保障財源の安定にはプラスに働く。",
          "低所得層還付と使途限定を組み合わせない限り、家計負担感と政策支持は悪化しやすい。",
        ]
      : [
          isDx ? "問い合わせ一次対応と職員検索支援により、窓口待ち時間と職員の調査負担を下げる。" : isAutonomous ? "地方交通維持と物流人手不足の緩和に短期効果を出す。" : "短期的な政策納得度と生活・事務負担の改善を狙う。",
          isDx ? "デジタル利用度が高い層では利便性が上がるが、非利用層には対面代替が必要。" : isAutonomous ? "製造・通信・保険など周辺産業にはプラスだが、運転職と安全規制の調整が必要。" : "産業別・所得別の効果差を見える化し、修正余地を残す。",
        ],
    concerns: isBurdenIncrease
      ? [
          "低所得層・子育て世帯・年金生活者の可処分所得が下がりやすい。",
          "小売・外食など内需産業では消費冷え込みと価格表示対応が同時に発生する。",
        ]
      : [
          isDx ? "誤回答や個人情報事故が起きると、安全・責任信頼度と政策納得度が大きく下がる。" : isAutonomous ? "事故時の責任分担が曖昧だと、地域交通の便益より安全不安が上回る。" : "財源補填が弱いと財政余力への懸念が強まる。",
          isDx ? "デジタル利用度の低い層には、利便性改善より排除感が出る可能性がある。" : isAutonomous ? "遠隔監視や道路・通信インフラの整備が遅れると、実装リスクが高止まりする。" : "対象範囲が曖昧だと無関心層や実務層に伝わりにくい。",
        ],
    beneficiaryGroups: isBurdenIncrease
      ? [
          { groupId: "fiscal_conservative", label: "財政規律重視層", reason: "社会保障目的と将来世代負担の抑制を条件に評価しやすい。" },
          { groupId: "high_income", label: "高所得層の一部", reason: "相対的な家計負担の痛みが小さく、財政安定を重視する層では受け入れ余地がある。" },
        ]
      : [
          { groupId: isDx ? "digital_users" : isAutonomous ? "regional_residents" : "middle_income", label: isDx ? "デジタル利用層・現役世代" : isAutonomous ? "地方部の移動困難層" : "中間層", reason: isDx ? "オンライン問い合わせや申請案内の時短を実感しやすい。" : isAutonomous ? "通院・買い物・通学などの移動手段維持に便益が出やすい。" : "生活・手続き負担の改善を比較的広く実感しやすい。" },
          { groupId: isDx ? "public_workers" : isAutonomous ? "mobility_industry" : "progressive", label: isDx ? "行政職員・自治体現場" : isAutonomous ? "交通・物流・製造関連産業" : "リベラル層", reason: isDx ? "回答候補の検索、FAQ整理、繁忙期対応の負担軽減が期待できる。" : isAutonomous ? "実証、車両、センサー、保険、運行管理で新たな需要が出る。" : "再分配や制度改善の方向性を評価しやすい。" },
        ],
    lowBenefitGroups: isBurdenIncrease
      ? [
          { groupId: "low_income", label: "低所得層", reason: "消費支出が所得に占める割合が高く、負担増を強く受ける。" },
          { groupId: "retail", label: "小売・外食事業者", reason: "消費冷え込み、価格転嫁、レジ改修などの負担が重なる。" },
        ]
      : [
          { groupId: isDx ? "digital_low_access" : isAutonomous ? "drivers" : "fiscal_conservative", label: isDx ? "デジタル利用が難しい層" : isAutonomous ? "運転職・既存交通事業者" : "財政規律重視層", reason: isDx ? "AI窓口への移行が対面支援の縮小に見えると不利益感が出る。" : isAutonomous ? "雇用転換、責任分担、既存路線との競合に不安が出やすい。" : "財源補填と恒久化リスクへの懸念が残る。" },
          { groupId: isDx ? "privacy_concern" : isAutonomous ? "safety_concern" : "indifferent", label: isDx ? "個人情報・監視懸念層" : isAutonomous ? "安全性を重視する住民" : "無関心層", reason: isDx ? "相談履歴や行政データのAI利用に不安を持ちやすい。" : isAutonomous ? "事故時の責任と補償が曖昧だと受容しにくい。" : "生活上の変化が分かりにくいと関心を持ちにくい。" },
        ],
    shortTermEffects: isBurdenIncrease
      ? {
          support: -8,
          happiness: -5,
          fairness: -4,
          economicRipple: -6,
          fiscalCapacity: 7,
          socialSecurity: 5,
          importIndustryImpact: -3,
          exportIndustryImpact: 0,
          manufacturingImpact: -2,
          agricultureImpact: -2,
          financeIndustryImpact: 2,
          teacherSatisfaction: -2,
        }
      : {
          support: 5,
          economicRipple: isDx ? 4 : 6,
          fiscalCapacity: -4,
          teacherSatisfaction: isDx ? 6 : isAutonomous ? -2 : -1,
          digitalUtilization: isDx ? 9 : isAutonomous ? 3 : 1,
          implementationRisk: isDx ? -5 : isAutonomous ? -7 : -2,
          safetyTrust: isDx ? -3 : isAutonomous ? -5 : 0,
          regionalMobility: isAutonomous ? 8 : 0,
          importIndustryImpact: 2,
          exportIndustryImpact: 1,
          manufacturingImpact: isDx ? 4 : isAutonomous ? 6 : 2,
          agricultureImpact: isChild ? 3 : 1,
          financeIndustryImpact: isDx ? 5 : isAutonomous ? 4 : -1,
        },
    longTermEffects: { trust: 2, polarization: -1, fatigue: 1, publicValue: 3 },
    risks: ["財源補填不足", "対象範囲の説明不足", "実施現場の負荷増"],
  };
}

function sampleNationalSegmentEffects(policyTarget = selectedPolicyTarget()) {
  if (inferPolicyDomain(policyTarget) === "defense_security") {
    return {
      international: [
        { segmentId: "us_alliance", segmentLabel: "アメリカ・同盟国", axis: "international", applicability: "applicable", effectScore: 5, benefitLevel: "medium", riskLevel: "medium", summary: "役割分担の強化として評価されやすいが、運用基準と輸出管理の透明性が問われる。", reason: "防衛装備と共同運用は同盟信頼に直結するため" },
        { segmentId: "china_region", segmentLabel: "中国・周辺国", axis: "international", applicability: "applicable", effectScore: -6, benefitLevel: "none", riskLevel: "high", summary: "軍拡や監視強化と受け止められ、外交的な警戒や対抗措置を招く可能性がある。", reason: "ドローン兵器は地域の軍事バランスに影響しやすいため" },
        { segmentId: "eu_rules", segmentLabel: "EU・国際規範", axis: "international", applicability: "applicable", effectScore: -1, benefitLevel: "low", riskLevel: "medium", summary: "人間の関与、AI倫理、輸出管理を明確にすれば批判を抑えやすい。", reason: "自律兵器やAI利用への規範形成が進んでいるため" },
      ],
      industry: [
        { segmentId: "defense_manufacturing", segmentLabel: "防衛・製造業", axis: "industry", applicability: "applicable", effectScore: 8, benefitLevel: "high", riskLevel: "medium", summary: "センサー、通信、航空、ソフトウェアに需要が出る。", reason: "国内防衛産業基盤とサプライチェーンに直接投資されるため" },
        { segmentId: "dual_use_it", segmentLabel: "IT・通信・サイバー", axis: "industry", applicability: "applicable", effectScore: 6, benefitLevel: "medium", riskLevel: "medium", summary: "管制、暗号化、AI、ログ監査の需要が増える一方、サイバー責任が重くなる。", reason: "遠隔運用とAI支援に通信・サイバー基盤が不可欠なため" },
        { segmentId: "civilian_industry", segmentLabel: "民生産業", axis: "industry", applicability: "applicable", effectScore: -2, benefitLevel: "low", riskLevel: "medium", summary: "軍事転用イメージや輸出管理で取引先から慎重に見られる可能性がある。", reason: "防衛用途と民生用途の境界が問われるため" },
      ],
      fiscal: [
        { segmentId: "defense_budget", segmentLabel: "防衛費・財政余力", axis: "fiscal", applicability: "applicable", effectScore: -7, benefitLevel: "none", riskLevel: "high", summary: "研究開発と調達が継続費になりやすく、財政余力を圧迫する。", reason: "装備開発は初期費だけでなく維持・更新費も大きいため" },
        { segmentId: "procurement_audit", segmentLabel: "調達監査", axis: "fiscal", applicability: "applicable", effectScore: -3, benefitLevel: "low", riskLevel: "high", summary: "監査を強めないと費用膨張や既得権化への批判が出やすい。", reason: "防衛調達は競争性と透明性が争点になりやすいため" },
      ],
      implementation: [
        { segmentId: "human_control", segmentLabel: "人間の関与・使用基準", axis: "implementation", applicability: "applicable", effectScore: -6, benefitLevel: "none", riskLevel: "high", summary: "攻撃判断や停止基準が曖昧だと倫理批判と安全不安が強まる。", reason: "ドローン兵器では自律判断の範囲が政策受容を左右するため" },
        { segmentId: "local_safety", segmentLabel: "配備・実証地域の安全", axis: "implementation", applicability: "applicable", effectScore: -5, benefitLevel: "none", riskLevel: "high", summary: "事故、騒音、電波障害、補償の設計が不十分だと地域反発が出る。", reason: "実験・訓練の負担は特定地域に集中しやすいため" },
        { segmentId: "cyber_resilience", segmentLabel: "サイバー耐性", axis: "implementation", applicability: "applicable", effectScore: -4, benefitLevel: "low", riskLevel: "high", summary: "乗っ取りや通信妨害への対策が弱いと安全・責任信頼度が下がる。", reason: "遠隔運用装備はサイバー攻撃の影響を受けやすいため" },
      ],
      clusters: [
        { segmentId: "security_support", segmentLabel: "安全保障重視層", axis: "clusters", applicability: "applicable", effectScore: 6, benefitLevel: "medium", riskLevel: "medium", summary: "抑止力強化として評価しやすい。", reason: "周辺国リスクを重視するため" },
        { segmentId: "pacifist_opposition", segmentLabel: "平和主義・反軍拡層", axis: "clusters", applicability: "applicable", effectScore: -8, benefitLevel: "none", riskLevel: "high", summary: "軍拡、自律兵器、民間人被害への懸念から反対しやすい。", reason: "政策価値観と衝突しやすいため" },
      ],
    };
  }
  if (policyTarget?.id === "gov_dx") {
    return {
      implementation: [
        { segmentId: "admin_frontline", segmentLabel: "行政窓口職員", axis: "implementation", applicability: "applicable", effectScore: 7, benefitLevel: "high", riskLevel: "medium", summary: "FAQ検索と回答案作成は負担軽減になるが、最終確認と苦情対応は残る。", reason: "AIを一次回答支援に限定すれば現場負荷を下げやすいため" },
        { segmentId: "error_responsibility", segmentLabel: "誤回答・責任設計", axis: "implementation", applicability: "applicable", effectScore: -6, benefitLevel: "none", riskLevel: "high", summary: "誤回答時の責任分界が曖昧だと、政策納得度と安全・責任信頼度が下がる。", reason: "行政判断は不利益処分や給付漏れにつながり得るため" },
        { segmentId: "vendor_ops", segmentLabel: "委託・システム運用", axis: "implementation", applicability: "applicable", effectScore: -3, benefitLevel: "low", riskLevel: "medium", summary: "ログ管理、モデル更新、自治体差分対応に継続コストが発生する。", reason: "AI導入後も運用・監査・契約管理が必要なため" },
      ],
      digital_access: [
        { segmentId: "digital_users", segmentLabel: "デジタル利用層", axis: "digital_access", applicability: "applicable", effectScore: 10, benefitLevel: "high", riskLevel: "low", summary: "夜間・休日の問い合わせや申請案内を使いやすくなる。", reason: "オンライン導線とAI応答の相性が高いため" },
        { segmentId: "elderly_low_access", segmentLabel: "高齢者・低デジタル利用層", axis: "digital_access", applicability: "applicable", effectScore: -5, benefitLevel: "none", riskLevel: "high", summary: "対面窓口縮小と受け止められると排除感が出る。", reason: "スマホ・認証・文章入力への負担が大きいため" },
        { segmentId: "multilingual_disabled", segmentLabel: "外国人・障害者対応", axis: "digital_access", applicability: "applicable", effectScore: 4, benefitLevel: "medium", riskLevel: "medium", summary: "多言語・音声対応が整えば便益は大きいが、品質差が不信につながる。", reason: "支援設計の精度で効果が大きく変わるため" },
      ],
      generation: [
        { segmentId: "age_18_29", segmentLabel: "18から29歳", axis: "generation", applicability: "applicable", effectScore: 6, benefitLevel: "medium", riskLevel: "low", summary: "オンライン完結への期待が高く、利便性を評価しやすい。", reason: "デジタル接点が多いため" },
        { segmentId: "age_65_plus", segmentLabel: "65歳以上", axis: "generation", applicability: "applicable", effectScore: -4, benefitLevel: "low", riskLevel: "high", summary: "電話・対面窓口が残るかで評価が分かれる。", reason: "デジタル利用の負担が大きいため" },
      ],
      industry: [
        { segmentId: "industry_finance", segmentLabel: "金融", axis: "industry", applicability: "applicable", effectScore: 4, benefitLevel: "medium", riskLevel: "medium", summary: "本人確認・行政手続き連携の効率化に期待がある。", reason: "行政データ連携の影響を受けやすいため" },
        { segmentId: "industry_it", segmentLabel: "IT・BPO", axis: "industry", applicability: "applicable", effectScore: 8, benefitLevel: "high", riskLevel: "medium", summary: "AI基盤、運用監査、FAQ整備、コールセンター再設計の需要が出る。", reason: "導入・運用の外部委託が見込まれるため" },
      ],
      fiscal: [
        { segmentId: "initial_cost", segmentLabel: "初期投資", axis: "fiscal", applicability: "applicable", effectScore: -4, benefitLevel: "low", riskLevel: "medium", summary: "短期はシステム・研修・監査費が先行する。", reason: "AI基盤と自治体展開に初期費用が必要なため" },
        { segmentId: "operational_saving", segmentLabel: "運用効率化", axis: "fiscal", applicability: "applicable", effectScore: 5, benefitLevel: "medium", riskLevel: "medium", summary: "定型問い合わせが減れば中期的な業務効率化余地がある。", reason: "問い合わせ一次対応を自動化できるため" },
      ],
    };
  }
  if (policyTarget?.id === "autonomous_driving") {
    return {
      regional: [
        { segmentId: "rural_mobility", segmentLabel: "地方交通空白地", axis: "regional", applicability: "applicable", effectScore: 10, benefitLevel: "high", riskLevel: "medium", summary: "通院・買い物・通学の移動手段維持に直接効果が出やすい。", reason: "運転手不足と路線維持困難が集中するため" },
        { segmentId: "urban_area", segmentLabel: "都市部", axis: "regional", applicability: "applicable", effectScore: 2, benefitLevel: "low", riskLevel: "medium", summary: "混雑・歩行者・既存交通との調整が多く、短期便益は限定的。", reason: "運行環境が複雑なため" },
      ],
      implementation: [
        { segmentId: "safety_rule", segmentLabel: "安全規制・許認可", axis: "implementation", applicability: "applicable", effectScore: -7, benefitLevel: "none", riskLevel: "high", summary: "事故責任、停止基準、遠隔監視ログの設計が不十分だと導入が止まりやすい。", reason: "安全・責任信頼度が政策受容を左右するため" },
        { segmentId: "remote_monitoring", segmentLabel: "遠隔監視体制", axis: "implementation", applicability: "applicable", effectScore: -4, benefitLevel: "low", riskLevel: "medium", summary: "監視人員、通信、緊急介入手順の整備に実装コストがかかる。", reason: "完全無人化までの運用負荷が残るため" },
      ],
      industry: [
        { segmentId: "industry_manufacturing", segmentLabel: "製造業", axis: "industry", applicability: "applicable", effectScore: 7, benefitLevel: "high", riskLevel: "medium", summary: "車両、センサー、通信機器、運行管理システムで需要が増える。", reason: "自動運転関連投資が広がるため" },
        { segmentId: "drivers", segmentLabel: "運転職・既存交通事業者", axis: "industry", applicability: "applicable", effectScore: -5, benefitLevel: "none", riskLevel: "high", summary: "雇用転換や既存路線との競合に不安が出やすい。", reason: "業務内容の再設計が必要になるため" },
        { segmentId: "industry_finance", segmentLabel: "金融・保険", axis: "industry", applicability: "applicable", effectScore: 4, benefitLevel: "medium", riskLevel: "medium", summary: "保険商品、事故データ、責任分担の新市場が生まれる。", reason: "リスク評価の枠組みが変わるため" },
      ],
      generation: [
        { segmentId: "age_65_plus", segmentLabel: "65歳以上", axis: "generation", applicability: "applicable", effectScore: 8, benefitLevel: "high", riskLevel: "medium", summary: "免許返納後の移動手段として期待が出やすい。", reason: "地方高齢者の移動課題に直結するため" },
        { segmentId: "age_30_49", segmentLabel: "30から49歳", axis: "generation", applicability: "applicable", effectScore: 3, benefitLevel: "low", riskLevel: "medium", summary: "子どもの送迎や物流改善には期待するが、安全不安も見る。", reason: "利用者と保護者の両面で評価するため" },
      ],
      international: [
        { segmentId: "international_competitiveness", segmentLabel: "国際競争力", axis: "international", applicability: "applicable", effectScore: 5, benefitLevel: "medium", riskLevel: "medium", summary: "制度整備が進めば技術実証と輸出競争力に寄与する。", reason: "標準化・実証データが国際展開に影響するため" },
        { segmentId: "safety_reputation", segmentLabel: "安全規制への信頼", axis: "international", applicability: "applicable", effectScore: -2, benefitLevel: "low", riskLevel: "medium", summary: "事故や規制の曖昧さがあると国際的な信頼を下げる。", reason: "安全認証と事故対応が注視されるため" },
      ],
      digital_access: [
        { segmentId: "mobility_app_users", segmentLabel: "配車アプリ利用層", axis: "digital_access", applicability: "applicable", effectScore: 5, benefitLevel: "medium", riskLevel: "low", summary: "予約・運行状況確認が整えば利用しやすい。", reason: "サービス利用にデジタル接点が必要なため" },
        { segmentId: "non_digital_users", segmentLabel: "非デジタル利用層", axis: "digital_access", applicability: "applicable", effectScore: -3, benefitLevel: "none", riskLevel: "medium", summary: "電話予約や地域窓口がないと利用しにくい。", reason: "予約・本人確認がデジタル前提になりやすいため" },
      ],
    };
  }
  if (inferPolicyDirection(policyTarget) === "burden_increase") {
    return {
      income: [
        { segmentId: "income_low", segmentLabel: "低所得層", axis: "income", applicability: "applicable", effectScore: -12, benefitLevel: "none", riskLevel: "high", summary: "消費支出の比率が高く、生活必需品への負担増を最も受けやすい。", reason: "所得に占める消費支出割合が高いため" },
        { segmentId: "income_middle", segmentLabel: "中間層", axis: "income", applicability: "applicable", effectScore: -8, benefitLevel: "none", riskLevel: "high", summary: "家計負担増と賃上げ遅れへの不満が出やすい。", reason: "広い消費支出に税率上昇がかかるため" },
        { segmentId: "income_high", segmentLabel: "高所得層", axis: "income", applicability: "applicable", effectScore: -3, benefitLevel: "low", riskLevel: "medium", summary: "負担額は増えるが、可処分所得への相対的影響は小さい。", reason: "所得に対する消費税負担比率が低めなため" },
      ],
      generation: [
        { segmentId: "age_18_29", segmentLabel: "18から29歳", axis: "generation", applicability: "applicable", effectScore: -5, benefitLevel: "none", riskLevel: "medium", summary: "日常消費への負担増に不満はあるが、社会保障目的の理解は分かれる。", reason: "所得水準がまだ低い層が多いため" },
        { segmentId: "age_30_49", segmentLabel: "30から49歳", axis: "generation", applicability: "applicable", effectScore: -10, benefitLevel: "none", riskLevel: "high", summary: "子育て・住宅・日用品支出が重なり、負担感が強く出る。", reason: "家族消費の規模が大きいため" },
        { segmentId: "age_50_64", segmentLabel: "50から64歳", axis: "generation", applicability: "applicable", effectScore: -7, benefitLevel: "none", riskLevel: "medium", summary: "将来の社会保障安定は評価しつつ、現役負担増への警戒が残る。", reason: "負担増と将来不安が同時に作用するため" },
        { segmentId: "age_65_plus", segmentLabel: "65歳以上", axis: "generation", applicability: "applicable", effectScore: -9, benefitLevel: "none", riskLevel: "high", summary: "固定収入の中で食費・医療周辺支出の負担増が重い。", reason: "年金収入が物価に追いつきにくいため" },
      ],
      industry: [
        { segmentId: "industry_import", segmentLabel: "輸入業", axis: "industry", applicability: "applicable", effectScore: -4, benefitLevel: "none", riskLevel: "medium", summary: "消費財需要の落ち込みで販売数量が下がる可能性がある。", reason: "最終消費の冷え込みを受けやすいため" },
        { segmentId: "industry_export", segmentLabel: "輸出業", axis: "industry", applicability: "low_relevance", effectScore: null, benefitLevel: "none", riskLevel: "low", summary: "直接影響は限定的だが、国内景況感の悪化は間接的に響く。", reason: "主な売上要因が外需と為替であるため" },
        { segmentId: "industry_manufacturing", segmentLabel: "製造業", axis: "industry", applicability: "applicable", effectScore: -3, benefitLevel: "none", riskLevel: "medium", summary: "耐久消費財や生活関連製品で買い控えが起きやすい。", reason: "増税前後で需要の反動が出るため" },
        { segmentId: "industry_agriculture", segmentLabel: "農業", axis: "industry", applicability: "applicable", effectScore: -2, benefitLevel: "none", riskLevel: "medium", summary: "食品需要は底堅いが、消費者の節約志向が強まる。", reason: "生活必需品でも価格感度が上がるため" },
        { segmentId: "industry_finance", segmentLabel: "金融", axis: "industry", applicability: "applicable", effectScore: 2, benefitLevel: "low", riskLevel: "medium", summary: "財政安定期待は一部プラスだが、消費悪化で景気見通しは弱くなる。", reason: "財政評価と景気評価が逆方向に働くため" },
      ],
      fiscal: [
        { segmentId: "fiscal_capacity", segmentLabel: "財政余力", axis: "fiscal", applicability: "applicable", effectScore: 8, benefitLevel: "high", riskLevel: "medium", summary: "増収により財政余力は改善するが、景気悪化時は税収見込みが下振れする。", reason: "税率上昇による増収効果があるため" },
        { segmentId: "social_security", segmentLabel: "社会保障財源", axis: "fiscal", applicability: "applicable", effectScore: 6, benefitLevel: "medium", riskLevel: "medium", summary: "使途限定なら社会保障財源の安定に寄与する。", reason: "消費税収を社会保障へ充てる設計が可能なため" },
      ],
      implementation: [
        { segmentId: "implementation_admin", segmentLabel: "行政・事業者対応", axis: "implementation", applicability: "applicable", effectScore: -6, benefitLevel: "none", riskLevel: "high", summary: "価格表示、レジ改修、相談対応、還付事務が同時に発生する。", reason: "税率変更と補償策の運用負荷が重なるため" },
      ],
      regional: [
        { segmentId: "regional_local", segmentLabel: "地方部", axis: "regional", applicability: "applicable", effectScore: -6, benefitLevel: "none", riskLevel: "medium", summary: "車移動・生活必需品支出の比率が高く、負担増を感じやすい。", reason: "可処分所得と消費構造の影響を受けるため" },
        { segmentId: "regional_urban", segmentLabel: "都市部", axis: "regional", applicability: "applicable", effectScore: -5, benefitLevel: "none", riskLevel: "medium", summary: "家賃以外の日常消費で負担増が広く出る。", reason: "サービス消費への支出が多いため" },
      ],
    };
  }
  return {
    income: [
      { segmentId: "income_low", segmentLabel: "低所得層", axis: "income", applicability: "applicable", effectScore: 8, benefitLevel: "medium", riskLevel: "medium", summary: "補完策が届く場合は短期便益が出る。", reason: "生活支出への影響が大きいため" },
      { segmentId: "income_middle", segmentLabel: "中間層", axis: "income", applicability: "applicable", effectScore: 5, benefitLevel: "medium", riskLevel: "medium", summary: "制度内容が明確なら一定の便益を感じやすい。", reason: "政策対象が広い場合に影響を受けやすいため" },
      { segmentId: "income_high", segmentLabel: "高所得層", axis: "income", applicability: "applicable", effectScore: 1, benefitLevel: "low", riskLevel: "low", summary: "直接的な生活改善効果は限定的。", reason: "所得に対する政策効果の比率が小さいため" },
    ],
  };
}

function nationalMetricIds() {
  return [
    "support",
    "happiness",
    "academic",
    "fairness",
    "rule",
    "participation",
    "externalReputation",
    "externalAchievements",
    "teacherSatisfaction",
    "fiscalCapacity",
    "socialSecurity",
    "economicRipple",
    "digitalUtilization",
    "implementationRisk",
    "regionalMobility",
    "safetyTrust",
    "importIndustryImpact",
    "exportIndustryImpact",
    "manufacturingImpact",
    "agricultureImpact",
    "financeIndustryImpact",
  ];
}

function nationalGenerationContext(policyTarget) {
  const policyDomain = inferPolicyDomain(policyTarget);
  return {
    scenario: appData.scenario,
    policyTarget,
    policyDirection: inferPolicyDirection(policyTarget),
    policyDomain,
    policyDomainGuidance: policyDomainGuidance(policyDomain),
    metricAxisBindings: policyTargetMetricBindings(policyTarget),
    requiredEffectAxes: requiredEffectAxesForPolicy(policyTarget),
    baseMetrics: appData.metrics,
    financeMetrics: appData.financeMetrics,
    populationSegments: appData.populationSegments,
    internationalRelations: appData.internationalRelations,
    availableMetricIds: nationalMetricIds(),
  };
}

function ensureNationalSegmentEffects(policyTarget, segmentEffects) {
  if (segmentEffects && Object.keys(segmentEffects).length) return segmentEffects;
  if (requiresAiFreeInference(policyTarget)) return {};
  return sampleNationalSegmentEffects(policyTarget);
}

function nationalVoiceRules() {
  return [
    "日本を想定し、国民属性は人口構成に近い広がりを持たせる",
    "政策文面を読んで、政策分野と政策方向を最初に判定する。context.policyDomainとcontext.policyDomainGuidanceを最優先で参照する",
    "context.policyDomainがgeneral_policyの場合は未分類の自由記述として扱い、固定の税制・子育て・防衛・行政DX・交通テンプレートに落とさず、政策本文から分野・関連指標・効果軸・利害関係者を自由に推論する",
    "政策分野に合わないテンプレートを使わない。生活費軽減、所得再分配、子育て支援、行政手続き負担などは、政策本文から直接関係が読める場合だけ中心論点にする",
    "増税、社会保険料増、自己負担増、給付削減など生活者に見える負担増は、補償策が明記されない限り国民反応を否定・慎重に寄せる",
    "負担増政策では、低所得層・中間層・子育て世帯・年金生活者などの短期効果を安易にプラスにしない",
    "消費税増税など広く家計にかかる負担増で補償策がない場合、賛成・条件付き支持の合計は全体の35%以下、反対・慎重・不安の合計は55%以上を目安にする",
    "財政改善や社会保障持続性へのプラスと、家計負担・消費・支持率へのマイナスを分けて評価する",
    "防衛・安全保障政策では、抑止力、防衛産業、同盟・周辺国、財政負担、調達透明性、平和主義、倫理、安全管理、地域負担を扱う。格差対策や生活改善期待を主クラスターにしない",
    "voicesは6件以上。世代、所得、地域、産業、政治思想、宗教・支持団体などを組み合わせたペルソナにする",
    "政治思想は保守、リベラル、極右的保守、宗教層、急進左派、無関心層を単独カテゴリではなく属性の組み合わせとして扱う",
    "各voiceのtextは、政策名を置換しただけの汎用文にせず、その政策で本人に何が起きるかを具体的に書く",
    "政策が負担増の場合、生活改善期待という肯定クラスターを作らない。支持する場合も財政規律・将来世代・使途限定・還付条件などの条件付き支持にする",
  ];
}

function userFacingOutputRules() {
  return [
    "画面に表示される文章には、内部処理やプロンプトの都合を説明するメタ文を入れない",
    "policyTarget、context、designIssues、JSON Schema、プロンプト、テンプレート、既存プリセット、AI生成、AIが推論、自己レビューなどの内部語を出力本文に含めない",
    "自由記述政策であっても、実施内容・効果・懸念には政策そのものの説明だけを書く",
    "内部の分析方針をそのまま写さず、政策対象、実施主体、対象者、財源、制度条件、影響として読める文章に言い換える",
  ];
}

async function generateNationalVoicesWithAi(policyTarget) {
  const prompt = JSON.stringify(
    {
      task: "国版政策シミュレーターの第一段階として、政策ターゲットに対する国民・ステークホルダーの代表的な声だけを生成してください。",
      context: nationalGenerationContext(policyTarget),
      requirements: nationalVoiceRules(),
      outputHygiene: userFacingOutputRules(),
      outputNotes: [
        "この段階ではvoiceAnalysisやpolicyDraftは作らない",
        "policyTarget.designIssuesがある場合は、各争点の対立軸に対する賛否・条件・懸念が分かれるように声を作る",
        "moodには反対、強い慎重、不安、条件付き支持、中立、低関心など態度が分かる語を使う",
        "後続のクラスター分析ができるよう、賛否・利害・関心度が分散した声にする",
      ],
    },
    null,
    2,
  );

  return await withTimeout(
    callProviderJson({ schemaName: "national-voices", prompt }),
    AI_GENERATION_TIMEOUT_MS,
    "声生成のAI応答が15分以内に返りませんでした",
  );
}

async function generateNationalVoiceAnalysisWithAi(policyTarget, voices) {
  const prompt = JSON.stringify(
    {
      task: "国版政策シミュレーターの第二段階として、入力された声だけを根拠にクラスター分析を作成してください。",
      context: nationalGenerationContext(policyTarget),
      voices,
      requirements: [
        ...userFacingOutputRules(),
        "新しい声を捏造せず、representativeVoiceIdsは入力voicesのidだけを参照する",
        "voiceAnalysis.clustersは4から6件",
        "populationSizeは代表発話数ではなく、政策影響を受ける推定母集団とする。国全体に関わる政策では125000000程度を使う",
        "sampledOpinionCountは代表発話数ではなく、背後にある推定アンケート母数とする。800から3000程度を使い、入力voices.lengthをそのまま入れない",
        "clustersのsize合計はsampledOpinionCountと整合させる",
        "負担増政策では、反対・慎重・不安クラスターが過半になるように、入力された声の態度を反映する",
        "policyTarget.designIssuesがある場合は、争点ごとに近いクラスター・遠いクラスターが見えるようにsummaryとdistancesへ反映する",
        "賛成・条件付き支持クラスターを過大評価しない。財政再建支持は条件付き支持として扱う",
        "distancesは主要クラスター間の近さを3件以上返す",
        "hierarchyは画面の階層表示に使えるよう、上位カテゴリと子クラスターを含める",
      ],
    },
    null,
    2,
  );

  return await withTimeout(
    callProviderJson({ schemaName: "national-voice-analysis", prompt }),
    AI_GENERATION_TIMEOUT_MS,
    "クラスター分析のAI応答が15分以内に返りませんでした",
  );
}

async function generateNationalInitialPolicyWithAi(policyTarget, voices, voiceAnalysis) {
  const prompt = JSON.stringify(
    {
      task: "国版政策シミュレーターの第三段階として、声とクラスター分析を入力データにして初期政策案を作成してください。",
      context: nationalGenerationContext(policyTarget),
      voices,
      voiceAnalysis,
      requirements: [
        ...userFacingOutputRules(),
        "policyDraft.primaryIssueIdはpolicyTarget.idにする",
        "policyDraftは短期実行を前提にする",
        "負担増政策では、支持を広げるための補償策・時限措置・使途限定・低所得層還付などを実施内容に必ず含める",
        "policyTarget.designIssuesがある場合は、各争点の対立軸から1つ以上の方針を選び、implementationDetails、concerns、costBreakdownのいずれかに明記する",
        "costBreakdownは3件以上。何に対して、どう計算し、どの財源で賄うかをdetailsまで分解する",
        "shortTermEffectsはavailableMetricIdsから該当する指標だけをキーにし、-12から+12程度の変化量にする",
        "segmentEffectsには、context.requiredEffectAxesに含まれる効果軸を必ず返す",
        "context.metricAxisBindingsは、policyTarget.relatedMetricIdsの各指標をどの効果軸に出すかの明示的な対応表である。各bindingのaxisに対応するsegmentEffects内で、そのmetricLabelに関係する影響をsummaryまたはreasonへ明記する",
        "例: relatedMetricIdsにfiscalCapacityやsocialSecurityが含まれる場合、context.requiredEffectAxesにfiscalが入り、segmentEffects.fiscalを必ず生成する",
        "policyTarget.metricsとpolicyTarget.relatedMetricIdsに含まれる指標は、segmentEffects、shortTermEffects、expectedEffects、concernsのどこかで必ず触れる",
        "行政AI・自動運転など実装型政策では、implementationRisk、digitalUtilization、safetyTrustを落とさず評価する",
        "出力前に自己レビューし、政策名から見て当然必要な効果軸や指標が抜けていないかを修正してから返す",
        "増税・負担増政策では、少なくともincome, generation, industry, fiscal, implementationを返す",
        "減税・給付・支援政策では、少なくともincome, generation, industry, fiscalを返す",
        "segmentEffectsのeffectScoreは便益ならプラス、不利益ならマイナス、該当性が低い場合はnullにする",
        "増税・負担増では所得別・世代別のeffectScoreを、補償策なしにプラスへしない",
        "世代別・所得別・産業別・国際関係への影響が該当する場合は、segmentEffectsとexpectedEffectsまたはconcernsに明記する",
        "長期影響は画面では非表示のため、longTermEffectsは空または控えめな仮置きにする",
        "assistantMessageはユーザーに対し、どの分析ビューから確認すべきかを短く案内する",
      ],
    },
    null,
    2,
  );

  return await withTimeout(
    callProviderJson({ schemaName: "national-initial-policy", prompt }),
    AI_GENERATION_TIMEOUT_MS,
    "初期政策案生成のAI応答が15分以内に返りませんでした",
  );
}

async function generateNationalPolicyTargetData(policyTarget) {
  if (usesFixedSampleProvider()) {
    if (requiresAiFreeInference(policyTarget)) {
      throw new Error("自由記述政策は固定サンプルでは生成できません。AI設定で接続先を有効にしてからリトライしてください。");
    }
    return null;
  }
  assertAiConnection();

  try {
    const voiceGeneration = await generateNationalVoicesWithAi(policyTarget);
    const voices = voiceGeneration.voices || [];
    const analysisGeneration = await generateNationalVoiceAnalysisWithAi(policyTarget, voices);
    const voiceAnalysis = normalizeNationalVoiceAnalysis(analysisGeneration.voiceAnalysis, voices);
    const policyGeneration = await generateNationalInitialPolicyWithAi(policyTarget, voices, voiceAnalysis);
    if (requiresAiFreeInference(policyTarget) && (!voices.length || !voiceAnalysis?.clusters?.length || !policyGeneration.policyDraft)) {
      throw new Error("自由記述政策のAI推論結果が不足しています。voices、voiceAnalysis、policyDraftをすべて返すようにリトライしてください。");
    }
    return {
      voices,
      voiceAnalysis,
      policyDraft: policyGeneration.policyDraft,
      segmentEffects: policyGeneration.segmentEffects || {},
      assistantMessage: policyGeneration.assistantMessage || analysisGeneration.assistantMessage || voiceGeneration.assistantMessage || "",
    };
  } catch (error) {
    console.warn(error);
    setAiErrorNotice(error);
    throw error;
  }
}

function applyPreparedTargetMock(policyTarget) {
  const prepared = appData.targetMockData?.[policyTarget?.id];
  if (!prepared) return false;
  appData.voices = deepClone(prepared.voices || []);
  appData.voiceAnalysis = normalizeNationalVoiceAnalysis(deepClone(prepared.voiceAnalysis || null), appData.voices);
  appData.segmentEffects = deepClone(prepared.segmentEffects || {});
  applyPolicyDraft(deepClone(prepared.policy || emptyPolicyDraft()), { resetChat: true });
  if (prepared.policyChat?.messages?.length) {
    appData.policyChat = deepClone(prepared.policyChat);
  }
  return true;
}

async function generatePolicyTargetInitialData() {
  const policyTarget = selectedPolicyTarget();
  if (!policyTarget) {
    saveStatus = "政策ターゲットを選択してください";
    App(appData);
    return;
  }
  const usedPreparedMock = applyPreparedTargetMock(policyTarget);
  let usedAiGeneration = false;
  let assistantMessage = "";
  if (!usedPreparedMock) {
    const generation = await generateNationalPolicyTargetData(policyTarget);
    if (generation) {
      appData.voices = generation.voices || [];
      appData.voiceAnalysis = normalizeNationalVoiceAnalysis(generation.voiceAnalysis || null, appData.voices);
      appData.segmentEffects = ensureNationalSegmentEffects(policyTarget, generation.segmentEffects);
      applyPolicyDraft(generation.policyDraft || sampleNationalPolicyDraft(policyTarget), { resetChat: true });
      assistantMessage = generation.assistantMessage || "";
      usedAiGeneration = true;
    }
  }
  if (!usedPreparedMock && !usedAiGeneration) {
    if (requiresAiFreeInference(policyTarget)) {
      throw new Error("自由記述政策は固定サンプルを使わず、AI接続で生成してください。");
    }
    appData.voices = sampleNationalVoices(policyTarget);
    appData.voiceAnalysis = normalizeNationalVoiceAnalysis(sampleNationalVoiceAnalysis(policyTarget, appData.voices), appData.voices);
    appData.segmentEffects = sampleNationalSegmentEffects(policyTarget);
    applyPolicyDraft(sampleNationalPolicyDraft(policyTarget), { resetChat: true });
  }
  const sourceLabel = usedPreparedMock ? "用意済みモックデータ" : usedAiGeneration ? "AI生成データ" : "固定サンプルデータ";
  appData.issueSelectionChat.messages.push({
    role: "assistant",
    text: assistantMessage || `「${policyTarget.title}」について${sourceLabel}で国民・ステークホルダーの声と初期政策案を生成しました。声の分析画面でクラスターを確認できます。`,
  });
  saveStatus = `${sourceLabel}で声の分析と初期政策案を生成しました`;
  nationalGenerationNotice = `「${policyTarget.title}」の声の分析と初期政策案の生成が完了しました。左メニューの「声の分析」または「政策案」から確認できます。`;
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
    clusters: "声のクラスター",
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
    digital_access: ["digital"],
    regional: ["regional"],
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

function resultDeltaEntries(result = appData.lastSimulationResult) {
  if (!result) return [];
  return Object.entries(result.visibleMetricDeltas || {}).map(([id, delta]) => ({
    id,
    delta,
    label: metricLabel(id),
    value: appData.metrics.find((metric) => metric.id === id)?.value || 0,
  }));
}

function resultTopImpacts(result = appData.lastSimulationResult, limit = 5) {
  return resultDeltaEntries(result)
    .filter((entry) => entry.delta)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

function ResultImpactBar(entry) {
  const width = Math.min(100, Math.max(8, Math.abs(entry.delta) * 8));
  const tone = entry.delta >= 0 ? "good" : "warn";
  return `
    <div class="report-bar-row ${tone}">
      <span>${entry.label}</span>
      <div class="report-bar-track"><b style="width:${width}%"></b></div>
      <strong>${entry.delta > 0 ? "+" : ""}${entry.delta}</strong>
    </div>
  `;
}

function ResultGroupImpactBar(impact) {
  const width = Math.min(100, Math.max(8, Math.abs(impact.scoreDelta || 0) * 5));
  const tone = impact.scoreDelta >= 0 ? "good" : "warn";
  return `
    <div class="report-bar-row ${tone}">
      <span>${groupLabel(impact.groupId)}</span>
      <div class="report-bar-track"><b style="width:${width}%"></b></div>
      <strong>${impact.scoreDelta > 0 ? "+" : ""}${impact.scoreDelta}</strong>
      <small>${impact.summary}</small>
    </div>
  `;
}

function resultDetailSections(result = appData.lastSimulationResult) {
  const impacts = resultTopImpacts(result, 4);
  const groupImpacts = [...(result?.groupImpacts || [])].sort((a, b) => Math.abs(b.scoreDelta || 0) - Math.abs(a.scoreDelta || 0));
  const fiscalImpact = resultDeltaEntries(result).filter((entry) => ["fiscalCapacity", "socialSecurity", "rule"].includes(entry.id));
  const industryImpact = resultDeltaEntries(result).filter((entry) => entry.id.includes("Industry") || ["manufacturingImpact", "agricultureImpact", "economicRipple"].includes(entry.id));
  return [
    {
      title: "家計・国民生活への短期影響",
      body: "短期では、家計の負担感と政策納得度の改善が最も見えやすい結果になりました。低所得層と中間層では支出に占める生活必需品の比率が高いため、政策効果の体感が早く出ます。一方で、制度の開始時期や対象範囲が伝わりにくい層では、実感が支持に転換するまで時間差が残ります。",
      entries: impacts.filter((entry) => ["support", "happiness", "academic", "economicRipple"].includes(entry.id)),
    },
    {
      title: "財政・社会保障への副作用",
      body: "政策実行により短期的な可処分所得は改善しますが、財政余力と社会保障財源には下押し圧力が出ます。ここは確定的な失敗ではなく、補填財源、時限措置の出口、恒久化しない条件をどれだけ明確にできるかで今後の評価が変わる領域です。",
      entries: fiscalImpact,
    },
    {
      title: "産業・実務面への波及",
      body: "需要下支えの効果は小売、輸入、製造、農業などへ分散して出ます。ただし金融や行政実務では、制度変更への対応、資金繰り、説明コストが増える可能性があります。産業別の効果差は、次の政策修正で優先的に確認すべき論点です。",
      entries: industryImpact,
    },
    {
      title: "国民・ステークホルダー別の反応",
      body: "属性別には、便益を直接受ける層で支持が伸びる一方、財政規律を重視する層では警戒が残ります。無関心層は政策の良し悪しよりも、いつ何が変わるかの説明で反応が左右されるため、広報と手続きの簡素化が重要です。",
      groupEntries: groupImpacts,
    },
  ];
}

function NationalResultReport() {
  const result = appData.lastSimulationResult;
  if (!result) {
    return `
      <section class="national-result-report">
        ${EmptyWorkflowPanel("実行結果は未生成", "政策案画面で政策を実行すると、短期結果・属性別影響を詳細レポートとして表示します。", "政策案へ進む")}
      </section>
    `;
  }
  const topImpacts = resultTopImpacts(result, 6);
  const detailSections = resultDetailSections(result);
  const cashDelta = result.financeDelta?.cash || 0;
  return `
    <section class="national-result-report">
      <article class="panel result-report-hero">
        <div class="panel-header">
          <div>
            <span class="section-label">実行結果レポート</span>
            <h2>${appData.policy.title}</h2>
          </div>
          <small>政策実行 / 詳細版</small>
        </div>
        <div class="report-summary-grid">
          <div>
            <h3>全体のまとめ</h3>
            <p>${result.summary}</p>
            <p>今回の実行では、短期的な生活負担の軽減と政策納得度の上昇が中心的な成果です。政策の便益は広く出る一方で、財政余力、社会保障財源、制度終了時の出口戦略に関する説明責任が残ります。したがって、この結果は「短期効果は確認できたが、長期は財源補填と制度設計の精度に依存する」という位置づけで読むべきです。</p>
          </div>
          <div class="report-score-card">
            <strong>${topImpacts[0]?.delta > 0 ? "+" : ""}${topImpacts[0]?.delta || 0}</strong>
            <span>最大変動: ${topImpacts[0]?.label || "なし"}</span>
            <small>短期財源使用 ${cashDelta.toLocaleString("ja-JP")}</small>
          </div>
        </div>
      </article>

      <article class="panel">
        <div class="panel-header">
          <div>
            <span class="section-label">可視化</span>
            <h2>影響の大きい指標</h2>
          </div>
        </div>
        <div class="report-chart-grid">
          <section>
            <h3>主要指標の変化</h3>
            <div class="report-bar-list">${topImpacts.map(ResultImpactBar).join("")}</div>
          </section>
          <section>
            <h3>属性別の反応</h3>
            <div class="report-bar-list">${(result.groupImpacts || []).map(ResultGroupImpactBar).join("")}</div>
          </section>
        </div>
      </article>

      <div class="result-report-sections">
        ${detailSections
          .map(
            (section) => `
              <article class="panel report-detail-section">
                <h3>${section.title}</h3>
                <p>${section.body}</p>
                ${
                  section.entries?.length
                    ? `<div class="report-bar-list compact">${section.entries.map(ResultImpactBar).join("")}</div>`
                    : `<div class="report-bar-list compact">${(section.groupEntries || []).map(ResultGroupImpactBar).join("")}</div>`
                }
              </article>
            `,
          )
          .join("")}
      </div>

      ${
        showLongTermResultSection
          ? `
            <article class="panel">
              <div class="panel-header">
                <div>
                  <span class="section-label">長期予想</span>
                  <h2>確定結果ではなく観測対象</h2>
                </div>
              </div>
              <div class="policy-target-meta">
                <div><strong>長期リスク</strong><span>恒久化した場合、財政余力と社会保障持続性が低下する可能性があります。</span></div>
                <div><strong>観測すべき指標</strong><span>${(result.nextIssues || []).join("、") || "税収、消費動向、社会保障財源、政策納得度、将来世代への負担感。"}</span></div>
                <div><strong>変動要因</strong><span>物価、賃金、景気循環、国際的な金融環境、制度終了時の政治圧力。</span></div>
              </div>
            </article>
          `
          : ""
      }
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

function VoiceRepresentativeSampleLabel() {
  const representativeCount = appData.voices?.length || 0;
  const sampleCount = appData.voiceAnalysis?.sampledOpinionCount;
  if (isNationalScenario() && sampleCount) {
    return `推定アンケート${formatCount(sampleCount)}件から${formatCount(representativeCount)}件を代表例`;
  }
  return `${formatCount(sampleCount || representativeCount)}件から代表例`;
}

function VoiceAnalysisViewer() {
  const analysis = appData.voiceAnalysis;
  if (!analysis) return `<div class="voice-list">${appData.voices.map(VoiceCard).join("")}</div>`;
  const representativeVoiceCount = appData.voices?.length || 0;
  const summaryItems = isNationalScenario()
    ? [
        [analysis.populationSize, "推定母集団"],
        [analysis.sampledOpinionCount, "推定アンケート母数"],
        [representativeVoiceCount, "代表発話"],
        [analysis.clusters.length, "意見クラスター"],
      ]
    : [
        [analysis.populationSize, "想定生徒数"],
        [analysis.sampledOpinionCount, "分析対象の声"],
        [analysis.clusters.length, "意見クラスター"],
      ];
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
        ${summaryItems.map(([value, label]) => `<div><strong>${formatCount(value)}</strong><span>${label}</span></div>`).join("")}
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
      const target = (appData.policyTargets || []).find((candidate) => candidate.id === issue.id) || issue;
      const issueCount = designIssuesForPolicy(target).length;
      return `
      <button class="issue-row ${isSelected ? "selected" : ""}" type="button" data-issue-id="${issue.id}" aria-pressed="${isSelected}">
        <span>${issue.title}</span>
        <strong class="issue-fit"><small>分析適合度</small>${formatIssueFit(issue)}%</strong>
        <small>${issue.metrics.join(" / ")}</small>
        ${issueCount ? `<em>制度設計上の争点 ${issueCount}件</em>` : ""}
      </button>
    `;
    })
    .join("");
}

function PolicyDesignIssueList(policyTarget = selectedPolicyTarget()) {
  const designIssues = designIssuesForPolicy(policyTarget);
  if (!designIssues.length) {
    return `
      <section class="design-issues-panel empty">
        <h3>制度設計上の争点</h3>
        <p>政策ターゲットを選択すると、チャットで独自色を入れやすくするための対立軸を表示します。</p>
      </section>
    `;
  }
  return `
    <section class="design-issues-panel">
      <div class="panel-head">
        <h3>制度設計上の争点</h3>
        <span>${designIssues.length}件</span>
      </div>
      <div class="design-issue-list">
        ${designIssues
          .map(
            (issue) => `
              <article class="design-issue-card">
                <header>
                  <strong>${escapeHtml(issue.title)}</strong>
                  <small>${escapeHtml(issue.id)}</small>
                </header>
                <div class="design-axis">
                  <span>${escapeHtml(issue.axisA)}</span>
                  <b>vs</b>
                  <span>${escapeHtml(issue.axisB)}</span>
                </div>
                <p>${escapeHtml(issue.description)}</p>
                <ul>
                  ${(issue.watchPoints || []).map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
                </ul>
              </article>
            `,
          )
          .join("")}
      </div>
      <p class="panel-note">この対立軸をチャットで指定すると、対象範囲、補償策、規制の強さ、財源方針などに独自色を入れやすくなります。</p>
    </section>
  `;
}

function PolicyMetricAxisBindingList(policyTarget = selectedPolicyTarget()) {
  const bindings = policyTargetMetricBindings(policyTarget);
  if (!bindings.length) return "";
  return `
    <section class="metric-axis-panel">
      <div class="panel-head">
        <h3>関連指標と効果軸</h3>
        <span>${requiredEffectAxesForPolicy(policyTarget).map(effectAxisTitle).join(" / ")}</span>
      </div>
      <div class="metric-axis-grid">
        ${bindings
          .map(
            (binding) => `
              <div>
                <strong>${escapeHtml(binding.metricLabel)}</strong>
                <span>${escapeHtml(binding.axisLabel)}</span>
                ${binding.description ? `<small>${escapeHtml(binding.description)}</small>` : ""}
              </div>
            `,
          )
          .join("")}
      </div>
      <p class="panel-note">声の分析と政策案生成では、この対応表に基づいて効果軸を出します。</p>
    </section>
  `;
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
      <button id="structure-free-policy" class="primary" type="button">AIで政策ターゲット化</button>
      <p>AI接続時のみ、入力内容から関連指標、推奨ビュー、制度設計上の争点を構造化します。</p>
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
  return `
    <article class="policy-preview">
      <div>
        <span class="section-label">${isNationalScenario() ? "政策案" : "今学期の施策案"}</span>
        <h3>${policy.title}</h3>
        <p>${policy.summary || `${policy.covers.join("、")}に同時対応する${isNationalScenario() ? "政策案" : "単一施策"}。${policy.financePlan}。`}</p>
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
          <span class="section-label">${isNationalScenario() ? "政策案修正チャット" : "施策修正チャット"}</span>
          <h2>${isNationalScenario() ? "政策案を深掘りして調整" : "施策案を深掘りして調整"}</h2>
        </div>
        <small>${hasDraft ? "編集中" : isNationalScenario() ? "政策案未作成" : "施策案未作成"}</small>
      </div>
      <div class="chat-thread">
        ${chat.messages
          .map(
            (message) => `
            <div class="chat-message ${message.role}">
              <span>${message.role === "user" ? (isNationalScenario() ? "ユーザー" : "生徒会") : "AI"}</span>
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
        <p>${isNationalScenario() ? "政策実行後、短期結果とクラスター別影響を表示します。" : "施策実行後、AIシミュレーション結果を指標・財務・属性メモリーへ反映します。"}</p>
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
      ${isNationalScenario() ? `<span class="turn-end-label">政策実行は完了しました</span>` : currentTurn().term >= 3 ? `<span class="turn-end-label">年度末処理へ進めます</span>` : `<button id="advance-turn" type="button">次学期へ進む</button>`}
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
            <small>${VoiceRepresentativeSampleLabel()}</small>
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
          <small>${VoiceRepresentativeSampleLabel()}</small>
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
      <section class="national-workflow-view">
        <div class="section-head">
          <div>
            <h2>政策ターゲット</h2>
            <p>分析対象の政策を指定し、仮想の声データと初期政策案を生成します。</p>
          </div>
          <button id="generate-target-analysis" class="primary-button" type="button" ${policyTarget ? "" : "disabled"}>声の分析へ進む</button>
        </div>
        <div class="two-column-view">
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
              <small>${policyTarget?.field || "AI生成分野"}</small>
            </div>
            <p>${policyTarget?.summary || ""}</p>
            <div class="policy-target-meta">
              <div><strong>関連指標</strong><span>${(policyTarget?.metrics || []).join(" / ")}</span></div>
              <div><strong>生成対象の効果軸</strong><span>${requiredEffectAxesForPolicy(policyTarget).map(effectAxisTitle).join(" / ") || "関連指標から生成"}</span></div>
              <div><strong>財源上の注意</strong><span>${policyTarget?.fundingNote || "政策案生成時に確認"}</span></div>
            </div>
            ${PolicyMetricAxisBindingList(policyTarget)}
            ${PolicyDesignIssueList(policyTarget)}
            ${IssueSelectionChat()}
          </article>
        </div>
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
  if (isNationalScenario()) {
    const hasDraft = appData.policy?.effects?.length > 0;
    const policyExecuted = Boolean(appData.lastSimulationResult);
    return `
      <section class="national-workflow-view">
        <div class="section-head">
          <div>
            <h2>政策案</h2>
            <p>生成済みの初期政策案を、コスト・実施内容・効果・対象属性に分けて確認します。</p>
          </div>
          ${hasDraft && !policyExecuted ? `<button id="execute-policy" class="primary-button" type="button">政策を実行して結果を見る</button>` : ""}
        </div>
        <div class="two-column-view">
          ${PolicyPreview()}
          ${PolicyRevisionChat()}
        </div>
      </section>
    `;
  }
  return `
    <section class="two-column-view">
      ${PolicyPreview()}
      ${PolicyRevisionChat()}
    </section>
  `;
}

function ResultView() {
  if (isNationalScenario()) {
    return `
      <section class="national-workflow-view">
        <div class="section-head">
          <div>
            <h2>実行結果</h2>
            <p>政策の短期結果と属性別影響を、政策レポート形式で詳しく確認します。</p>
          </div>
          <span class="status-pill">詳細レポート</span>
        </div>
        ${NationalResultReport()}
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

function ProcessGuideView() {
  const guideSteps = [
    {
      view: "dashboard",
      image: "dashboard.png",
      title: "ダッシュボード",
      action: "初期状態を確認",
      description: [
        "政策を決める前に、日本の初期状態とシミュレーションの前提を確認します。",
        "主要指標、政策関連指標、人口構成、国際関係スコアを見ながら、どの分野に注意して政策を検討するかを把握します。",
        "確認後、画面右上の「政策ターゲットへ進む」または左メニューから次の画面へ進みます。",
      ],
    },
    {
      view: "issues",
      image: "policy-target.png",
      title: "政策ターゲット",
      action: "分析対象の政策を指定",
      description: [
        "プリセット政策を選ぶか、自由記述で検討したい政策を入力します。",
        "選択した政策の内容を画面右の詳細欄で確認し、必要に応じてAIに質問して確認します。",
        "確認後「声の分析へ進む」を選択します。",
      ],
    },
    {
      view: "voices",
      image: "voices.png",
      title: "声の分析",
      action: "国民・ステークホルダー反応を確認",
      description: [
        "政策ターゲットに対して生成された国民・ステークホルダーの反応を確認します。",
        "距離マップ、階層、代表発話を切り替えながら、賛否、利害、無関心層、実務負担の分布を見ます。",
        "所得別、世代別、産業別などの効果軸も確認し、どの層に影響が出やすいかを把握して政策案へ進みます。",
      ],
    },
    {
      view: "policy",
      image: "policy-draft.png",
      title: "政策案",
      action: "実施内容・コストを調整",
      description: [
        "生成された初期政策案を、コスト、実施内容、効果、対象属性に分けて確認します。",
        "必要に応じてチャットで条件、補償策、税率、対象範囲を修正し、政策本文だけでなく実施内容やコスト内訳にも反映されているか確認します。",
        "内容に問題がなければ、画面右上の「政策を実行して結果を見る」を選択します。",
      ],
    },
    {
      view: "result",
      image: "result-report.png",
      title: "実行結果",
      action: "政策実行レポートを確認",
      description: [
        "政策実行後の結果を、詳細レポート形式で確認します。",
        "全体のまとめ、影響が大きい分野、主要指標の変化、属性別の反応を読み、政策の短期的な効果と副作用を確認します。",
        "必要に応じて保存画面からJSON保存やHTMLレポート出力を行い、検討内容を残します。",
      ],
    },
  ];
  const modes = [
    ["固定サンプル", "事前モックで動作確認"],
    ["AI生成", "接続Providerで声・分析・政策案を生成"],
  ];
  const thumb = (step) => `
    <figure class="screen-thumb-frame">
      <img src="./assets/screenshots/${step.image}" alt="${step.title}画面のスクリーンショット" onload="this.dataset.loaded = 'true'" onerror="this.hidden = true" />
      <div class="screen-thumb ${step.view}" aria-hidden="true">
      <div class="thumb-top">
        <i></i><i></i><i></i>
      </div>
      <div class="thumb-body">
        ${
          step.view === "dashboard"
            ? `
              <div class="thumb-metrics"><b></b><b></b><b></b><b></b></div>
              <div class="thumb-wide"><span></span><span></span><span></span></div>
              <div class="thumb-side"><span></span><span></span><span></span></div>
            `
            : ""
        }
        ${
          step.view === "issues"
            ? `
              <div class="thumb-list"><b></b><b></b><b></b></div>
              <div class="thumb-chat"><span></span><span></span></div>
            `
            : ""
        }
        ${
          step.view === "voices"
            ? `
              <div class="thumb-map"><b></b><b></b><b></b><b></b></div>
              <div class="thumb-tabs"><span></span><span></span><span></span></div>
            `
            : ""
        }
        ${
          step.view === "policy"
            ? `
              <div class="thumb-donut"></div>
              <div class="thumb-tabs"><span></span><span></span><span></span></div>
              <div class="thumb-list compact"><b></b><b></b></div>
            `
            : ""
        }
        ${
          step.view === "result"
            ? `
              <div class="thumb-report"><b></b><span></span><span></span><span></span></div>
              <div class="thumb-chart"><i></i><i></i><i></i></div>
            `
            : ""
        }
      </div>
    </div>
    </figure>
  `;
  return `
    <section class="process-guide-view">
      <div class="section-head">
        <div>
          <h2>使い方</h2>
          <p>各画面を順番に進みながら、人が判断する作業とAIが生成・分析する内容を確認します。</p>
        </div>
      </div>

      <div class="process-mode-strip">
        ${modes.map(([title, body]) => `<article><strong>${title}</strong><p>${body}</p></article>`).join("")}
      </div>

      <div class="screen-tour" aria-label="画面サムネイル付きの使い方">
        ${guideSteps
          .map(
            (step, index) => `
              <article class="tour-step">
                <div class="tour-number">
                  <span>${index + 1}</span>
                </div>
                <div class="tour-shot">
                  ${thumb(step)}
                </div>
                <div class="tour-copy">
                  <span class="section-label">${step.title}</span>
                  <h3>${step.action}</h3>
                  <div class="tour-description">
                    ${step.description.map((text) => `<p>${text}</p>`).join("")}
                  </div>
                </div>
              </article>
            `,
          )
          .join("")}
      </div>

      <article class="panel process-contract-panel">
        <div class="panel-head">
          <h3>現在の生成パイプライン</h3>
          <span>政策ターゲット決定後</span>
        </div>
        <div class="process-pipeline">
          <span>政策ターゲット</span>
          <i></i>
          <span>声の作成</span>
          <i></i>
          <span>クラスター分析</span>
          <i></i>
          <span>初期政策案</span>
          <i></i>
          <span>政策実行結果</span>
        </div>
        <p>各段階はJSON Schemaで受け取り、画面表示・保存・HTMLレポート出力に同じ状態データを使います。</p>
      </article>
    </section>
  `;
}

function ActiveView() {
  const views = {
    dashboard: DashboardView,
    guide: ProcessGuideView,
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
  normalizeNationalGeneratedState();
  const turn = currentTurn();
  const national = isNationalScenario();
  const statusTitle = appData.scenario.selectedPolicyTitle || appData.policy?.title || "政策未選択";
  document.querySelector("#app").innerHTML = `
    <div class="app-shell ${national ? "national-shell" : ""} view-${activeView}">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark">${national ? "政" : "学"}</span>
          <div class="brand-copy">
            <strong>${national ? "仮想政策シミュレーター" : "School Democracy Lab"}</strong>
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
                <button id="process-guide-open" type="button" class="${activeView === "guide" ? "active" : ""}">使い方</button>
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
                ? ""
                : `<div class="term-badge"><span>現在</span><strong>${turn.year}年目 ${termLabel(turn)}</strong></div>`
            }
            <h1>${appData.scenario.title || (national ? "日本版　仮想政策シミュレーター" : "学園自治シミュレーター")}</h1>
            <p>${national ? "対象政策に応じて、関連指標・国民の声・効果軸を切り替えながら政策の影響をAIを使って予想します。" : `${appData.scenario.termLabel}開始時点の指標から、生徒の声と課題候補をAIで抽出します。`}</p>
            ${
              national
                ? `<p class="simulation-disclaimer">本アプリケーションは、AIが推測したデータから導いた推測結果であり、実データに基づいてシミュレーションした結果ではありません。</p>`
                : ""
            }
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
        ${national && (isNationalGenerating || nationalGenerationNotice) ? `<div class="generation-notice ${isNationalGenerating ? "running" : ""}">${isNationalGenerating ? "声の分析と初期政策案を生成中です。画面を移動しても処理は継続します。" : nationalGenerationNotice}</div>` : ""}
        ${ActiveView()}
      </main>
      ${AiSettingsModal()}
      ${SaveModal()}
      ${AiErrorModal()}
    </div>
  `;
  bindInteractions();
  renderVoiceChart();
  renderAnnualChart();
}

function AiSettingsModal() {
  const testClass = aiConnectionTest?.status === "success" ? "success" : aiConnectionTest?.status === "error" ? "error" : "running";
  return `
    <div id="ai-settings-modal" class="modal-backdrop" ${aiSettingsModalOpen ? "" : "hidden"}>
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
        ${aiConnectionTest ? `<div class="connection-test-result ${testClass}">${escapeHtml(aiConnectionTest.message)}</div>` : ""}
        <div class="modal-actions">
          <button id="ai-settings-clear" type="button">クリア</button>
          <button id="ai-connection-test" type="button">接続テスト</button>
          <button class="primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  `;
}

function AiErrorModal() {
  if (!aiErrorDialog) return "";
  return `
    <div id="ai-error-modal" class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="ai-error-title">
        <div class="panel-header">
          <div>
            <span class="section-label">AI接続</span>
            <h2 id="ai-error-title">${escapeHtml(aiErrorDialog.title)}</h2>
          </div>
        </div>
        <p>${escapeHtml(aiErrorDialog.message)}</p>
        <div class="ai-warning">${escapeHtml(aiErrorDialog.detail)}</div>
        <div class="modal-actions">
          <button id="ai-error-cancel" type="button">キャンセル</button>
          <button id="ai-error-retry" class="primary" type="button">リトライ</button>
        </div>
      </section>
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
          <button id="export-report-html" type="button">HTMLレポート出力</button>
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
  document.querySelector("#ai-error-retry")?.addEventListener("click", async () => {
    const retry = aiErrorDialog?.retry;
    clearAiErrorDialog();
    App(appData);
    try {
      await retry?.();
    } catch (error) {
      console.warn(error);
      showAiErrorDialog({ error, retry });
    }
  });
  document.querySelector("#ai-error-cancel")?.addEventListener("click", () => {
    const cancel = aiErrorDialog?.cancel;
    clearAiErrorDialog();
    App(appData);
    cancel?.();
  });
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
  document.querySelector("#structure-free-policy")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const input = document.querySelector("#free-policy-input");
    const text = input?.value.trim() || "";
    if (!text) {
      saveStatus = "自由記述の政策内容を入力してください";
      App(appData);
      return;
    }
    freePolicyDraftText = text;
    button.disabled = true;
    button.textContent = "AI構造化中";
    saveStatus = "自由記述政策をAIで構造化しています";
    App(appData);
    try {
      const generation = await generateFreePolicyTargetWithAi(text, activeFreePolicyScale);
      upsertFreePolicyTarget(generation.policyTarget);
      if (generation.assistantMessage) {
        appData.issueSelectionChat.messages.push({ role: "assistant", text: generation.assistantMessage });
      }
      saveStatus = "自由記述政策をAIで政策ターゲット化しました";
      App(appData);
    } catch (error) {
      console.warn(error);
      showAiErrorDialog({
        title: "政策ターゲット構造化エラー",
        error,
        retry: async () => {
          const retryGeneration = await generateFreePolicyTargetWithAi(text, activeFreePolicyScale);
          upsertFreePolicyTarget(retryGeneration.policyTarget);
          if (retryGeneration.assistantMessage) {
            appData.issueSelectionChat.messages.push({ role: "assistant", text: retryGeneration.assistantMessage });
          }
          saveStatus = "自由記述政策をAIで政策ターゲット化しました";
          App(appData);
        },
      });
    }
  });
  document.querySelector("#generate-target-analysis")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "声と政策案を生成中";
    isNationalGenerating = true;
    nationalGenerationNotice = "";
    saveStatus = "声の分析と初期政策案を生成中です";
    App(appData);
    try {
      await generatePolicyTargetInitialData();
    } catch (error) {
      console.warn(error);
      nationalGenerationNotice = "";
      showAiErrorDialog({
        title: "声の分析生成エラー",
        error,
        retry: async () => {
          isNationalGenerating = true;
          nationalGenerationNotice = "";
          saveStatus = "声の分析と初期政策案を生成中です";
          App(appData);
          try {
            await generatePolicyTargetInitialData();
          } finally {
            isNationalGenerating = false;
            App(appData);
          }
        },
      });
    } finally {
      isNationalGenerating = false;
      App(appData);
    }
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

  document.querySelector("#process-guide-open")?.addEventListener("click", () => {
    activeView = "guide";
    App(appData);
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
  document.querySelector("#export-report-html")?.addEventListener("click", exportReportHtml);
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
      showAiErrorDialog({
        title: "政策実行シミュレーションエラー",
        error,
        retry: () => executePolicyTurn(),
      });
    }
  });
  document.querySelector("#create-policy-draft")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = `${isNationalScenario() ? "政策案" : "施策案"}を生成中`;
    try {
      await createPolicyDraftFromSelection();
    } catch (error) {
      showAiErrorDialog({
        title: "政策案生成エラー",
        error,
        retry: () => createPolicyDraftFromSelection(),
      });
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
    const loadingMessageIndex = policyChat().messages.push({ role: "assistant", text: `${isNationalScenario() ? "政策案" : "施策案"}の実施内容、効果、懸念、属性別影響を見直しています。` }) - 1;
    App(appData);
    try {
      await revisePolicyDraftFromChat(text);
    } catch (error) {
      policyChat().messages[loadingMessageIndex] = { role: "assistant", text: `${isNationalScenario() ? "政策案" : "施策案"}の修正に失敗しました。${error.message}` };
      showAiErrorDialog({
        title: "政策案修正エラー",
        error,
        retry: () => revisePolicyDraftFromChat(text),
      });
    }
  });
  document.querySelector("#advance-turn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "次学期を生成中";
    try {
      await advanceToNextTurn();
    } catch (error) {
      showAiErrorDialog({
        title: "次学期生成エラー",
        error,
        retry: () => advanceToNextTurn(),
      });
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
    aiSettingsModalOpen = true;
    App(appData);
  });
  document.querySelector("#ai-settings-close")?.addEventListener("click", () => {
    aiSettingsModalOpen = false;
    App(appData);
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
    aiConnectionTest = null;
    aiSettingsModalOpen = true;
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
    aiConnectionTest = null;
    aiSettingsModalOpen = true;
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
    aiConnectionTest = null;
    form.querySelector(".connection-test-result")?.remove();
  });
  document.querySelector("#ai-connection-test")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const form = document.querySelector("#ai-settings-form");
    const config = aiConfigFromFormData(new FormData(form));
    button.disabled = true;
    button.textContent = "接続確認中";
    aiConnectionTest = { status: "running", message: `${providerPresets[config.provider]?.label || config.provider} への接続を確認しています。` };
    aiSettingsModalOpen = true;
    App(appData);
    try {
      const message = await withTimeout(testAiConnection(config), AI_CONNECTION_TEST_TIMEOUT_MS, "接続テストが30秒以内に完了しませんでした。");
      aiConnectionTest = { status: "success", message };
      aiNotice = "";
    } catch (error) {
      aiConnectionTest = { status: "error", message: `接続テスト失敗: ${error.message}` };
      aiNotice = aiConnectionTest.message;
    }
    aiSettingsModalOpen = true;
    App(appData);
  });
  document.querySelector("#ai-settings-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveAiConfig(new FormData(event.currentTarget));
    aiSettingsModalOpen = false;
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
    } catch (error) {
      showAiErrorDialog({
        title: "政策分析チャットエラー",
        error,
        retry: () => discussIssueSelection(text).then((result) => {
          appData.issueSelectionChat.messages.push({ role: "assistant", text: result.message });
          App(appData);
        }),
      });
      return;
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
      appData.issueSelectionChat.messages.push({ role: "user", text: `${isNationalScenario() ? "政策ターゲット" : "課題"}「${issue.title}」を選択しました。内容を詳しく説明してください。` });
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
      } catch (error) {
        appData.issueSelectionChat.messages[loadingMessageIndex] = { role: "assistant", text: `AI接続に失敗したため詳細説明を生成できませんでした。${error.message}` };
        showAiErrorDialog({
          title: "政策ターゲット説明エラー",
          error,
          retry: () => explainIssueSelection(issue).then((result) => {
            appData.issueSelectionChat.messages[loadingMessageIndex] = { role: "assistant", text: result.message };
            App(appData);
          }),
        });
        return;
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
