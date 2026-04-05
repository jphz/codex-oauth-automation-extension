# Multi-Page Automation Chrome Extension - Design Spec

## Overview

A Chrome extension that automates a multi-step OAuth account registration and verification workflow. The extension operates across multiple websites (VPS panel, OpenAI auth, QQ Mail, ChatGPT) using a Side Panel as the control center and Content Scripts for DOM manipulation.

## User Story

The user needs to repeatedly perform a multi-step workflow involving:
1. Getting an OAuth link from a VPS panel
2. Registering a new account on the linked auth page (multi-page: email/password → verify code → name/birthday)
3. Receiving email verification codes (twice: registration + login)
4. Logging into ChatGPT with the new account
5. Completing OAuth callback verification

The extension automates DOM interactions at each step, with the user triggering steps manually via the Side Panel (semi-automatic mode, with future upgrade to full automation).

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Chrome Extension                │
├──────────┬──────────────┬───────────────────────┤
│ Side Panel │  Background  │    Content Scripts     │
│ (Control)  │  (Service    │  (Injected per site)   │
│            │   Worker)    │                        │
│ - Step list│ - Tab mgmt   │ - vps-panel.js         │
│ - Buttons  │ - Msg relay  │ - signup-page.js       │
│ - Status   │ - State store│ - qq-mail.js           │
│ - Logs     │ - Orchestrate│ - chatgpt.js           │
│ - Reset    │   tab switch │ - utils.js (shared)    │
└──────────┴──────────────┴───────────────────────┘
```

### Components

- **Side Panel**: Persistent right-side panel showing all steps with action buttons, status indicators, shared data display (OAuth URL, email, etc.), debug log area, and a reset button. On open/reload, restores full state from `chrome.storage.session`.
- **Background Service Worker**: Central dispatcher and orchestrator. Manages tab creation/switching, stores flow state in `chrome.storage.session` (NOT in-memory, as MV3 service workers can be terminated after 30s of inactivity), relays and routes messages between Side Panel and Content Scripts, and handles tab-switching choreography between steps.
- **Content Scripts**: Per-domain scripts injected into target pages, each responsible for DOM operations (reading, filling forms, clicking buttons). All share `utils.js` for common utilities.

### Communication — Unified Message Protocol

All messages between components use a standard format:
```js
{
  type: "ACTION_NAME",    // e.g. "FILL_SIGNUP", "CODE_FOUND", "STEP_COMPLETE", "STEP_ERROR", "LOG"
  source: "qq-mail",      // sender identifier
  target: "signup-page",  // intended receiver (optional, Background uses for routing)
  step: 4,                // which workflow step this relates to
  payload: { ... },       // data
  error: null             // error message string (if any)
}
```

**Message routing:**
- Side Panel <-> Background: `chrome.runtime.sendMessage`
- Background -> Content Script: `chrome.tabs.sendMessage` (only after content script reports ready)
- Content Script -> Background: `chrome.runtime.sendMessage`
- Background is the central router: it receives all messages and forwards to the correct target based on `target` field and `tabRegistry`.

### Content Script Readiness Protocol

Background must NOT send messages to a content script immediately after opening/navigating a tab. Instead:
1. Content script sends `{ type: "CONTENT_SCRIPT_READY", source: "vps-panel" }` message on load
2. Background registers the tab as ready in the `tabRegistry`
3. Only then does Background send action commands to that tab
4. If Background needs to send a command but the script isn't ready yet, it queues the command and sends it when the ready signal arrives (with a 15s timeout → error)

### Tab Registry

Background maintains a `tabRegistry` in `chrome.storage.session`:
```json
{
  "vps-panel": { "tabId": 123, "ready": true },
  "signup": { "tabId": 124, "ready": true },
  "qq-mail": { "tabId": 125, "ready": false },
  "chatgpt": { "tabId": 126, "ready": true }
}
```
Before operating on a tab, Background checks if the tab still exists via `chrome.tabs.get()`. If the tab was closed, it reopens and waits for the ready signal.

### Tab Switching Orchestration

When a step requires cross-tab coordination (e.g., step 4: get code from QQ Mail → fill into signup page), the orchestration is always handled by Background:
1. Content script A (e.g., qq-mail.js) sends result to Background: `{ type: "CODE_FOUND", payload: { code: "123456" } }`
2. Background stores the data in `chrome.storage.session`
3. Background activates target tab via `chrome.tabs.update(tabId, { active: true })`
4. Background sends command to Content script B: `{ type: "FILL_CODE", payload: { code: "123456" } }`
5. Content script B executes and reports `STEP_COMPLETE` or `STEP_ERROR`

Content scripts NEVER communicate directly with each other.

## Workflow Steps

| Step | Button | Executor | Action |
|------|--------|----------|--------|
| 1 | Get OAuth Link | `vps-panel.js` | Check VPS login state → Click OAuth login → Click Codex login → Read auth URL → Send to Background |
| 2 | Open Signup & Click Register | Background + `signup-page.js` | Background opens auth URL in new tab → `signup-page.js` loads and clicks "Register" button |
| 3 | Fill Email & Password | `signup-page.js` | Read email from Side Panel input (via Background) → Fill email + password (`mimashisha0.0`) → Submit |
| 4 | Get Signup Verification Code | `qq-mail.js` → Background → `signup-page.js` | Background opens QQ Mail tab → `qq-mail.js` polls for new email from OpenAI → Extracts code → Background switches to signup tab → `signup-page.js` fills code and confirms |
| 5 | Fill Name & Birthday | `signup-page.js` | After code verification, page transitions to profile form → Fill random English name + random birthday (age 19-25) → Click complete registration |
| 6 | Login ChatGPT | Background + `chatgpt.js` | Background opens chatgpt.com in new tab → `chatgpt.js` clicks login → Enters email → If password field appears, fills password; otherwise waits for OTP flow → Submit |
| 7 | Get Login Verification Code | `qq-mail.js` → Background → `chatgpt.js` | Background switches to QQ Mail tab → `qq-mail.js` polls for email newer than step 4's → Extracts code → Background switches to ChatGPT tab → `chatgpt.js` fills code → Login complete |
| 8 | Complete OAuth | Background (`webNavigation`) + `chatgpt.js` | `chatgpt.js` navigates to step 1's `oauthUrl` → Background captures localhost redirect via `webNavigation` listener → Stores `localhostUrl` |
| 9 | VPS Verify | `vps-panel.js` | Background switches to VPS panel tab → `vps-panel.js` pastes `localhostUrl` into input → Clicks verify button |

## Content Script URL Matching

| Script | Match Patterns | all_frames |
|--------|---------------|------------|
| `utils.js` | (included by all below) | — |
| `vps-panel.js` | `http://154.26.182.181:8317/*` | false |
| `signup-page.js` | `https://auth0.openai.com/*`, `https://auth.openai.com/*`, `https://accounts.openai.com/*` | false |
| `qq-mail.js` | `https://mail.qq.com/*`, `https://wx.mail.qq.com/*` | true |
| `chatgpt.js` | `https://chatgpt.com/*` | false |

Note: `qq-mail.js` uses `all_frames: true` because old QQ Mail (`mail.qq.com`) renders inbox inside iframes.

## Content Script Details

### utils.js (shared)

Loaded before every content script. Provides:

```js
// Wait for a DOM element to appear, with timeout
async function waitForElement(selector, timeout = 10000)

// React-compatible form filling — triggers proper event chain
function fillInput(el, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  nativeInputValueSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Send log message to Side Panel (via Background)
function log(message, level = 'info')

// Send step result to Background
function reportComplete(step, data = {})
function reportError(step, errorMessage)

// Standard ready signal
function reportReady(source)
```

### vps-panel.js
- **Step 1**: Check login state (look for known logged-in DOM indicator); if not logged in → `reportError(1, "VPS panel not logged in, please log in first")`. Then: locate OAuth login button → click → wait for Codex login button to appear → click → wait for auth URL to appear in DOM → read it → `reportComplete(1, { oauthUrl })`
- **Step 9**: `waitForElement` for URL input field → `fillInput` with `localhostUrl` → click verify button → `reportComplete(9)`

### signup-page.js
- **Step 2**: On ready, detect if current page has a "Register" / "Sign up" button → click it → `reportComplete(2)`
- **Step 3**: `waitForElement` for email input → `fillInput` email → `fillInput` password (`mimashisha0.0`) → click submit → `reportComplete(3)`
- **Step 4 (receiving end)**: `waitForElement` for verification code input → `fillInput` code → click confirm → `reportComplete(4)`
- **Step 5**: `waitForElement` for name/birthday fields (page transition after code verification) → `fillInput` random first name, last name → `fillInput` random birthday → click complete → `reportComplete(5)`
- All DOM operations use `waitForElement` before acting
- All input filling uses `fillInput` (React-compatible)

### qq-mail.js
- Check login state first; if not logged in → `reportError(step, "QQ Mail not logged in, please log in first")`
- **QQ Mail version handling**:
  - Old version (`mail.qq.com`): Content is inside iframes. With `all_frames: true`, the script runs in each frame. Only the frame containing the inbox list should act.
  - New version (`wx.mail.qq.com`): SPA, no iframes. All content in main frame with dynamic DOM updates.
- **Polling strategy** (no page refresh):
  - Click inbox refresh button (or equivalent DOM trigger) every 3 seconds
  - Observe email list DOM for new entries matching sender filter (e.g., `openai`, `noreply`) or subject filter (e.g., `verify`, `verification`, `code`)
  - Extract verification code from email preview/snippet if visible, or click into email and extract from body
  - Log each poll attempt: `log("Polling QQ Mail... attempt 3/20")`
- **Step 4**: Find email newer than flow start time → extract 6-digit code via regex → `reportComplete(4, { code, emailTimestamp })`
- **Step 7**: Find email newer than step 4's `emailTimestamp` → extract 6-digit code → `reportComplete(7, { code })`
- Timeout after 60 seconds (20 attempts) → `reportError(step, "No matching email found after 60s")`

### chatgpt.js
- **Step 6**: `waitForElement` for login button → click → `waitForElement` for email input → `fillInput` email → submit → detect next state:
  - If password field appears → `fillInput` password → submit → `reportComplete(6)`
  - If no password field (OTP flow) → `reportComplete(6, { needsOTP: true })` (code will come from step 7)
- **Step 7 (receiving end)**: `waitForElement` for code input → `fillInput` code → submit → `reportComplete(7)`
- **Step 8**: Navigate to `oauthUrl` (from storage) → page will redirect → `log("Navigating to OAuth URL, waiting for redirect...")` → (localhost capture handled by Background)

## Data Flow

Data persisted in `chrome.storage.session` (survives service worker termination), passed between steps:

```
Step 1  → oauthUrl          (authorization link)
Step 3  → email, password   (from Side Panel input + hardcoded)
Step 4  → lastEmailTimestamp (to distinguish step 7's email)
Step 8  → localhostUrl      (OAuth callback URL)
```

Additionally stored:
- `currentStep`: which step is active (for UI restore)
- `stepStatuses`: `{ 1: "completed", 2: "completed", 3: "running", ... }` (for UI restore)
- `tabRegistry`: tab ID mapping (for tab management)
- `logs`: array of log entries (for UI restore)
- `flowStartTime`: timestamp when flow began (for email filtering)

## Random Data Generation (in Background)

- **English names**: Built-in list of common first names + last names, randomly combined
- **Birthday**: Current year minus 19-25 years, random month/day, formatted per the target form's expected format

## Side Panel UI

```
┌──────────────────────────────────┐
│  Multi-Page Automation    [Reset]│
├──────────────────────────────────┤
│  OAuth URL: [显示/未获取]         │
│  Email:  [________粘贴邮箱______] │
│  Status: Step 3 running...       │
├──────────────────────────────────┤
│  1  [Get OAuth Link]      ✅     │
│  2  [Open Signup]         ✅     │
│  3  [Fill Email/Password] ⏳     │
│  4  [Get Signup Code]     ⬚ 禁用 │
│  5  [Fill Name/Birthday]  ⬚ 禁用 │
│  6  [Login ChatGPT]       ⬚ 禁用 │
│  7  [Get Login Code]      ⬚ 禁用 │
│  8  [Complete OAuth]      ⬚ 禁用 │
│  9  [VPS Verify]          ⬚ 禁用 │
├──────────────────────────────────┤
│  Log:                            │
│  10:23:01 [INFO] Step 1 started  │
│  10:23:03 [INFO] Found OAuth btn │
│  10:23:05 [OK]   Step 1 done     │
│  10:23:05 [INFO] oauthUrl saved  │
│  10:23:08 [INFO] Step 2 started  │
│  10:23:10 [INFO] Tab opened      │
│  10:23:12 [OK]   Register clicked│
│  10:23:15 [ERR]  Step 3 failed:  │
│           email input not found  │
│  10:23:15 [INFO] Retry step 3... │
└──────────────────────────────────┘
```

**UI behaviors:**
- **Step interlock**: When a step is running, all other buttons are disabled. Next step button stays disabled until previous step succeeds. Failed steps show ❌ and can be retried. Completed steps show ✅ and can be re-run.
- **State restore**: On Side Panel open/reload, read `currentStep`, `stepStatuses`, `logs`, and all data fields from `chrome.storage.session` and render.
- **Reset button**: Clears all `chrome.storage.session` data, resets all steps to pending, clears logs. Does NOT close open tabs (user may want them).
- **Email input**: Editable text field. User pastes DuckDuckGo-generated email here before step 3.
- **Log area**: Scrollable, auto-scrolls to bottom. Shows timestamp, level (INFO/OK/WARN/ERR), and message. Each content script action logs what it's about to do and the result.

## Debugging & Observability

Every step must be fully debuggable. The user should never be stuck wondering "what went wrong".

### Log Everything

Each content script logs at these checkpoints:
1. **Step start**: `"Step N started"`
2. **Waiting for element**: `"Waiting for selector: #email-input..."`
3. **Element found/not found**: `"Found #email-input"` or `"Timeout waiting for #email-input after 10s"`
4. **Action taken**: `"Filled email input with xxx@duck.com"`, `"Clicked submit button"`
5. **Page transition**: `"Page URL changed to https://..."`
6. **Polling progress**: `"Polling QQ Mail... attempt 5/20, no match yet"`
7. **Data extracted**: `"Verification code found: 123456"`
8. **Step result**: `"Step N completed successfully"` or `"Step N failed: [reason]"`

### Error Recovery Guide

When a step fails, the error message should include actionable guidance:

| Error | Guidance shown in log |
|-------|----------------------|
| VPS not logged in | "Please log in to VPS panel at http://154.26.182.181:8317 and retry" |
| QQ Mail not logged in | "Please log in to QQ Mail and retry" |
| Element not found (timeout) | "Could not find [selector] on [url]. Page may have changed layout. Check DevTools." |
| Email not received (timeout) | "No matching email after 60s. Check QQ Mail manually. Email may be in spam." |
| Tab was closed | "Tab [name] was closed. Will reopen on retry." |
| Content script not ready | "Content script on [url] did not respond in 15s. Try refreshing the tab and retry." |
| Unknown error | "Unexpected error: [message]. Check DevTools console on [tab name] for details." |

### DevTools Integration

- Each content script logs to the browser console with a prefix: `[MultiPage:vps-panel]`, `[MultiPage:qq-mail]`, etc.
- Background service worker also logs with `[MultiPage:bg]` prefix.
- All chrome.storage writes are logged: `[MultiPage:bg] storage.set: stepStatuses = {...}`
- This allows using Chrome DevTools on any tab or the service worker to see detailed execution trace.

## Robustness

### Login State Detection
- **VPS panel** (step 1): Check for known logged-in DOM indicator before operating; if absent, `reportError` with guidance and pause.
- **QQ Mail** (steps 4, 7): Check for inbox DOM indicator; if absent, `reportError` with guidance and pause.

### DOM Element Waiting
All content script DOM operations use `waitForElement(selector, timeout)` from `utils.js`. Default timeout: 10 seconds. On timeout, `reportError` with the selector and URL for debugging.

### Email Polling
- Poll QQ Mail inbox every 3 seconds for matching email (filter by sender/subject keywords)
- Step 7 only accepts emails newer than step 4's `lastEmailTimestamp` to avoid duplicates
- Each poll attempt is logged with attempt count
- Timeout after 60 seconds (20 attempts); `reportError` with guidance to check spam folder

### Localhost Redirect Capture
- `chrome.webNavigation.onBeforeNavigate` listener is registered in Background **only when step 8 starts**
- Listener matches URL starting with `http://localhost`
- On capture: store `localhostUrl`, remove listener, `reportComplete(8)`
- If not captured within 30 seconds: `reportError` with guidance
- Listener is always removed when step 8 ends (success or failure)

### Page Transitions
- After form submissions, `signup-page.js` and `chatgpt.js` must handle page navigation/SPA route changes
- Use `waitForElement` on the NEXT expected element after submission, not just submit and hope
- If URL changes (full navigation), the content script re-injects and sends a new READY signal; Background re-sends the pending command

## Permissions (manifest.json)

```json
{
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
  ]
}
```

Note: `scripting` permission enables `chrome.scripting.executeScript` for dynamic injection when the auth flow redirects to unexpected domains.

## Technical Decisions

- **Manifest V3**: Required for current Chrome extension development
- **Side Panel API**: `chrome.sidePanel` for persistent control panel
- **Pure Content Script approach**: No external dependencies, direct DOM manipulation
- **State in `chrome.storage.session`**: MV3 service workers can terminate after 30s idle; all flow state must be persisted, not held in memory
- **React-compatible form filling**: Use native setter + event dispatch pattern for all React-based target pages
- **Content script readiness protocol**: Scripts report ready before receiving commands; commands queued if not ready
- **Unified message protocol**: All inter-component messages use same format with type/source/target/step/payload/error
- **Shared utils.js**: Common utilities loaded by all content scripts to avoid duplication
- **Background as sole orchestrator**: All cross-tab coordination goes through Background; content scripts never talk to each other
- **webNavigation listener scoped to step 8**: Registered on step start, removed on step end, avoids false triggers
- **Semi-automatic first**: Each step triggered manually, upgrade to full automation later
- **DuckDuckGo email generation**: Manual step (user clicks DuckDuckGo panel), user pastes email into Side Panel input

## Future Enhancements

- Full automation mode (single button to run all steps)
- DuckDuckGo API integration for automatic email generation
- Batch execution support
- Error recovery and auto-retry logic
- Export logs for troubleshooting
