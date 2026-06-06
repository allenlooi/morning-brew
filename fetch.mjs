// ─────────────────────────────────────────────────────────────
// Morning Brew — scheduled fetcher
// Runs in GitHub Actions (or locally). Pulls fresh items per
// section using the Anthropic API + live web search, MERGES them
// into a rolling 30-day archive, and writes data.json. The
// dashboard (index.html) reads that file.
//
// Requires Node 20+ (built-in fetch) and an ANTHROPIC_API_KEY env var.
// ─────────────────────────────────────────────────────────────

import { readFile, writeFile } from "node:fs/promises";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }

// Model + web-search tool. Swap MODEL to a cheaper one (e.g. a Haiku
// string from the API docs) to cut cost; check docs for the current
// web_search tool version string if this one ever errors.
const MODEL = "claude-sonnet-4-6";
const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 };

const ITEMS_PER_PULL = 6;     // new items requested per section per run
const RETAIN_DAYS = 30;       // rolling archive window
const MAX_PER_SECTION = 40;   // hard cap so sections never balloon

// ── EDIT YOUR SECTIONS HERE ──────────────────────────────────
const SECTIONS = [
  {
    id: "platform",
    label: "Platform & Algorithm",
    desc: "Feature drops, ranking-signal shifts and ad-product changes across the major platforms",
    hint: "Recent platform and algorithm changes from Instagram, TikTok, Meta, LinkedIn, YouTube, X and Threads, plus new ad products and creator features.",
  },
  {
    id: "creator",
    label: "Creator & Influencer",
    desc: "The creator economy, KOL strategy and what is working across SEA",
    hint: "Recent creator economy and influencer marketing news, with weight on Southeast Asia: KOL strategy, platform shifts, payment models and standout creator campaigns.",
  },
  {
    id: "campaigns",
    label: "Brand Campaigns & Craft",
    desc: "Standout creative and social-first work worth stealing structure from",
    hint: "The best and most talked-about brand social media and advertising campaigns globally in the last 30 days, including notable award-winning or Cannes Lions-relevant work.",
  },
  {
    id: "singapore",
    label: "Singapore / APAC",
    desc: "Regional brand, agency and platform moves on your doorstep",
    hint: "Social media and marketing news specific to Singapore and the wider APAC region: platform adoption, agency news, regional campaigns and market data.",
  },
  {
    id: "malaysia",
    label: "Malaysia",
    desc: "Platform behaviour, creator trends and brand work specific to the Malaysian market",
    hint: "Social media and marketing news specific to Malaysia: platform behaviour (TikTok, Meta, WhatsApp, RED), KOL and KOC trends, festive-calendar campaigns, and notable local brand work.",
  },
  {
    id: "category",
    label: "Category Watch",
    desc: "Social moves in your clients' verticals: healthcare, automotive and luxury, gaming and tech, social good",
    hint: "Recent social media marketing news and campaigns within these verticals: healthcare and pharma, luxury and performance automotive, gaming and consumer tech, and social good or eldercare. Spread items across the verticals.",
  },
  {
    id: "industry",
    label: "AI & Industry",
    desc: "The structural shifts reshaping how social and comms teams work",
    hint: "Broader marketing and advertising industry shifts, AI tools and developments affecting social and communications teams, ad-spend forecasts, agency trends and governance issues.",
  },
];
// ─────────────────────────────────────────────────────────────

const NOW = new Date();
const todayStr = NOW.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const cutoff = NOW.getTime() - RETAIN_DAYS * 86400000;

const keyOf = (it) =>
  (it.url || it.title || "").toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "").trim();

function buildPrompt(section) {
  return `You are a social media industry intelligence analyst briefing the regional head of social at a Singapore communications agency. Today is ${todayStr}.
Use web search to find the ${ITEMS_PER_PULL} most recent and genuinely relevant items for this category: "${section.label}". ${section.hint}
Only include items published or updated within the last 30 days. Avoid generic listicles and SEO filler; favour concrete news, launches and named campaigns from credible sources.
Return ONLY a raw JSON array, no preamble and no markdown code fences. Each object must have exactly these keys: "tag" (short label, 1 to 2 words), "title" (max 11 words, no trailing period), "summary" (1 to 2 punchy sentences, no em dashes), "source" (publication name), "date" (e.g. "Jun 2026"), "url" (full https link to the primary source).`;
}

async function pullSection(section) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: buildPrompt(section) }],
      tools: [WEB_SEARCH_TOOL],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("no JSON array in response");
  const items = JSON.parse(match[0]);
  if (!Array.isArray(items) || !items.length) throw new Error("empty array");
  return items;
}

// merge new pull into the section's existing 30-day archive
function mergeSection(prevItems, newItems) {
  const map = new Map();
  // keep previous items still inside the window
  for (const it of prevItems) {
    const t = Date.parse(it.fetchedAt) || 0;
    if (t >= cutoff) map.set(keyOf(it), { ...it, fresh: false });
  }
  // add this run's items; new ones are flagged fresh
  for (const raw of newItems) {
    const it = {
      tag: String(raw.tag || "").slice(0, 24),
      title: String(raw.title || "").trim(),
      summary: String(raw.summary || "").trim(),
      source: String(raw.source || "").trim(),
      date: String(raw.date || "").trim(),
      url: String(raw.url || "").trim(),
    };
    if (!it.title) continue;
    const k = keyOf(it);
    if (map.has(k)) {
      map.set(k, { ...map.get(k), ...it, fresh: false }); // refresh fields, keep first-seen time
    } else {
      map.set(k, { ...it, fetchedAt: NOW.toISOString(), fresh: true });
    }
  }
  // newest first (this run's fresh items float to the top), then cap
  return [...map.values()]
    .sort((a, b) => (b.fresh - a.fresh) || (Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt)))
    .slice(0, MAX_PER_SECTION);
}

async function main() {
  let prev = { sections: [] };
  try { prev = JSON.parse(await readFile(new URL("./data.json", import.meta.url))); } catch { /* first run */ }
  const prevById = Object.fromEntries((prev.sections || []).map((s) => [s.id, s]));

  const out = { generatedAt: NOW.toISOString(), retainDays: RETAIN_DAYS, sections: [] };

  for (const section of SECTIONS) {
    const previous = prevById[section.id]?.items || [];
    try {
      const fresh = await pullSection(section);
      const merged = mergeSection(previous, fresh);
      out.sections.push({ id: section.id, label: section.label, desc: section.desc, items: merged });
      const n = merged.filter((i) => i.fresh).length;
      console.log(`\u2713 ${section.label}: +${n} new, ${merged.length} in window`);
    } catch (err) {
      const kept = previous.filter((i) => (Date.parse(i.fetchedAt) || 0) >= cutoff).map((i) => ({ ...i, fresh: false }));
      out.sections.push({ id: section.id, label: section.label, desc: section.desc, items: kept });
      console.error(`\u2717 ${section.label}: ${err.message} \u2014 kept ${kept.length} archived`);
    }
  }

  await writeFile(new URL("./data.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log(`\nWrote data.json at ${out.generatedAt}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
