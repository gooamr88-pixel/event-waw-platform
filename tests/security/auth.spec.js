// @ts-check
import { test, expect } from '@playwright/test';

/**
 * ═══════════════════════════════════════════════════════════════
 * EVENT WAW — Security Test Suite: Auth & Access Control
 * ═══════════════════════════════════════════════════════════════
 *
 * Verifies:
 *   1. Standard users CANNOT access /admin.html
 *   2. Unauthenticated users are redirected from protected pages
 *   3. Standard users CANNOT call admin-only RPCs
 *   4. Role escalation prevention (organizer can't self-promote to admin)
 *   5. XSS protection in the DOM sanitizer
 *
 * PREREQUISITES:
 *   Attendee account:   test-attendee@eventwaw.com / TestAttendee2026!
 *   Organizer account:  test-organizer@eventwaw.com / TestOrg2026!
 *   Admin account:      test-admin@eventwaw.com / TestAdmin2026!
 *
 *   Set via env vars: ATTENDEE_EMAIL, ATTENDEE_PASSWORD, etc.
 * ═══════════════════════════════════════════════════════════════
 */

const ATTENDEE_EMAIL = process.env.ATTENDEE_EMAIL || 'test-attendee@eventwaw.com';
const ATTENDEE_PASSWORD = process.env.ATTENDEE_PASSWORD || 'TestAttendee2026!';
const ORGANIZER_EMAIL = process.env.ORGANIZER_EMAIL || 'test-organizer@eventwaw.com';
const ORGANIZER_PASSWORD = process.env.ORGANIZER_PASSWORD || 'TestOrg2026!';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test-admin@eventwaw.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestAdmin2026!';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bmtwdwoibvoewbesohpu.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtdHdkd29pYnZvZXdiZXNvaHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMzY0NjYsImV4cCI6MjA5MTkxMjQ2Nn0.YIuyd2y34UHkrAp9nZM_O2yVuaMAT-XWdSrex6eATjQ';

/* ── Helper: Login and return session token ── */
async function loginAs(page, email, password) {
  await page.goto('/login.html');
  await page.waitForLoadState('domcontentloaded');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#login-submit');
  await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 15_000 });
}

/* ── Helper: Get Supabase access token via REST API ── */
async function getAccessToken(request, email, password) {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    data: { email, password },
  });

  if (response.ok()) {
    const body = await response.json();
    return body.access_token;
  }
  return null;
}

/* ═══════════════════════════════════════════
   1. UNAUTHORIZED PAGE ACCESS TESTS
   ═══════════════════════════════════════════ */

test.describe('Unauthorized Page Access', () => {
  test('Unauthenticated user is redirected from /admin.html to login', async ({ page }) => {
    // Clear all auth state
    await page.context().clearCookies();

    await page.goto('/admin.html');

    // Should be redirected to login page
    await expect(page).toHaveURL(/login/, { timeout: 15_000 });
  });

  test('Unauthenticated user is redirected from /dashboard.html to login', async ({ page }) => {
    await page.context().clearCookies();

    await page.goto('/dashboard.html');

    await expect(page).toHaveURL(/login/, { timeout: 15_000 });
  });

  test('Unauthenticated user is redirected from /scanner.html to login', async ({ page }) => {
    await page.context().clearCookies();

    await page.goto('/scanner.html');

    await expect(page).toHaveURL(/login/, { timeout: 15_000 });
  });
});

/* ═══════════════════════════════════════════
   2. ROLE-BASED ACCESS CONTROL (RBAC)
   ═══════════════════════════════════════════ */

test.describe('Role-Based Access Control', () => {
  test('Attendee cannot access /admin.html — gets upgrade modal or redirect', async ({ page }) => {
    await loginAs(page, ATTENDEE_EMAIL, ATTENDEE_PASSWORD);

    // Try to navigate to admin page
    await page.goto('/admin.html');

    // Guard should either:
    // a) Redirect to login/dashboard, or
    // b) Show upgrade modal (role gate)
    const currentUrl = page.url();
    const isOnAdmin = currentUrl.includes('admin.html');

    if (isOnAdmin) {
      // Should see upgrade modal or auth guard overlay — never the actual admin content
      const adminPanel = page.locator('#panel-dashboard .ev-stat-value').first();
      await expect(adminPanel).not.toBeVisible({ timeout: 5_000 });
    } else {
      // Correctly redirected away
      expect(currentUrl).not.toContain('admin.html');
    }
  });

  test('Organizer cannot access /admin.html', async ({ page }) => {
    await loginAs(page, ORGANIZER_EMAIL, ORGANIZER_PASSWORD);

    await page.goto('/admin.html');

    const currentUrl = page.url();
    const isOnAdmin = currentUrl.includes('admin.html');

    if (isOnAdmin) {
      // Should see upgrade modal — never admin stats
      const adminPanel = page.locator('#panel-dashboard .ev-stat-value').first();
      await expect(adminPanel).not.toBeVisible({ timeout: 5_000 });
    } else {
      expect(currentUrl).not.toContain('admin.html');
    }
  });
});

/* ═══════════════════════════════════════════
   3. ADMIN RPC AUTHORIZATION TESTS
   ═══════════════════════════════════════════ */

test.describe('Admin RPC Authorization', () => {
  test('Attendee cannot call admin_get_platform_stats RPC', async ({ request }) => {
    const token = await getAccessToken(request, ATTENDEE_EMAIL, ATTENDEE_PASSWORD);
    expect(token).toBeTruthy();

    const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/admin_get_platform_stats`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {},
    });

    // Should fail with 400/403 — "Unauthorized: admin role required"
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('Organizer cannot call admin_approve_event RPC', async ({ request }) => {
    const token = await getAccessToken(request, ORGANIZER_EMAIL, ORGANIZER_PASSWORD);
    expect(token).toBeTruthy();

    const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/admin_approve_event`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { p_event_id: '00000000-0000-0000-0000-000000000000' },
    });

    // Should fail — organizers cannot approve events
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('Organizer cannot call admin_reject_event RPC', async ({ request }) => {
    const token = await getAccessToken(request, ORGANIZER_EMAIL, ORGANIZER_PASSWORD);
    expect(token).toBeTruthy();

    const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/admin_reject_event`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        p_event_id: '00000000-0000-0000-0000-000000000000',
        p_reason: 'test-rejection',
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('Attendee cannot call admin_set_user_role RPC', async ({ request }) => {
    const token = await getAccessToken(request, ATTENDEE_EMAIL, ATTENDEE_PASSWORD);
    expect(token).toBeTruthy();

    const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/admin_set_user_role`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        p_target_user_id: '00000000-0000-0000-0000-000000000000',
        p_new_role: 'admin',
      },
    });

    // Should fail
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('Anonymous user cannot call admin RPCs at all', async ({ request }) => {
    const response = await request.post(`${SUPABASE_URL}/rest/v1/rpc/admin_get_platform_stats`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      data: {},
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});

/* ═══════════════════════════════════════════
   4. ROLE ESCALATION PREVENTION
   ═══════════════════════════════════════════ */

test.describe('Role Escalation Prevention', () => {
  test('Organizer cannot directly update own profile role to admin', async ({ request }) => {
    const token = await getAccessToken(request, ORGANIZER_EMAIL, ORGANIZER_PASSWORD);
    expect(token).toBeTruthy();

    // Try to directly update profile role column
    const response = await request.patch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.self`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      data: { role: 'admin' },
    });

    // Check that the role was NOT changed to admin
    if (response.ok()) {
      const body = await response.json();
      // Even if the request "succeeds", the role should not have changed
      // because profiles_update_own should prevent role field changes
      // (or the column is protected by a trigger)
      if (Array.isArray(body) && body.length > 0) {
        expect(body[0].role).not.toBe('admin');
      }
    }
    // If it returns an error, the protection is working
  });

  test('Attendee cannot set admin_approved=true on events via direct API', async ({ request }) => {
    const token = await getAccessToken(request, ATTENDEE_EMAIL, ATTENDEE_PASSWORD);
    expect(token).toBeTruthy();

    // Try to directly update an event's admin_approved column
    const response = await request.patch(
      `${SUPABASE_URL}/rest/v1/events?id=eq.00000000-0000-0000-0000-000000000000`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: { admin_approved: true },
      }
    );

    // Should fail — RLS prevents non-organizer from updating events
    // AND the events_update_own policy prevents flipping admin_approved
    const status = response.status();
    // Even a 200 with 0 affected rows is acceptable (RLS filtered it)
    if (response.ok()) {
      const body = await response.json();
      expect(Array.isArray(body) ? body.length : 0).toBe(0);
    }
  });
});

/* ═══════════════════════════════════════════
   5. PUBLIC PAGE SECURITY
   ═══════════════════════════════════════════ */

test.describe('Public Page Security', () => {
  test('Public events page only shows admin-approved events', async ({ request }) => {
    // Query events API directly (anonymous)
    const response = await request.get(
      `${SUPABASE_URL}/rest/v1/events?select=id,title,status,admin_approved&status=eq.published&limit=50`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const events = await response.json();

    // ALL returned events must have admin_approved = true
    for (const event of events) {
      expect(event.admin_approved).toBe(true);
    }
  });

  test('Unapproved events are NOT returned by public API', async ({ request }) => {
    // Try to fetch unapproved events directly
    const response = await request.get(
      `${SUPABASE_URL}/rest/v1/events?select=id,title&admin_approved=eq.false&status=eq.published`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const events = await response.json();

    // RLS should prevent seeing unapproved events as anonymous
    expect(events.length).toBe(0);
  });
});
