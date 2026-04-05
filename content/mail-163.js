// content/mail-163.js — Content script for 163 Mail (steps 4, 7)
// Injected on: mail.163.com
//
// Actual 163 Mail DOM structure:
// <div class="rF0" sign="letter" id="...Dom" aria-label="你的 ChatGPT 代码为 479637 发件人 ： OpenAI ...">
//   <div class="dP0" sign="start-from">
//     <span class="nui-user">OpenAI</span>
//   </div>
//   <div class="il0">
//     <span class="da0">你的 ChatGPT 代码为 479637</span>
//   </div>
// </div>

const MAIL163_PREFIX = '[MultiPage:mail-163]';
const isTopFrame = window === window.top;

console.log(MAIL163_PREFIX, 'Content script loaded on', location.href, 'frame:', isTopFrame ? 'top' : 'child');

// ============================================================
// Message Handler
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POLL_EMAIL') {
    handlePollEmail(message.step, message.payload).then(result => {
      sendResponse(result);
    }).catch(err => {
      reportError(message.step, err.message);
      sendResponse({ error: err.message });
    });
    return true;
  }
});

// ============================================================
// Get all current mail IDs
// ============================================================

function getCurrentMailIds() {
  const ids = new Set();
  // 163 mail items have sign="letter" and id ending with "Dom"
  const items = findMailItems();
  for (const item of items) {
    const id = item.getAttribute('id') || '';
    if (id) ids.add(id);
  }
  return ids;
}

function findMailItems() {
  // Try current document first
  let items = document.querySelectorAll('div[sign="letter"]');
  if (items.length > 0) return items;

  // Try iframes (163 mail may use iframes)
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        items = doc.querySelectorAll('div[sign="letter"]');
        if (items.length > 0) return items;
      }
    } catch { }
  }
  return [];
}

// ============================================================
// Email Polling
// ============================================================

async function handlePollEmail(step, payload) {
  const { senderFilters, subjectFilters, maxAttempts, intervalMs } = payload;

  log(`Step ${step}: Starting email poll on 163 Mail (max ${maxAttempts} attempts)`);

  // Wait for mail list to load
  await sleep(3000);

  let items = findMailItems();
  if (items.length === 0) {
    log(`Step ${step}: Waiting for mail list to appear...`);
    await sleep(5000);
    items = findMailItems();
  }

  if (items.length === 0) {
    throw new Error('163 Mail list did not load. Make sure inbox is open.');
  }

  log(`Step ${step}: Mail list loaded, ${items.length} items found`);

  const existingMailIds = getCurrentMailIds();
  log(`Step ${step}: Snapshotted ${existingMailIds.size} existing emails`);

  const FALLBACK_AFTER = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Polling 163 Mail... attempt ${attempt}/${maxAttempts}`);

    if (attempt > 1) {
      await refreshInbox();
      await sleep(1000);
    }

    const allItems = findMailItems();
    const useFallback = attempt > FALLBACK_AFTER;

    for (const item of allItems) {
      const id = item.getAttribute('id') || '';

      if (!useFallback && existingMailIds.has(id)) continue;

      // Get sender from .nui-user
      const senderEl = item.querySelector('.nui-user');
      const sender = senderEl ? senderEl.textContent.toLowerCase() : '';

      // Get subject from span.da0
      const subjectEl = item.querySelector('span.da0');
      const subject = subjectEl ? subjectEl.textContent : '';

      // Also check aria-label which contains full info
      const ariaLabel = (item.getAttribute('aria-label') || '').toLowerCase();

      const senderMatch = senderFilters.some(f => sender.includes(f.toLowerCase()) || ariaLabel.includes(f.toLowerCase()));
      const subjectMatch = subjectFilters.some(f => subject.toLowerCase().includes(f.toLowerCase()) || ariaLabel.includes(f.toLowerCase()));

      if (senderMatch || subjectMatch) {
        const code = extractVerificationCode(subject + ' ' + ariaLabel);
        if (code) {
          const source = useFallback && existingMailIds.has(id) ? 'fallback' : 'new';
          log(`Step ${step}: Code found: ${code} (${source}, subject: ${subject.slice(0, 40)})`, 'ok');
          return { ok: true, code, emailTimestamp: Date.now(), mailId: id };
        }
      }
    }

    if (attempt === FALLBACK_AFTER + 1) {
      log(`Step ${step}: No new emails after ${FALLBACK_AFTER} attempts, falling back to first match`, 'warn');
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `No matching email found on 163 Mail after ${(maxAttempts * intervalMs / 1000).toFixed(0)}s. ` +
    'Check inbox manually.'
  );
}

// ============================================================
// Inbox Refresh
// ============================================================

async function refreshInbox() {
  // 163 mail: click the "收信" button in toolbar
  function tryRefresh(doc) {
    const btn = doc.querySelector(
      'a[title="收信"], [id*="refresh"], .nui-toolbar-item[title*="收"]'
    );
    if (btn) {
      btn.click();
      console.log(MAIL163_PREFIX, 'Clicked 收信 button');
      return true;
    }
    return false;
  }

  if (tryRefresh(document)) { await sleep(500); return; }

  // Try in iframes
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc && tryRefresh(doc)) { await sleep(500); return; }
    } catch { }
  }

  console.log(MAIL163_PREFIX, 'Could not find refresh button');
}

// ============================================================
// Verification Code Extraction
// ============================================================

function extractVerificationCode(text) {
  const matchCn = text.match(/(?:代码为|验证码[^0-9]*?)[\s：:]*(\d{6})/);
  if (matchCn) return matchCn[1];

  const matchEn = text.match(/code[:\s]+is[:\s]+(\d{6})|code[:\s]+(\d{6})/i);
  if (matchEn) return matchEn[1] || matchEn[2];

  const match6 = text.match(/\b(\d{6})\b/);
  if (match6) return match6[1];

  return null;
}
