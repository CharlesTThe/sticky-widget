const { test, expect } = require('@playwright/test');

// These tests require the backend server running with API_SECRET=test-secret-key
// Set TEST_BACKEND=1 to enable

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api/v1';

test.describe('Backend security', () => {
  test.skip(
    () => !process.env.TEST_BACKEND,
    'Set TEST_BACKEND=1 and run the server with API_SECRET=test-secret-key to enable'
  );

  // Run serially — rate limit test must go last
  test.describe.configure({ mode: 'serial' });

  test('API key on GET — 401 without key, 200 with key', async ({ request }) => {
    const noKey = await request.get(`${API_BASE}/feedback`);
    expect(noKey.status()).toBe(401);

    const withKey = await request.get(`${API_BASE}/feedback`, {
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(withKey.status()).toBe(200);
  });

  test('Input validation — oversized ID returns 400', async ({ request }) => {
    const res = await request.post(`${API_BASE}/feedback`, {
      data: {
        id: 'x'.repeat(300),
        comment: 'Oversized ID test',
      },
    });
    expect(res.status()).toBe(400);
  });

  test('Input validation — missing required fields returns 400', async ({ request }) => {
    const res = await request.post(`${API_BASE}/feedback`, {
      data: { id: 'test-id' }, // missing comment
    });
    expect(res.status()).toBe(400);
  });

  test('Body size — >16kb payload returns 413', async ({ request }) => {
    const res = await request.post(`${API_BASE}/feedback`, {
      data: {
        id: 'body-size-test',
        comment: 'x'.repeat(20000), // > 16kb total
      },
    });
    // Either 413 (body too large) or 400 (comment too long — 5000 char limit)
    expect([400, 413]).toContain(res.status());
  });

  // Rate limit test MUST run last — it burns through the entire rate limit window
  test('Rate limiting — 31st request returns 429', async ({ request }) => {
    // We've already sent ~4 requests above, send enough to hit 30
    for (let i = 0; i < 26; i++) {
      await request.post(`${API_BASE}/feedback`, {
        data: {
          id: `rate-test-${i}-${Date.now()}`,
          comment: `Rate limit test ${i}`,
        },
      });
    }

    // Next request should be rate limited
    const res = await request.post(`${API_BASE}/feedback`, {
      data: {
        id: `rate-test-final-${Date.now()}`,
        comment: 'Should be rate limited',
      },
    });
    expect(res.status()).toBe(429);
  });
});
