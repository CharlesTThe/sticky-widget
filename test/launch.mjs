// Launches a Chromium for the browser suites, trying in order:
//   1. FBW_BROWSER_PATH / FBW_BROWSER_CHANNEL, when set
//   2. Playwright's own downloaded browser
//   3. an installed Google Chrome, then Microsoft Edge
//
// Step 3 exists because the Playwright download is blocked on some machines and missing on
// most that never ran `npx playwright install` — and a browser suite that skips is a browser
// suite that verified nothing. Throws with every attempt's reason if none launch.
export async function launchChromium() {
  const { chromium } = await import('playwright-core');
  const attempts = [];
  if (process.env.FBW_BROWSER_PATH || process.env.FBW_BROWSER_CHANNEL) {
    attempts.push({
      ...(process.env.FBW_BROWSER_CHANNEL ? { channel: process.env.FBW_BROWSER_CHANNEL } : {}),
      ...(process.env.FBW_BROWSER_PATH ? { executablePath: process.env.FBW_BROWSER_PATH } : {})
    });
  }
  attempts.push({}, { channel: 'chrome' }, { channel: 'msedge' });
  const reasons = [];
  for (const opts of attempts) {
    try {
      return await chromium.launch(opts);
    } catch (err) {
      reasons.push(`${JSON.stringify(opts)}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error('no Chromium could be launched — ' + reasons.join(' | '));
}
