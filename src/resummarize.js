// 補摘要工具（一次性）：用「已經存下來的文字」重新產生摘要，不重抓 IG（不花 Apify 額度）。
// 用途：之前沒設 AI 金鑰、摘要被跳過時，設好金鑰後跑這支把舊貼文補上中文摘要。
//
// 執行：node src/resummarize.js
// 需要：GEMINI_API_KEY（免費，推薦）或 ANTHROPIC_API_KEY
//
// 作用：掃 data/ 下所有 post.json，凡是摘要為「跳過/失敗/無」的就重做，
//       更新該則 post.json，並重建今天的 digests/YYYY-MM-DD.md。
const fs = require("fs");
const path = require("path");
const { summarize } = require("./summarize");
const { buildFeed } = require("./feed");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const DIGESTS = path.join(ROOT, "digests");
const ACCOUNTS_FILE = path.join(ROOT, "accounts.json");

const sleep = ms => new Promise(r => setTimeout(r, ms));
function ymd(d = new Date()) { return d.toISOString().slice(0, 10); }
function loadJson(f, d) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return d; } }
function readCaption(dir) { try { return fs.readFileSync(path.join(dir, "caption.txt"), "utf8"); } catch (_) { return ""; } }
function needsSummary(s) {
  return !s || s.startsWith("（未設定") || s.startsWith("（摘要失敗") || s.startsWith("（無摘要");
}

async function main() {
  const hasEngine = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY ||
    process.env.ANTHROPIC_API_KEY || process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN;
  if (!hasEngine) {
    console.error("沒有可用的摘要引擎（GROQ / GEMINI / ANTHROPIC / GitHub Models 皆未設定）。");
    process.exit(1);
  }
  if (!fs.existsSync(DATA)) { console.error("找不到 data/ 資料夾，還沒有抓過貼文。"); process.exit(1); }

  const accounts = loadJson(ACCOUNTS_FILE, []);
  const catByHandle = Object.fromEntries(accounts.map(a => [a.handle.replace(/^@/, ""), a.category || ""]));

  const entries = [];
  let updated = 0;

  for (const handle of fs.readdirSync(DATA)) {
    const hdir = path.join(DATA, handle);
    if (!fs.statSync(hdir).isDirectory()) continue;
    for (const short of fs.readdirSync(hdir)) {
      const dir = path.join(hdir, short);
      const pjPath = path.join(dir, "post.json");
      if (!fs.existsSync(pjPath)) continue;
      const meta = loadJson(pjPath, null);
      if (!meta) continue;
      const caption = readCaption(dir);
      const category = catByHandle[handle] || meta.category || "";

      if (needsSummary(meta.summary)) {
        let ai;
        try { ai = await summarize({ caption }, category); }
        catch (e) { ai = { place: "", vibe_tags: [], date_score: null, summary: "（分析失敗：" + e.message + "）" }; }
        meta.place = ai.place; meta.vibe_tags = ai.vibe_tags; meta.date_score = ai.date_score; meta.summary = ai.summary;
        fs.writeFileSync(pjPath, JSON.stringify(meta, null, 2), "utf8");
        updated++;
        console.log(`  ✔ @${handle}/${short}`);
        await sleep(1500);   // 節流，避免一次打太多被限流
      }
      entries.push({ handle, category, meta, caption });
    }
  }

  // 重建今天的彙整（把目前所有貼文依時間排序寫入）
  fs.mkdirSync(DIGESTS, { recursive: true });
  const file = path.join(DIGESTS, ymd() + ".md");
  entries.sort((a, b) => (b.meta.timestamp || "").localeCompare(a.meta.timestamp || ""));
  let md = `# 📸 ${ymd()} IG 新貼文彙整（已補摘要）\n\n`;
  for (const e of entries) {
    const cap = (e.caption || "").replace(/\s+/g, " ").slice(0, 140);
    const tags = (e.meta.vibe_tags || []).join("、");
    md += `## @${e.handle} · ${e.category}\n\n`;
    if (e.meta.place) md += `**地點：** ${e.meta.place}　`;
    if (e.meta.date_score != null) md += `**約會指數：** ${e.meta.date_score}/10　`;
    if (tags) md += `**風格：** ${tags}`;
    md += `\n\n**摘要：** ${e.meta.summary}\n\n`;
    if (e.meta.images && e.meta.images.length) md += `![貼文圖片](../${e.meta.images[0]})\n\n`;
    if (cap) md += `> ${cap}${cap.length >= 140 ? "…" : ""}\n\n`;
    md += `🔗 ${e.meta.postUrl}\n\n---\n\n`;
  }
  fs.writeFileSync(file, md, "utf8");
  buildFeed(catByHandle);   // 更新給「約會地圖」app 讀的 feed.json
  console.log(`\n完成：補了 ${updated} 則摘要，已重建 ${path.relative(ROOT, file)}`);
}

main().catch(e => { console.error("執行失敗：", e.message); process.exit(1); });
