# Event Waw — System Architecture

> **Version**: 2.0 · Enterprise Grade  
> **Last Updated**: 2026-05-07  
> **Stack**: Vanilla JS (ESM) · Supabase (Auth, DB, Storage, Edge Functions) · Stripe

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (Vanilla JS SPA)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Landing  │ │ Events   │ │Dashboard │ │ Admin Console │  │
│  │ index.html│ │events.html│ │dashboard │ │  admin.html   │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘  │
│       └─────────────┴────────────┴──────────────┘           │
│                          │                                  │
│              src/lib/ (Modular ES Modules)                  │
│  ┌────────┐ ┌──────┐ ┌───────┐ ┌────────┐ ┌────────────┐  │
│  │supabase│ │guard │ │events │ │ dom.js │ │dashboard-* │  │
│  │  .js   │ │ .js  │ │  .js  │ │(XSS)  │ │  modules   │  │
│  └───┬────┘ └──┬───┘ └───┬───┘ └────────┘ └────────────┘  │
└──────┼─────────┼─────────┼──────────────────────────────────┘
       │         │         │
       ▼         ▼         ▼
┌─────────────────────────────────────────────────────────────┐
│                    SUPABASE BACKEND                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │  Auth    │ │ Postgres │ │ Storage  │ │Edge Functions │  │
│  │(JWT+OTP)│ │ (RLS)    │ │ (S3)     │ │  (Deno)       │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────┬────────┘  │
└────────────────────────────────────────────────┬────────────┘
                                                 │
                                    ┌────────────▼──────────┐
                                    │   Stripe (Payments)   │
                                    │   Webhooks → Orders   │
                                    └───────────────────────┘
```

---

## 2. Database Schema

### Core Tables

| Table | Description | RLS |
|-------|-------------|-----|
| `profiles` | User identity (linked to `auth.users`) | Own-row + Admin global |
| `events` | Event listings with approval pipeline | Owner + Approved-public |
| `ticket_tiers` | Pricing tiers per event | Owner + Public-approved |
| `reservations` | Atomic seat holds (35-min TTL) | Own-row only |
| `orders` | Stripe payment records | Own + Organizer |
| `tickets` | Issued QR-code tickets | Own + Organizer |
| `login_otps` | 2FA OTP codes (SHA-256 hashed) | Own-row only |
| `platform_settings` | CMS content (hero, sponsors, stats) | Public read, Admin write |
| `venue_maps` | Seating chart layouts (JSON) | Owner |
| `seats` | Individual seat inventory | Owner |
| `webhook_failures` | Stripe webhook error log | Service-role only |

### Enums

| Enum | Values |
|------|--------|
| `user_role` | `attendee`, `organizer`, `admin` |
| `event_status` | `draft`, `published`, `cancelled`, `completed` |
| `reservation_status` | `active`, `expired`, `converted` |
| `order_status` | `pending`, `paid`, `refunded`, `failed` |
| `ticket_status` | `valid`, `scanned`, `cancelled` |

### Key Columns (Post-Migration)

- `events.admin_approved` — Boolean gate; public visibility requires `true`
- `events.admin_rejected_reason` — Feedback to organizer
- `events.listing_type` — `display_only` or `display_and_sell`
- `profiles.is_blocked` — Platform ban flag
- `profiles.otp_verified_at` — 24-hour OTP session window

---

## 3. RLS Security Model

### Defense-in-Depth Strategy

```
Layer 1: Supabase Auth (JWT validation)
Layer 2: Row Level Security (per-table policies)
Layer 3: SECURITY DEFINER RPCs (admin-only operations)
Layer 4: Client-side guard.js (page-level gating)
Layer 5: DOM sanitization (dom.js — XSS prevention)
```

### Critical RLS Policies

| Policy | Table | Rule |
|--------|-------|------|
| `events_select_public` | events | `status='published' AND admin_approved=true` |
| `events_insert` | events | `organizer_id=auth.uid() AND admin_approved=false` |
| `events_update_own` | events | Cannot flip `admin_approved` |
| `events_update_admin` | events | `is_admin()` — approve/reject |
| `profiles_select_admin` | profiles | `is_admin()` — global user list |
| `reservations` | reservations | NO INSERT policy — RPC only |
| `orders`/`tickets` | orders/tickets | INSERT via `service_role` webhook only |

### Admin Role Hierarchy

```
super_admin (level 3) → Full access: CMS, maintenance, roles, all panels
admin       (level 2) → Approvals, Users (up to moderator), Events
moderator   (level 1) → View stats, Approve/Reject events, View events
```

The `is_admin()` SECURITY DEFINER function checks the `profiles.role` column server-side, preventing client-side role spoofing.

---

## 4. Auth Flows

### Registration Flow
```
User → register.html → signUp() → Supabase Auth creates user
  → User metadata stores {full_name, phone, role}
  → Self-healing profile: getCurrentProfile() auto-creates row if missing
```

### Login Flow (with OTP)
```
User → login.html → signIn() → Supabase Auth
  → guard.js → protectPage({requireOTP: true})
  → generate_login_otp() RPC → SHA-256 hash stored in DB
  → Email OTP via Edge Function → User enters code
  → verify_login_otp() RPC → profiles.otp_verified_at set
  → 24-hour session window
```

### Admin Access Flow
```
User → admin.html → protectPage({requireRole: 'admin'})
  → guard.js checks profile.role via getCurrentProfile()
  → isAdminLevel() validates ['super_admin', 'admin', 'moderator']
  → Non-admin → showUpgradeModal() or redirect
```

### Checkout Flow (Stripe)
```
User selects tier → create_reservation() RPC (atomic, 35-min hold)
  → create-checkout Edge Function → Stripe Checkout Session
  → User pays on Stripe → stripe-webhook Edge Function
  → Webhook: creates Order (paid) + Tickets (with QR hash)
  → increment_sold_count() + reserve status → 'converted'
```

---

## 5. Frontend Module Map

### Entry Points (HTML Pages)
| Page | JS Entry | Guard |
|------|----------|-------|
| `index.html` | `js/main.js` | `semiProtectPage()` |
| `events.html` | `js/events-page.js` | `semiProtectPage()` |
| `event-detail.html` | (inline) | `semiProtectPage()` |
| `dashboard.html` | `js/eveenty-dashboard.js` | `protectPage({requireRole:'organizer'})` |
| `admin.html` | `js/admin-dashboard.js` | `protectPage({requireRole:'admin'})` |
| `login.html` | (inline) | `guestOnlyPage()` |
| `register.html` | (inline) | `guestOnlyPage()` |

### Module Dependency Graph
```
supabase.js ← auth.js ← guard.js ← [all pages]
     ↑
     ├── events.js ← dashboard-events.js ← eveenty-dashboard.js
     ├── dashboard-modals.js ← wizard-tickets.js, wizard-uploads.js, wizard-maps.js
     ├── dashboard-analytics.js, dashboard-attendees.js, dashboard-promos.js
     ├── dashboard-ui.js (toasts, panel switching)
     ├── dashboard-bus.js (event emitter)
     ├── admin-cms.js ← admin-dashboard.js
     └── dom.js (XSS sanitization) ← [all modules using setSafeHTML]
```

---

## 6. Edge Functions

| Function | Trigger | Auth | Purpose |
|----------|---------|------|---------|
| `create-checkout` | POST | Bearer JWT or Guest | Creates Stripe Checkout Session + reservation |
| `stripe-webhook` | POST | Stripe signature | Processes payment → creates orders + tickets |
| `send-otp-email` | POST | Service role | Sends OTP code via email |
| `send-password-reset-otp` | POST | Service role | Password reset OTP |
| `verify-ticket` | POST | Bearer JWT | QR code scan verification |
| `verify-guest-ticket` | POST | Public | Guest ticket verification |
| `verify-password-reset-otp` | POST | Public | Validates reset OTP |
| `stripe-onboarding` | POST | Bearer JWT | Organizer Stripe Connect |
| `gemini-chat` | POST | Bearer JWT | AI assistant |

---

## 7. Security Checklist

### SQL Injection Prevention ✅
All database queries use the Supabase client's parameterized methods:
- `.eq()`, `.neq()`, `.in()`, `.gte()`, `.match()`
- `.rpc()` with named parameters
- **Zero** raw SQL string interpolation in client code

### XSS Prevention ✅
- `dom.js` → `safeHTML()` strips `<script>`, `<iframe>`, `on*` handlers, `javascript:` URIs
- `utils.js` → `escapeHTML()` for text interpolation
- `csp.js` → Content Security Policy headers

### Rate Limiting Recommendations
```
Supabase Edge Function rate limiting (add to each function):

// In create-checkout/index.ts
const RATE_LIMIT = new Map();
const MAX_REQUESTS = 5;    // per window
const WINDOW_MS = 60_000;  // 1 minute

function checkRateLimit(key) {
  const now = Date.now();
  const entry = RATE_LIMIT.get(key) || { count: 0, reset: now + WINDOW_MS };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + WINDOW_MS; }
  entry.count++;
  RATE_LIMIT.set(key, entry);
  if (entry.count > MAX_REQUESTS) throw new Error('Rate limit exceeded');
}

// At top of handler:
const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
checkRateLimit(`checkout:${clientIP}`);
```

For production, use Supabase's built-in rate limiting or an API gateway (Cloudflare, Kong).

---

## 8. Automated Testing

### Running Tests

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install --with-deps

# Run all tests
npm test

# Individual test suites
npm run test:unit          # Jest unit tests
npm run test:e2e           # Playwright E2E tests
npm run test:security      # Security-specific tests
npm run test:coverage      # Jest with coverage report

# View coverage report
open test-results/coverage/lcov-report/index.html

# View E2E report
npm run test:report
```

### Coverage Threshold Enforcement

Coverage is enforced at **80% minimum** across all metrics (branches, functions, lines, statements). This is configured in `jest.config.js`:

```js
coverageThresholds: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  },
}
```

The `npm run test:coverage` command will **fail** if coverage drops below 80%, blocking the build.

### Test Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ORGANIZER_EMAIL` | `test-organizer@eventwaw.com` | E2E organizer account |
| `ORGANIZER_PASSWORD` | `TestOrg2026!` | E2E organizer password |
| `ADMIN_EMAIL` | `test-admin@eventwaw.com` | E2E admin account |
| `ADMIN_PASSWORD` | `TestAdmin2026!` | E2E admin password |
| `ATTENDEE_EMAIL` | `test-attendee@eventwaw.com` | Security test account |
| `ATTENDEE_PASSWORD` | `TestAttendee2026!` | Security test password |
| `BASE_URL` | `http://localhost:3000` | Server base URL |

### CI Pipeline Integration

```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:coverage
      - run: npm run test:e2e
      - run: npm run audit:filesize
```

---

## 9. File Size Policy

**Rule**: No source file may exceed **300 lines**.

Enforced by `npm run audit:filesize` which scans `src/lib/` and `js/` directories.

### Current Violations (Action Required)

| File | Lines | Proposed Breakdown |
|------|-------|--------------------|
| `admin-dashboard.js` | 1221 | → `admin-init.js`, `admin-approvals.js`, `admin-users.js`, `admin-events-all.js`, `admin-ui.js` |
| `dashboard-modals.js` | 1200 | → `wizard-basic.js`, `wizard-publishing.js`, `wizard-sponsors.js`, `modal-orchestrator.js` |
| `venue-designer-v2.js` | 770 | → `vd-engine.js`, `vd-renderers.js`, `vd-persistence.js` |
| `seating-chart.js` | 653 | → `seating-renderer.js`, `seating-interaction.js` |
| `guard.js` | 495 | → `guard-core.js`, `guard-ui.js` (move upgrade modal) |
| `dashboard-events.js` | 468 | → `events-table.js`, `events-modals.js`, `events-archives.js` |
| `events.js` | 412 | → `events-api.js`, `events-checkout.js`, `events-venue.js` |

---

## 10. Onboarding — New Developer Guide

1. **Clone & Install**: `git clone ... && npm install`
2. **Start Dev Server**: `npm run dev` (serves on `:3000`)
3. **Run Tests**: `npm test` (runs unit + E2E)
4. **Check Coverage**: `npm run test:coverage` → must be ≥80%
5. **File Audit**: `npm run audit:filesize` → no file >300 lines
6. **Pre-commit**: `npm run precommit` (lint + audit + unit tests)

### Key Conventions
- All DOM writes use `setSafeHTML()` from `dom.js` — never `innerHTML`
- All DB queries use Supabase client methods — never raw SQL strings
- Admin RPCs check `is_admin()` server-side — never trust client role
- New modules go in `src/lib/` with `<domain>-<concern>.js` naming
- Exports follow named-export pattern (no default exports)
