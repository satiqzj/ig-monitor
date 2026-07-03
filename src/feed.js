// 產生 feed.json：把目前抓到的貼文整理成一份扁平清單，給「約會地圖」app 讀取。
// 放在 repo 根目錄，可用 raw.githubusercontent.com 直接抓。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const FEED_FILE = path.join(ROOT, "feed.json");

function buildFeed(catByHandle = {}, limit = 60) {
  const today = new Date().toISOString().slice(0, 10);   // 用來過濾過期活動
  const items = [];
  if (fs.existsSync(DATA)) {
    for (const handle of fs.readdirSync(DATA)) {
      const hdir = path.join(DATA, handle);
      if (!fs.statSync(hdir).isDirectory()) continue;
      for (const short of fs.readdirSync(hdir)) {
        const pj = path.join(hdir, short, "post.json");
        if (!fs.existsSync(pj)) continue;
        let meta;
        try { meta = JSON.parse(fs.readFileSync(pj, "utf8")); } catch (_) { continue; }
        // 過期活動（有結束日期且已過）就不放進 feed
        if (meta.end_date && meta.end_date < today) continue;
        let caption = "";
        try { caption = fs.readFileSync(path.join(hdir, short, "caption.txt"), "utf8"); } catch (_) {}
        items.push({
          handle,
          category: catByHandle[handle] || meta.category || "",
          place: meta.place || "",
          vibe_tags: meta.vibe_tags || [],
          date_score: meta.date_score != null ? meta.date_score : null,
          end_date: meta.end_date || null,
          summary: meta.summary || "",
          caption: (caption || "").replace(/\s+/g, " ").slice(0, 200),
          image: (meta.images && meta.images[0]) || "",   // repo 相對路徑
          postUrl: meta.postUrl || "",
          timestamp: meta.timestamp || "",
        });
      }
    }
  }
  items.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const feed = items.slice(0, limit);
  fs.writeFileSync(FEED_FILE, JSON.stringify(feed, null, 2), "utf8");
  return feed.length;
}

module.exports = { buildFeed };
