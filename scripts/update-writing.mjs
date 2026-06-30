#!/usr/bin/env node
/**
 * Refresh the "from the handbook" block in README.md with the latest writing
 * from blog.cjoga.cloud.
 *
 * The handbook is a docs-only Docusaurus site (no RSS feed), but its source
 * lives in the public `cjoga-portfolio` repo. So we read the docs' frontmatter
 * directly via the GitHub API — the leaf docs carry `title`, `slug`, and
 * `date: "YYYY-MM-DD"` — sort by date, and render the latest few between the
 * <!-- WRITING:START --> / <!-- WRITING:END --> markers.
 *
 * Frontmatter parsing mirrors scripts/brand/build-doc-og.mjs in cjoga-portfolio.
 *
 * Usage: node scripts/update-writing.mjs    (set GITHUB_TOKEN to lift rate limits)
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const README = join(__dirname, "..", "README.md");

const OWNER = "Camilool8";
const REPO = "cjoga-portfolio";
const REF = "main";
const SITE = "https://blog.cjoga.cloud";
const SOURCES = [
  { dir: "blog-site/docs/me/opinions", category: "opinion" },
  { dir: "blog-site/docs/learn", category: "guide" },
];
const MAX = 5;
const START = "<!-- WRITING:START -->";
const END = "<!-- WRITING:END -->";

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Camilool8-profile-updater",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function gh(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res.json();
}

// Lightweight frontmatter reader: `key: value`, quote-stripped. Enough for
// title/slug/date — same approach as the brand:og generator.
function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return {};
  const data = {};
  for (const line of raw.slice(3, end).split("\n")) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    data[m[1]] = v;
  }
  return data;
}

async function collect({ dir, category }) {
  const entries = await gh(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${dir}?ref=${REF}`,
  );
  const out = [];
  for (const e of entries) {
    if (e.type !== "file" || !/\.(mdx|md)$/.test(e.name) || /^index\./.test(e.name)) continue;
    const raw = await (await fetch(e.download_url, { headers })).text();
    const fm = parseFrontmatter(raw);
    if (!fm.title || !fm.slug || !fm.date) continue;
    out.push({ title: fm.title, slug: fm.slug, date: fm.date, category });
  }
  return out;
}

const byDate = (a, b) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title);

const all = (await Promise.all(SOURCES.map(collect))).flat().sort(byDate);
const latest = all.slice(0, MAX);

// Keep the section honest to its intro ("opinions and the cert guides"): if a
// guide exists but none landed in the latest set, surface the newest one in the
// last slot. As more guides are written with recent dates, they sort in on merit.
const newestGuide = all.find((w) => w.category === "guide");
if (newestGuide && !latest.some((w) => w.category === "guide")) {
  latest[latest.length - 1] = newestGuide;
}

if (latest.length === 0) throw new Error("no handbook docs found — refusing to empty the section");

const lines = latest.map((w) => {
  const url = `${SITE}${w.slug.startsWith("/") ? "" : "/"}${w.slug}`;
  return `- **[${w.title}](${url})** &nbsp;·&nbsp; _${w.category}_ &nbsp;·&nbsp; ${w.date}`;
});
const block = `${START}\n${lines.join("\n")}\n${END}`;

const readme = await readFile(README, "utf8");
const re = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!re.test(readme)) throw new Error("WRITING markers not found in README.md");

const next = readme.replace(re, block);
if (next !== readme) {
  await writeFile(README, next);
  console.log(`Updated "from the handbook" with ${latest.length} entries.`);
} else {
  console.log("No change — writing section already current.");
}
