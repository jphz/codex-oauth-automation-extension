const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadPlusCheckoutBillingModule() {
  const source = fs.readFileSync('background/steps/fill-plus-checkout.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundPlusCheckoutBilling;`)(globalScope);
}

function createAddressSeed() {
  return {
    countryCode: 'DE',
    query: 'Berlin Mitte',
    suggestionIndex: 1,
    fallback: {
      address1: 'Unter den Linden',
      city: 'Berlin',
      region: 'Berlin',
      postalCode: '10117',
    },
  };
}

function createSuccessfulBillingResult() {
  return {
    countryText: 'Germany',
    structuredAddress: {
      address1: 'Unter den Linden',
      city: 'Berlin',
      postalCode: '10117',
    },
  };
}

function createExecutorHarness({ frames, stateByFrame, readyByFrame = {} }) {
  const api = loadPlusCheckoutBillingModule();
  const events = {
    completed: [],
    ensuredTabs: [],
    injectedAllFrames: false,
    logs: [],
    messages: [],
    states: [],
    waitedUrls: [],
  };
  const checkoutTab = {
    id: 42,
    url: 'https://chatgpt.com/checkout/openai_ie/cs_test',
    status: 'complete',
  };

  const executor = api.createPlusCheckoutBillingExecutor({
    addLog: async (message, level = 'info') => events.logs.push({ message, level }),
    chrome: {
      tabs: {
        get: async (tabId) => (tabId === checkoutTab.id ? checkoutTab : null),
        query: async (queryInfo) => {
          if (queryInfo.active && queryInfo.currentWindow) {
            return [checkoutTab];
          }
          if (queryInfo.url === 'https://chatgpt.com/checkout/*') {
            return [checkoutTab];
          }
          return [];
        },
        sendMessage: async (tabId, message, options = {}) => {
          const frameId = Number.isInteger(options.frameId) ? options.frameId : 0;
          events.messages.push({ tabId, message, frameId });
          if (message.type === 'PING') {
            if (readyByFrame[frameId] === false) {
              throw new Error('No receiving end');
            }
            return { ok: true, source: 'plus-checkout' };
          }
          if (message.type === 'PLUS_CHECKOUT_GET_STATE') {
            return stateByFrame[frameId] || { hasPayPal: false, paypalCandidates: [] };
          }
          return createSuccessfulBillingResult();
        },
      },
      scripting: {
        executeScript: async (details) => {
          if (details.target?.allFrames) {
            events.injectedAllFrames = true;
          }
        },
      },
      webNavigation: {
        getAllFrames: async () => frames,
      },
    },
    completeStepFromBackground: async (step, payload) => events.completed.push({ step, payload }),
    ensureContentScriptReadyOnTabUntilStopped: async (source, tabId) => events.ensuredTabs.push({ source, tabId }),
    generateRandomName: () => ({ firstName: 'Ada', lastName: 'Lovelace' }),
    getAddressSeedForCountry: () => createAddressSeed(),
    getTabId: async () => null,
    isTabAlive: async () => false,
    setState: async (updates) => events.states.push(updates),
    sleepWithStop: async () => {},
    waitForTabCompleteUntilStopped: async () => checkoutTab,
    waitForTabUrlMatchUntilStopped: async (tabId, matcher) => {
      events.waitedUrls.push({ tabId });
      assert.equal(matcher('https://www.paypal.com/checkoutnow'), true);
      return { id: tabId, url: 'https://www.paypal.com/checkoutnow' };
    },
  });

  return { checkoutTab, events, executor };
}

test('Plus checkout billing uses the current checkout tab when step 6 did not register one', async () => {
  const { checkoutTab, events, executor } = createExecutorHarness({
    frames: [{ frameId: 0, url: 'https://chatgpt.com/checkout/openai_ie/cs_test' }],
    stateByFrame: {
      0: {
        hasPayPal: true,
        paypalCandidates: [{ tag: 'button', text: 'PayPal' }],
        billingFieldsVisible: true,
        hasSubscribeButton: true,
      },
    },
  });

  await executor.executePlusCheckoutBilling({});

  assert.deepEqual(events.ensuredTabs[0], { source: 'plus-checkout', tabId: checkoutTab.id });
  assert.equal(events.messages.some((entry) => entry.message.type === 'PLUS_CHECKOUT_SELECT_PAYPAL' && entry.frameId === 0), true);
  assert.equal(events.messages.some((entry) => entry.message.type === 'PLUS_CHECKOUT_FILL_BILLING_ADDRESS' && entry.frameId === 0), true);
  assert.equal(events.messages.some((entry) => entry.message.type === 'PLUS_CHECKOUT_CLICK_SUBSCRIBE' && entry.frameId === 0), true);
  assert.equal(events.completed[0].step, 7);
  assert.equal(events.states.some((updates) => updates.plusCheckoutTabId === checkoutTab.id), true);
  assert.equal(events.logs.some((entry) => /当前已在 Plus Checkout 页面/.test(entry.message)), true);
});

test('Plus checkout billing sends the billing command to the iframe that contains PayPal', async () => {
  const { events, executor } = createExecutorHarness({
    frames: [
      { frameId: 0, url: 'https://chatgpt.com/checkout/openai_ie/cs_test' },
      { frameId: 7, url: 'https://js.stripe.com/v3/elements-inner-payment.html' },
      { frameId: 8, url: 'https://js.stripe.com/v3/elements-inner-address.html' },
    ],
    stateByFrame: {
      0: { hasPayPal: false, paypalCandidates: [], hasSubscribeButton: true },
      7: { hasPayPal: true, paypalCandidates: [{ tag: 'button', text: 'PayPal' }] },
      8: { hasPayPal: false, paypalCandidates: [], billingFieldsVisible: true },
    },
  });

  await executor.executePlusCheckoutBilling({});

  const selectMessage = events.messages.find((entry) => entry.message.type === 'PLUS_CHECKOUT_SELECT_PAYPAL');
  const fillMessage = events.messages.find((entry) => entry.message.type === 'PLUS_CHECKOUT_FILL_BILLING_ADDRESS');
  const subscribeMessage = events.messages.find((entry) => entry.message.type === 'PLUS_CHECKOUT_CLICK_SUBSCRIBE');
  assert.equal(selectMessage.frameId, 7);
  assert.equal(fillMessage.frameId, 8);
  assert.equal(subscribeMessage.frameId, 0);
  assert.equal(events.logs.some((entry) => /checkout iframe/.test(entry.message)), true);
  assert.equal(events.completed[0].step, 7);
});

test('Plus checkout billing uses the autocomplete iframe for address suggestions when Stripe splits it out', async () => {
  const { events, executor } = createExecutorHarness({
    frames: [
      { frameId: 0, url: 'https://chatgpt.com/checkout/openai_ie/cs_test' },
      { frameId: 7, url: 'https://js.stripe.com/v3/elements-inner-payment.html' },
      { frameId: 8, url: 'https://js.stripe.com/v3/elements-inner-address.html' },
      { frameId: 9, url: 'https://js.stripe.com/v3/elements-inner-autocompl.html' },
    ],
    stateByFrame: {
      0: { hasPayPal: false, paypalCandidates: [], hasSubscribeButton: true },
      7: { hasPayPal: true, paypalCandidates: [{ tag: 'button', text: 'PayPal' }] },
      8: { hasPayPal: false, paypalCandidates: [], billingFieldsVisible: true },
      9: { hasPayPal: false, paypalCandidates: [] },
    },
  });

  await executor.executePlusCheckoutBilling({});

  const fillQueryMessage = events.messages.find((entry) => entry.message.type === 'PLUS_CHECKOUT_FILL_ADDRESS_QUERY');
  const suggestionMessage = events.messages.find((entry) => entry.message.type === 'PLUS_CHECKOUT_SELECT_ADDRESS_SUGGESTION');
  const ensureAddressMessage = events.messages.find((entry) => entry.message.type === 'PLUS_CHECKOUT_ENSURE_BILLING_ADDRESS');
  const combinedFillMessage = events.messages.find((entry) => entry.message.type === 'PLUS_CHECKOUT_FILL_BILLING_ADDRESS');
  assert.equal(fillQueryMessage.frameId, 8);
  assert.equal(suggestionMessage.frameId, 9);
  assert.equal(ensureAddressMessage.frameId, 8);
  assert.equal(combinedFillMessage, undefined);
  assert.equal(events.logs.some((entry) => /Google 地址推荐/.test(entry.message)), true);
  assert.equal(events.completed[0].step, 7);
});

test('Plus checkout billing reports when the payment iframe exists but cannot receive the content script', async () => {
  const { executor } = createExecutorHarness({
    frames: [
      { frameId: 0, url: 'https://chatgpt.com/checkout/openai_ie/cs_test' },
      { frameId: 7, url: 'https://js.stripe.com/v3/elements-inner-payment.html' },
    ],
    stateByFrame: {
      0: { hasPayPal: false, paypalCandidates: [], hasSubscribeButton: true },
    },
    readyByFrame: {
      7: false,
    },
  });

  await assert.rejects(
    executor.executePlusCheckoutBilling({}),
    /已定位到 PayPal 所在 iframe（frameId=7），但账单脚本无法注入该 iframe/
  );
});
