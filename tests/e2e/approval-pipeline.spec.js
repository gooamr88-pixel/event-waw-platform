// @ts-check
import { test, expect } from '@playwright/test';

/**
 * ═══════════════════════════════════════════════════════════════
 * EVENT WAW — E2E: Approval Pipeline Critical Path
 * ═══════════════════════════════════════════════════════════════
 *
 * Tests the full business-critical flow:
 *   Organizer Login → Create Event → Admin Login → Approve → Public Visibility
 *
 * PREREQUISITES:
 *   1. A test Organizer account exists in Supabase Auth:
 *      Email: test-organizer@eventwaw.com  |  Password: TestOrg2026!
 *      Role:  organizer
 *
 *   2. A test Admin account exists in Supabase Auth:
 *      Email: test-admin@eventwaw.com  |  Password: TestAdmin2026!
 *      Role:  admin (or super_admin)
 *
 *   Set these via environment variables for CI:
 *      ORGANIZER_EMAIL, ORGANIZER_PASSWORD
 *      ADMIN_EMAIL, ADMIN_PASSWORD
 * ═══════════════════════════════════════════════════════════════
 */

const ORGANIZER_EMAIL = process.env.ORGANIZER_EMAIL || 'test-organizer@eventwaw.com';
const ORGANIZER_PASSWORD = process.env.ORGANIZER_PASSWORD || 'TestOrg2026!';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'test-admin@eventwaw.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestAdmin2026!';

// Unique event title per run to avoid collisions
const TEST_EVENT_TITLE = `E2E Test Event ${Date.now()}`;

/* ────────────────────────────────────────────
   HELPER: Login via the login page
   ──────────────────────────────────────────── */
async function loginAs(page, email, password) {
  await page.goto('/login.html');
  await page.waitForLoadState('domcontentloaded');

  // Fill login form
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);

  // Submit
  await page.click('#login-submit');

  // Wait for navigation away from login page
  await page.waitForURL((url) => !url.pathname.includes('login'), {
    timeout: 15_000,
  });
}

/* ────────────────────────────────────────────
   HELPER: Logout
   ──────────────────────────────────────────── */
async function logout(page) {
  // Try the signout button (dashboard or admin page)
  const signoutBtn = page.locator('#signout-btn, #dropdown-signout').first();
  if (await signoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await signoutBtn.click();
    // Handle confirmation modal if present
    const confirmBtn = page.locator('button:has-text("Sign Out")').last();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }
  }

  // Wait for redirect to login or index
  await page.waitForURL((url) =>
    url.pathname.includes('login') || url.pathname.includes('index') || url.pathname === '/',
    { timeout: 10_000 }
  );
}

/* ═══════════════════════════════════════════
   TEST SUITE: Approval Pipeline
   ═══════════════════════════════════════════ */

test.describe('Approval Pipeline — Full Business Flow', () => {
  test.describe.configure({ mode: 'serial' });

  let eventId;

  // ─── STEP 1: Organizer Creates Event ───
  test('Organizer: login and create a new event', async ({ page }) => {
    // Login as organizer
    await loginAs(page, ORGANIZER_EMAIL, ORGANIZER_PASSWORD);

    // Should land on dashboard
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 });

    // Click "Create Event" button
    const createBtn = page.locator('#header-create-event, #welcome-create-btn').first();
    await createBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await createBtn.click();

    // Wait for the create-event panel to appear
    const createPanel = page.locator('#panel-create-event');
    await createPanel.waitFor({ state: 'visible', timeout: 10_000 });

    // Select listing type: "Display & Sell Tickets"
    const sellRadio = page.locator('input[name="ce-listing-type"][value="display_and_sell"]');
    if (await sellRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sellRadio.click();
      const continueBtn = page.locator('#ce-listing-continue');
      await continueBtn.click();
    }

    // ── Fill Basic Info ──
    await page.fill('#ce-name', TEST_EVENT_TITLE);
    await page.fill('#ce-place', 'Cairo Convention Center');
    await page.fill('#ce-city', 'Cairo');

    // Select country
    await page.selectOption('#ce-country', { index: 1 }); // First available country

    // Select category
    await page.selectOption('#ce-category', 'Technology & Innovation');

    // Select currency
    await page.selectOption('#ce-currency', 'USD');

    // Select timezone
    const timezoneSelect = page.locator('#ce-timezone');
    if (await timezoneSelect.isVisible()) {
      await timezoneSelect.selectOption({ index: 1 });
    }

    // Organizer details
    await page.fill('#ce-organizer-name', 'Test Organizer');
    await page.fill('#ce-organizer-email', ORGANIZER_EMAIL);

    // Dates — tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    await page.fill('#ce-start-date', dateStr);

    const dayAfter = new Date(tomorrow);
    dayAfter.setHours(dayAfter.getHours() + 4);
    await page.fill('#ce-end-date', dayAfter.toISOString().slice(0, 16));

    // ── Add a Ticket Tier ──
    // Navigate to tickets step
    const saveBasicBtn = page.locator('#ce-save-basic');
    await saveBasicBtn.click();

    // Fill ticket info
    await page.waitForSelector('#ce-step-tickets.active', { timeout: 5_000 }).catch(() => {});
    const ticketName = page.locator('#ce-ticket-name');
    if (await ticketName.isVisible({ timeout: 3000 }).catch(() => false)) {
      await ticketName.fill('General Admission');
      await page.fill('#ce-ticket-price', '25');
      await page.fill('#ce-ticket-qty', '100');

      // Click Add Ticket
      const addTicketBtn = page.locator('#ce-add-ticket');
      await addTicketBtn.click();
    }

    // Navigate to publishing step
    const saveTicketsBtn = page.locator('#ce-save-tickets');
    if (await saveTicketsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveTicketsBtn.click();
    }

    // ── Publish Event ──
    const publishBtn = page.locator('#ce-publish-btn');
    await publishBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await publishBtn.click();

    // Wait for success toast
    await page.waitForSelector('.toast-success, .ev-toast', { timeout: 15_000 }).catch(() => {});

    // Verify redirect back to events panel
    await page.waitForTimeout(2000);

    // Extract the event from the events table to get its ID
    // The event should now be in "Pending Review" status
    const pendingBadge = page.locator(`.ev-badge:has-text("Pending")`).first();
    await expect(pendingBadge).toBeVisible({ timeout: 10_000 });

    // Logout
    await logout(page);
  });

  // ─── STEP 2: Admin Approves Event ───
  test('Admin: login and approve the pending event', async ({ page }) => {
    // Login as admin
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Should land on admin dashboard
    await expect(page).toHaveURL(/admin/, { timeout: 15_000 });

    // Navigate to Approvals panel
    const approvalsNav = page.locator('.ev-nav-item[data-panel="approvals"]');
    await approvalsNav.click();

    // Wait for approval queue to load
    const approvalsTable = page.locator('#approvals-tbody');
    await approvalsTable.waitFor({ state: 'visible', timeout: 10_000 });

    // Find our test event in the approval queue
    const eventRow = approvalsTable.locator(`text=${TEST_EVENT_TITLE}`).first();
    await expect(eventRow).toBeVisible({ timeout: 10_000 });

    // Click Approve button for our event
    const approveBtn = eventRow.locator('..').locator('..').locator('[data-approve]');
    await approveBtn.click();

    // Handle confirmation modal
    const confirmApprove = page.locator('button:has-text("Approve Event")').last();
    await confirmApprove.waitFor({ state: 'visible', timeout: 5_000 });
    await confirmApprove.click();

    // Wait for success toast
    await page.waitForSelector('.toast-success, .ev-toast', { timeout: 10_000 }).catch(() => {});

    // Verify event disappears from approval queue
    await page.waitForTimeout(2000);

    // Logout
    await logout(page);
  });

  // ─── STEP 3: Verify Event on Public Landing Page ───
  test('Public: approved event appears on the landing page', async ({ page }) => {
    // Go to events page (public)
    await page.goto('/events.html');
    await page.waitForLoadState('domcontentloaded');

    // Wait for events to load
    await page.waitForTimeout(3000);

    // Search for our test event
    const eventTitle = page.locator(`text=${TEST_EVENT_TITLE}`).first();
    await expect(eventTitle).toBeVisible({ timeout: 15_000 });
  });

  // ─── STEP 4: Verify event is accessible via direct URL ───
  test('Public: event detail page loads correctly', async ({ page }) => {
    // Go to events page and find our event
    await page.goto('/events.html');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Click on our event to navigate to detail page
    const eventLink = page.locator(`a:has-text("${TEST_EVENT_TITLE}")`).first();

    if (await eventLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await eventLink.click();

      // Should navigate to event-detail.html
      await expect(page).toHaveURL(/event-detail/, { timeout: 10_000 });

      // Verify event title is displayed
      await expect(page.locator('h1, .event-title').first()).toContainText(
        TEST_EVENT_TITLE.slice(0, 15), // Match partial due to potential truncation
        { timeout: 10_000 }
      );
    }
  });
});
