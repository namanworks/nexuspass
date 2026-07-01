# NexusPass

> A production-grade event ticketing platform built as a portfolio project to demonstrate backend concurrency patterns, real-time systems, and cryptographic ticket validation.

NexusPass lets users browse events, select seats in real time, book as a group with independent split payments, and receive tickets secured with rotating TOTP-based QR codes that expire every 15 seconds — making screenshots useless as fraud vectors. A regulated resale marketplace allows ticket holders to relist at or below face value.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Database Schema](#database-schema)
- [Real-Time System](#real-time-system)
- [API Endpoints](#api-endpoints)
- [Key Technical Decisions](#key-technical-decisions)
- [Running Locally](#running-locally)
- [Environment Variables](#environment-variables)
- [Known Limitations](#known-limitations)
- [CV Bullet Points](#cv-bullet-points)

---

## Features

| Feature | Description |
|---|---|
| **Event Browsing** | Browse events filtered by category (Concert, Movie, Comedy) |
| **Real-Time Seat Locking** | Seats lock instantly across all connected clients via WebSocket — no polling |
| **Solo & Group Booking** | Book alone or create a group session with a shareable invite link |
| **Split Payment** | Each group member pays for their own seat independently |
| **Partial Seat Release** | If a lock timer expires, only unpaid members seats are released — confirmed members keep theirs |
| **Rotating QR Tickets** | Tickets use TOTP (Time-based One-Time Passwords) — QR codes rotate every 15 seconds |
| **Admin Scanner** | Admins can verify tickets by scanning QR codes; verified tickets are immediately invalidated |
| **Resale Marketplace** | List tickets for resale at or below face value; a Rs.30 fine is charged upfront on listing |
| **Atomic Ownership Transfer** | On resale purchase, a new TOTP seed is generated — the sellers QR stops working instantly |
| **Idempotent Payments** | Booking and payment endpoints accept idempotency keys to prevent duplicate charges on retries |

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js | Non-blocking I/O suits concurrent seat reservations |
| HTTP Framework | Express 5 | Minimal, well-understood, async-native error handling |
| Database | PostgreSQL | ACID transactions + SELECT FOR UPDATE SKIP LOCKED for concurrency |
| DB Client | pg (node-postgres) | Raw SQL — no ORM abstraction hiding the concurrency primitives |
| Real-Time | Socket.io | Rooms per event + per booking group; instant seat status broadcasts |
| Auth | JWT (jsonwebtoken) | Stateless, stored in httpOnly cookies to prevent XSS token theft |
| OTP / QR | otplib + qrcode | Industry-standard TOTP for rotating ticket codes |
| ID Generation | uuid v4 | Unguessable IDs for tickets, groups, invite tokens |
| Background Jobs | node-cron | Seat lock expiry worker runs every 30 seconds |
| Rate Limiting | express-rate-limit | Global default limiter + stricter limiter on reservation endpoint |
| Frontend | Next.js 16 (App Router) | React Server Components + client-side interactivity |
| Styling | Tailwind CSS v4 | Utility-first, theme tokens via CSS variables |
| Socket Client | socket.io-client | Custom useSocket hook manages connection lifecycle and room joining |

---

## Architecture

```
+------------------------------------------------------------------+
|                         CLIENT (Next.js)                          |
|                                                                    |
|  / -> /events/[id] -> /groups/[token] -> /tickets -> /verify     |
|  hooks: useSocket (WebSocket)   lib/api.js (REST)                 |
+------------------+---------------------------+--------------------+
                   | REST (HTTP + cookies)      | WebSocket
                   v                           v
+------------------------------------------------------------------+
|                        SERVER (Express)                           |
|                                                                    |
|  /api/auth  /api/events  /api/bookings  /api/groups               |
|  /api/tickets  /api/resale  /api/verify                           |
|                                                                    |
|  Middleware: authenticateToken -> rateLimiter -> requireFields     |
|  Workers:   expiryWorker (cron every 30s)                         |
|  Socket:    Socket.io rooms per eventId + per groupId             |
+------------------------------+-----------------------------------+
                               |
                               v
+------------------------------------------------------------------+
|                         PostgreSQL                                 |
|                                                                    |
|  users -> categories -> events -> slots -> booking_groups          |
|        -> group_invites -> tickets -> transactions                 |
|        -> resale_marketplace                                       |
+------------------------------------------------------------------+
```

### Seat Reservation Flow

```
User clicks seat
      |
      v
POST /api/bookings/reserve
      |
      +-- 1. Idempotency check (in-memory Map)
      +-- 2. Fast-fail status check (no lock)
      +-- 3. BEGIN transaction
      +-- 4. SELECT ... FOR UPDATE SKIP LOCKED
      |        -> No row returned? -> 409 SEAT_LOCKED
      +-- 5. UPDATE slots SET status = 'locked'
      +-- 6. Create / join booking_group
      +-- 7. Upsert group_invite (links user <-> seat <-> group)
      +-- 8. COMMIT
      +-- 9. Emit seat_update WebSocket -> all clients in event room
```

### Group Booking Flow

```
Leader -> POST /api/groups/create -> gets invite_link_token
           |
           +-- Shares /groups/{token} link with friends
                      |
                      v
           Each member -> POST /api/bookings/reserve (with groupId)
           Each member -> POST /api/groups/{groupId}/pay (independent)
                      |
                      +-- Lock expires?
                           +-- paid member   -> seat kept, ticket valid
                           +-- unpaid member -> slot released, WS broadcast
```

### TOTP Rotating QR Flow

```
Frontend fetches /api/tickets/:id/seed  (once, on page load)
      |
      +-- otplib.authenticator.generate(seed) -> 6-digit token
      +-- QR encodes: "{ticketId}:{token}"
      +-- setInterval(15000) regenerates token + re-renders QR
      +-- on unmount -> clearInterval

Admin scans QR at gate
      |
      +-- POST /api/verify { ticketId, token }
      +-- otplib.authenticator.verify(token, seed) with window=1
      +-- Valid? -> ticket.status = 'used'  (one-time burn)
```

---

## Database Schema

### Tables

| Table | Key Columns | Notes |
|---|---|---|
| `users` | `id`, `email`, `password_hash`, `is_admin` | UUID PK, bcrypt hashed password |
| `categories` | `id`, `name` | Concert, Movie, Comedy, etc. |
| `events` | `id`, `category_id`, `title`, `venue`, `start_time` | FK to categories |
| `slots` | `id`, `event_id`, `seat_label`, `status`, `price` | status CHECK: available / locked / sold |
| `booking_groups` | `id`, `event_id`, `leader_user_id`, `expires_at`, `invite_link_token` | status CHECK: pending / confirmed / expired |
| `group_invites` | `group_id`, `user_id`, `seat_id`, `payment_status` | Links member <-> seat <-> group |
| `tickets` | `id`, `slot_id`, `user_id`, `status`, `purchased_price`, `totp_seed`, `relist_used` | Per-ticket HMAC key |
| `transactions` | `id`, `user_id`, `ticket_id`, `amount`, `type`, `idempotency_key` | idempotency_key UNIQUE |
| `resale_marketplace` | `ticket_id`, `seller_user_id`, `list_price`, `purchased_price`, `status`, `closes_at` | CONSTRAINT price_cap CHECK (list_price <= purchased_price) |

### Key Indexes

```sql
-- Concurrency — makes FOR UPDATE SKIP LOCKED fast
CREATE INDEX idx_slots_status   ON slots(status);
CREATE INDEX idx_slots_event_id ON slots(event_id);

-- Expiry worker — scans for expired groups every 30s
CREATE INDEX idx_booking_groups_expires_at ON booking_groups(expires_at);
CREATE INDEX idx_booking_groups_status     ON booking_groups(status);

-- Idempotency — O(1) duplicate check before any transaction
CREATE INDEX idx_transactions_idempotency ON transactions(idempotency_key);

-- Resale — finds active/expiring listings fast
CREATE INDEX idx_resale_status    ON resale_marketplace(status);
CREATE INDEX idx_resale_closes_at ON resale_marketplace(closes_at);
```

---

## Real-Time System

Socket.io is used for two types of rooms:

| Room | Key | Events emitted |
|---|---|---|
| **Event room** | `eventId` | `seat_update` (status changed), `seat_released` (lock expired) |
| **Group room** | `groupId` | `group_update` (member joined, payment confirmed) |

Clients join rooms by emitting `join_event` or `join_group` with the relevant ID. The server only broadcasts to rooms — it never targets individual socket connections — keeping server logic stateless per connection.

---

## API Endpoints

### Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | None | Register new user |
| POST | `/auth/login` | None | Login, sets httpOnly JWT cookie |
| POST | `/auth/logout` | None | Clears the JWT cookie |

### Events — `/api/events`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/events` | None | List all events with price range and available seats |
| GET | `/events/:eventId` | None | Event details + all seat slots with status |

### Bookings — `/api/bookings`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/bookings/reserve` | Required | Lock a seat; requires slotId + idempotencyKey |

### Groups — `/api/groups`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/groups/create` | Required | Create a booking group, returns invite token |
| GET | `/groups/:token` | Optional | Get group info via invite token |
| POST | `/groups/:groupId/pay` | Required | Confirm payment for a seat in a group |

### Tickets — `/api/tickets`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tickets` | Required | List all tickets owned by the authenticated user |
| GET | `/tickets/:ticketId` | Required | Get single ticket details |
| GET | `/tickets/:ticketId/seed` | Required | Get TOTP seed for QR generation (owner only) |

### Resale — `/api/resale`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/resale/list` | Required | List a ticket for resale; charges Rs.30 fine |
| GET | `/resale/:eventId` | None | Browse active resale listings for an event |
| POST | `/resale/buy/:listingId` | Required | Purchase a resale ticket; atomically transfers ownership |

### Verify — `/api/verify`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/verify` | Admin only | Verify a QR code token; marks ticket as used on success |

---

## Key Technical Decisions

### 1. `SELECT FOR UPDATE SKIP LOCKED` for Seat Concurrency

The canonical approach for concurrent seat reservation. When two users attempt to book the same seat simultaneously:

- **FOR UPDATE** acquires a row-level write lock on the slot
- **SKIP LOCKED** causes the second query to return 0 rows immediately instead of blocking
- The second user gets a 409 SEAT_LOCKED response within milliseconds, with zero deadlock risk

This is strictly better than application-level locking (breaks across multiple server processes) or optimistic locking with retries (extra round-trips under contention).

```sql
SELECT id, seat_label, status, price, event_id
FROM slots
WHERE id = $1 AND status != 'sold'
FOR UPDATE SKIP LOCKED
```

### 2. TOTP for Rotating QR Codes

Standard QR codes (static UUID) are trivially screenshotted and resold. TOTP solves this:

- Each ticket has a unique HMAC key (totp_seed) stored server-side
- The frontend generates a new 6-digit token every 15 seconds using otplib
- The QR encodes `ticketId:token` — the token is only valid within a ±1 window (~30 seconds)
- A screenshot becomes invalid within 30 seconds
- On resale, a completely new totp_seed is generated — the sellers QR is cryptographically invalidated the moment the sale completes

### 3. Split-Payment Group Booking with Partial Release

Each group member is tracked via a group_invites row with their own payment_status. When the group lock expires:

- The expiry worker checks each invite individually
- Paid members seats remain sold — their tickets are untouched
- Only unpaid members slots are flipped back to available
- WebSocket events are emitted per-seat, not per-group — clients get granular updates

This prevents the all-or-nothing failure mode where one late payer cancels everyones booking.

### 4. Idempotency Keys on Payments

Every booking and purchase endpoint requires a client-generated idempotencyKey. If a network failure causes the client to retry, the server returns the original response instead of processing a second charge. The key is stored in the transactions table with a UNIQUE constraint — the database itself is the idempotency store.

### 5. Database-Enforced Price Cap on Resale

```sql
CONSTRAINT price_cap CHECK (list_price <= purchased_price)
```

This cannot be bypassed by a bug in the application layer. Even a direct database write would be rejected.

### 6. httpOnly Cookies for JWT

JWTs are stored in httpOnly cookies instead of localStorage. This prevents XSS attacks from stealing the token — JavaScript running on the page cannot access httpOnly cookies. CORS is configured with credentials: true to allow the browser to send cookies cross-origin to the API.

---

## Running Locally

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/nexuspass.git
cd nexuspass
```

### 2. Set up the database

```bash
# Create the database
psql -U postgres -c "CREATE DATABASE nexuspass;"

# Install server dependencies and run migrations
cd server
npm install
npm run migrate

# Seed with sample events and an admin user
npm run seed
```

### 3. Configure environment variables

```bash
cp server/.env.example server/.env
# Edit server/.env with your database credentials and secrets
```

### 4. Start the backend

```bash
cd server
npm run dev
# API server runs on http://localhost:5000
```

### 5. Start the frontend

```bash
cd client
npm install
npm run dev
# Client runs on http://localhost:3000
```

### 6. Log in

The seed script creates a regular user and an admin account. The admin email is set by `ADMIN_EMAIL` in your `.env` (default: `admin@nexuspass.dev`). The seed script outputs the credentials to the console.

---

## Environment Variables

All variables go in `server/.env`. Copy from `server/.env.example`.

| Variable | Description | Default |
|---|---|---|
| `PORT` | Port the Express server listens on | `5000` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `JWT_SECRET` | Secret key for signing JWTs | — |
| `JWT_EXPIRES_IN` | JWT expiry duration | `7d` |
| `TOTP_WINDOW` | TOTP verification window (30s steps) | `1` |
| `RELIST_FINE_AMOUNT` | Flat fee charged on resale listing (INR) | `30` |
| `LOCK_DURATION_MINUTES` | Seat lock duration before expiry worker releases it | `10` |
| `RELIST_WINDOW_HOURS` | Minimum hours before event that a relist is allowed | `1` |
| `ADMIN_EMAIL` | Email of the admin user for the scanner page | `admin@nexuspass.dev` |
| `CLIENT_URL` | Frontend origin for CORS | `http://localhost:3000` |

---

## Known Limitations

| Limitation | Notes |
|---|---|
| **Mock payment** | `simulatePayment()` always returns success. Replace with Razorpay SDK for real payment processing. |
| **Single server** | The idempotency cache is an in-memory Map. Replace with Redis SETNX for horizontal scaling across multiple Node.js processes. |
| **No email notifications** | No emails are sent when group members pay, seats expire, or resale purchases complete. |
| **Unsold resale listings** | If a listing expires without a buyer, the ticket remains in listed state. A relistWorker background job would handle returning it to valid and refunding the Rs.30 fine. |

---

## CV Bullet Points

- Engineered a concurrent seat reservation system using PostgreSQL `SELECT FOR UPDATE SKIP LOCKED`, preventing race conditions under simultaneous booking requests without deadlocks or blocking transactions

- Designed a split-payment group booking flow with per-member partial-release expiry logic — only unpaid seats are released when a lock timer expires, preserving confirmed members tickets

- Built a regulated resale marketplace with face-value price enforcement via a database `CHECK` constraint and atomic `user_id` ownership transfer on purchase

- Implemented TOTP-based rotating QR ticket validation using `otplib` with per-ticket HMAC seeds — QR codes refresh every 15 seconds, rendering screenshots invalid as fraud vectors

- Integrated Socket.io for real-time seat availability updates — all connected clients see seat status changes within milliseconds without polling

- Implemented idempotency keys on booking and payment endpoints, using a database `UNIQUE` constraint as the idempotency store to prevent duplicate charges under network retries

---

*Built with Node.js · PostgreSQL · Socket.io · Next.js*
