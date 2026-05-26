const { test, expect } = require('@playwright/test');

const clickFab = (page) =>
  page.evaluate(() =>
    document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-fab').click()
  );

test('100 submissions stored correctly', async ({ page }) => {
  test.setTimeout(120000); // 2 minutes for 100 submissions

  // Stub the demo's POST endpoint so each submit succeeds without a real backend.
  await page.route('**/api/v1/feedback', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' })
  );

  await page.goto('/demo/');
  await page.waitForFunction(() => {
    const host = document.querySelector('#fbw-root');
    return host && host.shadowRoot && host.shadowRoot.querySelector('.fbw-fab');
  });

  for (let i = 1; i <= 100; i++) {
    // Enter feedback mode
    await clickFab(page);

    // Click an element
    await page.click('article h2');

    // Wait for popover
    await page.waitForFunction(() =>
      !!document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover__textarea')
    );

    // Type and submit
    const comment = `Stress test entry #${i}`;
    await page.evaluate((c) => {
      const shadow = document.querySelector('#fbw-root').shadowRoot;
      const ta = shadow.querySelector('.fbw-popover__textarea');
      ta.value = c;
      ta.dispatchEvent(new Event('input'));
      shadow.querySelector('.fbw-popover__btn--submit').click();
    }, comment);

    // Wait for popover to close (widget returns to idle)
    await page.waitForFunction(() =>
      !document.querySelector('#fbw-root').shadowRoot.querySelector('.fbw-popover')
    );
  }

  // Verify all 100 stored
  const entries = await page.evaluate(() => StickyWidget.getEntries());
  expect(entries.length).toBe(100);

  // Verify each entry
  for (let i = 0; i < 100; i++) {
    const entry = entries[i];
    expect(entry.id).toBeTruthy();
    expect(entry.comment).toBe(`Stress test entry #${i + 1}`);
    expect(entry.metadata).toBeDefined();
    expect(entry.metadata.userAgent).toBeTruthy();
    expect(entry.target).toBeDefined();
    expect(entry.target.selector).toBeTruthy();
  }

  // Verify all IDs are unique
  const ids = entries.map((e) => e.id);
  expect(new Set(ids).size).toBe(100);
});
