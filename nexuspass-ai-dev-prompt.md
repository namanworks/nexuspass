# NexusPass — Complete AI Development Document

> **Instructions for the AI agent:**
> Build this project strictly phase by phase. Start with Phase 0 only.
> After completing each phase, output a summary of every file created, every function written, and every route registered before moving to the next phase.
> Do not skip ahead. Do not assume anything not written in this document.
> If something is unclear, ask before implementing.

---

## 1. Project Overview

NexusPass is a full-stack event ticketing platform. It is a portfolio project built to demonstrate production-grade backend architecture, database concurrency patterns, and real-time systems.

**What it does:**
- Users browse events (concerts, movies, standup comedy) and select seats
- Seats are locked in real time — other users see locks instantly via WebSocket
- Users can book as a group where each member pays for their own seat independently
- Tickets are issued with a cryptographic rotating QR code that refreshes every 15 seconds
- Ticket holders can relist their ticket for resale at or below face value, subject to rules

**Tech stack:**

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| HTTP framework | Express |
| Database | PostgreSQL |
| DB client | pg (node-postgres) — raw SQL only, no ORM |
| Real-time | Socket.io |
| Config | dotenv |
| Auth | JWT (jsonwebtoken) |
| OTP / QR | otplib, qrcode |
| ID generation | uuid |
| Cron / workers | node-cron |
| Rate limiting | express-rate-limit |
| Frontend framework | Next.js (React) |
| Styling | Tailwind CSS |
| Socket client | socket.io-client |

---

## 2. Folder Structure

Create this exact folder structure. Do not deviate.

```
nexuspass/
├── server/
│   ├── index.js                  # Entry point, Express + Socket.io init
│   ├── socket.js                 # Socket.io event handlers
│   ├── .env                      # Environment variables (never commit)
│   ├── routes/
│   │   ├── auth.js
│   │   ├── events.js
│   │   ├── bookings.js
│   │   ├── groups.js
│   │   ├── tickets.js
│   │   ├── resale.js
│   │   └── verify.js
│   ├── middleware/
│   │   ├── authenticateToken.js
│   │   ├── rateLimiter.js
│   │   └── validateInput.js
│   ├── db/
│   │   ├── pool.js               # pg.Pool configuration
│   │   ├── migrate.js            # Run migration SQL files
│   │   ├── seed.js               # Seed data script
│   │   ├── migrations/
│   │   │   └── 001_initial.sql
│   │   └── queries/
│   │       ├── slots.js
│   │       ├── bookings.js
│   │       ├── groups.js
│   │       ├── tickets.js
│   │       └── resale.js
│   └── workers/
│       ├── expiryWorker.js       # Seat lock rollback cron
│       └── relistWorker.js       # Resale window close cron
├── client/
│   ├── pages/
│   │   ├── index.js              # Event dashboard
│   │   ├── events/[id].js        # Event detail + seat grid
│   │   ├── groups/[token].js     # Group join page
│   │   ├── tickets/index.js      # User ticket wallet
│   │   ├── tickets/[id].js       # Single ticket + QR
│   │   ├── resale/[eventId].js   # Resale marketplace
│   │   └── verify.js             # Admin QR verification page
│   ├── components/
│   │   ├── SeatGrid.js
│   │   ├── SeatCell.js
│   │   ├── GroupPanel.js
│   │   ├── TicketCard.js
│   │   ├── QRDisplay.js
│   │   └── ResaleListing.js
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useSocket.js
│   │   └── useTicket.js
│   └── lib/
│       ├── api.js                # Fetch wrapper with base URL + auth header
│       └── constants.js          # Shared constants
└── README.md
```

---

## 3. Environment Variables

Create `server/.env` with exactly these keys:

```env
PORT=5000
DATABASE_URL=postgresql://postgres:password@localhost:5432/nexuspass
JWT_SECRET=nexuspass_jwt_secret_change_in_production
JWT_EXPIRES_IN=7d
TOTP_WINDOW=1
RELIST_FINE_AMOUNT=30
LOCK_DURATION_MINUTES=10
RELIST_WINDOW_HOURS=1
```

Create `client/.env.local` with:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
```

---

## 4. Coding Conventions

Follow these rules in every file across every phase. Consistency matters.

- **Language:** JavaScript (ES2020+). No TypeScript.
- **Async style:** `async/await` everywhere. Never `.then()` chains.
- **Database:** Raw SQL via `pg`. No Sequelize, no Prisma, no query builders.
- **SQL location:** All SQL queries live in `server/db/queries/` files only. Route files never contain inline SQL.
- **Naming:** `camelCase` for JS variables and functions. `snake_case` for all database column names.
- **IDs:** All primary keys are UUIDs generated with the `uuid` package (`uuidv4()`).
- **One file per route group:** `routes/auth.js` handles only auth routes, etc.
- **Error handling:** Every async route wrapped in try/catch. Errors passed to Express error handler.
- **No magic numbers:** All configurable values (lock duration, fine amount, etc.) come from `process.env`.

---

## 5. Response Format Standard

Every API response — success or error — must follow this format exactly. The frontend depends on this contract.

**Success:**
```json
{
  "success": true,
  "data": { }
}
```

**Error:**
```json
{
  "error": true,
  "message": "Human readable message",
  "code": "SCREAMING_SNAKE_CASE_CODE"
}
```

**Standard error codes to use:**

| Code | HTTP Status | Meaning |
|---|---|---|
| `SEAT_LOCKED` | 409 | Seat already locked by another user |
| `SEAT_SOLD` | 409 | Seat already sold |
| `UNAUTHENTICATED` | 401 | No valid JWT |
| `FORBIDDEN` | 403 | Valid JWT but wrong user |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 400 | Missing or invalid request fields |
| `RELIST_LIMIT_REACHED` | 409 | Ticket already relisted once |
| `RELIST_WINDOW_CLOSED` | 409 | Less than 1 hour before event |
| `INVALID_QR` | 401 | TOTP token does not match |
| `TICKET_ALREADY_USED` | 409 | Ticket has already been scanned |
| `DUPLICATE_REQUEST` | 409 | Idempotency key already used |
| `SERVER_ERROR` | 500 | Unexpected server error |

---

## 6. Auth Strategy

- **Token type:** JWT
- **Storage:** httpOnly cookie on the client (not localStorage)
- **JWT payload:** `{ userId, email, iat, exp }`
- **Expiry:** 7 days (from `JWT_EXPIRES_IN` env var)
- **Refresh:** No refresh token — re-login on expiry
- **Protected routes:** All `/api/*` routes except `POST /api/auth/register` and `POST /api/auth/login`
- **Middleware:** `authenticateToken.js` reads the cookie, verifies the JWT, attaches `req.user = { userId, email }` to the request

---

## 7. WebSocket Event Contract

All Socket.io events must use exactly these names and shapes. The frontend and backend must match perfectly.

**Client → Server (emit from frontend):**

```js
socket.emit('join_event', { eventId })        // Join event room for seat updates
socket.emit('join_group', { groupId })        // Join group room for member updates
```

**Server → Client (emit from backend):**

```js
// Seat status changed
io.to(eventId).emit('seat_update', {
  seatId: 'uuid',
  status: 'available' | 'locked' | 'sold'
})

// A group member's payment status changed
io.to(groupId).emit('group_update', {
  groupId: 'uuid',
  memberId: 'uuid',
  paymentStatus: 'paid' | 'pending'
})

// A seat was released (lock expired or payment failed)
io.to(eventId).emit('seat_released', {
  seatId: 'uuid',
  reason: 'expired' | 'payment_failed'
})
```

---

## 8. Database Schema

Run migrations in this exact order due to foreign key dependencies:
`users → categories → events → slots → booking_groups → group_invites → tickets → transactions → resale_marketplace`

### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### categories
```sql
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### events
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id),
  title VARCHAR(255) NOT NULL,
  venue VARCHAR(255) NOT NULL,
  start_time TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### slots
```sql
CREATE TABLE slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  seat_label VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'locked', 'sold')),
  price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_slots_status ON slots(status);
CREATE INDEX idx_slots_event_id ON slots(event_id);
```

### booking_groups
```sql
CREATE TABLE booking_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  leader_user_id UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'expired')),
  expires_at TIMESTAMP NOT NULL,
  invite_link_token VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_booking_groups_expires_at ON booking_groups(expires_at);
CREATE INDEX idx_booking_groups_status ON booking_groups(status);
```

### group_invites
```sql
CREATE TABLE group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES booking_groups(id),
  user_id UUID NOT NULL REFERENCES users(id),
  seat_id UUID REFERENCES slots(id),
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid')),
  joined_at TIMESTAMP DEFAULT NOW()
);
```

### tickets
```sql
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES slots(id),
  user_id UUID NOT NULL REFERENCES users(id),
  group_id UUID REFERENCES booking_groups(id),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_lock'
    CHECK (status IN (
      'pending_lock', 'valid', 'listed',
      'returned_to_owner', 'sold_to_buyer', 'used'
    )),
  purchased_price NUMERIC(10,2) NOT NULL,
  totp_seed VARCHAR(255) NOT NULL,
  relist_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tickets_user_id ON tickets(user_id);
CREATE INDEX idx_tickets_status ON tickets(status);
```

### transactions
```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  ticket_id UUID REFERENCES tickets(id),
  amount NUMERIC(10,2) NOT NULL,
  type VARCHAR(20) NOT NULL
    CHECK (type IN ('purchase', 'relist_fine', 'refund')),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_transactions_idempotency ON transactions(idempotency_key);
```

### resale_marketplace
```sql
CREATE TABLE resale_marketplace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  seller_user_id UUID NOT NULL REFERENCES users(id),
  buyer_user_id UUID REFERENCES users(id),
  list_price NUMERIC(10,2) NOT NULL,
  purchased_price NUMERIC(10,2) NOT NULL,
  relist_fine NUMERIC(10,2) NOT NULL,
  fine_refunded BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'sold', 'expired_unsold')),
  listed_at TIMESTAMP DEFAULT NOW(),
  closes_at TIMESTAMP NOT NULL,
  CONSTRAINT price_cap CHECK (list_price <= purchased_price)
);

CREATE INDEX idx_resale_status ON resale_marketplace(status);
CREATE INDEX idx_resale_closes_at ON resale_marketplace(closes_at);
```

---

## 9. Seed Data

Run this seed after migrations. Use exact values — do not make up different data.

```js
// Categories: Concert, Movie, Comedy
// Events:
//   1. "Arijit Singh Live" — Concert — 50 seats (A1-A10, B1-B10, C1-C10, D1-D10, E1-E10) — ₹999 each — 14 days from NOW()
//   2. "Kalki 2898-AD"    — Movie   — 3 showtimes (10:00, 14:00, 18:00 tomorrow) — 30 seats each (A1-A10, B1-B10, C1-C10) — ₹250 each
//   3. "Zakir Khan Live"  — Comedy  — 40 seats (A1-A10, B1-B10, C1-C10, D1-D10) — ₹599 each — 10 days from NOW()
```

---

## 10. API Contract

Every endpoint, its method, auth requirement, request body, success response, and possible error codes.

---

### Auth Routes — `/api/auth`

**POST /api/auth/register**
- Auth: None
- Body: `{ name, email, password }`
- Success 201: `{ userId, email, name }`
- Errors: `VALIDATION_ERROR`, `SERVER_ERROR`

**POST /api/auth/login**
- Auth: None
- Body: `{ email, password }`
- Success 200: `{ userId, email, name }` + sets httpOnly JWT cookie
- Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `SERVER_ERROR`

**POST /api/auth/logout**
- Auth: None
- Success 200: clears JWT cookie

---

### Event Routes — `/api/events`

**GET /api/events**
- Auth: None
- Query params: `?category=Concert` (optional filter)
- Success 200: `{ events: [ { id, title, venue, start_time, category } ] }`

**GET /api/events/:eventId**
- Auth: None
- Success 200: `{ event: { id, title, venue, start_time, category }, slots: [ { id, seat_label, status, price } ] }`

---

### Booking Routes — `/api/bookings`

**POST /api/bookings/reserve**
- Auth: Required
- Body: `{ slotId, groupId (optional), idempotencyKey }`
- Logic: `SELECT ... FOR UPDATE SKIP LOCKED` on the slot. If locked or sold → 409. If available → lock it, create booking_group if no groupId provided.
- Success 201: `{ bookingGroupId, expiresAt, seat: { id, seatLabel, price } }`
- Errors: `SEAT_LOCKED`, `SEAT_SOLD`, `DUPLICATE_REQUEST`, `VALIDATION_ERROR`

---

### Group Routes — `/api/groups`

**POST /api/groups/create**
- Auth: Required
- Body: `{ eventId }`
- Logic: Creates booking_group with `expires_at = NOW() + LOCK_DURATION_MINUTES`, generates `invite_link_token` as UUID
- Success 201: `{ groupId, inviteLink: '/groups/{invite_link_token}', expiresAt }`

**POST /api/groups/join/:token**
- Auth: Required
- Body: none
- Logic: Find group by token, check not expired, add user to group_invites
- Success 200: `{ groupId, eventId, members: [ { userId, name, paymentStatus } ] }`
- Errors: `NOT_FOUND`, `SERVER_ERROR`

**GET /api/groups/:groupId**
- Auth: Required
- Success 200: `{ groupId, eventId, expiresAt, members: [ { userId, name, paymentStatus, seatLabel } ] }`

**POST /api/groups/:groupId/pay**
- Auth: Required
- Body: `{ slotId, idempotencyKey }`
- Logic: Mock payment → on success: set group_invite payment_status = 'paid', create ticket (status='valid', generate totp_seed), create transaction (type='purchase'), update slot status = 'sold'. Emit seat_update and group_update via WebSocket.
- Success 200: `{ ticketId, seat: { id, seatLabel }, expiresAt }`
- Errors: `DUPLICATE_REQUEST`, `FORBIDDEN`, `VALIDATION_ERROR`

---

### Ticket Routes — `/api/tickets`

**GET /api/tickets**
- Auth: Required
- Success 200: `{ tickets: [ { id, status, event: { title, start_time, venue }, seat: { seatLabel }, relist_used } ] }`

**GET /api/tickets/:ticketId**
- Auth: Required — must be ticket owner
- Success 200: `{ id, status, purchased_price, relist_used, event: { title, start_time, venue }, seat: { seatLabel } }`
- Errors: `NOT_FOUND`, `FORBIDDEN`

**GET /api/tickets/:ticketId/seed**
- Auth: Required — must be ticket owner
- Logic: Returns TOTP seed only if ticket status is 'valid' or 'listed'. Never return seed for used/expired tickets.
- Success 200: `{ seed }`
- Errors: `NOT_FOUND`, `FORBIDDEN`, `TICKET_ALREADY_USED`

---

### Resale Routes — `/api/resale`

**POST /api/resale/list**
- Auth: Required
- Body: `{ ticketId, listPrice, idempotencyKey }`
- Logic (all in one transaction):
  1. Check ticket.user_id == req.user.userId → else FORBIDDEN
  2. Check ticket.relist_used == false → else RELIST_LIMIT_REACHED
  3. Check event.start_time - NOW() > 1 hour → else RELIST_WINDOW_CLOSED
  4. Check listPrice <= ticket.purchased_price → else VALIDATION_ERROR
  5. Charge relist fine: create transaction (type='relist_fine', amount=RELIST_FINE_AMOUNT)
  6. Set ticket.relist_used = true, ticket.status = 'listed'
  7. Create resale_marketplace row with closes_at = event.start_time - 1 hour
- Success 201: `{ listingId, listPrice, relistFine, closesAt }`
- Errors: `FORBIDDEN`, `RELIST_LIMIT_REACHED`, `RELIST_WINDOW_CLOSED`, `VALIDATION_ERROR`, `DUPLICATE_REQUEST`

**GET /api/resale/:eventId**
- Auth: None
- Success 200: `{ listings: [ { id, listPrice, seat: { seatLabel }, seller: { name }, closesAt } ] }`

**POST /api/resale/buy/:listingId**
- Auth: Required
- Body: `{ idempotencyKey }`
- Logic (all in one transaction):
  1. Check listing.status == 'active' → else NOT_FOUND
  2. Check buyer is not the seller → else VALIDATION_ERROR
  3. Generate new totp_seed for the ticket
  4. Set ticket.user_id = buyer, ticket.status = 'valid', ticket.totp_seed = new seed
  5. Set listing.status = 'sold', listing.buyer_user_id = buyer
  6. Create transaction (type='purchase') for buyer
- Success 200: `{ ticketId, seat: { seatLabel }, event: { title, start_time } }`
- Errors: `NOT_FOUND`, `DUPLICATE_REQUEST`, `VALIDATION_ERROR`

---

### Verify Route — `/api/verify`

**POST /api/verify**
- Auth: Required (admin only — for now check a hardcoded admin email from env, or add `is_admin` column to users)
- Body: `{ ticketId, token }`
- Logic:
  1. Fetch ticket, check status == 'valid' → else TICKET_ALREADY_USED or NOT_FOUND
  2. Fetch totp_seed for the ticket
  3. Run `otplib.authenticator.verify({ token, secret: seed })` with window=TOTP_WINDOW
  4. If valid → set ticket.status = 'used', return success
  5. If invalid → return INVALID_QR
- Success 200: `{ valid: true, ticketId, seat: { seatLabel }, event: { title } }`
- Errors: `INVALID_QR`, `TICKET_ALREADY_USED`, `NOT_FOUND`

---

## 11. Payment Handling

**For this project, use a mock payment function only.** No real payment gateway.

Create `server/utils/mockPayment.js`:

```js
// Simulates a payment processor
async function simulatePayment(amount, userId) {
  // Always succeeds in mock mode
  return {
    success: true,
    transactionRef: require('uuid').v4(),
    amount,
    userId,
    timestamp: new Date().toISOString()
  }
}

module.exports = { simulatePayment }
```

Call this function before creating any transaction record. If it returns `success: false`, rollback the DB transaction and return a payment error.

Note in README: "Replace `simulatePayment` with Razorpay SDK calls to add real payment processing."

---

## 12. Core Features — Full Specification

### Feature 1 — Group Booking (Split Payment)

Each member of a group pays for their own seat independently. The group session is created by a leader and others join via a shared invite link containing the `invite_link_token`.

**Partial release on lock expiry:**
When the expiry worker finds an expired booking_group, it checks each group_invite row:
- If `payment_status = 'paid'` → do nothing, that member's ticket is confirmed
- If `payment_status = 'pending'` → release only that member's seat (set slot.status = 'available'), emit `seat_released` WebSocket event for that specific seatId

The group leader is the user who calls `POST /api/groups/create`. The fine and all responsibilities belong to each individual member for their own seat.

---

### Feature 2 — Regulated Resale Marketplace

**Relist fine:** Flat ₹30 (from `RELIST_FINE_AMOUNT` env). Charged upfront at listing time. Non-refundable if ticket sells.

**If ticket sells before window closes:**
- Buyer's `user_id` atomically replaces seller's on the ticket record
- New `totp_seed` generated — old seller's QR immediately stops working
- New QR issued to buyer
- Fine is non-refundable to seller

**If ticket does NOT sell (window closes unsold):**
- Triggered by `relistWorker.js` cron at exact moment `closes_at < NOW()`
- In a single DB transaction:
  1. Set `resale_marketplace.status = 'expired_unsold'`
  2. Set `resale_marketplace.fine_refunded = true`
  3. Set `ticket.status = 'valid'` (fully usable again by original owner)
  4. Create transaction record (type='refund', amount=RELIST_FINE_AMOUNT)
- Ticket is returned to original owner as a fully valid, usable ticket

**Relist limit:** One relist per ticket lifetime. `tickets.relist_used` is set to `true` when listing is created and never reset, even if the ticket is returned unsold.

**Window cutoff:** `closes_at = event.start_time - RELIST_WINDOW_HOURS` (1 hour). Any listing attempt with less than 1 hour to event is rejected.

---

### Feature 3 — Cryptographic Rotating QR Validation

**Seed generation:**
At ticket creation, generate a TOTP secret: `otplib.authenticator.generateSecret()`. Store in `tickets.totp_seed`. This is the HMAC key.

**QR generation (frontend):**
1. Fetch seed from `GET /api/tickets/:ticketId/seed`
2. Generate token: `otplib.authenticator.generate(seed)`
3. Encode as QR: `ticketId:token`
4. Render QR using `qrcode` library
5. Set `setInterval` for 15000ms to regenerate token and re-render QR
6. Clear interval on component unmount

**Verification (backend):**
```js
const isValid = otplib.authenticator.verify({
  token: submittedToken,
  secret: storedSeed,
  window: parseInt(process.env.TOTP_WINDOW) // 1 = allows ±30 seconds drift
})
```

**On resale ownership transfer:**
Generate a new seed with `otplib.authenticator.generateSecret()`. Update `tickets.totp_seed`. The previous owner's QR will fail verification from this point.

---

### Feature 4 — Real-Time Seat Locking

**Locking:**
```sql
BEGIN;
SELECT id FROM slots
WHERE id = $1 AND status = 'available'
FOR UPDATE SKIP LOCKED;
-- If no row returned: ROLLBACK, return 409 SEAT_LOCKED
-- If row returned: UPDATE slots SET status = 'locked' WHERE id = $1
-- Then: INSERT INTO booking_groups ...
COMMIT;
```

**WebSocket rooms:**
- One room per `event_id` for seat updates
- One room per `group_id` for group member updates
- Client joins event room on the seat grid page load
- Client joins group room when viewing group booking session

**Seat color states on frontend:**
- Green: `status = 'available'`
- Orange: `status = 'locked'`
- Red: `status = 'sold'`

**Optimistic UI:**
When user clicks a seat, immediately mark it orange in local state. If the API returns 409, revert to green. If success, keep orange until WebSocket confirms.

---

## 13. Background Workers

### expiryWorker.js — runs every 30 seconds

```
1. Query: SELECT * FROM booking_groups WHERE status = 'pending' AND expires_at < NOW()
2. For each expired group:
   a. BEGIN transaction
   b. For each group_invite in this group WHERE payment_status = 'pending':
      - UPDATE slots SET status = 'available' WHERE id = invite.seat_id
      - Emit seat_released WebSocket event for that seatId
   c. UPDATE booking_groups SET status = 'expired' WHERE id = group.id
   d. COMMIT
3. Log how many groups were expired in this run
```

### relistWorker.js — runs every minute

```
1. Query: SELECT * FROM resale_marketplace WHERE status = 'active' AND closes_at < NOW()
2. For each expired listing:
   a. BEGIN transaction
   b. UPDATE resale_marketplace SET status = 'expired_unsold', fine_refunded = true WHERE id = listing.id
   c. UPDATE tickets SET status = 'valid' WHERE id = listing.ticket_id
   d. INSERT INTO transactions (type='refund', amount=relist_fine, user_id=seller_user_id, ticket_id, idempotency_key=uuid)
   e. COMMIT
   f. (After commit) Send notification to seller — for now just console.log, can be replaced with email/push
3. Log how many listings were closed in this run
```

---

## 14. Ticket Status State Machine

This is the only valid set of status transitions. The API must enforce these — no other transitions are allowed.

```
pending_lock
    │
    ├── lock expires (no payment) ──→ slot released, ticket record deleted
    │
    └── payment confirmed ──→ valid
                                 │
                                 └── user calls /api/resale/list ──→ listed
                                                                         │
                                              ┌──────────────────────────┴──────────────────────────┐
                                              │                                                     │
                                     buyer purchases                                  closes_at passes, unsold
                                              │                                                     │
                                       sold_to_buyer                                    returned_to_owner
                                       (new owner gets                                  (fine refunded,
                                        new totp_seed)                                   relist_used stays true)
                                              │                                                     │
                                              └──────────────────────┬──────────────────────────────┘
                                                                     │
                                                                   valid
                                                                     │
                                                            venue scans QR at entry
                                                                     │
                                                                   used  (terminal state)
```

**Rules:**
- `used` is a terminal state — no transitions out of it
- `relist_used` is set to `true` when entering `listed` and never reset
- A ticket in `listed` state still belongs to original owner until sold
- A ticket in `returned_to_owner` immediately transitions to `valid` in the same DB transaction

---

## 15. Frontend Pages Specification

### `/` — Event Dashboard
- Fetch all events from `GET /api/events`
- Show event cards with title, venue, date, category badge, price range
- Category filter tabs: All / Concert / Movie / Comedy — client-side filter, no refetch
- Clicking a card navigates to `/events/:id`

### `/events/:id` — Event Detail + Seat Grid
- Fetch event + all slots from `GET /api/events/:eventId`
- Render seat grid using CSS Grid — seats colored by status
- Connect to Socket.io, join event room on mount
- On `seat_update` event: update that seat's color in state
- On seat click (if available): call `POST /api/bookings/reserve`
- "Book as group" button: calls `POST /api/groups/create`, shows modal with invite link + copy button
- Movie events: show showtime selector before seat grid

### `/groups/:token` — Group Join Page
- Call `POST /api/groups/join/:token` on page load (if authenticated)
- Show group panel: list of members, their seat selections, payment status
- Each member sees a "Pay for my seat" button once they've selected a seat
- Real-time updates via Socket.io group room

### `/tickets` — Ticket Wallet
- Fetch `GET /api/tickets` for the logged-in user
- Show ticket cards: event name, date, seat, status badge
- Clicking a ticket navigates to `/tickets/:id`

### `/tickets/:id` — Single Ticket + QR
- Fetch ticket details
- If status is `valid`: show rotating QR (15-second refresh)
- If status is `listed`: show "Listed for resale" banner with list price and closes_at countdown
- If status is `used`: show "Ticket used" state
- "Relist this ticket" button: visible only if `status = 'valid'` AND `relist_used = false`
- Relist flow: show modal with current fine amount (₹30), price input (capped at purchased_price), confirm button

### `/resale/:eventId` — Resale Marketplace
- Fetch `GET /api/resale/:eventId`
- Show available listings with seat label, price, time remaining before window closes
- "Buy" button triggers `POST /api/resale/buy/:listingId`

### `/verify` — Admin QR Verification
- Input fields: Ticket ID + Token (or scan QR directly)
- Calls `POST /api/verify`
- Shows green success or red failure with reason

---

## 16. Development Phases

> Build one phase at a time. After each phase, output a file tree and function index before proceeding.

---

### Phase 0 — Auth & Security Foundation

**What to build:**
1. Initialize `server/` with `npm init`, install all dependencies
2. Create `server/index.js` — Express app with JSON middleware, cookie-parser, CORS
3. Create `server/db/pool.js` — pg.Pool using `DATABASE_URL`
4. Create `server/middleware/authenticateToken.js` — reads JWT from httpOnly cookie, verifies, attaches `req.user`
5. Create `server/middleware/rateLimiter.js` — 100 req/15min default, 10 req/15min for `/api/bookings/reserve`
6. Create `server/middleware/validateInput.js` — reusable field presence checker
7. Create `server/routes/auth.js` — register, login, logout
8. Wire all middleware and routes into `index.js`

**Test:** Register a user, login, receive cookie, call a protected route.

---

### Phase 1 — Database Setup

**What to build:**
1. Write `server/db/migrations/001_initial.sql` — all CREATE TABLE statements in dependency order
2. Write `server/db/migrate.js` — reads and executes the SQL file
3. Run migration: `node server/db/migrate.js`
4. Write `server/db/seed.js` — inserts categories, events, slots per spec in section 9
5. Run seed: `node server/db/seed.js`

**Test:** Connect to DB with psql, verify all tables exist and seed data is present.

---

### Phase 2 — Concurrency Engine

**What to build:**
1. Create `server/db/queries/slots.js` — `getSlotById`, `lockSlot`, `releaseSlot`, `getSlotsByEvent`
2. Create `server/db/queries/bookings.js` — `createBookingGroup`, `expireBookingGroup`, `getPendingExpiredGroups`
3. Create `server/routes/bookings.js` — `POST /api/bookings/reserve` with `FOR UPDATE SKIP LOCKED`
4. Create `server/routes/events.js` — `GET /api/events`, `GET /api/events/:eventId`
5. Create `server/socket.js` — Socket.io init, join_event and join_group handlers
6. Attach Socket.io to Express server in `index.js`
7. Create `server/workers/expiryWorker.js` — 30-second cron, query and expire pending groups, emit seat_released

**Test:** Two simultaneous requests for the same seat — only one succeeds.

---

### Phase 3 — Group Booking

**What to build:**
1. Create `server/db/queries/groups.js` — `createGroup`, `getGroupByToken`, `getGroupById`, `addMemberToGroup`, `updateMemberPayment`
2. Create `server/routes/groups.js` — create, join, get, pay endpoints
3. Partial release logic in `expiryWorker.js` — release only pending members' seats
4. WebSocket `group_update` emit on payment

**Test:** 3 users join a group, 2 pay, lock expires — only the 3rd user's seat is released.

---

### Phase 4 — Resale Marketplace

**What to build:**
1. Create `server/db/queries/resale.js` — `createListing`, `getListingsByEvent`, `getListingById`, `completeSale`, `expireListing`
2. Create `server/db/queries/tickets.js` — `createTicket`, `getTicketById`, `updateTicketOwner`, `updateTicketStatus`, `rotateTotp`
3. Create `server/routes/resale.js` — list, browse, buy endpoints
4. Create `server/workers/relistWorker.js` — minute cron, expire unsold listings, refund fine
5. Add atomic `user_id` swap + new `totp_seed` generation in buy flow

**Test:** List a ticket, have another user buy it, verify old owner's ticket is invalidated and new owner has a valid ticket.

---

### Phase 5 — QR Ticket Validation

**What to build:**
1. Create `server/routes/tickets.js` — list tickets, get ticket, get seed
2. Create `server/routes/verify.js` — `POST /api/verify` with TOTP check
3. Create `server/utils/mockPayment.js`

**Test:** Generate a QR, submit the token to /api/verify within 15 seconds — should succeed. Submit the same token 45 seconds later — should fail.

---

### Phase 6 — Frontend

**What to build:**
1. Initialize `client/` with `create-next-app --tailwind`
2. Create `client/lib/api.js` — fetch wrapper: adds base URL, includes credentials (for cookie), handles response format
3. Build pages in this order: auth (login/register) → event dashboard → event detail + seat grid → group flow → ticket wallet → single ticket + QR → resale marketplace → verify page
4. Implement Socket.io connection in `useSocket.js` hook
5. Implement QR rotation in `QRDisplay.js` component with `setInterval` cleanup

**Test:** Full end-to-end — register two users, book seats in a group, one pays, one doesn't, verify seat released. List a ticket for resale, buy it as second user, verify QR works for new owner.

---

## 17. README Requirements

The README must include these sections:

1. **What is NexusPass** — 3 sentence summary
2. **Tech stack** — list
3. **How to run locally** — step by step from `git clone` to working app
4. **Environment variables** — list all keys with descriptions
5. **API endpoints** — table of all routes with method, auth, description
6. **Technical decisions** — explain why `FOR UPDATE SKIP LOCKED`, why TOTP for QR, why split-payment group model
7. **Known limitations** — mock payment (no real gateway), no email notifications, single server (Redis needed for horizontal scale)
8. **CV note** — "Replace `simulatePayment()` with Razorpay SDK for production payment processing"

---

## 18. CV Bullet Points (for reference)

- Engineered a concurrent seat reservation system using PostgreSQL `SELECT FOR UPDATE SKIP LOCKED`, preventing race conditions under simultaneous booking requests without deadlocks
- Designed a split-payment group booking flow with per-member partial-release expiry logic — only unpaid seats are released when a lock timer expires, preserving confirmed members' tickets
- Built a regulated resale marketplace with face-value price enforcement via database `CHECK` constraint and atomic `user_id` ownership transfer on purchase
- Implemented TOTP-based rotating QR ticket validation using `otplib` with per-ticket HMAC seeds — QR codes refresh every 15 seconds, making screenshots invalid as scalping or fraud vectors
- Developed real-time seat availability synchronization using Socket.io WebSocket rooms per event, with a `node-cron` background worker handling automatic lock expiry and seat release
- Designed a complete ticket lifecycle state machine (`pending_lock → valid → listed → returned_to_owner / sold_to_buyer → used`) enforced at the API layer with single-relist-per-ticket business rule
