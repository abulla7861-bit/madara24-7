/**
 * MADARA 5.1 - 24/7 Background Worker
 * Keeps Firebase history updated even when no user has the page open.
 *
 * Usage:
 *   node madara-24-7-worker.js
 *
 * Recommended: run with PM2 so it auto-restarts and survives reboots:
 *   npm install -g pm2
 *   pm2 start madara-24-7-worker.js --name madara
 *   pm2 save
 *   pm2 startup
 */

const DB = "https://madara-62f7b-default-rtdb.firebaseio.com";
const API = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";
const POLL_MS = 5000;          // 5 seconds (same as original)
const MAX_HISTORY = 3000;      // keep last N results in memory

let resultHistory = [];
let lastIssue = null;

function cmp(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return a.length - b.length;
  return a > b ? 1 : a < b ? -1 : 0;
}

function nextPeriod(issue) {
  try {
    return String(BigInt(issue) + 1n);
  } catch {
    const n = parseInt(issue, 10);
    return isNaN(n) ? issue : String(n + 1);
  }
}

async function loadHistory() {
  try {
    const res = await fetch(`${DB}/wingo_results.json`);
    const data = await res.json();
    if (!data) return;

    const list = [];
    for (const k in data) {
      if (data[k] && data[k].period != null) list.push(data[k]);
    }
    list.sort((a, b) => cmp(a.period, b.period));
    resultHistory = list.map((x) => ({
      period: String(x.period),
      number: Number(x.number),
      result: x.result,
    }));
    console.log(`[${new Date().toISOString()}] Loaded ${resultHistory.length} results from Firebase`);
  } catch (err) {
    console.error("loadHistory error:", err.message);
  }
}

async function saveItem(item) {
  try {
    await fetch(`${DB}/wingo_results/${item.period}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period: String(item.period),
        number: item.number,
        result: item.result,
      }),
    });
  } catch (err) {
    console.error("saveItem error:", err.message);
  }
}

async function fetchAPI() {
  try {
    const res = await fetch(`${API}?ts=${Date.now()}`, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data?.data?.list) return data.data.list;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.list)) return data.list;
    if (Array.isArray(data)) return data;
    return [];
  } catch (err) {
    console.error("fetchAPI error:", err.message);
    return null;
  }
}

function getIssue(it) {
  return it.issueNumber || it.issue || it.period || it.IssueNumber || "";
}

function getNumber(it) {
  let n = it.number ?? it.Number ?? it.result ?? it.Result ?? it.openNumber;
  return n == null ? null : Number(n);
}

async function update() {
  const list = await fetchAPI();
  if (!list || !list.length) {
    console.log(`[${new Date().toISOString()}] API offline / blocked`);
    return;
  }

  const saves = [];
  let added = 0;

  for (const it of list) {
    const period = String(getIssue(it));
    const number = getNumber(it);
    if (!period || number == null || isNaN(number)) continue;

    const exists = resultHistory.some((r) => r.period === period);
    if (!exists) {
      const item = {
        period,
        number,
        result: number >= 5 ? "BIG" : "SMALL",
      };
      resultHistory.push(item);
      saves.push(saveItem(item));
      added++;
    }
  }

  await Promise.all(saves);

  resultHistory.sort((a, b) => cmp(a.period, b.period));
  if (resultHistory.length > MAX_HISTORY) {
    resultHistory = resultHistory.slice(-MAX_HISTORY);
  }

  const latest = resultHistory[resultHistory.length - 1];
  if (!latest) return;

  if (latest.period !== lastIssue) {
    lastIssue = latest.period;
    console.log(
      `[${new Date().toISOString()}] New issue ${latest.period} → ${latest.number} (${latest.result}) | History: ${resultHistory.length}${added ? ` (+${added})` : ""}`
    );
  } else if (added) {
    console.log(`[${new Date().toISOString()}] History: ${resultHistory.length} (+${added})`);
  }
}

async function main() {
  console.log("══════════════════════════════════════════");
  console.log("  MADARA 5.1  •  24/7 Background Worker");
  console.log("  Polling every", POLL_MS / 1000, "seconds");
  console.log("══════════════════════════════════════════");

  await loadHistory();
  await update();

  setInterval(update, POLL_MS);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
