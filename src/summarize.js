// 用 Claude 把一則 IG 貼文濃縮成簡短中文摘要。
// 需要：環境變數 ANTHROPIC_API_KEY（沒有的話會略過摘要，仍會存圖片與文字）
// 模型：claude-opus-4-8（要更省錢可改成 claude-haiku-4-5）
const MODEL = "claude-opus-4-8";

const SYSTEM =
  "你是社群小編助理。把一則 Instagram 貼文濃縮成 2–3 句繁體中文摘要，明確點出：" +
  "(1) 這是什麼（活動／展覽／市集／咖啡廳）；" +
  "(2) 若文中有時間、地點、價格、報名方式就寫出來；" +
  "(3) 適不適合約會、為什麼。" +
  "沒有提到的資訊不要編造。只輸出摘要本身，不要任何前言或說明。";

async function summarize(post, category, key) {
  if (!key) return "（未設定 ANTHROPIC_API_KEY，略過 AI 摘要）";

  const body = {
    model: MODEL,
    max_tokens: 350,
    output_config: { effort: "low" },   // 摘要任務用低 effort 控制成本
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `帳號分類：${category || "未分類"}\n貼文內容：\n${(post.caption || "（這則貼文沒有文字）").slice(0, 4000)}`,
    }],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || ("HTTP " + res.status));
  if (data.stop_reason === "refusal") return "（模型基於安全原因未提供摘要）";
  const textBlock = (data.content || []).find(b => b.type === "text");
  return textBlock ? textBlock.text.trim() : "（無摘要）";
}

module.exports = { summarize, MODEL };
