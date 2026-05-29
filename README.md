# ExtensionForge AI

A premium browser-based **Chrome Extension Builder**. Build, edit, validate, and export real Manifest V3 Chrome Extensions — all in your browser. No backend. No build step. No signups. No API keys.

Use it as a private, mobile-friendly studio for crafting and editing extensions, with optional AI assistance via [puter.js](https://js.puter.com/v2/).

---

## Features

- **6 working templates** — Blank, Popup, Content Script, Website Customizer, Dark Mode, Productivity Notes. Every template generates real, valid Manifest V3 code.
- **Real file explorer** — create, rename, delete, duplicate, and organize files with folder paths (e.g. `assets/icon.svg`).
- **Code editor** — fast textarea-based editor optimized for Android/mobile. Tab key, auto-save, line/char count, JSON formatter.
- **Import any extension ZIP** — JSZip extracts text and binary files locally; binaries (icons, images) are preserved on export.
- **Manifest V3 validator** — checks 15+ rules: `manifest_version`, `name`, `version`, `description`, `action.default_popup`, `background.service_worker`, `content_scripts`, `permissions`, `host_permissions`, `icons`, `options_page`, `options_ui`, plus referenced-file existence.
- **Export to ZIP** — one-click download of `your-project.zip`. Extract it and load it as an unpacked extension in Chrome.
- **AI Assistant (puter.js)** — generate full extensions, modify the open file, explain it, fix bugs, or improve UI. Select among `gpt-5-nano`, `gpt-5-mini`, `gpt-5`, `claude-sonnet-4`, `claude-opus-4`, `gpt-4o-mini`.
- **Accept / Reject AI changes** — every AI suggestion is shown for review before it modifies your project.
- **localStorage autosave** — your project survives page reloads. Save indicator + last-modified status.
- **Mobile-first** — collapsible file panel, touch-sized targets, no horizontal overflow on Android.
- **No backend, no tracking** — everything runs locally in your browser.

---

## Project files

```
ExtensionForge-AI/
├── index.html
├── style.css
├── app.js
├── render.yaml   (Render Blueprint - optional one-click deploy config)
└── README.md
```

CDN dependencies (loaded from `index.html`, no install needed):

- [`https://js.puter.com/v2/`](https://js.puter.com/v2/) — AI chat (puter.js)
- [`https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js`](https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js) — ZIP import/export

---

## Run locally

You don't need Node or any build step. Two options:

**Option A — Just open the file**

Double-click `index.html`. It works in any modern browser.

**Option B — Serve from a tiny static server (recommended)**

Some browsers limit features when opening files via `file://`. Use any static server:

```sh
# Python (built in on most systems)
python3 -m http.server 8080

# or Node http-server
npx http-server -p 8080
```

Then open `http://localhost:8080`.

---

## Deploy to Render

The app is a pure static site. No build, no server, no environment variables.

A `render.yaml` Blueprint is included so Render can configure everything automatically.

### Option A — Blueprint (recommended, one click)

1. Push the project to a GitHub repository (already done if you forked this repo).

2. Go to [Render Dashboard](https://dashboard.render.com).

3. Click **New +** → **Blueprint**.

4. Connect your GitHub repo (`extensionMaker` or whatever you named it).

5. Render reads `render.yaml` and shows the service it will create:
   - **Name:** `extensionforge-ai`
   - **Type:** Static Site
   - **Build Command:** `echo "No build required"`
   - **Publish Directory:** `.`
   - **PR previews:** enabled
   - Sensible cache + security headers preconfigured.

6. Click **Apply**.

7. Wait ~30 seconds. Open the Render URL it gives you.

That's it — no manual config needed.

### Option B — Manual Static Site

1. Go to [Render](https://render.com).

2. Click **New +** → **Static Site**.

3. Connect your GitHub repository.

4. **Build Command:** `echo "No build required"`

5. **Publish Directory:** `.`

6. Click **Deploy**.

7. Open the Render URL after deployment.

The same files also work on Netlify, Vercel (Static), GitHub Pages, Cloudflare Pages, or any static host.

---

## How to use

### 1. Create a project

- Click **New Project** → pick a template (Blank, Popup, Content Script, Website Customizer, Dark Mode, or Productivity).
- All required files are created instantly.

### 2. Edit files

- Click any file in the **Files** panel to open it.
- Edit in the center editor. Changes auto-save to your browser's `localStorage` ~600 ms after you stop typing.
- Use **Format** to pretty-print JSON, **Copy** for clipboard, **Rename** / **Dup** / **Delete** to manage files.
- Click **+ File** in the file panel to create a new file (folder paths supported, e.g. `assets/logo.svg`).

### 3. Use the AI Assistant

- Open the **AI Assistant** tab on the right (or below on mobile).
- Pick a model.
- Type a prompt and pick an action:
  - **Generate Extension** — full new project from your prompt.
  - **Modify File** — apply your prompt to the currently open file.
  - **Explain** — explain what the open file does.
  - **Fix Bugs** — auto-fix the open file.
  - **Improve UI** — refine the UI/quality of the open file.
- Review the result; click **Accept** to apply or **Reject** to discard.

If puter.js isn't available, the AI status banner says so and the manual builder keeps working.

### 4. Validate

- Click **Validate** in the header (or **Run Manifest V3 Check** in the Validator tab).
- See errors, warnings, and passed checks. Errors block a clean Chrome install; fix them before exporting.

### 5. Export

- Click **Export ZIP** to download `your-project.zip`.
- The ZIP preserves folder paths and any binary files you imported.

### 6. Import an existing extension

- Click **Import ZIP** and pick a `.zip` of an extension you own.
- The app extracts text files into the editor and keeps binaries safe for re-export.

---

## Install your exported extension in Chrome (desktop)

1. **Export ZIP** in ExtensionForge AI.
2. Extract the ZIP on your computer.
3. In Chrome, open `chrome://extensions`.
4. Enable **Developer Mode** (top-right toggle).
5. Click **Load unpacked**.
6. Select the **extracted folder** (the one that contains `manifest.json`).
7. Your extension is now installed.

### Android note

Chrome on Android does not officially support loading custom extensions. Test on desktop Chrome, or on extension-supporting Android browsers (e.g. Kiwi, Yandex). ExtensionForge AI itself runs perfectly on Android — it just can't side-load extensions there.

---

## Safety notice

ExtensionForge AI is for building extensions you **own** or have permission to edit.

The AI assistant is instructed to refuse any request to create or modify:

- Malware, spyware, keyloggers
- Cookie / session / token / password stealers
- Phishing extensions or hidden trackers
- Crypto drainers
- Bypass tools or paid-feature unlockers
- Code that modifies third-party extensions without permission
- Code that secretly collects user data or hides malicious behavior

A client-side guardrail also blocks obvious unsafe prompts before they reach the model. When refusing, the AI says:

> "I can't help create or modify extensions that steal data, bypass permissions, or harm users. I can help build a safe extension instead."

Use ExtensionForge AI to build legitimate, helpful extensions: dark mode, popup tools, productivity helpers, accessibility utilities, safe website customizers, reading tools, theme switchers, bookmark managers, etc.

---

## Privacy

- All file editing, ZIP import, ZIP export, and validation happens **in your browser**.
- The only outbound network call is to puter.js when you use AI features. If you don't use AI, no requests leave your machine.
- Your project autosaves to `localStorage`. Use **Clear Project** to wipe it.

---

## Tech stack

- HTML, CSS, vanilla JavaScript (no frameworks)
- [JSZip 3.10.1](https://stuk.github.io/jszip/) for ZIP read/write
- [puter.js v2](https://docs.puter.com/) for AI chat
- Browser `Blob` + `URL.createObjectURL` for downloads
- `localStorage` for autosave

No `package.json`. No `node_modules`. No server.

---

## License

MIT — use it freely for your own projects.
