(function attachBackgroundPayPalApprove(root, factory) {
  root.MultiPageBackgroundPayPalApprove = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPayPalApproveModule() {
  const PAYPAL_SOURCE = 'paypal-flow';
  const PLUS_CHECKOUT_SOURCE = 'plus-checkout';
  const PAYPAL_INJECT_FILES = ['content/utils.js', 'content/paypal-flow.js'];

  function createPayPalApproveExecutor(deps = {}) {
    const {
      addLog,
      chrome,
      completeStepFromBackground,
      ensureContentScriptReadyOnTabUntilStopped,
      getTabId,
      isTabAlive,
      sendTabMessageUntilStopped,
      setState,
      sleepWithStop,
      waitForTabCompleteUntilStopped,
      waitForTabUrlMatchUntilStopped,
    } = deps;

    async function resolvePayPalTabId(state = {}) {
      const paypalTabId = await getTabId(PAYPAL_SOURCE);
      if (paypalTabId && await isTabAlive(PAYPAL_SOURCE)) {
        return paypalTabId;
      }
      const checkoutTabId = await getTabId(PLUS_CHECKOUT_SOURCE);
      if (checkoutTabId) {
        return checkoutTabId;
      }
      const storedTabId = Number(state.plusCheckoutTabId) || 0;
      if (storedTabId) {
        return storedTabId;
      }
      throw new Error('步骤 8：未找到 PayPal 标签页，请先完成步骤 7。');
    }

    async function ensurePayPalReady(tabId, logMessage = '') {
      await waitForTabUrlMatchUntilStopped(tabId, (url) => /paypal\./i.test(url));
      await waitForTabCompleteUntilStopped(tabId);
      await sleepWithStop(1000);
      await ensureContentScriptReadyOnTabUntilStopped(PAYPAL_SOURCE, tabId, {
        inject: PAYPAL_INJECT_FILES,
        injectSource: PAYPAL_SOURCE,
        logMessage: logMessage || '步骤 8：PayPal 页面仍在加载，等待脚本就绪...',
      });
    }

    async function getPayPalState(tabId) {
      const result = await sendTabMessageUntilStopped(tabId, PAYPAL_SOURCE, {
        type: 'PAYPAL_GET_STATE',
        source: 'background',
        payload: {},
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function dismissPrompts(tabId) {
      const result = await sendTabMessageUntilStopped(tabId, PAYPAL_SOURCE, {
        type: 'PAYPAL_DISMISS_PROMPTS',
        source: 'background',
        payload: {},
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function submitLogin(tabId, state = {}) {
      if (!state.paypalPassword) {
        throw new Error('步骤 8：未配置 PayPal 密码，请先在侧边栏填写。');
      }
      await addLog('步骤 8：正在填写 PayPal 登录信息并提交...', 'info');
      const result = await sendTabMessageUntilStopped(tabId, PAYPAL_SOURCE, {
        type: 'PAYPAL_SUBMIT_LOGIN',
        source: 'background',
        payload: {
          email: state.paypalEmail || '',
          password: state.paypalPassword || '',
        },
      });
      if (result?.error) {
        throw new Error(result.error);
      }
    }

    async function clickApprove(tabId) {
      const result = await sendTabMessageUntilStopped(tabId, PAYPAL_SOURCE, {
        type: 'PAYPAL_CLICK_APPROVE',
        source: 'background',
        payload: {},
      });
      if (result?.error) {
        throw new Error(result.error);
      }
      return Boolean(result?.clicked);
    }

    async function executePayPalApprove(state = {}) {
      const tabId = await resolvePayPalTabId(state);
      await ensurePayPalReady(tabId);
      await setState({ plusCheckoutTabId: tabId });

      let loggedWaiting = false;
      while (true) {
        const currentUrl = (await chrome.tabs.get(tabId).catch(() => null))?.url || '';
        if (currentUrl && !/paypal\./i.test(currentUrl)) {
          await addLog('步骤 8：PayPal 已跳转离开授权页，准备进入回跳确认。', 'ok');
          break;
        }

        await ensurePayPalReady(tabId, '步骤 8：PayPal 页面正在切换，等待脚本重新就绪...');
        const pageState = await getPayPalState(tabId);

        if (pageState.needsLogin) {
          await submitLogin(tabId, state);
          await waitForTabCompleteUntilStopped(tabId);
          await sleepWithStop(1000);
          continue;
        }

        if (pageState.hasPasskeyPrompt) {
          await addLog('步骤 8：检测到 PayPal 通行密钥提示，正在关闭...', 'info');
          await dismissPrompts(tabId);
          await sleepWithStop(1000);
          continue;
        }

        const dismissed = await dismissPrompts(tabId).catch(() => ({ clicked: 0 }));
        if (dismissed.clicked) {
          await sleepWithStop(1000);
          continue;
        }

        if (pageState.approveReady) {
          await addLog('步骤 8：正在点击 PayPal“同意并继续”...', 'info');
          const clicked = await clickApprove(tabId);
          if (clicked) {
            await setState({ plusPaypalApprovedAt: Date.now() });
            break;
          }
        }

        if (!loggedWaiting) {
          loggedWaiting = true;
          await addLog('步骤 8：等待 PayPal 授权按钮或下一步页面出现...', 'info');
        }
        await sleepWithStop(500);
      }

      await completeStepFromBackground(8, {
        plusPaypalApprovedAt: Date.now(),
      });
    }

    return {
      executePayPalApprove,
    };
  }

  return {
    createPayPalApproveExecutor,
  };
});
