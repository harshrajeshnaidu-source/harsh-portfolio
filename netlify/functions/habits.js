// netlify/functions/habits.js
// Fetches last 14 days of habit data from Notion and returns clean JSON
// Deploy this to Netlify. Set NOTION_TOKEN in Netlify environment variables.

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = "e9270383-59ce-4dcc-a942-57f518360504";

const HABITS = [
  { key: "Wake 6am",                emoji: "☀️",  track: "Daily System" },
  { key: "Meditate",                emoji: "🧘",  track: "Daily System" },
  { key: "Organise day before bed", emoji: "📋",  track: "Daily System" },
  { key: "Coffee house deep work",  emoji: "☕",  track: "Daily System" },
  { key: "Gym",                     emoji: "🏋️", track: "Body" },
  { key: "Sleep by midnight",       emoji: "🌙",  track: "Body" },
  { key: "Apply to 2 jobs",         emoji: "💼",  track: "Job Hunt" },
  { key: "LinkedIn post",           emoji: "📣",  track: "Job Hunt" },
  { key: "LinkedIn DMs / connections", emoji: "🤝", track: "Job Hunt" },
  { key: "Portfolio work",          emoji: "🗂️", track: "Portfolio" },
  { key: "HPL work",                emoji: "🏆",  track: "HPL" },
  { key: "SQL / AI learning",       emoji: "💻",  track: "Skills" },
];

const TRACKS = ["Daily System", "Body", "Job Hunt", "Portfolio", "HPL", "Skills"];

const TRACK_MAX = {
  "Daily System": 4,
  "Body": 2,
  "Job Hunt": 3,
  "Portfolio": 1,
  "HPL": 1,
  "Skills": 1,
};

function parseDay(props) {
  const completed = {};
  let xp = 0;
  let count = 0;

  for (const h of HABITS) {
    const done = props[h.key]?.checkbox === true;
    completed[h.key] = done;
    if (done) { xp += 10; count++; }
  }

  return { completed, xp, count, total: HABITS.length };
}

function calcStreak(days) {
  // days sorted newest first
  let streak = 0;
  for (const d of days) {
    // a day "counts" if at least 8/12 habits done
    if (d.count >= 8) streak++;
    else break;
  }
  return streak;
}

function calcLevel(totalXP) {
  // Level thresholds: 200 XP per level
  const XP_PER_LEVEL = 200;
  const level = Math.floor(totalXP / XP_PER_LEVEL) + 1;
  const xpIntoLevel = totalXP % XP_PER_LEVEL;
  return { level, xpIntoLevel, xpPerLevel: XP_PER_LEVEL };
}

function trackAverages(days) {
  const avgs = {};
  for (const track of TRACKS) {
    const habits = HABITS.filter(h => h.track === track);
    const max = TRACK_MAX[track];
    let totalPct = 0;
    for (const d of days) {
      const done = habits.filter(h => d.completed[h.key]).length;
      totalPct += done / max;
    }
    avgs[track] = days.length > 0 ? Math.round((totalPct / days.length) * 100) : 0;
  }
  return avgs;
}

exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    // Query Notion — last 14 days, sorted newest first
    const response = await fetch(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sorts: [{ property: "Date", direction: "descending" }],
          page_size: 14,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Notion API error: ${response.status}`);
    }

    const data = await response.json();

    // Parse each day
    const days = data.results.map(page => {
      const props = page.properties;
      const dateStr = props["Date"]?.date?.start || null;
      const dayName = props["Day"]?.title?.[0]?.plain_text || dateStr;
      const rating = props["Day Rating"]?.select?.name || null;
      const notes = props["Notes"]?.rich_text?.[0]?.plain_text || "";
      const parsed = parseDay(props);

      return {
        id: page.id,
        date: dateStr,
        dayName,
        rating,
        notes,
        ...parsed,
      };
    });

    // Today = most recent entry
    const today = days[0] || null;
    const last7 = days.slice(0, 7);

    // Total XP across all days
    const totalXP = days.reduce((sum, d) => sum + d.xp, 0);

    // Streak
    const streak = calcStreak(days);

    // Level
    const levelData = calcLevel(totalXP);

    // Track averages over last 7 days
    const trackAvgs = trackAverages(last7);

    // Heatmap data — last 7 days, per habit, boolean
    const heatmap = last7.map(d => ({
      date: d.date,
      dayName: d.dayName,
      pct: Math.round((d.count / d.total) * 100),
      xp: d.xp,
      completed: d.completed,
    }));

    // Today's track breakdown
    const todayTracks = today
      ? TRACKS.map(track => {
          const habits = HABITS.filter(h => h.track === track);
          const done = habits.filter(h => today.completed[h.key]).length;
          const max = TRACK_MAX[track];
          return {
            track,
            done,
            max,
            pct: Math.round((done / max) * 100),
            xp: done * 10,
            habits: habits.map(h => ({
              key: h.key,
              emoji: h.emoji,
              done: today.completed[h.key],
            })),
          };
        })
      : [];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        today: today
          ? {
              date: today.date,
              dayName: today.dayName,
              count: today.count,
              total: today.total,
              xp: today.xp,
              pct: Math.round((today.count / today.total) * 100),
              rating: today.rating,
              notes: today.notes,
              completed: today.completed,
            }
          : null,
        streak,
        totalXP,
        level: levelData.level,
        xpIntoLevel: levelData.xpIntoLevel,
        xpPerLevel: levelData.xpPerLevel,
        trackAverages: trackAvgs,
        heatmap,
        todayTracks,
        habits: HABITS,
        lastUpdated: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
