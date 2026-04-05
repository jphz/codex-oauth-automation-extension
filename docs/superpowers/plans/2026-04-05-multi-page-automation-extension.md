# Multi-Page Automation Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension (MV3) that automates a 9-step OAuth registration workflow across VPS panel, OpenAI auth, QQ Mail, and ChatGPT, controlled via a persistent Side Panel.

**Architecture:** Side Panel (UI control) ↔ Background Service Worker (orchestration, state, tab management) ↔ Content Scripts (per-domain DOM automation). All state in `chrome.storage.session`. Unified message protocol across all components. Shared `utils.js` for DOM utilities.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JS, Chrome APIs (sidePanel, tabs, webNavigation, storage, scripting)

**Spec:** `docs/superpowers/specs/2026-04-05-multi-page-automation-extension-design.md`

---

## File Structure

```
multiPagePlugins/
├── manifest.json                  # Extension manifest (MV3)
├── background.js                  # Service worker: orchestration, tab mgmt, state, message routing
├── sidepanel/
│   ├── sidepanel.html             # Side Panel markup
│   ├── sidepanel.css              # Side Panel styles
│   └── sidepanel.js               # Side Panel logic: buttons, log, state restore
├── content/
│   ├── utils.js                   # Shared utilities: waitForElement, fillInput, log, report*
│   ├── vps-panel.js               # Content script for VPS panel (steps 1, 9)
│   ├── signup-page.js             # Content script for OpenAI auth (steps 2, 3, 4-receive, 5)
│   ├── qq-mail.js                 # Content script for QQ Mail (steps 4, 7)
│   └── chatgpt.js                 # Content script for ChatGPT (steps 6, 7-receive, 8)
├── data/
│   └── names.js                   # English first/last name lists for random generation
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── docs/
    └── superpowers/
        ├── specs/...
        └── plans/...
```

**Responsibilities by file:**

| File | Responsibility |
|------|---------------|
| `manifest.json` | Permissions, content script registration, side panel config |
| `background.js` | Message routing, tab registry, state persistence, step orchestration, webNavigation listener, random data generation |
| `sidepanel/sidepanel.js` | Render UI, handle button clicks, display logs, state restore on open, send step commands to background |
| `content/utils.js` | `waitForElement`, `fillInput`, `log`, `reportReady`, `reportComplete`, `reportError` |
| `content/vps-panel.js` | DOM ops on VPS panel for steps 1 and 9 |
| `content/signup-page.js` | DOM ops on OpenAI auth pages for steps 2, 3, 4(fill code), 5 |
| `content/qq-mail.js` | Email polling, code extraction for steps 4 and 7 |
| `content/chatgpt.js` | DOM ops on ChatGPT for steps 6, 7(fill code), 8 |
| `data/names.js` | Static arrays of first names and last names |

---

## Chunk 1: Foundation (manifest, utils, background core, side panel shell)

### Task 1: Create manifest.json

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Write manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Multi-Page Automation",
  "version": "1.0.0",
  "description": "Automates multi-step OAuth registration workflow",
  "permissions": [
    "sidePanel",
    "tabs",
    "webNavigation",
    "storage",
    "scripting",
    "activeTab"
  ],
  "host_permissions": [
    "http://154.26.182.181:8317/*",
    "https://auth0.openai.com/*",
    "https://auth.openai.com/*",
    "https://accounts.openai.com/*",
    "https://mail.qq.com/*",
    "https://wx.mail.qq.com/*",
    "https://chatgpt.com/*",
    "http://localhost/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "content_scripts": [
    {
      "matches": ["http://154.26.182.181:8317/*"],
      "js": ["content/utils.js", "content/vps-panel.js"],
      "run_at": "document_idle"
    },
    {
      "matches": [
        "https://auth0.openai.com/*",
        "https://auth.openai.com/*",
        "https://accounts.openai.com/*"
      ],
      "js": ["content/utils.js", "content/signup-page.js"],
      "run_at": "document_idle"
    },
    {
      "matches": [
        "https://mail.qq.com/*",
        "https://wx.mail.qq.com/*"
      ],
      "js": ["content/utils.js", "content/qq-mail.js"],
      "all_frames": true,
      "run_at": "document_idle"
    },
    {
      "matches": ["https://chatgpt.com/*"],
      "js": ["content/utils.js", "content/chatgpt.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: Create placeholder icons**

Create simple colored square PNGs at 16x16, 48x48, 128x128 (can use canvas or any generator). These are required for Chrome to load the extension.

- [ ] **Step 3: Verify manifest loads**

Load the extension in `chrome://extensions` (Developer mode → Load unpacked). Confirm no manifest errors.

- [ ] **Step 4: Commit**

```bash
git add manifest.json icons/
git commit -m "feat: add manifest.json with MV3 config and placeholder icons"
```

---

### Task 2: Create shared utils.js

**Files:**
- Create: `content/utils.js`

- [ ] **Step 1: Write utils.js with all shared functions**

```js
// content/utils.js — Shared utilities for all content scripts

const SCRIPT_SOURCE = (() => {
  const url = location.href;
  if (url.includes('154.26.182.181')) return 'vps-panel';
  if (url.includes('auth0.openai.com') || url.includes('auth.openai.com') || url.includes('accounts.openai.com')) return 'signup-page';
  if (url.includes('mail.qq.com')) return 'qq-mail';
  if (url.includes('chatgpt.com')) return 'chatgpt';
  return 'unknown';
})();

const LOG_PREFIX = `[MultiPage:${SCRIPT_SOURCE}]`;

/**
 * Wait for a DOM element to appear.
 * @param {string} selector - CSS selector
 * @param {number} timeout - Max wait time in ms (default 10000)
 * @returns {Promise<Element>}
 */
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) {
      console.log(LOG_PREFIX, `Found immediately: ${selector}`);
      log(`Found element: ${selector}`);
      resolve(existing);
      return;
    }

    console.log(LOG_PREFIX, `Waiting for: ${selector} (timeout: ${timeout}ms)`);
    log(`Waiting for selector: ${selector}...`);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        console.log(LOG_PREFIX, `Found after wait: ${selector}`);
        log(`Found element: ${selector}`);
        resolve(el);
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      const msg = `Timeout waiting for ${selector} after ${timeout}ms on ${location.href}`;
      console.error(LOG_PREFIX, msg);
      reject(new Error(msg));
    }, timeout);
  });
}

/**
 * React-compatible form filling.
 * Sets value via native setter and dispatches input + change events.
 * @param {HTMLInputElement} el
 * @param {string} value
 */
function fillInput(el, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;
  nativeInputValueSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  console.log(LOG_PREFIX, `Filled input ${el.name || el.id || el.type} with: ${value}`);
  log(`Filled input [${el.name || el.id || el.type || 'unknown'}]`);
}

/**
 * Send a log message to Side Panel via Background.
 * @param {string} message
 * @param {string} level - 'info' | 'ok' | 'warn' | 'error'
 */
function log(message, level = 'info') {
  chrome.runtime.sendMessage({
    type: 'LOG',
    source: SCRIPT_SOURCE,
    step: null,
    payload: { message, level, timestamp: Date.now() },
    error: null,
  });
}

/**
 * Report that this content script is loaded and ready.
 */
function reportReady() {
  console.log(LOG_PREFIX, 'Content script ready');
  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    source: SCRIPT_SOURCE,
    step: null,
    payload: {},
    error: null,
  });
}

/**
 * Report step completion.
 * @param {number} step
 * @param {Object} data - Step output data
 */
function reportComplete(step, data = {}) {
  console.log(LOG_PREFIX, `Step ${step} completed`, data);
  log(`Step ${step} completed successfully`, 'ok');
  chrome.runtime.sendMessage({
    type: 'STEP_COMPLETE',
    source: SCRIPT_SOURCE,
    step,
    payload: data,
    error: null,
  });
}

/**
 * Report step error.
 * @param {number} step
 * @param {string} errorMessage
 */
function reportError(step, errorMessage) {
  console.error(LOG_PREFIX, `Step ${step} failed: ${errorMessage}`);
  log(`Step ${step} failed: ${errorMessage}`, 'error');
  chrome.runtime.sendMessage({
    type: 'STEP_ERROR',
    source: SCRIPT_SOURCE,
    step,
    payload: {},
    error: errorMessage,
  });
}

/**
 * Simulate a click with proper event dispatching.
 * @param {Element} el
 */
function simulateClick(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  console.log(LOG_PREFIX, `Clicked: ${el.tagName} ${el.textContent?.slice(0, 30) || ''}`);
  log(`Clicked [${el.tagName}] "${el.textContent?.trim().slice(0, 30) || ''}"`);
}

// Auto-report ready on load
reportReady();
```

- [ ] **Step 2: Reload extension, visit any matched URL**

Load extension in Chrome. Open `http://154.26.182.181:8317/management.html#/oauth`. Check the Background service worker console in `chrome://extensions` — should see the `CONTENT_SCRIPT_READY` message from vps-panel.

- [ ] **Step 3: Commit**

```bash
git add content/utils.js
git commit -m "feat: add shared utils.js with waitForElement, fillInput, logging, and ready protocol"
```

---

### Task 3: Create name data

**Files:**
- Create: `data/names.js`

- [ ] **Step 1: Write names.js**

```js
// data/names.js — English name lists for random generation

const FIRST_NAMES = [
  'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Christopher',
  'Mary', 'Patricia', 'Jennifer', 'Linda', 'Barbara', 'Elizabeth', 'Susan', 'Jessica', 'Sarah', 'Karen',
  'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Andrew', 'Paul', 'Joshua', 'Kenneth',
  'Emma', 'Olivia', 'Ava', 'Isabella', 'Sophia', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
];

/**
 * Generate a random full name.
 * @returns {{ firstName: string, lastName: string }}
 */
function generateRandomName() {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return { firstName, lastName };
}

/**
 * Generate a random birthday (age 19-25).
 * @returns {{ year: number, month: number, day: number }}
 */
function generateRandomBirthday() {
  const currentYear = new Date().getFullYear();
  const age = 19 + Math.floor(Math.random() * 7); // 19 to 25
  const year = currentYear - age;
  const month = 1 + Math.floor(Math.random() * 12); // 1 to 12
  const maxDay = new Date(year, month, 0).getDate(); // days in that month
  const day = 1 + Math.floor(Math.random() * maxDay);
  return { year, month, day };
}
```

- [ ] **Step 2: Commit**

```bash
git add data/names.js
git commit -m "feat: add random English name and birthday generation data"
```

---

### Task 4: Create Background Service Worker — core infrastructure

**Files:**
- Create: `background.js`

This task covers the core infrastructure: state management, tab registry, message routing, and command queuing. Step orchestration (per-step logic) is added in later tasks.

- [ ] **Step 1: Write background.js core**

```js
// background.js — Service Worker: orchestration, state, tab management, message routing

const LOG_PREFIX = '[MultiPage:bg]';

// ============================================================
// State Management (chrome.storage.session)
// ============================================================

const DEFAULT_STATE = {
  currentStep: 0,
  stepStatuses: { 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending', 6: 'pending', 7: 'pending', 8: 'pending', 9: 'pending' },
  oauthUrl: null,
  email: null,
  password: 'mimashisha0.0',
  lastEmailTimestamp: null,
  localhostUrl: null,
  flowStartTime: null,
  tabRegistry: {},
  logs: [],
};

async function getState() {
  const state = await chrome.storage.session.get(null);
  return { ...DEFAULT_STATE, ...state };
}

async function setState(updates) {
  console.log(LOG_PREFIX, 'storage.set:', JSON.stringify(updates).slice(0, 200));
  await chrome.storage.session.set(updates);
}

async function resetState() {
  console.log(LOG_PREFIX, 'Resetting all state');
  await chrome.storage.session.clear();
  await chrome.storage.session.set({ ...DEFAULT_STATE });
}

// ============================================================
// Tab Registry
// ============================================================

async function getTabRegistry() {
  const state = await getState();
  return state.tabRegistry || {};
}

async function registerTab(source, tabId) {
  const registry = await getTabRegistry();
  registry[source] = { tabId, ready: true };
  await setState({ tabRegistry: registry });
  console.log(LOG_PREFIX, `Tab registered: ${source} → ${tabId}`);
}

async function isTabAlive(source) {
  const registry = await getTabRegistry();
  const entry = registry[source];
  if (!entry) return false;
  try {
    await chrome.tabs.get(entry.tabId);
    return true;
  } catch {
    // Tab no longer exists
    registry[source] = null;
    await setState({ tabRegistry: registry });
    return false;
  }
}

async function getTabId(source) {
  const registry = await getTabRegistry();
  return registry[source]?.tabId || null;
}

// ============================================================
// Command Queue (for content scripts not yet ready)
// ============================================================

const pendingCommands = new Map(); // source → { message, resolve, reject, timer }

function queueCommand(source, message, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(source);
      const err = `Content script on ${source} did not respond in ${timeout / 1000}s. Try refreshing the tab and retry.`;
      console.error(LOG_PREFIX, err);
      reject(new Error(err));
    }, timeout);
    pendingCommands.set(source, { message, resolve, reject, timer });
    console.log(LOG_PREFIX, `Command queued for ${source} (waiting for ready)`);
  });
}

function flushCommand(source, tabId) {
  const pending = pendingCommands.get(source);
  if (pending) {
    clearTimeout(pending.timer);
    pendingCommands.delete(source);
    chrome.tabs.sendMessage(tabId, pending.message).then(pending.resolve).catch(pending.reject);
    console.log(LOG_PREFIX, `Flushed queued command to ${source} (tab ${tabId})`);
  }
}

// ============================================================
// Send command to content script (with readiness check)
// ============================================================

async function sendToContentScript(source, message) {
  const registry = await getTabRegistry();
  const entry = registry[source];

  if (!entry || !entry.ready) {
    console.log(LOG_PREFIX, `${source} not ready, queuing command`);
    return queueCommand(source, message);
  }

  // Verify tab is still alive
  const alive = await isTabAlive(source);
  if (!alive) {
    throw new Error(`Tab [${source}] was closed. Will reopen on retry.`);
  }

  console.log(LOG_PREFIX, `Sending to ${source} (tab ${entry.tabId}):`, message.type);
  return chrome.tabs.sendMessage(entry.tabId, message);
}

// ============================================================
// Logging
// ============================================================

async function addLog(message, level = 'info') {
  const state = await getState();
  const logs = state.logs || [];
  const entry = { message, level, timestamp: Date.now() };
  logs.push(entry);
  // Keep last 500 logs
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  await setState({ logs });
  // Broadcast to side panel
  chrome.runtime.sendMessage({ type: 'LOG_ENTRY', payload: entry }).catch(() => {});
}

// ============================================================
// Step Status Management
// ============================================================

async function setStepStatus(step, status) {
  const state = await getState();
  const statuses = { ...state.stepStatuses };
  statuses[step] = status;
  await setState({ stepStatuses: statuses, currentStep: step });
  // Broadcast to side panel
  chrome.runtime.sendMessage({
    type: 'STEP_STATUS_CHANGED',
    payload: { step, status },
  }).catch(() => {});
}

// ============================================================
// Message Handler (central router)
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(LOG_PREFIX, `Received: ${message.type} from ${message.source || 'sidepanel'}`, message);

  handleMessage(message, sender).then(response => {
    sendResponse(response);
  }).catch(err => {
    console.error(LOG_PREFIX, 'Handler error:', err);
    sendResponse({ error: err.message });
  });

  return true; // async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'CONTENT_SCRIPT_READY': {
      const tabId = sender.tab?.id;
      if (tabId && message.source) {
        await registerTab(message.source, tabId);
        flushCommand(message.source, tabId);
        await addLog(`Content script ready: ${message.source} (tab ${tabId})`);
      }
      return { ok: true };
    }

    case 'LOG': {
      const { message: msg, level } = message.payload;
      await addLog(`[${message.source}] ${msg}`, level);
      return { ok: true };
    }

    case 'STEP_COMPLETE': {
      await setStepStatus(message.step, 'completed');
      await addLog(`Step ${message.step} completed`, 'ok');
      // Store step-specific data
      await handleStepData(message.step, message.payload);
      return { ok: true };
    }

    case 'STEP_ERROR': {
      await setStepStatus(message.step, 'failed');
      await addLog(`Step ${message.step} failed: ${message.error}`, 'error');
      return { ok: true };
    }

    case 'GET_STATE': {
      return await getState();
    }

    case 'RESET': {
      await resetState();
      await addLog('Flow reset', 'info');
      return { ok: true };
    }

    case 'EXECUTE_STEP': {
      const step = message.payload.step;
      await executeStep(step);
      return { ok: true };
    }

    default:
      console.warn(LOG_PREFIX, `Unknown message type: ${message.type}`);
      return { error: `Unknown message type: ${message.type}` };
  }
}

// ============================================================
// Step Data Handlers
// ============================================================

async function handleStepData(step, payload) {
  switch (step) {
    case 1:
      if (payload.oauthUrl) await setState({ oauthUrl: payload.oauthUrl });
      break;
    case 3:
      if (payload.email) await setState({ email: payload.email });
      break;
    case 4:
      if (payload.emailTimestamp) await setState({ lastEmailTimestamp: payload.emailTimestamp });
      break;
    case 8:
      if (payload.localhostUrl) await setState({ localhostUrl: payload.localhostUrl });
      break;
  }
}

// ============================================================
// Step Execution (stub — each step implemented in later tasks)
// ============================================================

async function executeStep(step) {
  console.log(LOG_PREFIX, `Executing step ${step}`);
  await setStepStatus(step, 'running');
  await addLog(`Step ${step} started`);

  const state = await getState();

  // Set flow start time on first step
  if (step === 1 && !state.flowStartTime) {
    await setState({ flowStartTime: Date.now() });
  }

  try {
    switch (step) {
      case 1: await executeStep1(state); break;
      case 2: await executeStep2(state); break;
      case 3: await executeStep3(state); break;
      case 4: await executeStep4(state); break;
      case 5: await executeStep5(state); break;
      case 6: await executeStep6(state); break;
      case 7: await executeStep7(state); break;
      case 8: await executeStep8(state); break;
      case 9: await executeStep9(state); break;
      default:
        throw new Error(`Unknown step: ${step}`);
    }
  } catch (err) {
    await setStepStatus(step, 'failed');
    await addLog(`Step ${step} failed: ${err.message}`, 'error');
  }
}

// Step stubs — implemented in subsequent tasks
async function executeStep1(state) { await sendToContentScript('vps-panel', { type: 'EXECUTE_STEP', step: 1, payload: {} }); }
async function executeStep2(state) { /* Task 7 */ }
async function executeStep3(state) { /* Task 7 */ }
async function executeStep4(state) { /* Task 8 */ }
async function executeStep5(state) { /* Task 7 */ }
async function executeStep6(state) { /* Task 9 */ }
async function executeStep7(state) { /* Task 8 */ }
async function executeStep8(state) { /* Task 9 */ }
async function executeStep9(state) { await sendToContentScript('vps-panel', { type: 'EXECUTE_STEP', step: 9, payload: {} }); }

// ============================================================
// Open Side Panel on extension icon click
// ============================================================

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Enable side panel for all URLs
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
```

- [ ] **Step 2: Reload extension, check service worker**

Reload in `chrome://extensions`. Click "Service Worker" link to open DevTools for Background. Confirm no errors. Check that `chrome.storage.session` is initialized (can run `chrome.storage.session.get(null)` in console).

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: add background service worker with state management, tab registry, message routing, and command queue"
```

---

### Task 5: Create Side Panel (HTML + CSS + JS)

**Files:**
- Create: `sidepanel/sidepanel.html`
- Create: `sidepanel/sidepanel.css`
- Create: `sidepanel/sidepanel.js`

- [ ] **Step 1: Write sidepanel.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Multi-Page Automation</title>
  <link rel="stylesheet" href="sidepanel.css">
</head>
<body>
  <header>
    <h1>Multi-Page Automation</h1>
    <button id="btn-reset" title="Reset all steps">Reset</button>
  </header>

  <section id="data-section">
    <div class="data-row">
      <label>OAuth URL:</label>
      <span id="display-oauth-url" class="data-value">Not obtained</span>
    </div>
    <div class="data-row">
      <label>Email:</label>
      <input type="text" id="input-email" placeholder="Paste DuckDuckGo email here" />
    </div>
    <div class="data-row">
      <label>Status:</label>
      <span id="display-status" class="data-value">Waiting</span>
    </div>
  </section>

  <section id="steps-section">
    <div class="step-row" data-step="1">
      <span class="step-num">1</span>
      <button class="step-btn" data-step="1">Get OAuth Link</button>
      <span class="step-status" data-step="1">⬚</span>
    </div>
    <div class="step-row" data-step="2">
      <span class="step-num">2</span>
      <button class="step-btn" data-step="2">Open Signup</button>
      <span class="step-status" data-step="2">⬚</span>
    </div>
    <div class="step-row" data-step="3">
      <span class="step-num">3</span>
      <button class="step-btn" data-step="3">Fill Email/Password</button>
      <span class="step-status" data-step="3">⬚</span>
    </div>
    <div class="step-row" data-step="4">
      <span class="step-num">4</span>
      <button class="step-btn" data-step="4">Get Signup Code</button>
      <span class="step-status" data-step="4">⬚</span>
    </div>
    <div class="step-row" data-step="5">
      <span class="step-num">5</span>
      <button class="step-btn" data-step="5">Fill Name/Birthday</button>
      <span class="step-status" data-step="5">⬚</span>
    </div>
    <div class="step-row" data-step="6">
      <span class="step-num">6</span>
      <button class="step-btn" data-step="6">Login ChatGPT</button>
      <span class="step-status" data-step="6">⬚</span>
    </div>
    <div class="step-row" data-step="7">
      <span class="step-num">7</span>
      <button class="step-btn" data-step="7">Get Login Code</button>
      <span class="step-status" data-step="7">⬚</span>
    </div>
    <div class="step-row" data-step="8">
      <span class="step-num">8</span>
      <button class="step-btn" data-step="8">Complete OAuth</button>
      <span class="step-status" data-step="8">⬚</span>
    </div>
    <div class="step-row" data-step="9">
      <span class="step-num">9</span>
      <button class="step-btn" data-step="9">VPS Verify</button>
      <span class="step-status" data-step="9">⬚</span>
    </div>
  </section>

  <section id="log-section">
    <h2>Log</h2>
    <div id="log-area"></div>
  </section>

  <script src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write sidepanel.css**

```css
/* sidepanel/sidepanel.css */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: #333;
  background: #f8f9fa;
  padding: 12px;
  width: 100%;
  min-height: 100vh;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

header h1 {
  font-size: 15px;
  font-weight: 600;
}

#btn-reset {
  padding: 4px 10px;
  font-size: 12px;
  background: #dc3545;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
#btn-reset:hover { background: #c82333; }

/* Data Section */
#data-section {
  background: #fff;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 12px;
}

.data-row {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.data-row:last-child { margin-bottom: 0; }

.data-row label {
  width: 80px;
  font-weight: 600;
  font-size: 12px;
  color: #666;
  flex-shrink: 0;
}

.data-value {
  font-size: 12px;
  color: #999;
  word-break: break-all;
}

#input-email {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 12px;
}

/* Steps Section */
#steps-section {
  margin-bottom: 12px;
}

.step-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.step-num {
  width: 20px;
  text-align: center;
  font-weight: 600;
  font-size: 12px;
  color: #666;
}

.step-btn {
  flex: 1;
  padding: 6px 10px;
  font-size: 12px;
  background: #007bff;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}
.step-btn:hover:not(:disabled) { background: #0069d9; }
.step-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.step-status {
  width: 24px;
  text-align: center;
  font-size: 14px;
}

/* Log Section */
#log-section h2 {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

#log-area {
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.5;
  padding: 8px;
  border-radius: 6px;
  height: 250px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.log-info { color: #d4d4d4; }
.log-ok { color: #4ec9b0; }
.log-warn { color: #dcdcaa; }
.log-error { color: #f44747; }
```

- [ ] **Step 3: Write sidepanel.js**

```js
// sidepanel/sidepanel.js — Side Panel logic

const STATUS_ICONS = {
  pending: '⬚',
  running: '⏳',
  completed: '✅',
  failed: '❌',
};

const logArea = document.getElementById('log-area');
const displayOauthUrl = document.getElementById('display-oauth-url');
const displayStatus = document.getElementById('display-status');
const inputEmail = document.getElementById('input-email');
const btnReset = document.getElementById('btn-reset');

// ============================================================
// State Restore on load
// ============================================================

async function restoreState() {
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'sidepanel' });

  // Restore data fields
  if (state.oauthUrl) {
    displayOauthUrl.textContent = state.oauthUrl;
    displayOauthUrl.style.color = '#333';
  }
  if (state.email) {
    inputEmail.value = state.email;
  }

  // Restore step statuses
  if (state.stepStatuses) {
    for (const [step, status] of Object.entries(state.stepStatuses)) {
      updateStepUI(Number(step), status);
    }
  }

  // Restore logs
  if (state.logs) {
    for (const entry of state.logs) {
      appendLog(entry);
    }
  }

  updateStatusDisplay(state);
}

// ============================================================
// UI Updates
// ============================================================

function updateStepUI(step, status) {
  const statusEl = document.querySelector(`.step-status[data-step="${step}"]`);
  const btnEl = document.querySelector(`.step-btn[data-step="${step}"]`);
  if (statusEl) statusEl.textContent = STATUS_ICONS[status] || '⬚';

  // Interlock logic
  updateButtonStates();
}

function updateButtonStates() {
  // Get all current statuses from DOM
  const statuses = {};
  document.querySelectorAll('.step-status').forEach(el => {
    const step = Number(el.dataset.step);
    const icon = el.textContent;
    const status = Object.entries(STATUS_ICONS).find(([, v]) => v === icon)?.[0] || 'pending';
    statuses[step] = status;
  });

  // Find if any step is running
  const anyRunning = Object.values(statuses).some(s => s === 'running');

  for (let step = 1; step <= 9; step++) {
    const btn = document.querySelector(`.step-btn[data-step="${step}"]`);
    if (!btn) continue;

    if (anyRunning) {
      // When any step is running, disable all buttons
      btn.disabled = true;
    } else if (step === 1) {
      // Step 1 is always available (unless running)
      btn.disabled = false;
    } else {
      // Steps 2-9: enabled if previous step completed (or current step failed for retry)
      const prevStatus = statuses[step - 1];
      const currentStatus = statuses[step];
      btn.disabled = !(prevStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'completed');
    }
  }
}

function updateStatusDisplay(state) {
  if (!state.stepStatuses) return;
  const running = Object.entries(state.stepStatuses).find(([, s]) => s === 'running');
  if (running) {
    displayStatus.textContent = `Step ${running[0]} running...`;
  } else {
    const lastCompleted = Object.entries(state.stepStatuses)
      .filter(([, s]) => s === 'completed')
      .map(([k]) => Number(k))
      .sort((a, b) => b - a)[0];
    if (lastCompleted === 9) {
      displayStatus.textContent = 'All steps completed!';
    } else if (lastCompleted) {
      displayStatus.textContent = `Step ${lastCompleted} done. Ready for step ${lastCompleted + 1}.`;
    } else {
      displayStatus.textContent = 'Waiting';
    }
  }
}

function appendLog(entry) {
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
  const levelLabel = entry.level.toUpperCase().padEnd(5);
  const line = document.createElement('div');
  line.className = `log-${entry.level}`;
  line.textContent = `${time} [${levelLabel}] ${entry.message}`;
  logArea.appendChild(line);
  logArea.scrollTop = logArea.scrollHeight;
}

// ============================================================
// Button Handlers
// ============================================================

document.querySelectorAll('.step-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const step = Number(btn.dataset.step);

    // Save email if step 3 and email input has value
    if (step === 3) {
      const email = inputEmail.value.trim();
      if (!email) {
        appendLog({ message: 'Please paste email address first', level: 'error', timestamp: Date.now() });
        return;
      }
      await chrome.runtime.sendMessage({
        type: 'EXECUTE_STEP',
        source: 'sidepanel',
        payload: { step, email },
      });
    } else {
      await chrome.runtime.sendMessage({
        type: 'EXECUTE_STEP',
        source: 'sidepanel',
        payload: { step },
      });
    }
  });
});

// Reset button
btnReset.addEventListener('click', async () => {
  if (confirm('Reset all steps and data?')) {
    await chrome.runtime.sendMessage({ type: 'RESET', source: 'sidepanel' });
    // Clear UI
    displayOauthUrl.textContent = 'Not obtained';
    displayOauthUrl.style.color = '#999';
    inputEmail.value = '';
    displayStatus.textContent = 'Waiting';
    logArea.innerHTML = '';
    document.querySelectorAll('.step-status').forEach(el => el.textContent = '⬚');
    updateButtonStates();
  }
});

// ============================================================
// Listen for Background broadcasts
// ============================================================

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'LOG_ENTRY':
      appendLog(message.payload);
      break;

    case 'STEP_STATUS_CHANGED': {
      const { step, status } = message.payload;
      updateStepUI(step, status);
      // Update status display
      chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'sidepanel' }).then(updateStatusDisplay);
      // Update data displays
      if (status === 'completed') {
        chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'sidepanel' }).then(state => {
          if (state.oauthUrl) {
            displayOauthUrl.textContent = state.oauthUrl;
            displayOauthUrl.style.color = '#333';
          }
        });
      }
      break;
    }
  }
});

// ============================================================
// Init
// ============================================================

restoreState().then(() => {
  updateButtonStates();
});
```

- [ ] **Step 4: Reload extension, open Side Panel**

Click the extension icon → Side Panel should open on the right. Verify:
- All 9 step buttons visible
- Only step 1 button enabled, rest disabled
- Log area is empty
- Reset button is present
- Email input field is editable

- [ ] **Step 5: Test Reset button**

Click Reset → confirm dialog → all steps should reset to ⬚.

- [ ] **Step 6: Commit**

```bash
git add sidepanel/
git commit -m "feat: add Side Panel UI with step buttons, log area, state restore, and interlock logic"
```

---

## Chunk 2: Content Scripts — VPS Panel & Signup Page

### Task 6: Create vps-panel.js content script

**Files:**
- Create: `content/vps-panel.js`

- [ ] **Step 1: Write vps-panel.js**

```js
// content/vps-panel.js — Content script for VPS panel (steps 1, 9)
// Injected on: http://154.26.182.181:8317/*

console.log('[MultiPage:vps-panel] Content script loaded on', location.href);

// Listen for commands from Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXECUTE_STEP') {
    handleStep(message.step, message.payload).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      reportError(message.step, err.message);
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function handleStep(step, payload) {
  switch (step) {
    case 1: return await step1_getOAuthLink();
    case 9: return await step9_vpsVerify(payload);
    default:
      throw new Error(`vps-panel.js does not handle step ${step}`);
  }
}

// ============================================================
// Step 1: Get OAuth Link
// ============================================================

async function step1_getOAuthLink() {
  log('Step 1: Checking VPS panel login state...');

  // TODO: Adjust selector after inspecting actual VPS panel DOM
  // Check login state — look for a known element that only appears when logged in
  // For now, we check if the page has loaded the management content
  const pageContent = document.body.innerText;
  if (pageContent.includes('login') && !pageContent.includes('oauth')) {
    throw new Error('VPS panel not logged in. Please log in to VPS panel at http://154.26.182.181:8317 and retry.');
  }

  log('Step 1: Looking for OAuth login button...');

  // TODO: Adjust selectors based on actual VPS panel DOM structure
  // These are placeholder selectors — must be updated during debugging
  const oauthBtn = await waitForElement('[data-action="oauth-login"], .oauth-login-btn, button:has-text("OAuth")', 10000)
    .catch(() => {
      // Fallback: try to find any button with OAuth-related text
      const buttons = [...document.querySelectorAll('button, a, [role="button"]')];
      const btn = buttons.find(b => /oauth/i.test(b.textContent));
      if (btn) return btn;
      throw new Error('Could not find OAuth login button. Check VPS panel page structure in DevTools.');
    });

  simulateClick(oauthBtn);
  log('Step 1: Clicked OAuth login, waiting for Codex login...');

  // Wait for Codex login option to appear
  await new Promise(r => setTimeout(r, 1000)); // Brief wait for UI transition

  const codexBtn = await waitForElement('[data-action="codex-login"], .codex-login-btn', 10000)
    .catch(() => {
      const buttons = [...document.querySelectorAll('button, a, [role="button"]')];
      const btn = buttons.find(b => /codex/i.test(b.textContent));
      if (btn) return btn;
      throw new Error('Could not find Codex login button. Check VPS panel DOM after clicking OAuth.');
    });

  simulateClick(codexBtn);
  log('Step 1: Clicked Codex login, waiting for auth URL...');

  // Wait for the auth URL to appear in the page
  await new Promise(r => setTimeout(r, 2000)); // Wait for URL generation

  // TODO: Adjust how the URL is extracted — may be in a text field, link, or copied to clipboard
  const urlElement = await waitForElement('input[readonly], .auth-url, textarea, code', 10000)
    .catch(() => {
      // Fallback: search all text nodes for a URL matching auth pattern
      throw new Error('Could not find auth URL element. Check VPS panel DOM for the generated URL.');
    });

  const oauthUrl = urlElement.value || urlElement.textContent || urlElement.innerText;
  if (!oauthUrl || !oauthUrl.startsWith('http')) {
    throw new Error(`Invalid OAuth URL found: "${oauthUrl?.slice(0, 50)}". Expected URL starting with http.`);
  }

  log(`Step 1: OAuth URL obtained: ${oauthUrl.slice(0, 80)}...`);
  reportComplete(1, { oauthUrl: oauthUrl.trim() });
}

// ============================================================
// Step 9: VPS Verify
// ============================================================

async function step9_vpsVerify(payload) {
  log('Step 9: Looking for URL input field on VPS panel...');

  // Get localhostUrl from storage (passed via Background)
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  const localhostUrl = state.localhostUrl;
  if (!localhostUrl) {
    throw new Error('No localhost URL found. Complete step 8 first.');
  }

  // TODO: Adjust selector for the URL input field on VPS panel
  const urlInput = await waitForElement('input[placeholder*="localhost"], input[name="callback_url"], .callback-url-input', 10000)
    .catch(() => {
      throw new Error('Could not find URL input field on VPS panel. Check DOM structure.');
    });

  fillInput(urlInput, localhostUrl);
  log(`Step 9: Filled URL input with: ${localhostUrl}`);

  // Find and click verify button
  const verifyBtn = await waitForElement('button:has-text("verify"), .verify-btn, [data-action="verify"]', 10000)
    .catch(() => {
      const buttons = [...document.querySelectorAll('button, [role="button"]')];
      const btn = buttons.find(b => /verif|确认|验证/i.test(b.textContent));
      if (btn) return btn;
      throw new Error('Could not find verify button. Check VPS panel DOM.');
    });

  simulateClick(verifyBtn);
  log('Step 9: Clicked verify button');
  reportComplete(9);
}
```

- [ ] **Step 2: Reload extension, open VPS panel**

Navigate to `http://154.26.182.181:8317/management.html#/oauth`. Open DevTools console. Confirm `[MultiPage:vps-panel] Content script loaded` appears.

- [ ] **Step 3: Test step 1 via Side Panel**

Open Side Panel → click "Get OAuth Link" → observe logs. **Expected**: Will likely fail on selectors (TODO placeholders). Use DevTools to inspect actual DOM, note the correct selectors, then update the script.

- [ ] **Step 4: Commit**

```bash
git add content/vps-panel.js
git commit -m "feat: add vps-panel content script for steps 1 (get OAuth link) and 9 (VPS verify)"
```

---

### Task 7: Create signup-page.js content script + wire up steps 2, 3, 5

**Files:**
- Create: `content/signup-page.js`
- Modify: `background.js` — implement `executeStep2`, `executeStep3`, `executeStep5`

- [ ] **Step 1: Write signup-page.js**

```js
// content/signup-page.js — Content script for OpenAI auth pages (steps 2, 3, 4-receive, 5)
// Injected on: auth0.openai.com, auth.openai.com, accounts.openai.com

console.log('[MultiPage:signup-page] Content script loaded on', location.href);

// Listen for commands from Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXECUTE_STEP' || message.type === 'FILL_CODE') {
    handleCommand(message).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      reportError(message.step, err.message);
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function handleCommand(message) {
  switch (message.type) {
    case 'EXECUTE_STEP':
      switch (message.step) {
        case 2: return await step2_clickRegister();
        case 3: return await step3_fillEmailPassword(message.payload);
        case 5: return await step5_fillNameBirthday(message.payload);
        default: throw new Error(`signup-page.js does not handle step ${message.step}`);
      }
    case 'FILL_CODE':
      return await step4_fillVerificationCode(message.payload);
  }
}

// ============================================================
// Step 2: Click Register
// ============================================================

async function step2_clickRegister() {
  log('Step 2: Looking for Register/Sign up button...');

  // TODO: Adjust selectors based on actual OpenAI auth page
  const registerBtn = await waitForElement('a[href*="signup"], button:has-text("Sign up"), [data-action="signup"]', 10000)
    .catch(() => {
      const links = [...document.querySelectorAll('a, button')];
      const btn = links.find(b => /sign\s*up|register|注册|create/i.test(b.textContent));
      if (btn) return btn;
      throw new Error('Could not find Register/Sign up button. Check auth page DOM. URL: ' + location.href);
    });

  simulateClick(registerBtn);
  log('Step 2: Clicked Register button');
  reportComplete(2);
}

// ============================================================
// Step 3: Fill Email & Password
// ============================================================

async function step3_fillEmailPassword(payload) {
  const { email } = payload;
  if (!email) throw new Error('No email provided. Paste email in Side Panel first.');

  log(`Step 3: Filling email: ${email}`);

  // TODO: Adjust selectors
  const emailInput = await waitForElement('input[type="email"], input[name="email"], input[name="username"]', 10000)
    .catch(() => { throw new Error('Could not find email input field on signup page. URL: ' + location.href); });

  fillInput(emailInput, email);
  log('Step 3: Email filled');

  // Some signup flows show email first, then password on next page
  // Try to find password field — if not found, submit email first
  let passwordInput = document.querySelector('input[type="password"]');

  if (!passwordInput) {
    // Maybe need to submit email first to get to password page
    log('Step 3: No password field yet, looking for continue/submit button...');
    const submitBtn = await waitForElement('button[type="submit"], input[type="submit"]', 5000)
      .catch(() => {
        const buttons = [...document.querySelectorAll('button')];
        return buttons.find(b => /continue|next|submit|继续/i.test(b.textContent));
      });

    if (submitBtn) {
      simulateClick(submitBtn);
      log('Step 3: Submitted email, waiting for password field...');
      await new Promise(r => setTimeout(r, 2000));
    }

    passwordInput = await waitForElement('input[type="password"]', 10000)
      .catch(() => { throw new Error('Could not find password input after submitting email. URL: ' + location.href); });
  }

  fillInput(passwordInput, 'mimashisha0.0');
  log('Step 3: Password filled');

  // Submit
  const submitBtn = await waitForElement('button[type="submit"], input[type="submit"]', 5000)
    .catch(() => {
      const buttons = [...document.querySelectorAll('button')];
      return buttons.find(b => /continue|sign\s*up|submit|注册|创建/i.test(b.textContent));
    });

  if (submitBtn) {
    simulateClick(submitBtn);
    log('Step 3: Form submitted');
  }

  reportComplete(3, { email });
}

// ============================================================
// Step 4 (receiving end): Fill Verification Code
// ============================================================

async function step4_fillVerificationCode(payload) {
  const { code } = payload;
  if (!code) throw new Error('No verification code provided.');

  log(`Step 4: Filling verification code: ${code}`);

  // TODO: Adjust selector for code input
  const codeInput = await waitForElement('input[name="code"], input[type="text"][maxlength="6"], input[aria-label*="code"], input[placeholder*="code"]', 10000)
    .catch(() => { throw new Error('Could not find verification code input. URL: ' + location.href); });

  fillInput(codeInput, code);
  log('Step 4: Code filled');

  // Submit
  const submitBtn = document.querySelector('button[type="submit"]')
    || [...document.querySelectorAll('button')].find(b => /verify|confirm|submit|continue|确认|验证/i.test(b.textContent));

  if (submitBtn) {
    simulateClick(submitBtn);
    log('Step 4: Verification submitted');
  }

  // Wait for page transition
  await new Promise(r => setTimeout(r, 2000));
  reportComplete(4);
}

// ============================================================
// Step 5: Fill Name & Birthday
// ============================================================

async function step5_fillNameBirthday(payload) {
  const { firstName, lastName, year, month, day } = payload;
  if (!firstName || !lastName) throw new Error('No name data provided.');

  log(`Step 5: Filling name: ${firstName} ${lastName}, Birthday: ${year}-${month}-${day}`);

  // TODO: Adjust selectors based on actual profile form
  // First name
  const firstNameInput = await waitForElement('input[name="firstName"], input[name="first_name"], input[placeholder*="first"]', 10000)
    .catch(() => { throw new Error('Could not find first name input. URL: ' + location.href); });
  fillInput(firstNameInput, firstName);

  // Last name
  const lastNameInput = await waitForElement('input[name="lastName"], input[name="last_name"], input[placeholder*="last"]', 5000)
    .catch(() => { throw new Error('Could not find last name input. URL: ' + location.href); });
  fillInput(lastNameInput, lastName);

  // Birthday — could be separate fields or dropdowns
  // TODO: This varies greatly by form. Adjust after inspecting actual page.
  const birthdayInput = document.querySelector('input[name="birthday"], input[type="date"], input[name="dob"]');
  if (birthdayInput) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    fillInput(birthdayInput, dateStr);
    log(`Step 5: Birthday filled: ${dateStr}`);
  } else {
    // Try separate month/day/year selects or inputs
    log('Step 5: Looking for separate birthday fields...');
    const monthInput = document.querySelector('select[name="month"], input[name="month"]');
    const dayInput = document.querySelector('select[name="day"], input[name="day"]');
    const yearInput = document.querySelector('select[name="year"], input[name="year"]');

    if (monthInput) {
      if (monthInput.tagName === 'SELECT') { monthInput.value = String(month); monthInput.dispatchEvent(new Event('change', { bubbles: true })); }
      else fillInput(monthInput, String(month));
    }
    if (dayInput) {
      if (dayInput.tagName === 'SELECT') { dayInput.value = String(day); dayInput.dispatchEvent(new Event('change', { bubbles: true })); }
      else fillInput(dayInput, String(day));
    }
    if (yearInput) {
      if (yearInput.tagName === 'SELECT') { yearInput.value = String(year); yearInput.dispatchEvent(new Event('change', { bubbles: true })); }
      else fillInput(yearInput, String(year));
    }

    if (!monthInput && !dayInput && !yearInput) {
      log('Step 5: WARNING — Could not find any birthday fields. May need to adjust selectors.', 'warn');
    }
  }

  // Submit / Complete
  const completeBtn = document.querySelector('button[type="submit"]')
    || [...document.querySelectorAll('button')].find(b => /complete|continue|finish|done|create|完成|创建/i.test(b.textContent));

  if (completeBtn) {
    simulateClick(completeBtn);
    log('Step 5: Profile form submitted');
  }

  await new Promise(r => setTimeout(r, 2000));
  reportComplete(5);
}
```

- [ ] **Step 2: Wire up executeStep2, executeStep3, executeStep5 in background.js**

Replace the stubs in `background.js`:

```js
async function executeStep2(state) {
  if (!state.oauthUrl) {
    throw new Error('No OAuth URL. Complete step 1 first.');
  }
  await addLog(`Step 2: Opening auth URL in new tab: ${state.oauthUrl.slice(0, 80)}...`);
  const tab = await chrome.tabs.create({ url: state.oauthUrl, active: true });
  // signup-page.js will auto-inject via manifest content_scripts
  // When it reports ready, Background queues step 2 command
  // But signup-page.js step 2 is triggered after READY signal
  // So we queue the command now — it will flush when script is ready
  await sendToContentScript('signup-page', {
    type: 'EXECUTE_STEP',
    step: 2,
    source: 'background',
    payload: {},
  });
}

async function executeStep3(state) {
  if (!state.email) {
    throw new Error('No email address. Paste email in Side Panel first.');
  }
  await sendToContentScript('signup-page', {
    type: 'EXECUTE_STEP',
    step: 3,
    source: 'background',
    payload: { email: state.email },
  });
}

async function executeStep5(state) {
  // Generate random name and birthday
  // Import names data (loaded via importScripts or inline)
  const { firstName, lastName } = generateRandomName();
  const { year, month, day } = generateRandomBirthday();

  await addLog(`Step 5: Generated name: ${firstName} ${lastName}, Birthday: ${year}-${month}-${day}`);

  await sendToContentScript('signup-page', {
    type: 'EXECUTE_STEP',
    step: 5,
    source: 'background',
    payload: { firstName, lastName, year, month, day },
  });
}
```

Also add to the top of `background.js`, after the LOG_PREFIX line:

```js
importScripts('data/names.js');
```

And update the `EXECUTE_STEP` handler in `handleMessage` to save email when step 3 is called from sidepanel:

```js
case 'EXECUTE_STEP': {
  const step = message.payload.step;
  // Save email if provided (from side panel step 3)
  if (message.payload.email) {
    await setState({ email: message.payload.email });
  }
  await executeStep(step);
  return { ok: true };
}
```

- [ ] **Step 3: Reload extension, verify no errors**

Reload extension. Open Service Worker DevTools — confirm no syntax errors. Open Side Panel — confirm step buttons still work.

- [ ] **Step 4: Commit**

```bash
git add content/signup-page.js background.js data/names.js
git commit -m "feat: add signup-page content script (steps 2,3,4-fill,5) and wire up background orchestration"
```

---

## Chunk 3: Content Scripts — QQ Mail & ChatGPT

### Task 8: Create qq-mail.js content script + wire up steps 4, 7

**Files:**
- Create: `content/qq-mail.js`
- Modify: `background.js` — implement `executeStep4`, `executeStep7`

- [ ] **Step 1: Write qq-mail.js**

```js
// content/qq-mail.js — Content script for QQ Mail (steps 4, 7)
// Injected on: mail.qq.com, wx.mail.qq.com
// NOTE: all_frames: true — this script runs in every frame on QQ Mail

console.log('[MultiPage:qq-mail] Content script loaded on', location.href, 'frame:', window === window.top ? 'top' : 'child');

// Only act in the correct frame:
// - wx.mail.qq.com (new version): top frame only
// - mail.qq.com (old version): need to find the inbox frame
const isNewVersion = location.hostname === 'wx.mail.qq.com';
const isTopFrame = window === window.top;

// For old QQ Mail, only act in the frame that contains the inbox
// Skip reporting ready from irrelevant frames
if (!isNewVersion && isTopFrame) {
  // Old version top frame — still report ready but inbox is in iframe
  // The iframe instance of this script will handle actual email operations
  console.log('[MultiPage:qq-mail] Old QQ Mail top frame — waiting for inbox frame');
}

// Detect if this frame contains the email list
function isInboxFrame() {
  if (isNewVersion) return isTopFrame;
  // Old version: check if this frame has email list elements
  return !!document.querySelector('#mailList, .mail-list, [id*="mailList"]');
}

// Listen for commands from Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POLL_EMAIL') {
    // Only handle in the correct frame
    if (!isInboxFrame()) {
      sendResponse({ ok: false, reason: 'wrong-frame' });
      return;
    }
    handlePollEmail(message.step, message.payload).then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }

  if (message.type === 'CHECK_LOGIN') {
    if (!isTopFrame) { sendResponse({ ok: false }); return; }
    const loggedIn = checkLoginState();
    sendResponse({ loggedIn });
    return;
  }
});

// ============================================================
// Login State Check
// ============================================================

function checkLoginState() {
  if (isNewVersion) {
    // wx.mail.qq.com: check for inbox/compose button
    return !!document.querySelector('[class*="folder"], [class*="compose"], [class*="inbox"]');
  } else {
    // mail.qq.com: check for known logged-in element
    return !!document.querySelector('#folder_1, .folder_inbox, #composebtn');
  }
}

// ============================================================
// Email Polling
// ============================================================

async function handlePollEmail(step, payload) {
  const { filterAfterTimestamp, senderFilters, subjectFilters, maxAttempts, intervalMs } = payload;

  log(`Step ${step}: Starting email poll (max ${maxAttempts} attempts, every ${intervalMs / 1000}s)`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Polling QQ Mail... attempt ${attempt}/${maxAttempts}`, 'info');

    // Try to refresh inbox
    await refreshInbox();

    // Search for matching email
    const result = await findMatchingEmail(filterAfterTimestamp, senderFilters, subjectFilters);

    if (result) {
      log(`Step ${step}: Found matching email! Extracting code...`);
      const code = extractVerificationCode(result.content);
      if (code) {
        log(`Step ${step}: Verification code found: ${code}`, 'ok');
        return { ok: true, code, emailTimestamp: Date.now() };
      } else {
        log(`Step ${step}: Email found but no 6-digit code in content. Content preview: ${result.content.slice(0, 100)}`, 'warn');
      }
    }

    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  throw new Error(`No matching email found after ${maxAttempts * intervalMs / 1000}s. Check QQ Mail manually. Email may be in spam.`);
}

async function refreshInbox() {
  if (isNewVersion) {
    // wx.mail.qq.com: click refresh or trigger inbox reload
    // TODO: Find the actual refresh button selector
    const refreshBtn = document.querySelector('[class*="refresh"], [title*="刷新"], button[aria-label*="refresh"]');
    if (refreshBtn) {
      simulateClick(refreshBtn);
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    // mail.qq.com: old version refresh
    const refreshBtn = document.querySelector('#refresh, .refresh_btn');
    if (refreshBtn) {
      simulateClick(refreshBtn);
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function findMatchingEmail(afterTimestamp, senderFilters, subjectFilters) {
  // Get email list items
  // TODO: Adjust selectors for actual QQ Mail DOM structure
  let emailItems;
  if (isNewVersion) {
    emailItems = document.querySelectorAll('[class*="mail-item"], [class*="list-item"], tr[class*="mail"]');
  } else {
    emailItems = document.querySelectorAll('.toarea tr, #mailList tr, .mail_list tr');
  }

  for (const item of emailItems) {
    const text = item.textContent || '';
    const senderMatch = senderFilters.some(f => text.toLowerCase().includes(f.toLowerCase()));
    const subjectMatch = subjectFilters.some(f => text.toLowerCase().includes(f.toLowerCase()));

    if (senderMatch || subjectMatch) {
      // Try to get content from preview/snippet first
      let content = text;

      // If we need more content, click into the email
      // TODO: May need to click the email item and wait for content to load
      // For now, try to extract from the visible text
      if (!extractVerificationCode(content)) {
        // Click to open email for full content
        simulateClick(item);
        await new Promise(r => setTimeout(r, 1000));

        // Read email body
        const bodyEl = document.querySelector('[class*="mail-body"], [class*="mail_body"], .body_content, #contentDiv');
        if (bodyEl) {
          content = bodyEl.textContent || bodyEl.innerText || '';
        }
      }

      return { content };
    }
  }

  return null;
}

function extractVerificationCode(text) {
  // Match 6-digit code (most common format for verification codes)
  const match = text.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}
```

- [ ] **Step 2: Wire up executeStep4 and executeStep7 in background.js**

Replace the stubs:

```js
async function executeStep4(state) {
  // Check if QQ Mail tab exists, open if not
  const alive = await isTabAlive('qq-mail');
  if (!alive) {
    await addLog('Step 4: Opening QQ Mail...');
    await chrome.tabs.create({ url: 'https://wx.mail.qq.com/', active: true });
    // Wait for content script ready — the sendToContentScript will queue
  }

  // First check login state
  const tabId = await getTabId('qq-mail');
  if (tabId) {
    await chrome.tabs.update(tabId, { active: true });
  }

  // Send poll command
  const result = await sendToContentScript('qq-mail', {
    type: 'POLL_EMAIL',
    step: 4,
    source: 'background',
    payload: {
      filterAfterTimestamp: state.flowStartTime || 0,
      senderFilters: ['openai', 'noreply', 'verify', 'auth'],
      subjectFilters: ['verify', 'verification', 'code', '验证', 'confirm'],
      maxAttempts: 20,
      intervalMs: 3000,
    },
  });

  if (result.error) {
    throw new Error(result.error);
  }

  if (result.code) {
    await setState({ lastEmailTimestamp: result.emailTimestamp });
    await addLog(`Step 4: Got verification code: ${result.code}`);

    // Switch to signup tab and fill code
    const signupTabId = await getTabId('signup-page');
    if (signupTabId) {
      await chrome.tabs.update(signupTabId, { active: true });
      await sendToContentScript('signup-page', {
        type: 'FILL_CODE',
        step: 4,
        source: 'background',
        payload: { code: result.code },
      });
    } else {
      throw new Error('Signup page tab was closed. Cannot fill verification code.');
    }
  }
}

async function executeStep7(state) {
  const alive = await isTabAlive('qq-mail');
  if (!alive) {
    await addLog('Step 7: Opening QQ Mail...');
    await chrome.tabs.create({ url: 'https://wx.mail.qq.com/', active: true });
  }

  const tabId = await getTabId('qq-mail');
  if (tabId) {
    await chrome.tabs.update(tabId, { active: true });
  }

  const result = await sendToContentScript('qq-mail', {
    type: 'POLL_EMAIL',
    step: 7,
    source: 'background',
    payload: {
      filterAfterTimestamp: state.lastEmailTimestamp || state.flowStartTime || 0,
      senderFilters: ['openai', 'noreply', 'verify', 'auth', 'chatgpt'],
      subjectFilters: ['verify', 'verification', 'code', '验证', 'confirm', 'login'],
      maxAttempts: 20,
      intervalMs: 3000,
    },
  });

  if (result.error) {
    throw new Error(result.error);
  }

  if (result.code) {
    await addLog(`Step 7: Got login verification code: ${result.code}`);

    // Switch to ChatGPT tab and fill code
    const chatgptTabId = await getTabId('chatgpt');
    if (chatgptTabId) {
      await chrome.tabs.update(chatgptTabId, { active: true });
      await sendToContentScript('chatgpt', {
        type: 'FILL_CODE',
        step: 7,
        source: 'background',
        payload: { code: result.code },
      });
    } else {
      throw new Error('ChatGPT tab was closed. Cannot fill verification code.');
    }
  }
}
```

- [ ] **Step 3: Reload extension, test qq-mail content script loads**

Navigate to `https://wx.mail.qq.com/`. Open DevTools console. Confirm `[MultiPage:qq-mail] Content script loaded` appears.

- [ ] **Step 4: Commit**

```bash
git add content/qq-mail.js background.js
git commit -m "feat: add qq-mail content script with email polling and wire up steps 4, 7 orchestration"
```

---

### Task 9: Create chatgpt.js content script + wire up steps 6, 8

**Files:**
- Create: `content/chatgpt.js`
- Modify: `background.js` — implement `executeStep6`, `executeStep8`

- [ ] **Step 1: Write chatgpt.js**

```js
// content/chatgpt.js — Content script for ChatGPT (steps 6, 7-receive, 8)
// Injected on: chatgpt.com

console.log('[MultiPage:chatgpt] Content script loaded on', location.href);

// Listen for commands from Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXECUTE_STEP' || message.type === 'FILL_CODE') {
    handleCommand(message).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      reportError(message.step, err.message);
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function handleCommand(message) {
  switch (message.type) {
    case 'EXECUTE_STEP':
      switch (message.step) {
        case 6: return await step6_loginChatGPT(message.payload);
        case 8: return await step8_navigateOAuth(message.payload);
        default: throw new Error(`chatgpt.js does not handle step ${message.step}`);
      }
    case 'FILL_CODE':
      return await step7_fillLoginCode(message.payload);
  }
}

// ============================================================
// Step 6: Login ChatGPT
// ============================================================

async function step6_loginChatGPT(payload) {
  log('Step 6: Looking for login button on ChatGPT...');

  // TODO: Adjust selectors based on actual ChatGPT login page
  const loginBtn = await waitForElement('[data-testid="login-button"], a[href*="auth"], button', 10000)
    .catch(() => {
      const links = [...document.querySelectorAll('a, button')];
      const btn = links.find(b => /log\s*in|sign\s*in|登录/i.test(b.textContent));
      if (btn) return btn;
      throw new Error('Could not find Login button on ChatGPT. URL: ' + location.href);
    });

  simulateClick(loginBtn);
  log('Step 6: Clicked Login button, waiting for auth page...');

  // Wait for redirect to auth page — email input should appear
  await new Promise(r => setTimeout(r, 3000));

  // Get email from storage
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  const email = state.email;
  if (!email) throw new Error('No email found in state. Complete earlier steps first.');

  // Find email input (may be on redirected auth page)
  const emailInput = await waitForElement('input[type="email"], input[name="email"], input[name="username"]', 15000)
    .catch(() => { throw new Error('Could not find email input on login page. URL: ' + location.href); });

  fillInput(emailInput, email);
  log(`Step 6: Filled email: ${email}`);

  // Submit email
  const submitBtn = document.querySelector('button[type="submit"]')
    || [...document.querySelectorAll('button')].find(b => /continue|next|submit/i.test(b.textContent));
  if (submitBtn) simulateClick(submitBtn);

  await new Promise(r => setTimeout(r, 2000));

  // Check: password field or OTP?
  const passwordInput = document.querySelector('input[type="password"]');
  if (passwordInput) {
    log('Step 6: Password field found, filling password...');
    fillInput(passwordInput, state.password || 'mimashisha0.0');

    const submitBtn2 = document.querySelector('button[type="submit"]')
      || [...document.querySelectorAll('button')].find(b => /continue|log\s*in|submit/i.test(b.textContent));
    if (submitBtn2) simulateClick(submitBtn2);

    await new Promise(r => setTimeout(r, 2000));

    // Check if we need OTP after password
    const codeInput = document.querySelector('input[name="code"], input[maxlength="6"]');
    if (codeInput) {
      log('Step 6: OTP code required after password. Waiting for step 7...');
      reportComplete(6, { needsOTP: true });
    } else {
      log('Step 6: Login appears successful (no OTP needed)');
      reportComplete(6, { needsOTP: false });
    }
  } else {
    // OTP flow — no password
    log('Step 6: No password field. OTP flow detected. Waiting for step 7...');
    reportComplete(6, { needsOTP: true });
  }
}

// ============================================================
// Step 7 (receiving end): Fill Login Verification Code
// ============================================================

async function step7_fillLoginCode(payload) {
  const { code } = payload;
  if (!code) throw new Error('No verification code provided.');

  log(`Step 7: Filling login verification code: ${code}`);

  const codeInput = await waitForElement('input[name="code"], input[maxlength="6"], input[type="text"][inputmode="numeric"]', 10000)
    .catch(() => { throw new Error('Could not find verification code input on ChatGPT login. URL: ' + location.href); });

  fillInput(codeInput, code);

  const submitBtn = document.querySelector('button[type="submit"]')
    || [...document.querySelectorAll('button')].find(b => /continue|verify|submit|confirm/i.test(b.textContent));
  if (submitBtn) simulateClick(submitBtn);

  log('Step 7: Login verification code submitted');
  await new Promise(r => setTimeout(r, 3000));

  reportComplete(7);
}

// ============================================================
// Step 8: Navigate to OAuth URL
// ============================================================

async function step8_navigateOAuth(payload) {
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  const oauthUrl = state.oauthUrl;
  if (!oauthUrl) throw new Error('No OAuth URL found. Complete step 1 first.');

  log(`Step 8: Navigating to OAuth URL: ${oauthUrl.slice(0, 80)}...`);
  log('Step 8: Waiting for localhost redirect (captured by background)...');

  // Navigate — the webNavigation listener in background will capture localhost redirect
  window.location.href = oauthUrl;

  // Don't reportComplete here — background handles it via webNavigation
}
```

- [ ] **Step 2: Wire up executeStep6 and executeStep8 in background.js**

Replace the stubs:

```js
async function executeStep6(state) {
  // Open ChatGPT
  const alive = await isTabAlive('chatgpt');
  if (!alive) {
    await addLog('Step 6: Opening ChatGPT...');
    await chrome.tabs.create({ url: 'https://chatgpt.com/', active: true });
  } else {
    const tabId = await getTabId('chatgpt');
    await chrome.tabs.update(tabId, { active: true });
  }

  await sendToContentScript('chatgpt', {
    type: 'EXECUTE_STEP',
    step: 6,
    source: 'background',
    payload: {},
  });
}

let webNavListener = null;

async function executeStep8(state) {
  if (!state.oauthUrl) {
    throw new Error('No OAuth URL. Complete step 1 first.');
  }

  await addLog('Step 8: Setting up localhost redirect listener...');

  // Register webNavigation listener (scoped to this step)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (webNavListener) {
        chrome.webNavigation.onBeforeNavigate.removeListener(webNavListener);
        webNavListener = null;
      }
      reject(new Error('Localhost redirect not captured after 30s. Check if OAuth authorization completed.'));
    }, 30000);

    webNavListener = (details) => {
      if (details.url.startsWith('http://localhost')) {
        console.log(LOG_PREFIX, `Captured localhost redirect: ${details.url}`);
        chrome.webNavigation.onBeforeNavigate.removeListener(webNavListener);
        webNavListener = null;
        clearTimeout(timeout);

        setState({ localhostUrl: details.url }).then(() => {
          addLog(`Step 8: Captured localhost URL: ${details.url}`, 'ok');
          setStepStatus(8, 'completed');
          resolve();
        });
      }
    };

    chrome.webNavigation.onBeforeNavigate.addListener(webNavListener);

    // Tell chatgpt.js to navigate to OAuth URL
    sendToContentScript('chatgpt', {
      type: 'EXECUTE_STEP',
      step: 8,
      source: 'background',
      payload: {},
    }).catch(reject);
  });
}
```

- [ ] **Step 3: Reload extension, verify no errors**

Reload extension. Check Service Worker DevTools — no errors. Open `chatgpt.com` in a tab, verify `[MultiPage:chatgpt] Content script loaded` appears in console.

- [ ] **Step 4: Commit**

```bash
git add content/chatgpt.js background.js
git commit -m "feat: add chatgpt content script (steps 6,7-fill,8) and wire up background with webNavigation listener"
```

---

## Chunk 4: Integration Testing & Selector Tuning

### Task 10: End-to-end debugging — Step 1 (VPS Panel)

**Files:**
- Modify: `content/vps-panel.js` — update selectors based on actual DOM

- [ ] **Step 1: Inspect VPS panel DOM**

Open `http://154.26.182.181:8317/management.html#/oauth` in Chrome. Open DevTools → Elements tab. Identify:
1. The OAuth login button (tag, class, id, text content)
2. The Codex login button that appears after clicking OAuth
3. Where the auth URL appears (input, textarea, span, etc.)
4. The URL input field for step 9
5. The verify button for step 9
6. A DOM element that indicates logged-in state

Document found selectors in a comment at the top of `vps-panel.js`.

- [ ] **Step 2: Update vps-panel.js selectors**

Replace all `TODO` placeholder selectors with actual selectors found in step 1.

- [ ] **Step 3: Test step 1 via Side Panel**

Click "Get OAuth Link" in Side Panel. Watch log output. Should complete and show OAuth URL.

- [ ] **Step 4: Commit**

```bash
git add content/vps-panel.js
git commit -m "fix: update vps-panel selectors to match actual DOM structure"
```

---

### Task 11: End-to-end debugging — Steps 2, 3, 4, 5 (Signup Flow)

**Files:**
- Modify: `content/signup-page.js` — update selectors
- Modify: `content/qq-mail.js` — update selectors

- [ ] **Step 1: Inspect OpenAI auth page DOM**

Open the OAuth URL from step 1 in a new tab. Use DevTools to identify:
1. Register / Sign up button
2. Email input field
3. Password input field (same page or next page?)
4. Submit / Continue button
5. Verification code input field
6. Name fields (first name, last name)
7. Birthday fields (format? single input or separate?)
8. Complete registration button

Document actual selectors.

- [ ] **Step 2: Inspect QQ Mail DOM**

Open `https://wx.mail.qq.com/`. Use DevTools to identify:
1. Login state indicator element
2. Inbox refresh button
3. Email list item structure (how to iterate emails)
4. How to identify sender / subject in list
5. Email body content element (after clicking an email)

Document actual selectors.

- [ ] **Step 3: Update signup-page.js selectors**

Replace all TODO placeholder selectors with actual ones.

- [ ] **Step 4: Update qq-mail.js selectors**

Replace all TODO placeholder selectors with actual ones.

- [ ] **Step 5: Test steps 2-5 sequentially**

Run through steps 2-5 in Side Panel, checking log output at each step. Fix any selector or timing issues.

- [ ] **Step 6: Commit**

```bash
git add content/signup-page.js content/qq-mail.js
git commit -m "fix: update signup-page and qq-mail selectors to match actual DOM structures"
```

---

### Task 12: End-to-end debugging — Steps 6, 7, 8, 9 (Login + OAuth)

**Files:**
- Modify: `content/chatgpt.js` — update selectors
- Modify: `content/vps-panel.js` — update step 9 selectors if needed

- [ ] **Step 1: Inspect ChatGPT login page DOM**

Open `https://chatgpt.com/`. Use DevTools to identify:
1. Login button
2. Email input on auth redirect
3. Password field (if present)
4. Submit buttons at each stage
5. Verification code input (if OTP flow)

Document actual selectors.

- [ ] **Step 2: Update chatgpt.js selectors**

Replace all TODO placeholder selectors with actual ones.

- [ ] **Step 3: Test steps 6-9 sequentially**

Run through steps 6-9 in Side Panel. Fix any issues.

- [ ] **Step 4: Test step 9 VPS verify selectors**

If step 9 selectors need updating based on actual VPS panel verify form, update now.

- [ ] **Step 5: Commit**

```bash
git add content/chatgpt.js content/vps-panel.js
git commit -m "fix: update chatgpt and vps-panel selectors for login and verify flows"
```

---

### Task 13: Full end-to-end test

- [ ] **Step 1: Reset and run all 9 steps**

Click Reset in Side Panel. Run through all 9 steps sequentially:
1. Get OAuth Link → verify URL appears in Side Panel
2. Open Signup → verify registration page loads
3. (Paste DuckDuckGo email in Side Panel) Fill Email/Password → verify form filled
4. Get Signup Code → verify QQ Mail polled and code filled
5. Fill Name/Birthday → verify profile completed
6. Login ChatGPT → verify login initiated
7. Get Login Code → verify code retrieved and filled
8. Complete OAuth → verify localhost URL captured
9. VPS Verify → verify URL pasted and verify clicked

- [ ] **Step 2: Fix any remaining issues**

Address any timing, selector, or orchestration issues found in the full run.

- [ ] **Step 3: Commit final fixes**

```bash
git add -u
git commit -m "fix: address issues found in full end-to-end testing"
```

---

## Notes for the implementer

### About TODO selectors

Every content script has `// TODO: Adjust selector` comments. These are intentional — the actual DOM selectors for VPS panel, OpenAI auth, QQ Mail, and ChatGPT **must be determined by inspecting the live pages in DevTools**. The placeholder selectors are educated guesses. Tasks 10-12 are specifically for this selector tuning.

### Debugging workflow

When a step fails:
1. Check Side Panel log — it shows what went wrong
2. Open DevTools on the target tab — look for `[MultiPage:xxx]` console messages
3. Open Service Worker DevTools — look for `[MultiPage:bg]` messages
4. Use Elements tab to find the correct selector
5. Update the content script, reload extension, retry

### Chrome extension reload

After modifying any file:
1. Go to `chrome://extensions`
2. Click the reload (↻) button on the extension card
3. Refresh any open tabs that use content scripts (or close and reopen)
4. Reopen Side Panel if it was open
