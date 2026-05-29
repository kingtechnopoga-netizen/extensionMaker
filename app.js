/* =====================================================================
   ExtensionForge AI - app.js
   Vanilla JS Chrome Extension builder.
   Sections:
     1.  Constants & state
     2.  DOM helpers (toast, modal prompt/confirm, working overlay)
     3.  Storage (localStorage save/restore)
     4.  File operations (create, rename, delete, duplicate, switch)
     5.  Editor (load, save, autosave, format JSON, line/char count)
     6.  File explorer rendering
     7.  Templates (blank, popup, content, customizer, darkmode, productivity)
     8.  ZIP import / export (JSZip + base64 binary preservation)
     9.  Manifest V3 validator
     10. AI assistant (puter.js)
     11. Event bindings
     12. Init
   ===================================================================== */

(function () {
  'use strict';

  /* ============== 1. CONSTANTS & STATE ============== */

  const STORAGE_KEY = 'extensionforge-ai:project:v1';
  const AUTOSAVE_DEBOUNCE_MS = 600;
  const TOAST_LIFETIME_MS = 3200;

  const TEXT_EXTENSIONS = new Set([
    'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'json', 'jsonc',
    'md', 'txt', 'svg', 'xml', 'yml', 'yaml', 'csv', 'ini', 'log', 'toml', 'env'
  ]);

  // Languages that get JSON formatter button
  const JSON_EXTENSIONS = new Set(['json', 'jsonc']);

  const FILE_ICONS = {
    'manifest.json': '⚙',
    'popup.html': '◐',
    'popup.css': '✎',
    'popup.js': '◉',
    'background.js': '⚡',
    'content.js': '≣',
    'options.html': '⚙',
    'options.js': '⚙',
    'README.md': '★'
  };

  const EXT_ICONS = {
    html: '◰', css: '✎', js: '◉', json: '⚙', md: '★',
    svg: '◯', png: '▣', jpg: '▣', jpeg: '▣', gif: '▣', ico: '▣',
    txt: '☰', xml: '≣', yml: '≣', yaml: '≣'
  };

  // Patterns that would indicate harmful intent. Used to refuse client-side
  // before we even hit the AI. (Bare-minimum guardrail.)
  const UNSAFE_PROMPT_PATTERNS = [
    /\b(steal|exfiltrate|harvest|capture|grab)\b.*\b(cookie|token|password|credential|session|auth)\b/i,
    /\bkey ?logger\b/i,
    /\bspyware\b/i,
    /\bphish/i,
    /\bcrypto[\s-]?drainer\b/i,
    /\bbypass.*(paywall|payment|license|drm|paid)\b/i,
    /\bunlock.*(paid|premium)\b/i,
    /\bcookie ?(stealer|grabber)\b/i,
    /\bsession ?hijack/i,
    /\bsilent.*(record|monitor|track).*\b(user|keystroke|typing)\b/i,
    /\bmodify.*\bother (people'?s|user'?s|third[- ]?party)\b.*extension/i
  ];

  const AI_SYSTEM_PROMPT =
`You are ExtensionForge AI, a safe Chrome Extension development assistant.

You help users create and modify Chrome Extensions that they own or have permission to edit.

Always create real Manifest V3 Chrome Extension code.

When generating a full extension, return ONLY valid JSON (no markdown fences, no commentary outside JSON) in this exact format:

{
  "files": {
    "manifest.json": "...",
    "popup.html": "...",
    "popup.css": "...",
    "popup.js": "...",
    "background.js": "...",
    "content.js": "..."
  },
  "message": "Short explanation"
}

Rules:
- Use Manifest V3 only.
- Do not generate fake files.
- Do not use placeholder code.
- Do not create malware, spyware, keyloggers, or trackers.
- Do not steal cookies, passwords, tokens, or personal data.
- Do not bypass paid features.
- Do not help modify third-party extensions without permission.
- Keep permissions minimal.
- Prefer safe browser APIs.
- Make code clean and working.
- Avoid hidden behavior.

If the request is unsafe, refuse briefly with this exact message and offer a safe alternative:
"I can't help create or modify extensions that steal data, bypass permissions, or harm users. I can help build a safe extension instead."`;

  // Project state
  const state = {
    projectName: 'Untitled project',
    files: {}, // { [path]: { content: string, binary: false, mime?: string } | { base64: string, binary: true, mime?: string } }
    currentFile: null,
    lastModified: null,
    saveStatus: 'idle', // 'idle' | 'unsaved' | 'saving' | 'saved'
    validStatus: '—',
    pendingAI: null, // { kind: 'generate'|'modify', files?: {...}, content?: string, target?: string, message?: string }
    autosaveTimer: null,
    isDirty: false,
    aiAvailable: false,
    aiChecked: false
  };

  /* ============== 2. DOM HELPERS ============== */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {};
  function bindEls() {
    Object.assign(els, {
      // Header
      btnNewProject: $('#btnNewProject'),
      btnImportZip: $('#btnImportZip'),
      btnValidate: $('#btnValidate'),
      btnExportZip: $('#btnExportZip'),
      btnClearProject: $('#btnClearProject'),
      btnMobileMenu: $('#btnMobileMenu'),
      headerActions: $('.header-actions'),
      zipInput: $('#zipInput'),

      // Files
      panelFiles: $('#panelFiles'),
      btnNewFile: $('#btnNewFile'),
      btnPanelNewProject: $('#btnPanelNewProject'),
      btnPanelReset: $('#btnPanelReset'),
      btnCollapseFiles: $('#btnCollapseFiles'),
      projectNameInput: $('#projectNameInput'),
      fileList: $('#fileList'),
      fileCountLabel: $('#fileCountLabel'),

      // Editor
      currentFileIcon: $('#currentFileIcon'),
      currentFileName: $('#currentFileName'),
      currentFileType: $('#currentFileType'),
      saveIndicator: $('#saveIndicator'),
      btnCopyCode: $('#btnCopyCode'),
      btnFormatJson: $('#btnFormatJson'),
      btnRenameFile: $('#btnRenameFile'),
      btnDuplicateFile: $('#btnDuplicateFile'),
      btnDeleteFile: $('#btnDeleteFile'),
      codeEditor: $('#codeEditor'),
      editorEmpty: $('#editorEmpty'),
      editorError: $('#editorError'),
      editorMeta: $('#editorMeta'),
      editorMime: $('#editorMime'),

      // Tabs
      tabs: $$('.tab'),
      tabPanels: $$('.tab-panel'),

      // AI
      aiStatus: $('#aiStatus'),
      aiModel: $('#aiModel'),
      aiPrompt: $('#aiPrompt'),
      btnAIGenerate: $('#btnAIGenerate'),
      btnAIModify: $('#btnAIModify'),
      btnAIExplain: $('#btnAIExplain'),
      btnAIFix: $('#btnAIFix'),
      btnAIImprove: $('#btnAIImprove'),
      aiOutput: $('#aiOutput'),
      aiOutputTitle: $('#aiOutputTitle'),
      aiOutputBody: $('#aiOutputBody'),
      aiOutputMessage: $('#aiOutputMessage'),
      btnAIAccept: $('#btnAIAccept'),
      btnAIReject: $('#btnAIReject'),
      btnAICopy: $('#btnAICopy'),

      // Validator
      btnRunValidator: $('#btnRunValidator'),
      validatorResults: $('#validatorResults'),

      // Status bar
      statusFile: $('#statusFile'),
      statusSave: $('#statusSave'),
      statusValid: $('#statusValid'),
      statusProject: $('#statusProject'),
      statusModified: $('#statusModified'),

      // Modals
      modalTemplates: $('#modalTemplates'),
      modalPrompt: $('#modalPrompt'),
      modalConfirm: $('#modalConfirm'),
      promptTitle: $('#promptTitle'),
      promptMessage: $('#promptMessage'),
      promptInput: $('#promptInput'),
      promptOk: $('#promptOk'),
      promptCancel: $('#promptCancel'),
      confirmTitle: $('#confirmTitle'),
      confirmMessage: $('#confirmMessage'),
      confirmOk: $('#confirmOk'),
      confirmCancel: $('#confirmCancel'),

      // Misc
      toastWrap: $('#toastWrap'),
      workingOverlay: $('#workingOverlay'),
      workingText: $('#workingText')
    });
  }

  function toast(msg, kind = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    els.toastWrap.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      t.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      setTimeout(() => t.remove(), 280);
    }, TOAST_LIFETIME_MS);
  }

  function showModal(modalEl) { modalEl.hidden = false; }
  function hideModal(modalEl) { modalEl.hidden = true; }

  function openPrompt({ title, message, defaultValue = '', okLabel = 'OK' }) {
    return new Promise((resolve) => {
      els.promptTitle.textContent = title || 'Input';
      els.promptMessage.textContent = message || '';
      els.promptInput.value = defaultValue;
      els.promptOk.textContent = okLabel;

      const cleanup = () => {
        hideModal(els.modalPrompt);
        els.promptOk.removeEventListener('click', onOk);
        els.promptCancel.removeEventListener('click', onCancel);
        els.promptInput.removeEventListener('keydown', onKey);
        $$('[data-close="modalPrompt"]', els.modalPrompt).forEach(b => b.removeEventListener('click', onCancel));
      };
      const onOk = () => { const v = els.promptInput.value; cleanup(); resolve(v); };
      const onCancel = () => { cleanup(); resolve(null); };
      const onKey = (e) => {
        if (e.key === 'Enter') onOk();
        else if (e.key === 'Escape') onCancel();
      };
      els.promptOk.addEventListener('click', onOk);
      els.promptCancel.addEventListener('click', onCancel);
      els.promptInput.addEventListener('keydown', onKey);
      $$('[data-close="modalPrompt"]', els.modalPrompt).forEach(b => b.addEventListener('click', onCancel));
      showModal(els.modalPrompt);
      setTimeout(() => els.promptInput.focus(), 30);
    });
  }

  function openConfirm({ title, message, okLabel = 'Confirm', danger = true }) {
    return new Promise((resolve) => {
      els.confirmTitle.textContent = title || 'Confirm';
      els.confirmMessage.textContent = message || '';
      els.confirmOk.textContent = okLabel;
      els.confirmOk.className = danger ? 'btn btn-danger' : 'btn btn-primary';

      const cleanup = () => {
        hideModal(els.modalConfirm);
        els.confirmOk.removeEventListener('click', onOk);
        els.confirmCancel.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        $$('[data-close="modalConfirm"]', els.modalConfirm).forEach(b => b.removeEventListener('click', onCancel));
      };
      const onOk = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };
      const onKey = (e) => {
        if (e.key === 'Escape') onCancel();
        else if (e.key === 'Enter') onOk();
      };
      els.confirmOk.addEventListener('click', onOk);
      els.confirmCancel.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
      $$('[data-close="modalConfirm"]', els.modalConfirm).forEach(b => b.addEventListener('click', onCancel));
      showModal(els.modalConfirm);
    });
  }

  function setWorking(on, text = 'Working…') {
    els.workingText.textContent = text;
    els.workingOverlay.hidden = !on;
  }

  function closeMobileMenu() {
    if (els.headerActions) els.headerActions.classList.remove('show');
  }

  // Wrap a click handler so any thrown error becomes a visible toast instead
  // of a silent failure (which is what the user was seeing on mobile).
  function safe(handler) {
    return async function (...args) {
      try { return await handler.apply(this, args); }
      catch (err) {
        console.error('Handler error:', err);
        toast('Action failed: ' + (err && err.message ? err.message : err), 'error');
      }
    };
  }

  function resetProject() {
    if (state.autosaveTimer) { clearTimeout(state.autosaveTimer); state.autosaveTimer = null; }
    state.files = {};
    state.currentFile = null;
    state.projectName = 'Untitled project';
    state.lastModified = null;
    state.saveStatus = 'idle';
    state.validStatus = '—';
    state.pendingAI = null;
    state.isDirty = false;
    clearProjectStorage();
    hideAIOutput();
    renderFileList();
    loadCurrentFileToEditor();
    updateStatusBar();
    if (els.validatorResults) {
      els.validatorResults.innerHTML = '<p class="hint-text">Run the validator to check your manifest.json and referenced files.</p>';
    }
  }

  /* ============== 3. STORAGE ============== */

  function saveProjectToStorage() {
    try {
      const payload = {
        projectName: state.projectName,
        files: state.files,
        currentFile: state.currentFile,
        lastModified: state.lastModified
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      // Likely QuotaExceededError
      console.warn('Save failed:', e);
      toast('localStorage is full. Export your ZIP to keep your work safe.', 'error');
      return false;
    }
  }

  function loadProjectFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return false;
      state.projectName = data.projectName || 'Untitled project';
      state.files = data.files || {};
      state.currentFile = data.currentFile || null;
      state.lastModified = data.lastModified || null;
      return true;
    } catch (e) {
      console.warn('Load failed:', e);
      return false;
    }
  }

  function clearProjectStorage() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  /* ============== 4. FILE OPERATIONS ============== */

  function getExt(path) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(path);
    return m ? m[1].toLowerCase() : '';
  }

  function getBaseName(path) {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(i + 1) : path;
  }

  function isTextExt(ext) { return TEXT_EXTENSIONS.has(ext.toLowerCase()); }

  function isTextFile(path) {
    const ext = getExt(path);
    return isTextExt(ext);
  }

  function getFileIcon(path) {
    const base = getBaseName(path);
    if (FILE_ICONS[base]) return FILE_ICONS[base];
    const ext = getExt(path);
    return EXT_ICONS[ext] || '☰';
  }

  function nowIso() { return new Date().toISOString(); }

  function formatRelative(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const diff = (Date.now() - d.getTime()) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return d.toLocaleString();
    } catch (e) { return iso; }
  }

  function markModified() {
    state.lastModified = nowIso();
    state.isDirty = true;
    state.saveStatus = 'unsaved';
    updateStatusBar();
    updateSaveIndicator();
  }

  function scheduleAutosave() {
    if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(() => {
      // Persist editor content into the file map first
      flushEditorToFile();
      const ok = saveProjectToStorage();
      if (ok) {
        state.saveStatus = 'saved';
        state.isDirty = false;
        updateStatusBar();
        updateSaveIndicator();
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function createFile(path, content = '', { binary = false, base64 = '', mime = '', overwrite = false } = {}) {
    if (!path || typeof path !== 'string') {
      toast('Invalid file name.', 'error');
      return false;
    }
    path = path.replace(/^\/+/, '').trim();
    if (!path) { toast('Invalid file name.', 'error'); return false; }
    if (state.files[path] && !overwrite) {
      toast(`File "${path}" already exists.`, 'error');
      return false;
    }
    if (binary) {
      state.files[path] = { binary: true, base64, mime };
    } else {
      state.files[path] = { binary: false, content: content || '', mime };
    }
    markModified();
    renderFileList();
    scheduleAutosave();
    return true;
  }

  function deleteFile(path) {
    if (!state.files[path]) return false;
    delete state.files[path];
    if (state.currentFile === path) {
      state.currentFile = Object.keys(state.files)[0] || null;
    }
    markModified();
    renderFileList();
    loadCurrentFileToEditor();
    scheduleAutosave();
    return true;
  }

  function renameFile(oldPath, newPath) {
    if (!state.files[oldPath]) return false;
    newPath = newPath.replace(/^\/+/, '').trim();
    if (!newPath) { toast('Invalid file name.', 'error'); return false; }
    if (newPath === oldPath) return true;
    if (state.files[newPath]) {
      toast(`File "${newPath}" already exists.`, 'error');
      return false;
    }
    state.files[newPath] = state.files[oldPath];
    delete state.files[oldPath];
    if (state.currentFile === oldPath) state.currentFile = newPath;
    markModified();
    renderFileList();
    loadCurrentFileToEditor();
    scheduleAutosave();
    return true;
  }

  function duplicateFile(path) {
    if (!state.files[path]) return false;
    const base = path.replace(/(\.[^.]*)?$/, (m) => '');
    const ext = (path.match(/\.[^.]*$/) || [''])[0];
    const stem = path.slice(0, path.length - ext.length);
    let i = 1;
    let candidate = `${stem}-copy${ext}`;
    while (state.files[candidate]) {
      i++;
      candidate = `${stem}-copy${i}${ext}`;
    }
    state.files[candidate] = JSON.parse(JSON.stringify(state.files[path]));
    markModified();
    renderFileList();
    scheduleAutosave();
    toast(`Duplicated as ${candidate}`, 'success');
    return true;
  }

  function switchToFile(path) {
    if (!state.files[path]) return;
    flushEditorToFile();
    state.currentFile = path;
    loadCurrentFileToEditor();
    renderFileList();
    saveProjectToStorage();
  }

  /* ============== 5. EDITOR ============== */

  function flushEditorToFile() {
    if (!state.currentFile) return;
    const file = state.files[state.currentFile];
    if (!file || file.binary) return;
    file.content = els.codeEditor.value;
  }

  function loadCurrentFileToEditor() {
    const path = state.currentFile;
    const editor = els.codeEditor;
    const empty = els.editorEmpty;

    if (!path || !state.files[path]) {
      editor.value = '';
      editor.hidden = true;
      empty.hidden = false;
      els.currentFileName.textContent = 'No file open';
      els.currentFileType.textContent = '';
      els.currentFileIcon.textContent = '📄';
      els.editorMeta.textContent = '0 lines · 0 chars';
      els.editorMime.textContent = '—';
      els.editorError.hidden = true;
      els.btnFormatJson.hidden = true;
      els.statusFile.textContent = '—';
      return;
    }

    const file = state.files[path];
    els.currentFileName.textContent = path;
    els.currentFileIcon.textContent = getFileIcon(path);
    const ext = getExt(path);
    els.currentFileType.textContent = ext || 'file';
    els.btnFormatJson.hidden = !JSON_EXTENSIONS.has(ext);
    els.statusFile.textContent = path;

    if (file.binary) {
      editor.value = '';
      editor.hidden = true;
      empty.hidden = false;
      empty.querySelector('.editor-empty-title').textContent = 'Binary file';
      empty.querySelector('.editor-empty-sub').textContent =
        `${path} is a binary file. It will be preserved when you export the ZIP.`;
      els.editorMeta.textContent = '— binary —';
      els.editorMime.textContent = file.mime || 'application/octet-stream';
      els.editorError.hidden = true;
      return;
    }

    empty.hidden = true;
    editor.hidden = false;
    editor.value = file.content || '';
    empty.querySelector('.editor-empty-title').textContent = 'No file selected';
    empty.querySelector('.editor-empty-sub').textContent =
      'Create a new project or open a file from the explorer.';
    updateEditorMeta();
    validateCurrentFileShallow();
  }

  function updateEditorMeta() {
    const v = els.codeEditor.value || '';
    const lines = v ? v.split('\n').length : 0;
    els.editorMeta.textContent = `${lines} lines · ${v.length} chars`;
    const ext = getExt(state.currentFile || '');
    const mimeMap = {
      html: 'text/html', css: 'text/css', js: 'application/javascript',
      json: 'application/json', md: 'text/markdown', svg: 'image/svg+xml',
      txt: 'text/plain', xml: 'application/xml', yml: 'text/yaml', yaml: 'text/yaml'
    };
    els.editorMime.textContent = mimeMap[ext] || ext || '—';
  }

  function validateCurrentFileShallow() {
    els.editorError.hidden = true;
    const path = state.currentFile;
    if (!path) return;
    const ext = getExt(path);
    if (JSON_EXTENSIONS.has(ext)) {
      const v = els.codeEditor.value || '';
      if (!v.trim()) return;
      try { JSON.parse(v); }
      catch (e) {
        els.editorError.textContent = `JSON error: ${e.message}`;
        els.editorError.hidden = false;
      }
    }
  }

  function updateSaveIndicator() {
    if (state.saveStatus === 'saved' || state.saveStatus === 'idle') {
      els.saveIndicator.textContent = 'saved';
      els.saveIndicator.classList.remove('unsaved');
    } else {
      els.saveIndicator.textContent = 'unsaved';
      els.saveIndicator.classList.add('unsaved');
    }
  }

  function updateStatusBar() {
    els.statusFile.textContent = state.currentFile || '—';
    els.statusSave.textContent =
      state.saveStatus === 'saved' || state.saveStatus === 'idle' ? 'saved'
      : state.saveStatus === 'unsaved' ? 'unsaved'
      : 'saving…';
    els.statusValid.textContent = state.validStatus || '—';
    els.statusProject.textContent = state.projectName || 'Untitled project';
    els.statusModified.textContent = formatRelative(state.lastModified);
  }

  /* ============== 6. FILE EXPLORER ============== */

  function renderFileList() {
    const list = els.fileList;
    list.innerHTML = '';
    const paths = Object.keys(state.files).sort((a, b) => {
      // manifest first, then folders, then files
      if (a === 'manifest.json') return -1;
      if (b === 'manifest.json') return 1;
      return a.localeCompare(b);
    });

    if (paths.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'file-empty';
      empty.textContent = 'No files yet. Click "New Project" or "Import ZIP".';
      list.appendChild(empty);
    } else {
      for (const p of paths) {
        const li = document.createElement('li');
        li.className = 'file-item';
        if (p === state.currentFile) li.classList.add('active');
        if (state.files[p].binary) li.classList.add('binary');
        li.innerHTML = `
          <span class="file-icon" aria-hidden="true">${getFileIcon(p)}</span>
          <span class="fname"></span>
          ${state.files[p].binary ? '<span class="fbadge">bin</span>' : ''}
        `;
        li.querySelector('.fname').textContent = p;
        li.addEventListener('click', () => switchToFile(p));
        list.appendChild(li);
      }
    }
    els.fileCountLabel.textContent = `${paths.length} file${paths.length === 1 ? '' : 's'}`;
    els.projectNameInput.value = state.projectName;
    updateStatusBar();
  }

  /* ============== 7. TEMPLATES ============== */

  const TPL_README = (name) =>
`# ${name}

This Chrome Extension was created with ExtensionForge AI.

## How to install

1. Export the ZIP from ExtensionForge AI.
2. Extract the ZIP file.
3. Open Chrome and go to chrome://extensions
4. Enable Developer Mode (top-right toggle).
5. Click "Load unpacked".
6. Select the extracted folder.
`;

  const TPL_ICON_SVG =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff2d4a"/>
      <stop offset="1" stop-color="#5a0c18"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="24" fill="#0b0a0f"/>
  <path d="M64 18 L108 42 V86 L64 110 L20 86 V42 Z" fill="url(#g)" stroke="#ff5468" stroke-width="3"/>
  <text x="64" y="78" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="44" fill="#fff">E</text>
</svg>`;

  function manifestFor(opts) {
    const m = {
      manifest_version: 3,
      name: opts.name || 'ExtensionForge Project',
      version: '1.0.0',
      description: opts.description || 'A Chrome Extension created with ExtensionForge AI.',
      action: { default_popup: 'popup.html', default_title: opts.name || 'ExtensionForge Project' },
      permissions: opts.permissions || ['storage', 'activeTab'],
      background: { service_worker: 'background.js' },
      icons: { 16: 'icon.svg', 48: 'icon.svg', 128: 'icon.svg' }
    };
    if (opts.contentScripts !== false) {
      m.content_scripts = [{ matches: ['<all_urls>'], js: ['content.js'] }];
    }
    if (opts.host_permissions) m.host_permissions = opts.host_permissions;
    if (opts.options_page) m.options_page = opts.options_page;
    return JSON.stringify(m, null, 2);
  }

  const TEMPLATES = {
    blank: () => ({
      name: 'Blank Extension',
      files: {
        'manifest.json': manifestFor({ name: 'Blank Extension', description: 'A minimal Manifest V3 starter.' }),
        'popup.html':
`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Blank Extension</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <main class="popup">
    <h1>Blank Extension</h1>
    <p>Edit popup.html, popup.js, and popup.css to begin.</p>
  </main>
  <script src="popup.js"></script>
</body>
</html>
`,
        'popup.css':
`body { margin: 0; min-width: 280px; font-family: Arial, sans-serif; background: #0b0b10; color: #fff; }
.popup { padding: 16px; }
h1 { font-size: 18px; margin: 0 0 8px; }
p { margin: 0; opacity: 0.8; font-size: 13px; }
`,
        'popup.js':
`document.addEventListener('DOMContentLoaded', () => {
  console.log('Popup ready');
});
`,
        'background.js':
`chrome.runtime.onInstalled.addListener(() => {
  console.log('Blank Extension installed.');
});
`,
        'content.js':
`console.log('Blank Extension content script loaded.');
`,
        'icon.svg': TPL_ICON_SVG,
        'README.md': TPL_README('Blank Extension')
      }
    }),

    popup: () => ({
      name: 'Popup Extension',
      files: {
        'manifest.json': manifestFor({
          name: 'Popup Extension',
          description: 'A popup with a button that uses chrome.storage.',
          permissions: ['storage', 'activeTab']
        }),
        'popup.html':
`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Popup Extension</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <main class="popup">
    <h1>ExtensionForge Popup</h1>
    <p class="lead">A safe, simple popup powered by chrome.storage.</p>
    <button id="mainBtn" class="primary">Click Me</button>
    <p id="status">Ready</p>
    <p id="lastClicked" class="muted"></p>
  </main>
  <script src="popup.js"></script>
</body>
</html>
`,
        'popup.css':
`body { margin: 0; min-width: 300px; font-family: -apple-system, Arial, sans-serif; background: #0b0b10; color: #fff; }
.popup { padding: 16px; }
h1 { font-size: 18px; margin: 0 0 8px; }
.lead { font-size: 13px; opacity: 0.85; margin: 0 0 14px; }
button.primary {
  width: 100%; padding: 10px 12px; border: none; border-radius: 10px;
  background: #b11226; color: white; font-weight: 700; cursor: pointer;
  font-size: 14px;
}
button.primary:hover { background: #d51b34; }
#status { margin: 12px 0 4px; font-size: 13px; }
.muted { font-size: 12px; opacity: 0.7; margin: 0; }
`,
        'popup.js':
`const mainBtn = document.getElementById("mainBtn");
const statusText = document.getElementById("status");
const lastClicked = document.getElementById("lastClicked");

async function refresh() {
  if (typeof chrome !== "undefined" && chrome.storage) {
    const data = await chrome.storage.local.get("lastClicked");
    if (data.lastClicked) {
      lastClicked.textContent = "Last clicked: " + new Date(data.lastClicked).toLocaleString();
    }
  }
}

mainBtn.addEventListener("click", async () => {
  statusText.textContent = "Button clicked!";
  if (typeof chrome !== "undefined" && chrome.storage) {
    await chrome.storage.local.set({ lastClicked: new Date().toISOString() });
    refresh();
  }
});

refresh();
`,
        'background.js':
`chrome.runtime.onInstalled.addListener(() => {
  console.log("Popup Extension installed.");
});
`,
        'content.js':
`console.log("Popup Extension content script loaded safely.");
`,
        'icon.svg': TPL_ICON_SVG,
        'README.md': TPL_README('Popup Extension')
      }
    }),

    content: () => ({
      name: 'Content Script Extension',
      files: {
        'manifest.json': manifestFor({
          name: 'Content Script Extension',
          description: 'Injects a small badge into every page you visit.',
          permissions: ['storage', 'activeTab']
        }),
        'popup.html':
`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Content Script Extension</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <main class="popup">
    <h1>Page Badge</h1>
    <p>Toggle the badge that this extension injects onto pages.</p>
    <label class="row">
      <input type="checkbox" id="enabled"> Show badge
    </label>
    <p id="status" class="muted">Ready</p>
  </main>
  <script src="popup.js"></script>
</body>
</html>
`,
        'popup.css':
`body { margin: 0; min-width: 280px; font-family: Arial, sans-serif; background: #0b0b10; color: #fff; }
.popup { padding: 16px; } h1 { margin: 0 0 8px; font-size: 18px; }
p { font-size: 13px; opacity: 0.85; }
.row { display: flex; gap: 8px; align-items: center; margin: 10px 0; font-size: 13px; }
.muted { font-size: 12px; opacity: 0.7; }
`,
        'popup.js':
`const enabled = document.getElementById('enabled');
const status = document.getElementById('status');

async function init() {
  const { showBadge = true } = await chrome.storage.local.get('showBadge');
  enabled.checked = showBadge;
}

enabled.addEventListener('change', async () => {
  await chrome.storage.local.set({ showBadge: enabled.checked });
  status.textContent = enabled.checked ? 'Badge enabled' : 'Badge disabled';
});

init();
`,
        'background.js':
`chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ showBadge: true });
  console.log("Content Script Extension installed.");
});
`,
        'content.js':
`(async () => {
  const { showBadge = true } = await chrome.storage.local.get('showBadge');
  if (!showBadge) return;
  if (document.getElementById('__exforge_badge')) return;
  const badge = document.createElement('div');
  badge.id = '__exforge_badge';
  badge.textContent = 'ExtensionForge';
  Object.assign(badge.style, {
    position: 'fixed', right: '12px', bottom: '12px', zIndex: 2147483647,
    background: 'linear-gradient(180deg,#ff2d4a,#b11226)', color: '#fff',
    padding: '6px 10px', borderRadius: '10px',
    font: '12px/1 -apple-system, Arial, sans-serif',
    boxShadow: '0 6px 18px rgba(0,0,0,0.4)'
  });
  document.body.appendChild(badge);
})();
`,
        'icon.svg': TPL_ICON_SVG,
        'README.md': TPL_README('Content Script Extension')
      }
    }),

    customizer: () => ({
      name: 'Website Customizer',
      files: {
        'manifest.json': manifestFor({
          name: 'Website Customizer',
          description: 'Apply custom CSS to specific websites you choose.',
          permissions: ['storage', 'activeTab', 'scripting'],
          host_permissions: ['<all_urls>']
        }),
        'popup.html':
`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Website Customizer</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <main class="popup">
    <h1>Site CSS</h1>
    <p>Custom CSS applied to the current site.</p>
    <textarea id="css" placeholder="body { background: #111 !important; }"></textarea>
    <div class="row">
      <button id="apply" class="primary">Apply</button>
      <button id="clear" class="ghost">Clear</button>
    </div>
    <p id="status" class="muted">Ready</p>
  </main>
  <script src="popup.js"></script>
</body>
</html>
`,
        'popup.css':
`body { margin: 0; min-width: 320px; font-family: Arial, sans-serif; background: #0b0b10; color: #fff; }
.popup { padding: 16px; } h1 { margin: 0 0 6px; font-size: 18px; } p { font-size: 13px; opacity: 0.85; margin: 0 0 8px; }
textarea { width: 100%; height: 140px; background: #14131a; color: #fff; border: 1px solid #2a2530; border-radius: 8px; padding: 8px; font-family: ui-monospace, monospace; font-size: 12px; }
.row { display: flex; gap: 8px; margin-top: 10px; }
button { flex: 1; padding: 10px; border: none; border-radius: 8px; cursor: pointer; font-weight: 700; }
.primary { background: #b11226; color: white; } .primary:hover { background: #d51b34; }
.ghost { background: #1c1922; color: #fff; }
.muted { font-size: 12px; opacity: 0.7; margin-top: 8px; }
`,
        'popup.js':
`const cssBox = document.getElementById('css');
const apply = document.getElementById('apply');
const clear = document.getElementById('clear');
const status = document.getElementById('status');

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function load() {
  const tab = await getActiveTab();
  if (!tab) return;
  const host = new URL(tab.url).hostname;
  const data = await chrome.storage.local.get(host);
  cssBox.value = data[host] || '';
}

apply.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  const host = new URL(tab.url).hostname;
  const css = cssBox.value;
  await chrome.storage.local.set({ [host]: css });
  await chrome.scripting.insertCSS({ target: { tabId: tab.id }, css });
  status.textContent = 'Applied to ' + host;
});

clear.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  const host = new URL(tab.url).hostname;
  await chrome.storage.local.remove(host);
  cssBox.value = '';
  status.textContent = 'Cleared for ' + host;
});

load();
`,
        'background.js':
`chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url || !tab.url.startsWith('http')) return;
  try {
    const host = new URL(tab.url).hostname;
    const data = await chrome.storage.local.get(host);
    const css = data[host];
    if (css) {
      await chrome.scripting.insertCSS({ target: { tabId }, css });
    }
  } catch (e) { /* ignore */ }
});
`,
        'content.js':
`// Reserved for future use.
console.log('Website Customizer ready.');
`,
        'icon.svg': TPL_ICON_SVG,
        'README.md': TPL_README('Website Customizer')
      }
    }),

    darkmode: () => ({
      name: 'Dark Mode',
      files: {
        'manifest.json': manifestFor({
          name: 'Dark Mode',
          description: 'Toggle a simple dark filter on any website.',
          permissions: ['storage', 'activeTab', 'scripting'],
          host_permissions: ['<all_urls>']
        }),
        'popup.html':
`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Dark Mode</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <main class="popup">
    <h1>Dark Mode</h1>
    <p>Toggle dark mode for the current site.</p>
    <label class="switch"><input type="checkbox" id="toggle"> <span>Enabled</span></label>
    <p id="status" class="muted">Ready</p>
  </main>
  <script src="popup.js"></script>
</body>
</html>
`,
        'popup.css':
`body { margin: 0; min-width: 280px; font-family: Arial, sans-serif; background: #0b0b10; color: #fff; }
.popup { padding: 16px; } h1 { margin: 0 0 8px; font-size: 18px; } p { font-size: 13px; opacity: 0.85; }
.switch { display: flex; align-items: center; gap: 8px; padding: 10px 0; font-size: 14px; }
.muted { font-size: 12px; opacity: 0.7; }
`,
        'popup.js':
`const toggle = document.getElementById('toggle');
const status = document.getElementById('status');

async function getTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

async function key() {
  const t = await getTab();
  return t ? 'dm:' + new URL(t.url).hostname : null;
}

async function load() {
  const k = await key();
  if (!k) return;
  const data = await chrome.storage.local.get(k);
  toggle.checked = !!data[k];
}

toggle.addEventListener('change', async () => {
  const t = await getTab();
  if (!t) return;
  const k = 'dm:' + new URL(t.url).hostname;
  await chrome.storage.local.set({ [k]: toggle.checked });
  await chrome.scripting.executeScript({
    target: { tabId: t.id },
    func: (on) => {
      const id = '__exforge_dark';
      const old = document.getElementById(id);
      if (old) old.remove();
      if (on) {
        const s = document.createElement('style');
        s.id = id;
        s.textContent = 'html { filter: invert(1) hue-rotate(180deg) !important; background: #fff !important; } img, video, picture, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }';
        document.documentElement.appendChild(s);
      }
    },
    args: [toggle.checked]
  });
  status.textContent = toggle.checked ? 'Dark mode on' : 'Dark mode off';
});

load();
`,
        'background.js':
`chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url || !tab.url.startsWith('http')) return;
  try {
    const k = 'dm:' + new URL(tab.url).hostname;
    const data = await chrome.storage.local.get(k);
    if (data[k]) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (document.getElementById('__exforge_dark')) return;
          const s = document.createElement('style');
          s.id = '__exforge_dark';
          s.textContent = 'html { filter: invert(1) hue-rotate(180deg) !important; background: #fff !important; } img, video, picture, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }';
          document.documentElement.appendChild(s);
        }
      });
    }
  } catch (e) { /* ignore */ }
});
`,
        'content.js':
`console.log('Dark Mode ready.');
`,
        'icon.svg': TPL_ICON_SVG,
        'README.md': TPL_README('Dark Mode')
      }
    }),

    productivity: () => ({
      name: 'Productivity Notes',
      files: {
        'manifest.json': manifestFor({
          name: 'Productivity Notes',
          description: 'Quick notes & reminders saved in chrome.storage.',
          permissions: ['storage', 'alarms', 'notifications']
        }),
        'popup.html':
`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Productivity Notes</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <main class="popup">
    <h1>Notes</h1>
    <textarea id="note" placeholder="Type a note..."></textarea>
    <div class="row">
      <input id="reminder" type="number" min="0" placeholder="Remind in (min)" />
      <button id="save" class="primary">Save</button>
    </div>
    <ul id="list"></ul>
  </main>
  <script src="popup.js"></script>
</body>
</html>
`,
        'popup.css':
`body { margin: 0; min-width: 320px; font-family: Arial, sans-serif; background: #0b0b10; color: #fff; }
.popup { padding: 16px; } h1 { margin: 0 0 8px; font-size: 18px; }
textarea { width: 100%; height: 80px; background: #14131a; color: #fff; border: 1px solid #2a2530; border-radius: 8px; padding: 8px; }
.row { display: flex; gap: 8px; margin-top: 8px; }
input[type=number] { flex: 1; background: #14131a; color: #fff; border: 1px solid #2a2530; border-radius: 8px; padding: 8px; }
button.primary { padding: 10px 14px; border: none; border-radius: 8px; background: #b11226; color: white; font-weight: 700; cursor: pointer; }
ul { list-style: none; padding: 0; margin: 12px 0 0; max-height: 180px; overflow: auto; }
li { padding: 8px; background: #14131a; border-radius: 8px; margin-bottom: 6px; font-size: 13px; display: flex; justify-content: space-between; gap: 8px; }
li button { background: transparent; border: none; color: #ff5468; cursor: pointer; }
`,
        'popup.js':
`const note = document.getElementById('note');
const reminder = document.getElementById('reminder');
const save = document.getElementById('save');
const list = document.getElementById('list');

async function refresh() {
  const { notes = [] } = await chrome.storage.local.get('notes');
  list.innerHTML = '';
  notes.forEach((n, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = n.text;
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.addEventListener('click', async () => {
      const arr = (await chrome.storage.local.get('notes')).notes || [];
      arr.splice(i, 1);
      await chrome.storage.local.set({ notes: arr });
      refresh();
    });
    li.appendChild(span); li.appendChild(btn);
    list.appendChild(li);
  });
}

save.addEventListener('click', async () => {
  const text = note.value.trim();
  if (!text) return;
  const { notes = [] } = await chrome.storage.local.get('notes');
  notes.push({ text, at: Date.now() });
  await chrome.storage.local.set({ notes });
  note.value = '';
  const mins = Number(reminder.value);
  if (mins > 0) {
    chrome.alarms.create('note:' + Date.now(), { delayInMinutes: mins });
    chrome.storage.local.set({ ['reminderText:' + Date.now()]: text });
  }
  refresh();
});

refresh();
`,
        'background.js':
`chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('note:')) return;
  const id = alarm.name.split(':')[1];
  const key = 'reminderText:' + id;
  const data = await chrome.storage.local.get(key);
  const text = data[key] || 'Reminder';
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.svg',
    title: 'ExtensionForge Reminder',
    message: text
  });
  chrome.storage.local.remove(key);
});
`,
        'content.js':
`console.log('Productivity Notes ready.');
`,
        'icon.svg': TPL_ICON_SVG,
        'README.md': TPL_README('Productivity Notes')
      }
    })
  };

  function applyTemplate(key) {
    const tpl = TEMPLATES[key];
    if (!tpl) { toast('Unknown template.', 'error'); return; }
    // Cancel any pending autosave so it can't write stale state on top of the new project
    if (state.autosaveTimer) { clearTimeout(state.autosaveTimer); state.autosaveTimer = null; }
    const t = tpl();
    state.projectName = t.name;
    state.files = {};
    for (const [path, content] of Object.entries(t.files)) {
      state.files[path] = { binary: false, content };
    }
    state.currentFile = 'manifest.json';
    state.lastModified = nowIso();
    state.isDirty = false;
    state.saveStatus = 'saved';
    state.validStatus = '—';
    state.pendingAI = null;
    hideAIOutput();
    saveProjectToStorage();
    renderFileList();
    loadCurrentFileToEditor();
    updateStatusBar();
    closeMobileMenu();
    toast(`${t.name} project created.`, 'success');
  }

  /* ============== 8. ZIP IMPORT / EXPORT ============== */

  function uint8ToBase64(u8) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  function base64ToUint8(b64) {
    const binary = atob(b64);
    const u8 = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
    return u8;
  }

  async function importZip(file) {
    if (!window.JSZip) {
      toast('JSZip is not loaded. Check your network connection.', 'error');
      return;
    }
    setWorking(true, 'Reading ZIP…');
    try {
      const zip = await JSZip.loadAsync(file);
      const newFiles = {};
      const entries = Object.values(zip.files).filter(e => !e.dir);

      // Detect if all paths share a common top folder; if so strip it
      const topFolders = new Set(entries.map(e => e.name.split('/')[0]));
      const stripPrefix = (entries.length > 0 && topFolders.size === 1 && entries.every(e => e.name.includes('/')))
        ? [...topFolders][0] + '/' : '';

      for (const entry of entries) {
        const rawPath = entry.name;
        const path = stripPrefix && rawPath.startsWith(stripPrefix)
          ? rawPath.slice(stripPrefix.length) : rawPath;
        if (!path || path.endsWith('/')) continue;
        const ext = getExt(path);
        if (isTextExt(ext)) {
          const content = await entry.async('string');
          newFiles[path] = { binary: false, content };
        } else {
          const u8 = await entry.async('uint8array');
          newFiles[path] = { binary: true, base64: uint8ToBase64(u8), mime: '' };
        }
      }

      if (Object.keys(newFiles).length === 0) {
        toast('ZIP is empty.', 'error');
        setWorking(false);
        return;
      }

      state.files = newFiles;

      // Project name from manifest if available
      let projectName = file.name.replace(/\.zip$/i, '') || 'Imported Project';
      if (newFiles['manifest.json'] && !newFiles['manifest.json'].binary) {
        try {
          const m = JSON.parse(newFiles['manifest.json'].content);
          if (m && m.name) projectName = m.name;
        } catch (e) {
          toast('Imported ZIP has invalid manifest.json. You can still edit it.', 'error');
        }
      } else {
        toast('No manifest.json in ZIP. You can still edit files.', 'info');
      }
      state.projectName = projectName;
      state.currentFile = newFiles['manifest.json'] ? 'manifest.json' : Object.keys(newFiles)[0];
      state.lastModified = nowIso();

      saveProjectToStorage();
      renderFileList();
      loadCurrentFileToEditor();
      updateStatusBar();
      toast(`Imported ${Object.keys(newFiles).length} files.`, 'success');
    } catch (e) {
      console.error(e);
      toast('Could not read ZIP: ' + (e.message || e), 'error');
    } finally {
      setWorking(false);
    }
  }

  async function exportZip() {
    if (!window.JSZip) {
      toast('JSZip is not loaded.', 'error');
      return;
    }
    flushEditorToFile();
    if (Object.keys(state.files).length === 0) {
      toast('Project is empty. Create files first.', 'error');
      return;
    }
    setWorking(true, 'Building ZIP…');
    try {
      const zip = new JSZip();
      for (const [path, f] of Object.entries(state.files)) {
        if (f.binary) zip.file(path, base64ToUint8(f.base64));
        else zip.file(path, f.content || '');
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const safeName = (state.projectName || 'extensionforge-project').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName || 'extensionforge-project'}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('ZIP exported. Extract it and use "Load unpacked" in Chrome.', 'success');
    } catch (e) {
      console.error(e);
      toast('Export failed: ' + (e.message || e), 'error');
    } finally {
      setWorking(false);
    }
  }

  /* ============== 9. MANIFEST V3 VALIDATOR ============== */

  function runValidator() {
    flushEditorToFile();
    const results = [];
    const push = (level, msg) => results.push({ level, msg });

    const mFile = state.files['manifest.json'];
    if (!mFile || mFile.binary) {
      push('err', 'manifest.json is missing.');
      renderValidator(results);
      return;
    }

    let m;
    try { m = JSON.parse(mFile.content || '{}'); }
    catch (e) {
      push('err', 'manifest.json is not valid JSON: ' + e.message);
      renderValidator(results);
      return;
    }

    if (m.manifest_version === 3) push('pass', 'manifest_version is 3.');
    else if (m.manifest_version) push('err', `manifest_version is ${m.manifest_version}; must be 3.`);
    else push('err', 'manifest_version is missing.');

    if (m.name && typeof m.name === 'string') push('pass', `name is "${m.name}".`);
    else push('err', 'name is missing or not a string.');

    if (m.version && typeof m.version === 'string') push('pass', `version is "${m.version}".`);
    else push('err', 'version is missing or not a string.');

    if (m.description && typeof m.description === 'string') push('pass', 'description is set.');
    else push('warn', 'description is missing.');

    if (m.action && m.action.default_popup) {
      const popup = m.action.default_popup;
      if (state.files[popup]) push('pass', `action.default_popup "${popup}" exists.`);
      else push('err', `action.default_popup "${popup}" is referenced but does not exist.`);
    }

    if (m.background && m.background.service_worker) {
      const sw = m.background.service_worker;
      if (state.files[sw]) push('pass', `background.service_worker "${sw}" exists.`);
      else push('err', `background.service_worker "${sw}" does not exist.`);
    }

    if (m.content_scripts) {
      if (Array.isArray(m.content_scripts)) {
        m.content_scripts.forEach((cs, i) => {
          if (Array.isArray(cs.js)) {
            cs.js.forEach((js) => {
              if (state.files[js]) push('pass', `content_scripts[${i}].js "${js}" exists.`);
              else push('err', `content_scripts[${i}].js "${js}" does not exist.`);
            });
          }
          if (Array.isArray(cs.css)) {
            cs.css.forEach((c) => {
              if (state.files[c]) push('pass', `content_scripts[${i}].css "${c}" exists.`);
              else push('err', `content_scripts[${i}].css "${c}" does not exist.`);
            });
          }
          if (!Array.isArray(cs.matches) || cs.matches.length === 0)
            push('warn', `content_scripts[${i}] is missing "matches".`);
        });
      } else push('err', 'content_scripts must be an array.');
    }

    if (m.permissions) {
      if (Array.isArray(m.permissions)) push('pass', `permissions has ${m.permissions.length} entries.`);
      else push('err', 'permissions must be an array.');
    }

    if (m.host_permissions) {
      if (Array.isArray(m.host_permissions)) push('pass', `host_permissions has ${m.host_permissions.length} entries.`);
      else push('err', 'host_permissions must be an array.');
    }

    if (m.icons) {
      if (typeof m.icons === 'object') {
        for (const [size, p] of Object.entries(m.icons)) {
          if (state.files[p]) push('pass', `icons.${size} "${p}" exists.`);
          else push('warn', `icons.${size} "${p}" does not exist.`);
        }
      } else push('err', 'icons must be an object.');
    } else {
      push('warn', 'icons is missing. Chrome will use a default placeholder.');
    }

    if (m.options_page) {
      if (state.files[m.options_page]) push('pass', `options_page "${m.options_page}" exists.`);
      else push('err', `options_page "${m.options_page}" does not exist.`);
    }
    if (m.options_ui && m.options_ui.page) {
      if (state.files[m.options_ui.page]) push('pass', `options_ui.page "${m.options_ui.page}" exists.`);
      else push('err', `options_ui.page "${m.options_ui.page}" does not exist.`);
    }

    renderValidator(results);

    const errs = results.filter(r => r.level === 'err').length;
    state.validStatus = errs === 0 ? 'OK' : `${errs} error${errs === 1 ? '' : 's'}`;
    updateStatusBar();
    if (errs === 0) toast('Manifest validation passed.', 'success');
    else toast(`Manifest has ${errs} error${errs === 1 ? '' : 's'}.`, 'error');
  }

  function renderValidator(results) {
    const root = els.validatorResults;
    root.innerHTML = '';
    if (!results.length) {
      root.innerHTML = '<p class="hint-text">No results yet.</p>';
      return;
    }
    // Sort: errors first, then warnings, then passes
    const order = { err: 0, warn: 1, pass: 2 };
    results.sort((a, b) => order[a.level] - order[b.level]);
    for (const r of results) {
      const row = document.createElement('div');
      row.className = `v-row ${r.level}`;
      const tag = document.createElement('span');
      tag.className = 'v-tag';
      tag.textContent = r.level === 'err' ? 'ERROR' : r.level === 'warn' ? 'WARN' : 'PASS';
      const msg = document.createElement('span');
      msg.textContent = r.msg;
      row.appendChild(tag);
      row.appendChild(msg);
      root.appendChild(row);
    }
    // Switch to validator tab
    activateTab('validator');
  }

  /* ============== 10. AI ASSISTANT ============== */

  function checkAIAvailability() {
    state.aiChecked = true;
    if (typeof window.puter !== 'undefined' && window.puter && window.puter.ai && typeof window.puter.ai.chat === 'function') {
      state.aiAvailable = true;
      els.aiStatus.textContent = 'AI ready (puter.js)';
      els.aiStatus.className = 'ai-status ok';
    } else {
      state.aiAvailable = false;
      els.aiStatus.textContent = 'AI unavailable. The manual builder still works fully.';
      els.aiStatus.className = 'ai-status err';
    }
  }

  function isUnsafePrompt(text) {
    if (!text) return false;
    return UNSAFE_PROMPT_PATTERNS.some(rx => rx.test(text));
  }

  function extractText(resp) {
    if (resp == null) return '';
    if (typeof resp === 'string') return resp;
    if (typeof resp.toString === 'function' && typeof resp !== 'object' && resp.toString !== Object.prototype.toString) {
      const s = resp.toString();
      if (typeof s === 'string') return s;
    }
    if (typeof resp === 'object') {
      if (typeof resp.message === 'string') return resp.message;
      if (resp.message && typeof resp.message.content === 'string') return resp.message.content;
      if (resp.message && Array.isArray(resp.message.content)) {
        return resp.message.content.map(p => (typeof p === 'string' ? p : p && p.text) || '').join('');
      }
      if (typeof resp.text === 'string') return resp.text;
      if (typeof resp.content === 'string') return resp.content;
      if (Array.isArray(resp.content)) return resp.content.map(p => (typeof p === 'string' ? p : p && p.text) || '').join('');
      if (resp.choices && resp.choices[0] && resp.choices[0].message && typeof resp.choices[0].message.content === 'string')
        return resp.choices[0].message.content;
    }
    try { return JSON.stringify(resp); } catch (e) { return String(resp); }
  }

  function stripCodeFences(s) {
    if (!s) return s;
    let t = s.trim();
    // Strip ```lang ... ``` or ``` ... ```
    const fence = /^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```\s*$/;
    const m = t.match(fence);
    if (m) return m[1];
    return t;
  }

  function tryParseJSON(text) {
    if (!text) return null;
    let t = stripCodeFences(text).trim();
    try { return JSON.parse(t); } catch (e) {}
    // Extract first {...last}
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = t.slice(start, end + 1);
      try { return JSON.parse(slice); } catch (e) {}
    }
    return null;
  }

  async function callAI(userPrompt) {
    if (!state.aiAvailable) {
      toast('AI is unavailable. Try refreshing or use manual editing.', 'error');
      return null;
    }
    if (isUnsafePrompt(userPrompt)) {
      const refusal = "I can't help create or modify extensions that steal data, bypass permissions, or harm users. I can help build a safe extension instead.";
      showAIOutput({ kind: 'message', message: refusal, body: refusal });
      return null;
    }
    const model = els.aiModel.value || 'gpt-5-mini';
    const fullPrompt = `${AI_SYSTEM_PROMPT}\n\n--- USER REQUEST ---\n${userPrompt}`;
    setWorking(true, 'Asking AI…');
    try {
      const opts = { model };
      const resp = await window.puter.ai.chat(fullPrompt, opts);
      const text = extractText(resp);
      return text || '';
    } catch (e) {
      console.error('AI error:', e);
      toast('AI call failed: ' + (e && e.message ? e.message : e), 'error');
      return null;
    } finally {
      setWorking(false);
    }
  }

  function showAIOutput({ kind, files, content, target, message, body }) {
    state.pendingAI = { kind, files, content, target, message };
    els.aiOutput.hidden = false;
    if (kind === 'generate') {
      els.aiOutputTitle.textContent = `AI Generated ${Object.keys(files || {}).length} files`;
      els.aiOutputBody.textContent = Object.keys(files || {}).map(p => `• ${p}`).join('\n');
    } else if (kind === 'modify') {
      els.aiOutputTitle.textContent = `AI proposed change to ${target}`;
      els.aiOutputBody.textContent = content || '';
    } else if (kind === 'message') {
      els.aiOutputTitle.textContent = 'AI Response';
      els.aiOutputBody.textContent = body || message || '';
    } else {
      els.aiOutputTitle.textContent = 'AI Output';
      els.aiOutputBody.textContent = body || '';
    }
    els.aiOutputMessage.textContent = message || '';
  }

  function hideAIOutput() {
    els.aiOutput.hidden = true;
    state.pendingAI = null;
  }

  function acceptAI() {
    const p = state.pendingAI;
    if (!p) return;
    if (p.kind === 'generate' && p.files) {
      // Replace project files with AI files
      state.files = {};
      for (const [path, content] of Object.entries(p.files)) {
        state.files[path] = { binary: false, content: String(content) };
      }
      // Try to use manifest name
      try {
        const m = state.files['manifest.json'];
        if (m && !m.binary) {
          const parsed = JSON.parse(m.content);
          if (parsed && parsed.name) state.projectName = parsed.name;
        }
      } catch (e) {}
      state.currentFile = state.files['manifest.json'] ? 'manifest.json' : Object.keys(state.files)[0];
      state.lastModified = nowIso();
      saveProjectToStorage();
      renderFileList();
      loadCurrentFileToEditor();
      toast('AI files applied.', 'success');
    } else if (p.kind === 'modify' && p.target && p.content != null) {
      const file = state.files[p.target];
      if (file && !file.binary) {
        file.content = p.content;
        if (state.currentFile === p.target) loadCurrentFileToEditor();
        markModified();
        scheduleAutosave();
        renderFileList();
        toast(`Updated ${p.target}.`, 'success');
      }
    } else if (p.kind === 'message') {
      // Nothing to apply
    }
    hideAIOutput();
  }

  async function aiGenerate() {
    const prompt = els.aiPrompt.value.trim();
    if (!prompt) { toast('Type a prompt first.', 'error'); return; }

    const text = await callAI(`Generate a complete Manifest V3 Chrome Extension. Return ONLY the JSON object.\n\nUser request: ${prompt}`);
    if (text == null) return;

    const json = tryParseJSON(text);
    if (json && json.files && typeof json.files === 'object') {
      // Sanity-check files have at least manifest.json
      if (!json.files['manifest.json']) {
        toast('AI did not return a manifest.json. Showing raw output.', 'error');
        showAIOutput({ kind: 'message', body: text });
        return;
      }
      showAIOutput({
        kind: 'generate',
        files: json.files,
        message: json.message || 'AI generated an extension. Review the file list, then Accept or Reject.'
      });
    } else {
      // Show the raw response so user can copy
      showAIOutput({ kind: 'message', body: text, message: 'AI did not return valid JSON. You can copy the response.' });
    }
  }

  async function aiOnCurrentFile(action) {
    const path = state.currentFile;
    if (!path) { toast('Open a file first.', 'error'); return; }
    const file = state.files[path];
    if (!file || file.binary) { toast('Cannot operate on binary files.', 'error'); return; }
    flushEditorToFile();

    const userPrompt = els.aiPrompt.value.trim();
    let task;
    switch (action) {
      case 'modify':
        task = `Modify the file "${path}" based on the following user instruction. Return ONLY the new full file content (no commentary, no markdown fences). User instruction: ${userPrompt || '(improve and clean up)'}`;
        break;
      case 'fix':
        task = `Fix bugs and errors in the file "${path}". Return ONLY the corrected full file content (no commentary, no markdown fences).`;
        break;
      case 'improve':
        task = `Improve the UI / quality of the file "${path}" while keeping its purpose. Return ONLY the new full file content (no commentary, no markdown fences).`;
        break;
      case 'explain':
        task = `Briefly explain what the file "${path}" does, in plain language. Return only the explanation as plain text.`;
        break;
      default:
        return;
    }

    const fullTask = `${task}\n\n--- File: ${path} ---\n${file.content || ''}`;
    const text = await callAI(fullTask);
    if (text == null) return;

    if (action === 'explain') {
      showAIOutput({ kind: 'message', body: text, message: 'Explanation only — no file changes.' });
      return;
    }

    const cleaned = stripCodeFences(text).trim();
    showAIOutput({
      kind: 'modify',
      target: path,
      content: cleaned,
      message: `Proposed update to ${path}. Review the diff in the editor by Accept/Reject.`
    });
    // Also load proposed content into editor as preview (without saving) — keep file untouched until accepted
    // We won't overwrite the editor; instead show in output panel.
  }

  /* ============== 11. EVENT BINDINGS ============== */

  function activateTab(name) {
    els.tabs.forEach(t => t.classList.toggle('tab-active', t.dataset.tab === name));
    els.tabPanels.forEach(p => { p.hidden = p.dataset.tabPanel !== name; });
  }

  function bindEvents() {
    // Header
    els.btnNewProject.addEventListener('click', safe(() => {
      closeMobileMenu();
      showModal(els.modalTemplates);
    }));
    els.btnImportZip.addEventListener('click', safe(() => {
      closeMobileMenu();
      els.zipInput.click();
    }));
    els.zipInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importZip(f);
      e.target.value = '';
    });
    els.btnValidate.addEventListener('click', safe(() => { closeMobileMenu(); runValidator(); }));
    els.btnExportZip.addEventListener('click', safe(() => { closeMobileMenu(); return exportZip(); }));
    els.btnClearProject.addEventListener('click', safe(async () => {
      closeMobileMenu();
      const ok = await openConfirm({
        title: 'Clear project',
        message: 'This will delete all files in the current project from your browser. Export ZIP first if you want a copy. Continue?',
        okLabel: 'Clear project'
      });
      if (!ok) return;
      resetProject();
      toast('Project cleared.', 'info');
    }));

    els.btnMobileMenu.addEventListener('click', () => {
      els.headerActions.classList.toggle('show');
    });

    // Templates
    $$('.template-card').forEach(card => {
      card.addEventListener('click', () => {
        const tpl = card.dataset.template;
        hideModal(els.modalTemplates);
        // Always apply directly. Picking a template IS the confirmation.
        // (Avoids a second modal that was getting stuck on some mobile browsers.)
        applyTemplate(tpl);
      });
    });
    $$('[data-close="modalTemplates"]').forEach(b => b.addEventListener('click', () => hideModal(els.modalTemplates)));

    // File explorer
    els.btnNewFile.addEventListener('click', safe(async () => {
      const path = await openPrompt({
        title: 'New file',
        message: 'Enter a file path (folders supported with /). Example: assets/icon.svg',
        defaultValue: 'newfile.js',
        okLabel: 'Create'
      });
      if (!path) return;
      if (createFile(path, '', { overwrite: false })) {
        switchToFile(path);
        toast(`Created ${path}`, 'success');
      }
    }));
    els.btnPanelNewProject.addEventListener('click', safe(() => {
      showModal(els.modalTemplates);
    }));
    els.btnPanelReset.addEventListener('click', safe(async () => {
      const ok = await openConfirm({
        title: 'Reset project',
        message: 'Delete all files in this project? Export your ZIP first if you want a copy.',
        okLabel: 'Reset'
      });
      if (!ok) return;
      resetProject();
      toast('Project reset. Tap "New" to start fresh.', 'info');
    }));
    els.btnCollapseFiles.addEventListener('click', () => {
      els.panelFiles.classList.toggle('collapsed');
    });

    els.projectNameInput.addEventListener('input', () => {
      state.projectName = els.projectNameInput.value || 'Untitled project';
      markModified();
      scheduleAutosave();
      updateStatusBar();
    });

    // Editor
    els.codeEditor.addEventListener('input', () => {
      markModified();
      updateEditorMeta();
      validateCurrentFileShallow();
      scheduleAutosave();
    });
    // Tab key inserts two spaces
    els.codeEditor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const ta = els.codeEditor;
        const start = ta.selectionStart, end = ta.selectionEnd;
        const insert = '  ';
        ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + insert.length;
        markModified();
        updateEditorMeta();
        scheduleAutosave();
      }
    });

    els.btnCopyCode.addEventListener('click', async () => {
      const v = els.codeEditor.value || '';
      try {
        await navigator.clipboard.writeText(v);
        toast('Copied to clipboard.', 'success');
      } catch (e) {
        // Fallback
        els.codeEditor.select();
        document.execCommand('copy');
        toast('Copied.', 'success');
      }
    });

    els.btnFormatJson.addEventListener('click', () => {
      try {
        const obj = JSON.parse(els.codeEditor.value || '{}');
        const formatted = JSON.stringify(obj, null, 2);
        els.codeEditor.value = formatted;
        markModified();
        updateEditorMeta();
        validateCurrentFileShallow();
        scheduleAutosave();
        toast('JSON formatted.', 'success');
      } catch (e) {
        toast('Invalid JSON: ' + e.message, 'error');
      }
    });

    els.btnRenameFile.addEventListener('click', async () => {
      if (!state.currentFile) return;
      const next = await openPrompt({
        title: 'Rename file',
        message: `Rename "${state.currentFile}" to:`,
        defaultValue: state.currentFile,
        okLabel: 'Rename'
      });
      if (!next || next === state.currentFile) return;
      flushEditorToFile();
      renameFile(state.currentFile, next);
    });

    els.btnDuplicateFile.addEventListener('click', () => {
      if (!state.currentFile) return;
      flushEditorToFile();
      duplicateFile(state.currentFile);
    });

    els.btnDeleteFile.addEventListener('click', async () => {
      if (!state.currentFile) return;
      const path = state.currentFile;
      const ok = await openConfirm({
        title: 'Delete file',
        message: `Delete "${path}"? This cannot be undone.`,
        okLabel: 'Delete'
      });
      if (!ok) return;
      deleteFile(path);
      toast(`Deleted ${path}`, 'info');
    });

    // Tabs
    els.tabs.forEach(t => t.addEventListener('click', () => activateTab(t.dataset.tab)));

    // Validator
    els.btnRunValidator.addEventListener('click', () => runValidator());

    // AI buttons
    els.btnAIGenerate.addEventListener('click', () => aiGenerate());
    els.btnAIModify.addEventListener('click', () => aiOnCurrentFile('modify'));
    els.btnAIExplain.addEventListener('click', () => aiOnCurrentFile('explain'));
    els.btnAIFix.addEventListener('click', () => aiOnCurrentFile('fix'));
    els.btnAIImprove.addEventListener('click', () => aiOnCurrentFile('improve'));
    els.btnAIAccept.addEventListener('click', () => acceptAI());
    els.btnAIReject.addEventListener('click', () => { hideAIOutput(); toast('AI suggestion discarded.', 'info'); });
    els.btnAICopy.addEventListener('click', async () => {
      const text = els.aiOutputBody.textContent || '';
      try { await navigator.clipboard.writeText(text); toast('Copied.', 'success'); }
      catch (e) { toast('Copy failed.', 'error'); }
    });

    // Save before unload
    window.addEventListener('beforeunload', () => {
      flushEditorToFile();
      saveProjectToStorage();
    });

    // Periodic relative-time refresh in status bar
    setInterval(() => updateStatusBar(), 30000);
  }

  /* ============== 12. INIT ============== */

  function init() {
    bindEls();
    bindEvents();

    // Load existing project or show empty workspace
    const loaded = loadProjectFromStorage();
    if (!loaded || Object.keys(state.files).length === 0) {
      // Empty workspace, prompt user via UI
      state.files = {};
      state.currentFile = null;
      state.projectName = 'Untitled project';
    }

    renderFileList();
    loadCurrentFileToEditor();
    updateStatusBar();

    // AI availability — puter.js loads async, so check now and after a short delay
    checkAIAvailability();
    setTimeout(checkAIAvailability, 1200);
    setTimeout(checkAIAvailability, 3000);

    // Default tab
    activateTab('ai');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
