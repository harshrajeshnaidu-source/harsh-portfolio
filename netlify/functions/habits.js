// netlify/functions/habits.js
// Fetches habit data from Google Sheets (published CSV) — no auth needed

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vThGZkZMInHgZspfrvd1DRZI20jvTU1h-yr3m3-WpeUOPmqrnUTYPCrJk71z-OfcSU8fWbxjf6V3vXA/pub?output=csv&sheet=✅ Habits";

const HABITS = [
  { key: "Wake 6am",                   col: 1,  emoji: "☀️",  track: "Daily System" },
  { key: "Meditate",                   col: 2,  emoji: "🧘",  track: "Daily System" },
  { key: "Organise day before bed",    col: 3,  emoji: "📋",  track: "Daily System" },
  { key: "Coffee house deep work",     col: 4,  emoji: "☕",  track: "Daily System" },
  { key: "Gym",                        col: 5,  emoji: "🏋️", track: "Body" },
  { key: "Sleep by midnight",          col: 6,  emoji: "🌙",  track: "Body" },
  { key: "Apply to 2 jobs",            col: 7,  emoji: "💼",  track: "Job Hunt" },
  { key: "LinkedIn post",              col: 8,  emoji: "📣",  track: "Job Hunt" },
  { key: "LinkedIn DMs / connections", col: 9,  emoji: "🤝",  track: "Job Hunt" },
  { key: "Portfolio work",             col: 10, emoji: "🗂️", track: "Portfolio" },
  { key: "HPL work",                   col: 11, emoji: "🏆",  track: "HPL" },
  { key: "SQL / AI learning",          col: 12, emoji: "💻",  track: "Skills" },
];

const TRACKS = ["Daily System", "Body", "Job Hunt", "Portfolio", "HPL", "Skills"];
const TRACK_MAX = { "Daily System": 4, "Body": 2, "Job Hunt": 3, "Portfolio": 1, "HPL": 1, "Skills": 1 };

function parseCSV(text) {
  const lines = text.trim().split("\n");
  return lines.map(line => {
    const cols = [];
    let current = "", inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === "," && !inQuotes) { cols.push(current.trim()); current = ""; }
      else { current += ch; }
    }
    cols.push(current.trim());
    return cols;
  });
}

function parseDay(row) {
  const completed = {};
  let xp = 0, count = 0;
  for (const h of HABITS) {
    const val = (row[h.col] || "").toUpperCase();
    const done = val === "TRUE" || val === "1" || val === "YES";
    completed[h.key] = done;
    if (done) { xp += 10; count++; }
  }
  return { completed, xp, count, total: HABITS.length };
}

function calcStreak(days) {
  let streak = 0;
  for (const d of days) { if (d.count >= 8) streak++; else break; }
  return streak;
}

function calcLevel(totalXP) {
  const XP_PER_LEVEL = 200;
  return { level: Math.floor(totalXP / XP_PER_LEVEL) + 1, xpIntoLevel: totalXP % XP_PER_LEVEL, xpPerLevel: XP_PER_LEVEL };
}

function trackAverages(days) {
  const avgs = {};
  for (const track of TRACKS) {
    const habits = HABITS.filter(h => h.track === track);
    const max = TRACK_MAX[track];
    let totalPct = 0;
    for (const d of days) { const done = habits.filter(h => d.completed[h.key]).length; totalPct += done / max; }
    avgs[track] = days.length > 0 ? Math.round((totalPct / days.length) * 100) : 0;
  }
  return avgs;
}

exports.handler = async function(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  try {
    const res = await fetch(SHEET_URL);
    if (!res.ok) throw new Error(`Sheets fetch failed: ${res.status}`);

    const csv = await res.text();
    const rows = parseCSV(csv);

    // Row 0 is header, rows 1+ are data
    const days = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0] || row[0].trim() === "") continue; // skip empty rows

      const dateStr = row[0].trim();
      const rating = row[15] ? row[15].trim() : "";
      const notes = row[16] ? row[16].trim() : "";
      const parsed = parseDay(row);

      days.push({ date: dateStr, dayName: dateStr, rating, notes, ...parsed });
    }

    // Sort newest first
    days.sort((a, b) => new Date(b.date) - new Date(a.date));

    const today = days[0] || null;
    const last7 = days.slice(0, 7);
    const totalXP = days.reduce((sum, d) => sum + d.xp, 0);
    const streak = calcStreak(days);
    const levelData = calcLevel(totalXP);
    const trackAvgs = trackAverages(last7);

    const heatmap = last7.map(d => ({
      date: d.date, dayName: d.dayName,
      pct: Math.round((d.count / d.total) * 100),
      xp: d.xp, completed: d.completed,
    }));

    const todayTracks = today ? TRACKS.map(track => {
      const habits = HABITS.filter(h => h.track === track);
      const done = habits.filter(h => today.completed[h.key]).length;
      const max = TRACK_MAX[track];
      return {
        track, done, max,
        pct: Math.round((done / max) * 100),
        xp: done * 10,
        habits: habits.map(h => ({ key: h.key, emoji: h.emoji, done: today.completed[h.key] })),
      };
    }) : [];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        today: today ? {
          date: today.date, dayName: today.dayName,
          count: today.count, total: today.total,
          xp: today.xp, pct: Math.round((today.count / today.total) * 100),
          rating: today.rating, notes: today.notes, completed: today.completed,
        } : null,
        streak, totalXP,
        level: levelData.level,
        xpIntoLevel: levelData.xpIntoLevel,
        xpPerLevel: levelData.xpPerLevel,
        trackAverages: trackAvgs,
        heatmap, todayTracks,
        habits: HABITS,
        lastUpdated: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error("habits.js error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
