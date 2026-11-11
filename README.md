# Personal Resource Hub

**English** · [简体中文](README.zh-CN.md)

A self-hosted personal resource hub and study assistant that runs on your own computer. Drop in files and folders — they are classified by topic and type automatically, and you can browse them from your phone over the same Wi-Fi. Optionally plug in any OpenAI-compatible model to get file Q&A, AI-generated flashcards, mistake analysis, and study planning.

Built with Node.js + Express and plain ES Modules — no build step, no framework, no cloud dependency. Designed for students and self-learners who want their own material library, spaced-repetition cards, and exam preparation in one place.

## Features

### Resource library

- Drag & drop files or whole folders; automatic classification by **topic + type (7 kinds)** and automatic tags (notes, slides, homework, past papers, year, chapter…)
- Grid and list views, topic overview, favorites, recent files, search and filters
- Web link collecting: desktop bookmarklet, iPhone Shortcuts for Bilibili / Xiaohongshu / WeChat / Instagram, with title, summary and cover fetched automatically
- **Batch actions** on the home page and inside the private vault: multi-select, favorite, move topic, tag, hide, delete

### Private vault

- Opens with its own password; the interface mirrors the main library
- Global search can find vault items, but opening one requires the password
- Content is shown unobscured once unlocked

### AI assistant (`/orbit.html`)

- On the home page as a floating orb and in the sidebar
- Chats about study *and* everyday things
- Reads your actual files to answer questions (text, PDF, Word, PPT, Excel, images — up to 3 files)
- Proactive suggestions based on your materials and exams, rotating continuously
- Optional: auto-summary after upload, AI auto-classification, AI-filled file type

### Flashcards (`/cards.html`)

- Anki-style Q&A cards: AI card generation from notes, manual editing, deck filtering
- Card review: press space to flip, `1/2/3` for again / hard / good, intervals grow with familiarity
- **History timeline** (`/history.html`): grouped by year, filterable by era/unit, flip-card review for dates and events

### Exam center (`/exam.html`)

- Countdown, plan completion, per-subject score rates, total-score trend, weak-subject priority
- Automatic study plan: tasks only on weekends and holidays, weaker subjects get more slots, timed mock papers near the exam
- Score records and per-subject analysis
- **Mistake notebook**: photograph a page, the AI extracts each question, keeps only the wrong ones, and returns answers, error causes, advice, and knowledge points
- **Mistake flashcard review**: full-screen flip cards, `1/2/3` grading writes back to "to review / mastered", forgotten cards are re-queued

### Mobile & offline

- Usable on iPhone over the same Wi-Fi; add to home screen and it behaves like an app
- PWA / Service Worker offline cache (requires HTTPS — Tailscale works well)
- Browse the index and cached files while the computer is off; new links and photos go into an on-device queue and sync later

## Quick start

1. Install [Node.js](https://nodejs.org/) (18+, 20/22/24 recommended)
2. Run `启动资源站.bat` on Windows, or:

```bash
npm install
npm start
```

3. The terminal prints the desktop URL, the LAN URL for your phone, and a QR code:

```
Desktop   http://localhost:5178
Phone     http://192.168.x.x:5178
```

Open the desktop URL in a browser. Folders are created automatically under `data/`.

### Phone access

1. Connect the phone to the same Wi-Fi as the computer
2. Scan the QR code, or type the LAN URL
3. On iPhone: Share → Add to Home Screen

If it does not load: allow the app in the Windows firewall prompt (private network), confirm both devices are on the same Wi-Fi, and check whether the computer's IP changed after a restart.

> The server has no built-in authentication — anyone on the same network can open it. Do not use it on public or shared Wi-Fi; put private files in the vault.

### Run it on an Android tablet (Termux)

The server can also live entirely on the tablet, without a computer:

```bash
pkg install -y git
git clone https://github.com/luobutu19-rgb/personal-resource-hub.git ~/personal-resource-hub
cd ~/personal-resource-hub
bash scripts/termux-install.sh
```

Then open `http://localhost:5178` on the tablet, or `http://<tablet-ip>:5178` from other devices on the same Wi-Fi. Run `termux-wake-lock` and disable battery optimization for Termux to keep it alive. Requires Termux from F-Droid (not the Play Store build).

## How classification works

- **Type (7)**: image, document, video, audio, archive, code, other — determined by extension
- **Topic** (priority order): first-level folder name → filename keyword rules → "Uncategorized" (editable)
- **Tags**: usage keywords, years, and chapters parsed from the filename

To customize the vocabulary, edit `TOPIC_RULES` and `TAG_RULES` at the top of `server/classifier.js` and restart.

## Optional AI integration

Disabled by default; everything works without it. Open Settings in the top-right corner and provide:

- Base URL: any OpenAI-compatible endpoint, e.g. `https://api.deepseek.com`
- Model: e.g. `deepseek-chat`, `gpt-4o-mini`
- API key — stored locally in `data/settings.json` only

With AI enabled you get: file summaries, web page summaries, AI organization (topic/type/rename), topic summaries, natural-language focus search (`Ctrl / ⌘ + K`), file-aware assistant answers, photo-based mistake analysis, automatic card generation, and auto-classification on upload.

Note: text excerpts and file listings are sent to the AI provider you configure. Videos and audio are not summarized. When AI is unavailable, focus search falls back to local keyword matching.

## Project structure

```
server/          Express server, classifier, upload, AI, exams/mistakes, storage
public/          Pages, styles, ES modules, icons, service worker
data/            Your files and runtime data (git-ignored, never committed)
启动资源站.bat   One-click launcher for Windows
```

Data lives in `data/`:

```
data/
├─ db.json            file index
├─ settings.json      AI settings and vault credentials
├─ cards.json         flashcards
├─ exams.json         exam plans and scores
├─ mistakes.json      mistake notebook
├─ history.json       timeline events
└─ files/             your actual files
```

Back up by copying `data/`. Restore by putting it back and restarting.

## Privacy

- All files and data stay on your machine under `data/`, which is excluded via `.gitignore`
- The AI API key is stored only in `data/settings.json`; never share that folder
- Vault passwords are stored as salted hashes, never in plain text
- Use it on a trusted home network or inside a VPN mesh such as Tailscale; add your own reverse proxy and auth before exposing it to the internet

## Tech stack

- Backend: Node.js 18+, Express 5, Multer, pdf-parse, fflate, qrcode-terminal
- Frontend: plain HTML / CSS / ES Modules — no framework, no bundler
- Storage: local JSON files plus a directory tree on disk
- Optional: any OpenAI-compatible Chat Completions API

## License

[MIT](LICENSE)
