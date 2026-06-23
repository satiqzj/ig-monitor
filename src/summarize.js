// 用 AI 把一則 IG 貼文濃縮成簡短中文摘要（泰文/英文也會幫你看懂）。
// 可換引擎，依環境變數自動選（由上到下，設了哪個就用哪個）：
//   GROQ_API_KEY        → Groq（免費、全球可用）
//   GEMINI_API_KEY      → Google Gemini（有免費額度，但部分地區/帳號為 0）
//   ANTHROPIC_API_KEY   → Claude（claude-opus-4-8，付費）
//   GITHUB_MODELS_TOKEN / GITHUB_TOKEN → GitHub Models（免費，在 GitHub Actions 內建可用，免額外註冊）
//   都沒有              → 跳過摘要，仍會存圖片與文字
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_MODEL = "gemini-2.0-flash";
const CLAUDE_MODEL = "claude-opus-4-8";
const GITHUB_MODEL = "openai/gpt-4o-mini";

const SYSTEM =
  "你是社群小編助理。把一則 Instagram 貼文濃縮成 2–3 句繁體中文摘要，明確點出：" +
  "(1) 這是什麼（活動／展覽／市集／咖啡廳）；" +
  "(2) 若文中有時間、地點、價格、報名方式就寫出來；" +
  "(3) 適不適合約會、為什麼。" +
  "若貼文是泰文或英文，請直接用中文摘要其內容。" +
  "沒有提到的資訊不要編造。只輸出摘要本身，不要任何前言或說明。";

function buildPrompt(post, category) {
  return `帳號分類：${category || "未分類"}\n貼文內容：\n${(post.caption || "（這則貼文沒有文字）").slice(0, 4000)}`;
}

// 共用：OpenAI 相容的 chat/completions（Groq、GitHub Models 都用這個格式）
async function chatCompletions(url, token, model, post, category) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildPrompt(post, category) },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const m = data.error && (data.error.message || data.error);
    throw new Error(m || ("HTTP " + res.status));
  }
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return (text || "").trim() || "（無摘要）";
}

const viaGroq = (post, category, key) =>
  chatCompletions("https://api.groq.com/openai/v1/chat/completions", key, GROQ_MODEL, post, category);

const viaGithubModels = (post, category, token) =>
  chatCompletions("https://models.github.ai/inference/chat/completions", token, GITHUB_MODEL, post, category);

// Google Gemini
async function viaGemini(post, category, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ parts: [{ text: buildPrompt(post, category) }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.4 },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || ("HTTP " + res.status));
  const cand = data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  const text = parts ? parts.map(p => p.text || "").join("").trim() : "";
  return text || "（無摘要）";
}

// Anthropic Claude（付費）
async function viaClaude(post, category, key) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 350,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(post, category) }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || ("HTTP " + res.status));
  if (data.stop_reason === "refusal") return "（模型基於安全原因未提供摘要）";
  const textBlock = (data.content || []).find(b => b.type === "text");
  return textBlock ? textBlock.text.trim() : "（無摘要）";
}

async function summarize(post, category) {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const ghToken = process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN;
  if (groqKey) return viaGroq(post, category, groqKey);
  if (geminiKey) return viaGemini(post, category, geminiKey);
  if (anthropicKey) return viaClaude(post, category, anthropicKey);
  if (ghToken) return viaGithubModels(post, category, ghToken);
  return "（未設定 AI 金鑰（GROQ / GEMINI / ANTHROPIC / GitHub Models 皆無），略過 AI 摘要）";
}

module.exports = { summarize, GROQ_MODEL, GEMINI_MODEL, CLAUDE_MODEL, GITHUB_MODEL };
