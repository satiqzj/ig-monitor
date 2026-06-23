// 每日檢查：抓追蹤帳號的最新貼文 → 找出沒看過的 → 存圖片 + 文字 + AI 摘要 → 寫成當天彙整。
//
// 執行：node src/check.js
// 需要環境變數：APIFY_TOKEN（必要）、ANTHROPIC_API_KEY（選填，缺少則略過摘要）
//
// 產出（會進版控，讓 GitHub Actions commit）：
//   data/<帳號>/<貼文代碼>/  image_N.jpg、caption.txt、post.json
//   digests/YYYY-MM-DD.md     當天所有新貼文的彙整
//   state.json                記住每個帳號看過哪些貼文（避免重複處理）
const fs = require("fs");
const path = require("path");
const { fetchRecentPosts } = require("./fetchInstagram");
const { summarize } = require("./summarize");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const DIGESTS = path.join(ROOT, "digests");
const STATE_FILE = path.join(ROOT, "state.json");
const ACCOUNTS_FILE = path.join(ROOT, "accounts.json");

const PER_ACCOUNT = 12;          // 每次每帳號抓最近幾則來比對
const MAX_NEW_PER_ACCOUNT = 5;   // 每次每帳號最多「處理」幾則新貼文；其餘只標記為已看，避免首次跑爆量

function loadJson(file, dflt) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return dflt; }
}
function ymd(d = new Date()) { return d.toISOString().slice(0, 10); }
function sanitize(s) { return (s || "").replace(/[^a-zA-Z0-9_-]/g, "_"); }

async function downloadImage(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("下載失敗 " + res.status);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const apifyToken = process.env.APIFY_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const accounts = loadJson(ACCOUNTS_FILE, []);
  if (!accounts.length) {
    console.error("accounts.json 是空的，請先填入要追蹤的帳號。");
    process.exit(1);
  }
  const handles = accounts.map(a => a.handle.replace(/^@/, ""));
  const catByHandle = Object.fromEntries(accounts.map(a => [a.handle.replace(/^@/, ""), a.category || ""]));
  const state = loadJson(STATE_FILE, {});

  console.log(`抓取 ${handles.length} 個帳號最近 ${PER_ACCOUNT} 則貼文…`);
  const posts = await fetchRecentPosts(handles, { token: apifyToken, perAccount: PER_ACCOUNT });

  const byHandle = {};
  for (const p of posts) (byHandle[p.handle] = byHandle[p.handle] || []).push(p);

  const digestEntries = [];
  let totalNew = 0;

  for (const handle of handles) {
    const seen = new Set((state[handle] && state[handle].seen) || []);
    const isFirstRun = !state[handle];
    const list = (byHandle[handle] || []).sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    const fresh = list.filter(p => !seen.has(p.shortCode));
    const toProcess = fresh.slice(0, MAX_NEW_PER_ACCOUNT);
    const toSkip = fresh.slice(MAX_NEW_PER_ACCOUNT);

    if (!byHandle[handle]) console.warn(`  ⚠ 抓不到 @${handle} 的貼文（帳號名是否正確？是否為私人帳號？）`);

    for (const post of toProcess) {
      const dir = path.join(DATA, sanitize(handle), sanitize(post.shortCode));
      fs.mkdirSync(dir, { recursive: true });

      // 1) 存文字
      fs.writeFileSync(path.join(dir, "caption.txt"), post.caption || "", "utf8");

      // 2) 存圖片
      const savedImgs = [];
      for (let i = 0; i < post.images.length && i < 10; i++) {
        const fn = `image_${i + 1}.jpg`;
        try {
          await downloadImage(post.images[i], path.join(dir, fn));
          savedImgs.push(`data/${sanitize(handle)}/${sanitize(post.shortCode)}/${fn}`);
        } catch (e) {
          console.warn(`  圖片略過 ${handle}/${post.shortCode}#${i}：${e.message}`);
        }
      }

      // 3) AI 摘要
      let summary;
      try { summary = await summarize(post, catByHandle[handle], anthropicKey); }
      catch (e) { summary = "（摘要失敗：" + e.message + "）"; }

      // 4) 存 metadata
      fs.writeFileSync(path.join(dir, "post.json"), JSON.stringify({
        handle, category: catByHandle[handle], shortCode: post.shortCode,
        postUrl: post.postUrl, timestamp: post.timestamp, type: post.type,
        images: savedImgs, summary,
      }, null, 2), "utf8");

      digestEntries.push({ handle, category: catByHandle[handle], post, summary, savedImgs });
      seen.add(post.shortCode);
      totalNew++;
      console.log(`  ✔ @${handle} 新貼文 ${post.shortCode}`);
    }

    // 沒處理到的也標記為已看，下次才不會又被當成新貼文回填
    for (const p of toSkip) seen.add(p.shortCode);
    if (isFirstRun && toSkip.length) console.log(`  （首次執行：@${handle} 另有 ${toSkip.length} 則舊貼文已標記為已看）`);

    state[handle] = { seen: [...seen].slice(-500), lastRun: new Date().toISOString() };
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");

  if (totalNew) {
    fs.mkdirSync(DIGESTS, { recursive: true });
    const file = path.join(DIGESTS, ymd() + ".md");
    let md = fs.existsSync(file) ? fs.readFileSync(file, "utf8") + "\n" : `# 📸 ${ymd()} IG 新貼文彙整\n\n`;
    for (const e of digestEntries) {
      const cap = (e.post.caption || "").replace(/\s+/g, " ").slice(0, 140);
      md += `## @${e.handle} · ${e.category}\n\n`;
      md += `**AI 摘要：** ${e.summary}\n\n`;
      if (e.savedImgs.length) md += `![貼文圖片](../${e.savedImgs[0]})\n\n`;
      if (cap) md += `> ${cap}${cap.length >= 140 ? "…" : ""}\n\n`;
      md += `🔗 ${e.post.postUrl}\n\n---\n\n`;
    }
    fs.writeFileSync(file, md, "utf8");
    console.log(`\n完成：${totalNew} 則新貼文，已寫入 ${path.relative(ROOT, file)}`);
  } else {
    console.log("\n完成：今天沒有新貼文。");
  }
}

main().catch(e => { console.error("執行失敗：", e.message); process.exit(1); });
