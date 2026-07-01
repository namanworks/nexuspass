# NexusPass — Project Plan

## Overview

NexusPass is a full-stack ticketing platform with four core differentiators: real-time group seat booking where every member pays for themselves, a regulated face-value resale marketplace, cryptographic rotating QR ticket validation, and live seat locking with WebSocket synchronization. The project is designed as a portfolio piece that demonstrates production-grade backend architecture, database concurrency patterns, and real-time systems.

---

## Core Features

### Feature 1 — Group Booking (Split Payment)

Users can initiate a group booking session and invite others via a shareable link. Each member selects and pays for their own seat independently within the same session. Seats are held under a shared group lock for 10 minutes.

**Edge case — partial payment at expiry:**
If 4 out of 5 members pay before the lock expires, only the unpaid member's seat is released. The 4 paid members retain their tickets. The released seat becomes immediately available to other users and is broadcast via WebSocket to all connected clients.

**Group invite flow:**
The group organizer creates a session and shares a link containing the `group_id`. Anyone with the link can join the session and select an available seat within the group. The schema uses a `group_invites` table to track invited members and their payment status.

**Roles:**
- Group leader: the person who initiates the session
- Group members: anyone who joins via the invite link
- Each member owns and pays for their own ticket — there is no concept of one person paying for others

---

### Feature 2 — Regulated Resale Marketplace

Any ticket holder can relist their ticket on the platform at or below the original purchase price. A flat relist fine is charged upfront at the moment of listing. The relist window closes exactly 1 hour before the event starts.

**Relist fine ownership:**
The fine is always paid by the ticket owner at the time of listing. Since everyone pays for their own ticket in a group booking, each person is responsible for their own relist fine with no involvement from the group leader.

**If the ticket sells:**
- The buyer's `user_id` is atomically swapped onto the ticket record
- A new TOTP seed is generated for the new owner
- A new QR code is issued to the buyer
- The original seller receives the sale amount minus the relist fine (fine is non-refundable in this case)

**If the ticket does not sell:**
- At T-1hr (relist window close), a cron job runs
- The ticket status flips to `returned_to_owner` and then immediately to `valid`
- The relist fine is refunded in the same database transaction
- The user receives a notification that their ticket is valid and usable
- The ticket is fully functional — the original owner can attend the event

**Relist limit:**
A ticket can only be relisted once. The `tickets` table stores a `relist_used BOOLEAN DEFAULT false` flag. Once set to `true` at the time of listing, any future relist attempt is rejected by the API regardless of the ticket's current status.

**Relist window:**
Closes exactly 1 hour before the event `start_time`. No exceptions. Any listing created with less than 1 hour to event start is rejected.

---

### Feature 3 — Cryptographic Rotating QR Ticket Validation

Each ticket has a unique HMAC secret seed stored in the database at the time of issue. When a user opens their ticket wallet, the frontend fetches the seed and uses `otplib` to derive a TOTP token. The QR code encodes `ticketId:currentTOTP` and re-renders every 15 seconds.

**At venue entry:**
The admin scans the QR or manually submits the token to the `/api/verify` endpoint. The backend re-derives the TOTP from the stored seed for that `ticketId` and compares it against the submitted token. If valid, the ticket status flips to `used`. If invalid (expired token or wrong ticket), the scan is rejected.

**Why this works as anti-fraud:**
A screenshot of the QR is useless after 15 seconds. Bulk-buying tickets to resell physically is blocked because the QR the scalper holds will expire. The face-value resale cap on the platform removes the financial incentive for scalping entirely.

**On resale:**
When a ticket changes ownership, a new HMAC seed is generated and the old one is invalidated. The previous owner's QR immediately stops working.

---

### Feature 4 — Real-Time Seat Locking

When a user clicks a seat, the backend runs `SELECT ... FOR UPDATE SKIP LOCKED` on that row. This allows concurrent requests to compete for seats without deadlocking — if a seat is already locked, the competing request skips it cleanly rather than waiting.

A `booking_groups` record is created with `status = 'pending'` and an `expires_at` timestamp of `NOW() + 10 minutes`. The locked seat's status flips to `locked`.

**WebSocket synchronization:**
All users viewing the same event are connected to a Socket.io room keyed by `event_id`. When a seat is locked, the server broadcasts `{ seatId, status: 'locked' }` to the entire room. The frontend updates the seat color instantly for all connected clients: green (available) → orange (locked) → red (sold).

**Rollback worker:**
A background worker runs every 30 seconds. It queries for `booking_groups` where `status = 'pending' AND expires_at < NOW()`. For each expired group, it sets the group status to `expired`, resets the corresponding seat statuses back to `available`, and emits a WebSocket broadcast to release those seats in every connected client's UI.

---

## Ticket Status State Machine

Every ticket in the system moves through a defined set of statuses. The `tickets.status` column is the single source of truth.

```
pending_lock
    │
    ├── (lock expires, no payment) ──→ [seat released, ticket record deleted]
    │
    └── (payment made) ──→ valid
                               │
                               └── (user relists) ──→ listed
                                                          │
                                           ┌─────────────┴──────────────┐
                                           │                            │
                              (buyer found)                  (window closes, unsold)
                                           │                            │
                                    sold_to_buyer              returned_to_owner
                                           │                            │
                                           └──────────┬─────────────────┘
                                                      │
                                                   valid  ← (relist_used = true, cannot relist again)
                                                      │
                                              (venue scans QR)
                                                      │
                                                    used
```

---

## Database Schema

### Table: `categories`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | VARCHAR | e.g. Concert, Movie, Comedy |
| created_at | TIMESTAMP | |

### Table: `events`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| category_id | UUID FK → categories | |
| title | VARCHAR | |
| venue | VARCHAR | |
| start_time | TIMESTAMP | Used for relist window calculation |
| created_at | TIMESTAMP | |

### Table: `slots`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| event_id | UUID FK → events | |
| seat_label | VARCHAR | e.g. A-12 |
| status | ENUM | available, locked, sold |
| price | NUMERIC | Face value |
| created_at | TIMESTAMP | |

### Table: `booking_groups`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| event_id | UUID FK → events | |
| leader_user_id | UUID FK → users | Group organizer |
| status | ENUM | pending, confirmed, expired |
| expires_at | TIMESTAMP | NOW() + 10 min |
| invite_link_token | VARCHAR UNIQUE | For shareable join link |
| created_at | TIMESTAMP | |

### Table: `group_invites`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| group_id | UUID FK → booking_groups | |
| user_id | UUID FK → users | |
| payment_status | ENUM | pending, paid |
| seat_id | UUID FK → slots | Null until seat selected |
| joined_at | TIMESTAMP | |

### Table: `transactions`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users | |
| ticket_id | UUID FK → tickets | |
| amount | NUMERIC | |
| type | ENUM | purchase, relist_fine, refund |
| idempotency_key | VARCHAR UNIQUE | Prevents duplicate charges |
| created_at | TIMESTAMP | |

### Table: `tickets`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| slot_id | UUID FK → slots | |
| user_id | UUID FK → users | Current owner |
| group_id | UUID FK → booking_groups | |
| status | ENUM | pending_lock, valid, listed, returned_to_owner, sold_to_buyer, used |
| purchased_price | NUMERIC | Face value paid at time of purchase |
| totp_seed | VARCHAR | HMAC secret for QR generation |
| relist_used | BOOLEAN DEFAULT false | Can only relist once |
| created_at | TIMESTAMP | |

### Table: `resale_marketplace`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| ticket_id | UUID FK → tickets | |
| seller_user_id | UUID FK → users | |
| buyer_user_id | UUID FK → users | Null until sold |
| list_price | NUMERIC | Must be ≤ purchased_price (DB constraint) |
| relist_fine | NUMERIC | Flat fee charged upfront |
| fine_refunded | BOOLEAN DEFAULT false | Set true if unsold at window close |
| status | ENUM | active, sold, expired_unsold |
| listed_at | TIMESTAMP | |
| closes_at | TIMESTAMP | event.start_time - 1 hour |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| HTTP framework | Express |
| Database | PostgreSQL |
| DB client | pg (node-postgres) |
| Real-time | Socket.io |
| Config | dotenv |
| Auth | JWT (jsonwebtoken) |
| OTP / QR | otplib, qrcode |
| ID generation | uuid |
| Cron / workers | node-cron |
| Frontend framework | Next.js (React) |
| Styling | Tailwind CSS |
| Socket client | socket.io-client |
| Rate limiting | express-rate-limit |

---

## Development Phases

### Phase 0 — Auth & Security Foundation
**Goal:** Build the authentication layer before anything else. Nothing else is safe without it.

**Steps:**
1. Set up project structure: `nexuspass/` with `/server` and `/client` directories
2. Install all dependencies (see tech stack above)
3. Create `.env` with `DATABASE_URL`, `JWT_SECRET`, `PORT`
4. Write `POST /api/auth/register` and `POST /api/auth/login` — return signed JWT
5. Write `authenticateToken` middleware that validates JWT on protected routes
6. Add `express-rate-limit` to all API routes — 100 requests per 15 minutes default, stricter on `/reserve`
7. Add input validation middleware (check all required fields, sanitize strings)

**CV talking points:** JWT authentication, middleware architecture, rate limiting

---

### Phase 1 — Database Setup
**Goal:** Deploy schema and seed data.

**Steps:**
1. Install and configure PostgreSQL locally
2. Write migration SQL files for all tables in dependency order:
   `users → categories → events → slots → booking_groups → group_invites → tickets → transactions → resale_marketplace`
3. Add DB constraint: `list_price <= purchased_price` on `resale_marketplace`
4. Add DB index on `slots.status` and `booking_groups.expires_at` (used heavily by the rollback worker)
5. Seed data: 1 Concert (numbered seats), 1 Movie (multiple showtimes), 1 Standup Comedy show
6. Write a `db.js` pool configuration file using `pg.Pool`

**CV talking points:** Relational schema design, DB constraints, indexing strategy

---

### Phase 2 — Core Concurrency Engine
**Goal:** Build the hardest part — seat locking under concurrent load.

**Steps:**

**2.1 — Seat reservation API**
- Write `POST /api/bookings/reserve`
- Begin a PostgreSQL transaction
- Run `SELECT id FROM slots WHERE id = $1 AND status = 'available' FOR UPDATE SKIP LOCKED`
- If no rows returned → seat taken, rollback, return 409
- If row returned → update `slots.status = 'locked'`, create `booking_groups` record with `expires_at = NOW() + interval '10 minutes'`
- Commit transaction
- Add `idempotency_key` check on the request — reject duplicates

**2.2 — WebSocket server**
- Initialize Socket.io on the Express server
- On client connect: `socket.join(eventId)` — rooms are per event
- On seat lock: `io.to(eventId).emit('seat_update', { seatId, status: 'locked' })`
- On seat release: emit `{ seatId, status: 'available' }`
- On payment complete: emit `{ seatId, status: 'sold' }`

**2.3 — Rollback worker**
- Write `workers/expiry.js` using `node-cron` on a 30-second schedule
- Query: `SELECT * FROM booking_groups WHERE status = 'pending' AND expires_at < NOW()`
- For each expired group: wrap in a transaction — set group `status = 'expired'`, reset all associated `slots.status = 'available'`
- After transaction commits: emit WebSocket `seat_update` for each released seat

**CV talking points:** `SELECT FOR UPDATE SKIP LOCKED`, PostgreSQL transactions, idempotency keys, WebSocket rooms, background workers

---

### Phase 3 — Group Booking & Payment
**Goal:** Build the group session flow end to end.

**Steps:**
1. `POST /api/groups/create` — creates a `booking_groups` record, generates `invite_link_token` (UUID), returns shareable URL
2. `POST /api/groups/join/:token` — authenticated user joins the group, creates a `group_invites` row
3. `POST /api/groups/:groupId/pay` — marks the calling user's `group_invites.payment_status = 'paid'`, creates a `tickets` record with `status = 'valid'` and a generated `totp_seed`, creates a `transactions` record
4. Partial expiry logic: rollback worker checks each expired `booking_group` — for each `group_invite` where `payment_status = 'pending'`, release only that seat. Do not touch paid members' tickets.
5. Emit granular WebSocket events per seat, not per group

**CV talking points:** Partial rollback logic, invite link token flow, atomic payment + ticket creation

---

### Phase 4 — Resale Marketplace
**Goal:** Build the regulated secondary market.

**Steps:**
1. `POST /api/resale/list` — authenticated, checks `ticket.user_id == req.user.id`, checks `relist_used == false`, checks `event.start_time - NOW() > 1 hour`, charges relist fine (creates a `transactions` record of type `relist_fine`), sets `relist_used = true`, creates `resale_marketplace` row with `closes_at = event.start_time - 1 hour`
2. `GET /api/resale/:eventId` — returns all active listings for an event
3. `POST /api/resale/buy/:listingId` — wraps in a transaction: swap `ticket.user_id` to buyer, generate new `totp_seed`, invalidate old seed, set `resale_marketplace.status = 'sold'`, set `ticket.status = 'valid'`, create purchase transaction record
4. Cron job (runs every minute): query `resale_marketplace` where `status = 'active' AND closes_at < NOW()` — for each: set `status = 'expired_unsold'`, set `ticket.status = 'valid'`, set `fine_refunded = true`, create a `transactions` record of type `refund`, send notification to seller

**CV talking points:** Atomic ownership transfer, DB constraint enforcement, cron-driven financial refund logic

---

### Phase 5 — QR Ticket Validation
**Goal:** Build the cryptographic ticket wallet and venue verification.

**Steps:**
1. `GET /api/tickets/:ticketId/seed` — authenticated, checks `ticket.user_id == req.user.id`, returns `totp_seed` (never expose this to third parties)
2. Frontend ticket wallet page: fetch seed, use `otplib.authenticator.generate(seed)` to produce a token, encode `ticketId:token` as a QR code using `qrcode` library, set a 15-second `setInterval` to regenerate
3. `POST /api/verify` — admin-only route, accepts `{ ticketId, token }`, fetches `totp_seed` from DB, runs `otplib.authenticator.verify({ token, secret: seed })`, if valid → set `ticket.status = 'used'` and return 200, if invalid → return 401
4. On resale ownership transfer: generate a new `totp_seed` with `otplib.authenticator.generateSecret()`, update the ticket record, previous seed is now invalid

**CV talking points:** TOTP cryptography, HMAC-based secret rotation, secure seed storage, time-window validation

---

### Phase 6 — Frontend
**Goal:** Build the visual layer.

**Steps:**

**6.1 — Next.js setup**
- `npx create-next-app@latest client --tailwind`
- Configure API base URL in `.env.local`
- Set up JWT storage in httpOnly cookies (not localStorage)
- Create reusable `useAuth` hook

**6.2 — Event dashboard**
- Landing page with event cards
- Category filter tabs (Concerts / Movies / Comedy) — client-side filter, no re-fetch
- Event detail page with showtime selector for movies

**6.3 — Seat grid**
- Fetch all slots for the event on page load
- Render as a CSS Grid — color-coded by status: green (available), orange (locked), red (sold)
- Connect to Socket.io room on mount, disconnect on unmount
- On `seat_update` event: update local state immediately
- On seat click: call `/api/bookings/reserve`, optimistically mark seat as orange, revert to green on 409

**6.4 — Group booking UI**
- "Book as group" button → creates session, shows shareable invite link with copy button
- Group panel showing member list and each person's payment status in real time via WebSocket

**6.5 — Ticket wallet**
- List of user's valid tickets
- Individual ticket page with rotating QR (15-second refresh)
- "Relist this ticket" button — shows current fine amount, confirms before listing

**6.6 — Resale marketplace page**
- List of available resale tickets for an event
- Buy button → triggers atomic purchase flow

**CV talking points:** Next.js dynamic routing, optimistic UI, Socket.io client integration, TOTP QR rendering

---

## Missing Pieces to Add Before Submission

These are not in the original spec but are required for the project to be credible on a CV:

1. **Payment stub** — Integrate Razorpay test mode or a mock payment function. The `transactions` table is already in the schema; just wire up a fake payment confirmation step before setting ticket status to `valid`. Without this the booking flow has no real completion.

2. **Redis for Socket.io** — If you run more than one Node process (or demonstrate horizontal scaling), Socket.io's in-memory rooms break. Add `socket.io-redis` adapter. Even if you don't scale it, mentioning this in the README shows you understand the limitation.

3. **Environment-based config** — All secrets in `.env`, never hardcoded. Add a `.env.example` file with all required keys and empty values for the repo.

4. **README** — Write a clear README with: what the project does, how to run it locally, what each API endpoint does, and a section on the technical decisions (why `FOR UPDATE SKIP LOCKED`, why TOTP for QR). This is what interviewers read before looking at code.

---

## CV Bullet Points (Ready to Use)

- Engineered a concurrent seat reservation system using PostgreSQL `SELECT FOR UPDATE SKIP LOCKED`, preventing race conditions under simultaneous booking requests
- Designed a split-payment group booking flow with partial-release expiry logic — only unpaid seats are released when a lock timer expires, preserving confirmed members' tickets
- Built a regulated resale marketplace with face-value price enforcement via database constraint and atomic `user_id` ownership transfer on purchase
- Implemented TOTP-based rotating QR ticket validation using `otplib` with per-ticket HMAC seeds — QR codes refresh every 15 seconds, making screenshots invalid as fraud vectors
- Developed real-time seat availability synchronization using Socket.io WebSocket rooms per event, with a background cron worker handling automatic lock expiry and seat release
- Designed a complete ticket lifecycle state machine (`pending_lock → valid → listed → returned_to_owner / sold_to_buyer → used`) enforced at the API layer
