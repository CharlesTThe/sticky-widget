const { test, expect } = require('@playwright/test');

// Helper: get shadow root
const getShadow = (page) =>
  page.evaluateHandle(() => document.querySelector('#fbw-root').shadowRoot);

// Helper: query inside shadow DOM
const shadowEl = (page, selector) =>
  page.evaluateHandle(
    (sel) => document.querySelector('#fbw-root').shadowRoot.querySelector(sel),
    selector
  );

// Helper: click FAB via JS (inside shadow DOM)
const clickFab = (page) =>
  page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-fab').click()
  );

test.beforeEach(async ({ page }) => {
  // Default: stub the demo's POST endpoint so submits succeed without a real backend.
  // Tests that need a different response can override with their own page.route.
  await page.route('**/api/v1/feedback', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' })
  );

  await page.goto('/demo/');
  // Wait for widget to init (FAB exists in shadow DOM)
  await page.waitForFunction(() => {
    const host = document.querySelector('#fbw-root');
    return host && host.shadowRoot && host.shadowRoot.querySelector('.fbw-fab');
  });
});

test('FAB renders in shadow DOM', async ({ page }) => {
  const hasFab = await page.evaluate(() => {
    const host = document.querySelector('#fbw-root');
    return !!host.shadowRoot.querySelector('.fbw-fab');
  });
  expect(hasFab).toBe(true);
});

test('Shadow DOM isolates widget CSS', async ({ page }) => {
  // Widget styles should NOT be in document.head (except light DOM overlay/cursor styles)
  const hasShadowStyle = await page.evaluate(() => {
    const host = document.querySelector('#fbw-root');
    return !!host.shadowRoot.querySelector('style[data-fbw]');
  });
  const hasLightStyle = await page.evaluate(() =>
    !!document.querySelector('style[data-fbw-light]')
  );
  expect(hasShadowStyle).toBe(true);
  expect(hasLightStyle).toBe(true);
});

test('Feedback mode toggle — click FAB to enter, click again to exit', async ({ page }) => {
  await clickFab(page);

  // FAB should be active (red)
  const isActive = await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-fab').classList.contains('fbw-fab--active')
  );
  expect(isActive).toBe(true);

  // Overlay should exist in light DOM
  const hasOverlay = await page.evaluate(() => !!document.querySelector('.fbw-overlay'));
  expect(hasOverlay).toBe(true);

  // Click FAB again to exit
  await clickFab(page);
  const isIdle = await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-fab').classList.contains('fbw-fab--idle')
  );
  expect(isIdle).toBe(true);
});

test('Element highlighting on hover', async ({ page }) => {
  await clickFab(page);

  // Move mouse over an element
  const card = page.locator('.card').first();
  await card.hover();
  await page.waitForFunction(() => !!document.querySelector('.fbw-highlight'));

  const hasHighlight = await page.evaluate(() => !!document.querySelector('.fbw-highlight'));
  expect(hasHighlight).toBe(true);
});

test('Popover opens on click in feedback mode', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  const hasPopover = await page.evaluate(() =>
    !!document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover')
  );
  expect(hasPopover).toBe(true);

  // Textarea should be focused (wait for rAF focus)
  await page.waitForFunction(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    return shadow.activeElement?.classList.contains('fbw-popover__textarea');
  });
});

test('Submit flow — type text and click submit', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  // Type in textarea
  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Test feedback comment';
    ta.dispatchEvent(new Event('input'));
  });

  // Click submit
  await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover__btn--submit').click()
  );

  // Popover closes only after the (stubbed) server confirms.
  await page.waitForFunction(() =>
    !document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover')
  , { timeout: 2000 });

  // Debug panel should have the feedback
  const debugText = await page.textContent('#debug-output');
  expect(debugText).toContain('Test feedback comment');
});

test('Ctrl+Enter submits feedback', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Ctrl+Enter test';
    ta.dispatchEvent(new Event('input'));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  });

  await page.waitForFunction(() =>
    document.getElementById('debug-output').textContent.includes('Ctrl+Enter test')
  );
  const debugText = await page.textContent('#debug-output');
  expect(debugText).toContain('Ctrl+Enter test');
});

test('Cancel with empty textarea closes popover', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover__btn--cancel').click()
  );

  const popoverGone = await page.evaluate(() =>
    !document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover')
  );
  expect(popoverGone).toBe(true);
});

test('Confirmation dialog appears when canceling with text', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  // Type some text
  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Unsaved text';
    ta.dispatchEvent(new Event('input'));
  });

  // Click cancel
  await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover__btn--cancel').click()
  );

  // Confirm dialog should appear
  const hasConfirm = await page.evaluate(() =>
    !!document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-confirm')
  );
  expect(hasConfirm).toBe(true);
});

test('Confirm → Go back preserves text', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Preserve me';
    ta.dispatchEvent(new Event('input'));
  });

  // Cancel → triggers confirm
  await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover__btn--cancel').click()
  );

  // Click "Go back" (last button in confirm)
  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const buttons = shadow.querySelector('.fbw-confirm').querySelectorAll('button');
    buttons[buttons.length - 1].click();
  });

  // Popover should still be open with text preserved
  const text = await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    return shadow.querySelector('.fbw-popover__textarea').value;
  });
  expect(text).toBe('Preserve me');
});

test('Confirm → Discard closes popover', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Will be discarded';
    ta.dispatchEvent(new Event('input'));
  });

  await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover__btn--cancel').click()
  );

  // Click "Discard" (first button)
  await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-confirm button').click()
  );

  const popoverGone = await page.evaluate(() =>
    !document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover')
  );
  expect(popoverGone).toBe(true);
});

test('Confirm → Submit submits from confirm dialog', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Submit from confirm';
    ta.dispatchEvent(new Event('input'));
  });

  // Click outside popover to trigger confirm (click on body area)
  await page.click('nav');

  await page.waitForFunction(() =>
    !!document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-confirm')
  );

  // Click "Submit" button in confirm dialog (second button: Discard=0, Submit=1, Go back=2)
  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const buttons = shadow.querySelector('.fbw-confirm').querySelectorAll('button');
    buttons[1].click();
  });

  await page.waitForFunction(() =>
    document.getElementById('debug-output').textContent.includes('Submit from confirm')
  );
  const debugText = await page.textContent('#debug-output');
  expect(debugText).toContain('Submit from confirm');
});

test('Escape key exits feedback mode', async ({ page }) => {
  await clickFab(page);
  await page.keyboard.press('Escape');

  const isIdle = await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-fab').classList.contains('fbw-fab--idle')
  );
  expect(isIdle).toBe(true);
});

test('Toast appears on submit (captured before auto-dismiss)', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  // Set up a listener to capture toast creation
  await page.evaluate(() => {
    window.__toastCaptured = false;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.classList && node.classList.contains('fbw-toast')) {
            window.__toastCaptured = node.textContent;
          }
        }
      }
    });
    observer.observe(document.querySelector('#fbw-root').shadowRoot, { childList: true });
  });

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Toast test';
    ta.dispatchEvent(new Event('input'));
    shadow.querySelector('.fbw-popover__btn--submit').click();
  });

  await page.waitForTimeout(300);
  const toastText = await page.evaluate(() => window.__toastCaptured);
  expect(toastText).toBeTruthy();
});

test('Error toast on failed POST', async ({ page }) => {
  // Re-init with a bad postUrl
  await page.evaluate(() => {
    StickyWidget.destroy();
    StickyWidget.init({ postUrl: 'http://localhost:1/nonexistent' });
  });
  await page.waitForFunction(() =>
    !!document.querySelector('#fbw-root')?.shadowRoot?.querySelector('.fbw-fab')
  );

  await clickFab(page);
  await page.click('article h2');

  await page.evaluate(() => {
    window.__errorToast = null;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.classList && node.classList.contains('fbw-toast--error')) {
            window.__errorToast = node.textContent;
          }
        }
      }
    });
    observer.observe(document.querySelector('#fbw-root').shadowRoot, { childList: true });
  });

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Error test';
    ta.dispatchEvent(new Event('input'));
    shadow.querySelector('.fbw-popover__btn--submit').click();
  });

  await page.waitForFunction(() => window.__errorToast !== null, { timeout: 5000 });
  const errorToast = await page.evaluate(() => window.__errorToast);
  expect(errorToast).toContain('Failed');
});

test('Browser metadata captured in payload', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Metadata test';
    ta.dispatchEvent(new Event('input'));
    shadow.querySelector('.fbw-popover__btn--submit').click();
  });

  await page.waitForFunction(() => StickyWidget.getEntries().length > 0);
  const entry = await page.evaluate(() => StickyWidget.getEntries()[0]);
  expect(entry.metadata).toBeDefined();
  expect(entry.metadata.userAgent).toBeTruthy();
  expect(entry.metadata.viewport).toMatch(/\d+x\d+/);
  expect(entry.metadata.url).toContain('localhost');
});

test('User identity included in payload', async ({ page }) => {
  await clickFab(page);
  await page.click('article h2');

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'User test';
    ta.dispatchEvent(new Event('input'));
    shadow.querySelector('.fbw-popover__btn--submit').click();
  });

  await page.waitForFunction(() => StickyWidget.getEntries().length > 0);
  const entry = await page.evaluate(() => StickyWidget.getEntries()[0]);
  expect(entry.user).toBeDefined();
  expect(entry.user.name).toBe('Demo User');
  expect(entry.user.email).toBe('demo@example.com');
});

test('Popover stays open until fetch resolves; retry possible on failure', async ({ page }) => {
  // Intercept the POST and stall it for 500ms so we can observe in-flight UI.
  await page.route('**/api/v1/feedback', async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
  });

  await page.evaluate(() => {
    StickyWidget.destroy();
    StickyWidget.init({ postUrl: '/api/v1/feedback' });
  });
  await page.waitForFunction(() =>
    !!document.querySelector('#fbw-root')?.shadowRoot?.querySelector('.fbw-fab')
  );

  await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-fab').click()
  );
  await page.click('article h2');

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Retry me';
    ta.dispatchEvent(new Event('input'));
    shadow.querySelector('.fbw-popover__btn--submit').click();
  });

  // While the fetch is in flight, popover must still be visible.
  await page.waitForTimeout(150);
  const popoverStillThere = await page.evaluate(() =>
    !!document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover')
  );
  expect(popoverStillThere).toBe(true);

  // After failure (≥500ms), popover should STILL be there (user can retry)
  // and an error toast should have appeared.
  await page.waitForFunction(() =>
    !!document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-toast--error')
  , { timeout: 2000 });
  const popoverAfterError = await page.evaluate(() =>
    !!document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover')
  );
  expect(popoverAfterError).toBe(true);

  // Textarea content preserved for retry
  const text = await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    return shadow.querySelector('.fbw-popover__textarea').value;
  });
  expect(text).toBe('Retry me');
});

test('Client rejects 200 OK with non-ok body as failure', async ({ page }) => {
  await page.route('**/api/v1/feedback', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"misrouted"}' })
  );

  await page.evaluate(() => {
    StickyWidget.destroy();
    StickyWidget.init({ postUrl: '/api/v1/feedback' });
  });
  await page.waitForFunction(() =>
    !!document.querySelector('#fbw-root')?.shadowRoot?.querySelector('.fbw-fab')
  );

  await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-fab').click()
  );
  await page.click('article h2');

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Soft fail';
    ta.dispatchEvent(new Event('input'));
    shadow.querySelector('.fbw-popover__btn--submit').click();
  });

  await page.waitForFunction(() =>
    !!document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-toast--error')
  , { timeout: 2000 });

  const popoverOpen = await page.evaluate(() =>
    !!document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover')
  );
  expect(popoverOpen).toBe(true);
});

test('Popover closes only after a successful submit', async ({ page }) => {
  await page.route('**/api/v1/feedback', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.evaluate(() => {
    StickyWidget.destroy();
    StickyWidget.init({ postUrl: '/api/v1/feedback' });
  });
  await page.waitForFunction(() =>
    !!document.querySelector('#fbw-root')?.shadowRoot?.querySelector('.fbw-fab')
  );

  await page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-fab').click()
  );
  await page.click('article h2');

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'OK path';
    ta.dispatchEvent(new Event('input'));
    shadow.querySelector('.fbw-popover__btn--submit').click();
  });

  // Wait for popover to close.
  await page.waitForFunction(() =>
    !document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover')
  , { timeout: 2000 });
});

test('Console logs captured in payload', async ({ page }) => {
  // Trigger a console error before submitting
  await page.evaluate(() => console.error('Test error for capture'));

  await clickFab(page);
  await page.click('article h2');

  await page.evaluate(() => {
    const shadow = document.querySelector('#fbw-root').shadowRoot;
    const ta = shadow.querySelector('.fbw-popover__textarea');
    ta.value = 'Console test';
    ta.dispatchEvent(new Event('input'));
    shadow.querySelector('.fbw-popover__btn--submit').click();
  });

  await page.waitForFunction(() => StickyWidget.getEntries().length > 0);
  const entry = await page.evaluate(() => StickyWidget.getEntries()[0]);
  expect(entry.consoleLogs).toBeDefined();
  expect(entry.consoleLogs.length).toBeGreaterThan(0);
  const errorLog = entry.consoleLogs.find((l) => l.message.includes('Test error for capture'));
  expect(errorLog).toBeDefined();
});
