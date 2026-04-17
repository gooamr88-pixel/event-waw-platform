# Via — Premium Event Ticketing Platform

A production-ready event ticketing & FinTech SaaS with zero-overbooking guarantees, secure Stripe payments, and real-time QR access control.

## Tech Stack

- **Frontend:** Vanilla HTML5, CSS, JavaScript (Phase 1 → Vite + ES Modules from Phase 2)
- **Backend:** Supabase (PostgreSQL, Auth, RLS, Edge Functions)
- **Payments:** Stripe Connect + Checkout
- **Hosting:** Vercel (Frontend) + Supabase (Cloud Backend)

## Project Structure

```
├── index.html              # Landing page
├── login.html              # Sign in
├── register.html           # Create account
├── forgot-password.html    # Password reset
├── css/
│   └── styles.css          # Design system
├── js/
│   └── main.js             # Shared JavaScript
└── images/                 # Event assets
```

## Development

Open `index.html` in your browser, or serve locally:

```bash
npx serve .
```

## Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 — Demo & Deposit | ✅ In Progress | Premium UI prototype |
| 2 — Core DB & Auth | ⬜ Planned | Supabase schema + RLS + Auth |
| 2.5 — Organizer Dashboard | ⬜ Planned | Event CRUD, tier management |
| 3 — FinTech Engine | ⬜ Planned | Stripe + concurrency control |
| 4 — Scanner PWA | ⬜ Planned | QR ticket validation |

## License

Proprietary — All rights reserved.
