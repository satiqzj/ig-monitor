// 讀一則 IG 貼文，產出結構化分析：{ place, vibe_tags, date_score, summary }。
// 可換引擎，依環境變數自動選（由上到下，設了哪個就用哪個）：
//   GROQ_API_KEY        → Groq（免費、全球可用）
//   GEMINI_API_KEY      → Google Gemini（有免費額度，但部分地區/帳號為 0）
//   ANTHROPIC_API_KEY   → Claude（claude-opus-4-8，付費）
//   GITHUB_MODELS_TOKEN / GITHUB_TOKEN → GitHub Models（免費，GitHub Actions 內建，免額外註冊）
//   都沒有              → 跳過分析
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_MODEL = "gemini-2.0-flash";
const CLAUDE_MODEL = "claude-opus-4-8";
const GITHUB_MODEL = "openai/gpt-4o-mini";

const SYSTEM =
  "你是約會地點分析助理。讀一則 Instagram 貼文，輸出「一個 JSON 物件」，欄位如下：\n" +
  "place：這個地點／店家／活動的名稱；若貼文沒有明確名稱，用簡短描述（例如「曼谷河濱文青市集」）。\n" +
  "vibe_tags：2–4 個中文風格標籤的陣列（例如 文青、浪漫、戶外、熱鬧、靜謐）。\n" +
  "date_score：1–10 的整數，代表約會適合度（10 最適合）。\n" +
  "summary：2–3 句繁體中文摘要，點出這是什麼、若有時間/地點/價格就寫出來、適不適合約會。\n" +
  "貼文是泰文或英文時，一律用中文。沒提到的資訊不要編造。只輸出 JSON，不要 markdown 圍欄或多餘文字。";

function buildPrompt(post, category) {
  return `帳號分類：${category || "未分類"}\n貼文內容：\n${(post.caption || "（這則貼文沒有文字）").slice(0, 4000)}`;
}

// 把模型回傳的文字解析成結構化物件（容錯：去掉 ``` 圍欄、解析失敗就退回純摘要）
function parseStructured(text) {
  const raw = (text || "").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const o = JSON.parse(cleaned);
    return {
      place: (o.place || "").toString().trim(),
      vibe_tags: Array.isArray(o.vibe_tags) ? o.vibe_tags.map(String).slice(0, 5) : [],
      date_score: Number.isFinite(+o.date_score) ? Math.round(+o.date_score) : null,
      summary: (o.summary || "").toString().trim() || "（無摘要）",
    };
  } catch (_) {
    return { place: "", vibe_tags: [], date_score: null, summary: raw || "（無摘要）" };
  }
}

// OpenAI 相容格式（Groq、GitHub Models 共用）
async function chatCompletions(url, token, model, post, category) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildPrompt(post, category) },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && (data.error.message || data.error)) || ("HTTP " + res.status));
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return text || "";
}

const groqText = (post, category, key) =>
  chatCompletions("https://api.groq.com/openai/v1/chat/completions", key, GROQ_MODEL, post, category);

const githubText = (post, category, token) =>
  chatCompletions("https://models.github.ai/inference/chat/completions", token, GITHUB_MODEL, post, category);

async function geminiText(post, category, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ parts: [{ text: buildPrompt(post, category) }] }],
      generationConfig: { maxOutputTokens: 600, temperature: 0.4, responseMimeType: "application/json" },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || ("HTTP " + res.status));
  const cand = data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  return parts ? parts.map(p => p.text || "").join("") : "";
}

async function claudeText(post, category, key) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(post, category) }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || ("HTTP " + res.status));
  if (data.stop_reason === "refusal") return '{"summary":"（模型基於安全原因未提供摘要）"}';
  const textBlock = (data.content || []).find(b => b.type === "text");
  return textBlock ? textBlock.text : "";
}

// 回傳 { place, vibe_tags, date_score, summary }
async function summarize(post, category) {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const ghToken = process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN;

  let text;
  if (groqKey) text = await groqText(post, category, groqKey);
  else if (geminiKey) text = await geminiText(post, category, geminiKey);
  else if (anthropicKey) text = await claudeText(post, category, anthropicKey);
  else if (ghToken) text = await githubText(post, category, ghToken);
  else return { place: "", vibe_tags: [], date_score: null, summary: "（未設定 AI 金鑰，略過分析）" };

  return parseStructured(text);
}

module.exports = { summarize, GROQ_MODEL, GEMINI_MODEL, CLAUDE_MODEL, GITHUB_MODEL };
