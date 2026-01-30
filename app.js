import { supabase } from "./supabaseClient.js";

// ===== Storage Keys =====
const KEY_LOGS = "fd_time_logs_v1";
const KEY_CATS = "fd_categories_v1";

// ===== Default Categories =====
const DEFAULT_CATEGORIES = [
  "日本語学習", "コーディング", "授業", "アルバイト", "運動",
  "食事", "睡眠", "通勤", "休憩", "スマホ"
];

// ===== UI Text (JA) =====
const UI = {
  clickToLogOnce: "クリックすると1件記録します",
  inputCategoryName: "カテゴリ名を入力してください",
  categoryExists: "このカテゴリはすでに存在します",
  noRecentLogs: "まだ記録がありません",
  rangeSummary: (start, end, count) =>
    `期間：${start} ～ ${end}（終了日は含まない）｜件数：${count}`,
  noData: "データなし",
  delete: "削除",
  exportNoData: "エクスポートできるデータがありません",
  confirmClear: "すべてのデータを削除します。よろしいですか？（元に戻せません）"
};

// ===== State =====
let categories = loadCategories();
let logs = loadLogs(); // {id, ts, category}

// ===== Elements =====
const quickButtonsEl = document.getElementById("quickButtons");
const recentListEl = document.getElementById("recentList");
const newCategoryEl = document.getElementById("newCategory");
const addCategoryBtn = document.getElementById("addCategoryBtn");

const exportCsvBtn = document.getElementById("exportCsvBtn");
const clearBtn = document.getElementById("clearBtn");

const tabs = Array.from(document.querySelectorAll(".tab"));
const baseDateEl = document.getElementById("baseDate");
const topNEl = document.getElementById("topN");
const summaryEl = document.getElementById("summary");

const summaryTableBody = document.querySelector("#summaryTable tbody");
const rawTableBody = document.querySelector("#rawTable tbody");

let activeTab = "day";

// ===== Init =====
init();

function init() {
  // base date = today
  baseDateEl.value = toDateInputValue(new Date());

  renderButtons();
  renderRecent();
  renderStats();

  addCategoryBtn.addEventListener("click", onAddCategory);
  exportCsvBtn.addEventListener("click", exportCSV);
  clearBtn.addEventListener("click", onClearAll);

  tabs.forEach(btn => btn.addEventListener("click", () => {
    tabs.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeTab = btn.dataset.tab;
    renderStats();
  }));

  baseDateEl.addEventListener("change", renderStats);
  topNEl.addEventListener("change", renderStats);
}

// ===== Category UI =====
function renderButtons() {
  quickButtonsEl.innerHTML = "";
  categories.forEach(cat => {
    const b = document.createElement("button");
    b.textContent = cat;
    b.title = UI.clickToLogOnce;
    b.addEventListener("click", () => addLog(cat));
    quickButtonsEl.appendChild(b);
  });
}

function onAddCategory() {
  const v = (newCategoryEl.value || "").trim();
  if (!v) return alert(UI.inputCategoryName);
  if (categories.includes(v)) return alert(UI.categoryExists);
  categories.unshift(v);
  saveCategories(categories);
  newCategoryEl.value = "";
  renderButtons();
}

// ===== Logs =====
function addLog(category) {
  const entry = {
    id: cryptoRandomId(),
    ts: Date.now(),
    category
  };
  logs.unshift(entry);
  saveLogs(logs);
  renderRecent();
  renderStats();
}

function deleteLog(id) {
  logs = logs.filter(x => x.id !== id);
  saveLogs(logs);
  renderRecent();
  renderStats();
}

// ===== Recent =====
function renderRecent() {
  recentListEl.innerHTML = "";
  const take = logs.slice(0, 30);
  if (take.length === 0) {
    recentListEl.innerHTML = `<div class="item"><span>${UI.noRecentLogs}</span><span class="mono">—</span></div>`;
    return;
  }
  take.forEach(x => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div><b>${escapeHtml(x.category)}</b></div>
      <div class="mono">${formatDateTime(x.ts)}</div>
    `;
    recentListEl.appendChild(div);
  });
}

// ===== Stats =====
function renderStats() {
  const base = new Date(baseDateEl.value + "T00:00:00");
  const range = getRange(base, activeTab);

  const filtered = logs
    .filter(x => x.ts >= range.start.getTime() && x.ts < range.end.getTime())
    .slice(0); // copy

  // Summary text
  summaryEl.textContent = UI.rangeSummary(
    formatDate(range.start),
    formatDate(range.end),
    filtered.length
  );

  // Group
  const byCat = new Map();
  filtered.forEach(x => {
    const rec = byCat.get(x.category) || { count: 0, lastTs: 0 };
    rec.count += 1;
    rec.lastTs = Math.max(rec.lastTs, x.ts);
    byCat.set(x.category, rec);
  });

  // Sort categories by count
  const rows = Array.from(byCat.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.count - a.count);

  const total = filtered.length || 1;
  const topN = Number(topNEl.value);

  // Render summary table
  summaryTableBody.innerHTML = "";
  rows.slice(0, topN).forEach(r => {
    const tr = document.createElement("tr");
    const pct = ((r.count / total) * 100).toFixed(1) + "%";
    tr.innerHTML = `
      <td>${escapeHtml(r.category)}</td>
      <td>${r.count}</td>
      <td>${pct}</td>
      <td class="mono">${formatDateTime(r.lastTs)}</td>
    `;
    summaryTableBody.appendChild(tr);
  });
  if (rows.length === 0) {
    summaryTableBody.innerHTML = `<tr><td colspan="4">${UI.noData}</td></tr>`;
  }

  // Render raw table
  rawTableBody.innerHTML = "";
  filtered.slice(0, 200).forEach(x => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${formatDateTime(x.ts)}</td>
      <td>${escapeHtml(x.category)}</td>
      <td class="actions"><button data-id="${x.id}">${UI.delete}</button></td>
    `;
    tr.querySelector("button").addEventListener("click", () => deleteLog(x.id));
    rawTableBody.appendChild(tr);
  });
  if (filtered.length === 0) {
    rawTableBody.innerHTML = `<tr><td colspan="3">${UI.noData}</td></tr>`;
  }
}

// ===== Range Helpers =====
function getRange(baseDate, mode) {
  const start = new Date(baseDate);
  let end;

  if (mode === "day") {
    end = addDays(start, 1);
  } else if (mode === "month") {
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    start.setDate(1);
  } else if (mode === "quarter") {
    const q = Math.floor(start.getMonth() / 3); // 0..3
    start.setMonth(q * 3, 1);
    start.setHours(0, 0, 0, 0);
    end = new Date(start.getFullYear(), start.getMonth() + 3, 1);
  } else {
    end = addDays(start, 1);
  }

  // Normalize start to 00:00:00
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return { start, end };
}

// ===== Export =====
function exportCSV() {
  if (logs.length === 0) return alert(UI.exportNoData);

  const header = ["timestamp", "datetime", "category"];
  const lines = [header.join(",")];

  logs.slice().reverse().forEach(x => {
    const dt = formatDateTime(x.ts);
    lines.push([x.ts, `"${dt}"`, `"${x.category.replaceAll('"', '""')}"`].join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `time-log-${toDateInputValue(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== Clear =====
function onClearAll() {
  if (!confirm(UI.confirmClear)) return;
  logs = [];
  categories = DEFAULT_CATEGORIES.slice();
  saveLogs(logs);
  saveCategories(categories);
  renderButtons();
  renderRecent();
  renderStats();
}

// ===== LocalStorage =====
function loadLogs() {
  try {
    const raw = localStorage.getItem(KEY_LOGS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveLogs(arr) {
  localStorage.setItem(KEY_LOGS, JSON.stringify(arr));
}
function loadCategories() {
  try {
    const raw = localStorage.getItem(KEY_CATS);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr) && arr.length) return arr;
    saveCategories(DEFAULT_CATEGORIES.slice());
    return DEFAULT_CATEGORIES.slice();
  } catch {
    return DEFAULT_CATEGORIES.slice();
  }
}
function saveCategories(arr) {
  localStorage.setItem(KEY_CATS, JSON.stringify(arr));
}

// ===== Utils =====
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function toDateInputValue(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function formatDateTime(ts) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}
function cryptoRandomId() {
  if (crypto && crypto.getRandomValues) {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return `${a[0].toString(16)}${a[1].toString(16)}`;
  }
  return String(Date.now()) + String(Math.random()).slice(2);
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ===== Backup =====
function backupJSON() {
  const data = { logs, categories };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "backup.json";
  a.click();
}

// ===== Supabase Test (Optional) =====
async function testInsert() {
  const { data, error } = await supabase
    .from("activity_logs")
    .insert([{ activity: "test", log_date: new Date().toISOString().slice(0, 10) }])
    .select();

  console.log("insert data:", data);
  console.log("insert error:", error);
}

testInsert();
