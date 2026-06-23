# 📸 IG 每日新貼文監看器

每天自動檢查你追蹤的 Instagram 帳號（曼谷展覽／咖啡廳／市集等）有沒有**新貼文**，有的話就：

1. **存圖片** → `data/<帳號>/<貼文代碼>/image_N.jpg`
2. **存文字** → 同資料夾的 `caption.txt`
3. **AI 摘要** → 用 Claude 濃縮成 2–3 句，點出「是什麼活動／時間地點／適不適合約會」
4. 把當天所有新貼文整理成一份彙整 → `digests/YYYY-MM-DD.md`

全程跑在 **GitHub Actions** 雲端，結果自動 commit 回 repo，你不用開電腦。

## 為什麼用 Apify？

讀取「別人的」公開 IG 帳號沒有官方 API。本工具透過 [Apify](https://apify.com) 的 Instagram Scraper 抓資料 —— 它用自己的基礎設施執行，**不需要你的 IG 帳號登入，所以你的帳號沒有被封的風險**。Apify 有免費額度（約 $5/月 credit），5 個帳號每天各抓十幾則的用量很小。

## 設定步驟

### 1. 填入要追蹤的帳號
編輯 [accounts.json](accounts.json)，把 `handle` 換成你實際追蹤的帳號名（不含 `@`），最多放你的 5 個：

```json
[
  { "handle": "實際的帳號名", "category": "展覽" },
  { "handle": "實際的帳號名", "category": "咖啡廳" },
  { "handle": "實際的帳號名", "category": "市集" }
]
```

### 2. 取得金鑰
- **Apify token**（必要）：到 https://apify.com 註冊 → Settings → Integrations → 複製 API token。
- **AI 摘要金鑰**（選填，擇一）：
  - **Groq（免費、全球可用、不挑地區，推薦）**：https://console.groq.com → API Keys → Create（不需信用卡）。
  - **Gemini（有免費額度，但部分地區/帳號為 0）**：https://aistudio.google.com/apikey。
  - **Anthropic（付費）**：https://console.anthropic.com/settings/keys。
  - 都沒設，仍會存圖片與文字，只是略過 AI 摘要。

### 3. 推上 GitHub 並設定 Secrets
把這個資料夾推成一個 GitHub repo，然後到 repo 的 **Settings → Secrets and variables → Actions** 新增：
- `APIFY_TOKEN`（必要）
- `GROQ_API_KEY`（免費摘要，推薦）／ `GEMINI_API_KEY` ／ `ANTHROPIC_API_KEY`（付費）—— 擇一即可

### 4. 啟用排程
[.github/workflows/daily.yml](.github/workflows/daily.yml) 已設定每天 **曼谷時間 08:00**（UTC 01:00）自動執行。
想立刻測試：到 repo 的 **Actions → Daily IG digest → Run workflow** 手動觸發一次。

## 本機執行（測試用）

```bash
# Git Bash / macOS / Linux
export APIFY_TOKEN=apify_api_xxx
export ANTHROPIC_API_KEY=sk-ant-xxx   # 選填
node src/check.js
```

```powershell
# PowerShell
$env:APIFY_TOKEN="apify_api_xxx"
$env:ANTHROPIC_API_KEY="sk-ant-xxx"   # 選填
node src/check.js
```

## 運作細節

- **怎麼判斷「新」**：`state.json` 記住每個帳號處理過的貼文代碼（shortCode）；只處理沒看過的，所以重跑不會重複。
- **首次執行**：每個帳號最多處理最近 5 則（`MAX_NEW_PER_ACCOUNT`），其餘舊貼文直接標記為已看，避免一次回填太多、消耗大量 Apify／Claude 額度。之後每天只會處理真正的新貼文。
- **摘要引擎（自動選，由上到下）**：`GROQ_API_KEY`（`llama-3.3-70b-versatile`，免費）→ `GEMINI_API_KEY`（`gemini-2.0-flash`）→ `ANTHROPIC_API_KEY`（`claude-opus-4-8`）→ 都沒有就跳過。可在 [src/summarize.js](src/summarize.js) 調整。
- **補舊貼文摘要**：之前沒設金鑰、摘要被跳過時，設好金鑰後到 **Actions → Re-summarize → Run workflow**（或本機 `node src/resummarize.js`），會用已存下來的文字免費補摘要，不重抓 IG。
- **產出都會進版控**：`data/`、`digests/`、`state.json` 由 Actions 自動 commit，你在 GitHub 上就能直接看每天的彙整。

## 與「約會地圖」搭配

這裡產生的 `digests/*.md` 摘要，可以直接複製貼到隔壁的「約會地圖」App，分析約會適合度並排路線。
