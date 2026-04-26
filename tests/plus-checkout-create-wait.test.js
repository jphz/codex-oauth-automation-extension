const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/steps/create-plus-checkout.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundPlusCheckoutCreate;`)(globalScope);

test('Plus checkout create does not wait 20 seconds after opening checkout page', async () => {
  const events = [];
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async (message, level = 'info') => {
      events.push({ type: 'log', message, level });
    },
    chrome: {
      tabs: {
        update: async (tabId, payload) => {
          events.push({ type: 'tab-update', tabId, payload });
        },
      },
    },
    completeStepFromBackground: async (step, payload) => {
      events.push({ type: 'complete', step, payload });
    },
    ensureContentScriptReadyOnTabUntilStopped: async () => {
      events.push({ type: 'ready' });
    },
    reuseOrCreateTab: async (source, url, options) => {
      events.push({ type: 'reuse-tab', source, url, options });
      return 42;
    },
    sendTabMessageUntilStopped: async () => ({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/session',
      country: 'US',
      currency: 'USD',
    }),
    setState: async (payload) => {
      events.push({ type: 'set-state', payload });
    },
    sleepWithStop: async (ms) => {
      events.push({ type: 'sleep', ms });
    },
    waitForTabCompleteUntilStopped: async () => {
      events.push({ type: 'tab-complete' });
    },
  });

  await executor.executePlusCheckoutCreate();

  const reuseEvent = events.find((event) => event.type === 'reuse-tab');
  assert.equal(reuseEvent.source, 'plus-checkout');
  assert.equal(reuseEvent.options.reloadIfSameUrl, false);
  assert.equal(Object.hasOwn(reuseEvent.options, 'inject'), false);

  const sleepEvents = events.filter((event) => event.type === 'sleep');
  assert.deepStrictEqual(sleepEvents.map((event) => event.ms), [1000, 1000]);

  const completeIndex = events.findIndex((event) => event.type === 'complete');
  const readyLogIndex = events.findIndex((event) => event.type === 'log' && /Plus Checkout 页面已就绪/.test(event.message));
  assert.ok(readyLogIndex > -1);
  assert.ok(completeIndex > readyLogIndex);
  assert.equal(events.some((event) => event.type === 'sleep' && event.ms === 20000), false);
  assert.equal(events.some((event) => event.type === 'log' && /固定等待 20 秒后继续下一步/.test(event.message)), false);
});

test('Plus checkout create reuses the ChatGPT tab from signup step 5', async () => {
  const events = [];
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async (message, level = 'info') => {
      events.push({ type: 'log', message, level });
    },
    chrome: {
      tabs: {
        get: async (tabId) => {
          events.push({ type: 'tab-get', tabId });
          return { id: tabId, url: 'https://chatgpt.com/' };
        },
        update: async (tabId, payload) => {
          events.push({ type: 'tab-update', tabId, payload });
        },
      },
    },
    completeStepFromBackground: async (step, payload) => {
      events.push({ type: 'complete', step, payload });
    },
    ensureContentScriptReadyOnTabUntilStopped: async (source, tabId, options) => {
      events.push({ type: 'ready', source, tabId, options });
    },
    getTabId: async (source) => {
      events.push({ type: 'get-tab-id', source });
      return source === 'signup-page' ? 55 : null;
    },
    isTabAlive: async (source) => {
      events.push({ type: 'alive', source });
      return source === 'signup-page';
    },
    registerTab: async (source, tabId) => {
      events.push({ type: 'register', source, tabId });
    },
    reuseOrCreateTab: async () => {
      events.push({ type: 'reuse-tab' });
      return 42;
    },
    sendTabMessageUntilStopped: async () => ({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/session',
      country: 'US',
      currency: 'USD',
    }),
    setState: async (payload) => {
      events.push({ type: 'set-state', payload });
    },
    sleepWithStop: async (ms) => {
      events.push({ type: 'sleep', ms });
    },
    waitForTabCompleteUntilStopped: async (tabId) => {
      events.push({ type: 'tab-complete', tabId });
    },
  });

  await executor.executePlusCheckoutCreate();

  assert.equal(events.some((event) => event.type === 'reuse-tab'), false);
  assert.deepEqual(
    events.find((event) => event.type === 'register'),
    { type: 'register', source: 'plus-checkout', tabId: 55 }
  );
  assert.deepEqual(
    events.find((event) => event.type === 'ready').options.inject,
    ['content/plus-checkout.js']
  );
  assert.equal(
    events.some((event) => event.type === 'log' && /直接接管当前标签页/.test(event.message)),
    true
  );
});
