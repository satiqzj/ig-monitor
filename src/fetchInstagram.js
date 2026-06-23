// 透過 Apify 的 Instagram Scraper 取得帳號最近的貼文。
// 用 Apify 的好處：它用自己的基礎設施抓，不需要你的 IG 帳號登入 → 你的帳號沒有被封的風險。
//
// 需要：環境變數 APIFY_TOKEN（到 https://apify.com 註冊後在 Settings → Integrations 取得）
// Actor：apify/instagram-scraper
// 文件：https://apify.com/apify/instagram-scraper

const ACTOR = "apify~instagram-scraper";

// 把 Apify 回傳的原始 item 正規化成我們要用的欄位
function normalize(it) {
  const handle =
    it.ownerUsername ||
    (it.inputUrl || "").replace(/^https?:\/\/www\.instagram\.com\//, "").replace(/\/.*/, "");
  const images = [];
  if (Array.isArray(it.images) && it.images.length) images.push(...it.images);
  else if (it.displayUrl) images.push(it.displayUrl);
  return {
    handle,
    shortCode: it.shortCode || "",
    type: it.type || "",
    caption: it.caption || "",
    timestamp: it.timestamp || "",        // ISO 8601
    postUrl: it.url || (it.shortCode ? `https://www.instagram.com/p/${it.shortCode}/` : ""),
    images,
  };
}

// handles：不含 @ 的帳號名陣列；perAccount：每個帳號抓最近幾則
async function fetchRecentPosts(handles, { token, perAccount = 12 }) {
  if (!token) throw new Error("缺少 APIFY_TOKEN（請設定環境變數或 GitHub Secret）");

  const input = {
    directUrls: handles.map(h => `https://www.instagram.com/${h.replace(/^@/, "")}/`),
    resultsType: "posts",
    resultsLimit: perAccount,
    addParentData: false,
  };

  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Apify ${res.status}：${t.slice(0, 300)}`);
  }
  const items = await res.json();
  return (Array.isArray(items) ? items : []).map(normalize).filter(p => p.shortCode);
}

module.exports = { fetchRecentPosts };
