(function attachBackgroundPlusCheckoutCreate(root, factory) {
  root.MultiPageBackgroundPlusCheckoutCreate = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPlusCheckoutCreateModule() {
  const PLUS_CHECKOUT_SOURCE = 'plus-checkout';
  const SIGNUP_PAGE_SOURCE = 'signup-page';
  const PLUS_CHECKOUT_ENTRY_URL = 'https://chatgpt.com/';
  const PLUS_CHECKOUT_INJECT_FILES = ['content/utils.js', 'content/plus-checkout.js'];
  const PLUS_CHECKOUT_ONLY_INJECT_FILES = ['content/plus-checkout.js'];

  function isReusableChatGptTabUrl(url = '') {
    try {
      const parsed = new URL(String(url || ''));
      const hostname = parsed.hostname.toLowerCase();
      return ['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(hostname)
        && !/^\/checkout(?:\/|$)/i.test(parsed.pathname || '');
    } catch {
      return false;
    }
  }

  function createPlusCheckoutCreateExecutor(deps = {}) {
    const {
      addLog,
      chrome,
      completeStepFromBackground,
      ensureContentScriptReadyOnTabUntilStopped,
      getTabId,
      isTabAlive,
      registerTab,
      reuseOrCreateTab,
      sendTabMessageUntilStopped,
      setState,
      sleepWithStop,
      waitForTabCompleteUntilStopped,
    } = deps;

    async function getReusableSignupChatGptTabId() {
      if (typeof getTabId !== 'function' || typeof isTabAlive !== 'function') {
        return null;
      }
      const tabId = await getTabId(SIGNUP_PAGE_SOURCE);
      if (!tabId || !(await isTabAlive(SIGNUP_PAGE_SOURCE))) {
        return null;
      }
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      return tab && isReusableChatGptTabUrl(tab.url) ? tabId : null;
    }

    async function resolveChatGptTabForCheckoutCreate() {
      const existingSignupTabId = await getReusableSignupChatGptTabId();
      if (existingSignupTabId) {
        await chrome.tabs.update(existingSignupTabId, { active: true });
        if (typeof registerTab === 'function') {
          await registerTab(PLUS_CHECKOUT_SOURCE, existingSignupTabId);
        }
        await addLog('步骤 6：检测到第 5 步已打开 ChatGPT 页面，直接接管当前标签页创建 Plus Checkout。', 'info');
        return {
          tabId: existingSignupTabId,
          injectFiles: PLUS_CHECKOUT_ONLY_INJECT_FILES,
        };
      }

      const tabId = await reuseOrCreateTab(PLUS_CHECKOUT_SOURCE, PLUS_CHECKOUT_ENTRY_URL, {
        reloadIfSameUrl: false,
      });
      return {
        tabId,
        injectFiles: PLUS_CHECKOUT_INJECT_FILES,
      };
    }

    async function executePlusCheckoutCreate() {
      await addLog('步骤 6：正在打开 ChatGPT 会话页，准备创建 Plus Checkout...', 'info');
      const { tabId, injectFiles } = await resolveChatGptTabForCheckoutCreate();

      await waitForTabCompleteUntilStopped(tabId);
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: injectFiles,
        injectSource: PLUS_CHECKOUT_SOURCE,
        logMessage: '步骤 6：ChatGPT 页面仍在加载，等待 Plus Checkout 脚本就绪...',
      });

      const result = await sendTabMessageUntilStopped(tabId, PLUS_CHECKOUT_SOURCE, {
        type: 'CREATE_PLUS_CHECKOUT',
        source: 'background',
        payload: {},
      });

      if (result?.error) {
        throw new Error(result.error);
      }
      if (!result?.checkoutUrl) {
        throw new Error('步骤 6：Plus Checkout 创建后未返回支付链接。');
      }

      await addLog('步骤 6：Plus Checkout 已创建，正在打开支付页面...', 'ok');
      await chrome.tabs.update(tabId, { url: result.checkoutUrl, active: true });
      await waitForTabCompleteUntilStopped(tabId);
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PLUS_CHECKOUT_SOURCE, tabId, {
        inject: PLUS_CHECKOUT_INJECT_FILES,
        injectSource: PLUS_CHECKOUT_SOURCE,
        logMessage: '步骤 6：Checkout 页面仍在加载，等待页面脚本就绪...',
      });

      await setState({
        plusCheckoutTabId: tabId,
        plusCheckoutUrl: result.checkoutUrl,
        plusCheckoutCountry: result.country || 'DE',
        plusCheckoutCurrency: result.currency || 'EUR',
      });

      await addLog('步骤 6：Plus Checkout 页面已就绪，准备继续下一步。', 'info');

      await completeStepFromBackground(6, {
        plusCheckoutCountry: result.country || 'DE',
        plusCheckoutCurrency: result.currency || 'EUR',
      });
    }

    return {
      executePlusCheckoutCreate,
    };
  }

  return {
    createPlusCheckoutCreateExecutor,
  };
});
