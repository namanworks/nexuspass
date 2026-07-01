-- NexusPass — Initial Migration
-- Run in this exact order due to foreign key dependencies:
-- users → categories → events → slots → booking_groups → group_invites → tickets → transactions → resale_marketplace

-- ─────────────────────────────────────────────
-- 1. users
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  is_admin        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 2. categories
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 3. events
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID NOT NULL REFERENCES categories(id),
  title         VARCHAR(255) NOT NULL,
  venue         VARCHAR(255) NOT NULL,
  start_time    TIMESTAMP NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 4. slots
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id),
  seat_label  VARCHAR(20) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'available'
                CHECK (status IN ('available', 'locked', 'sold')),
  price       NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slots_status   ON slots(status);
CREATE INDEX IF NOT EXISTS idx_slots_event_id ON slots(event_id);

-- ─────────────────────────────────────────────
-- 5. booking_groups
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_groups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id),
  leader_user_id    UUID NOT NULL REFERENCES users(id),
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'confirmed', 'expired')),
  expires_at        TIMESTAMP NOT NULL,
  invite_link_token VARCHAR(255) UNIQUE NOT NULL,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_groups_expires_at ON booking_groups(expires_at);
CREATE INDEX IF NOT EXISTS idx_booking_groups_status     ON booking_groups(status);

-- ─────────────────────────────────────────────
-- 6. group_invites
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES booking_groups(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  seat_id         UUID REFERENCES slots(id),
  payment_status  VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (payment_status IN ('pending', 'paid')),
  joined_at       TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 7. tickets
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id          UUID NOT NULL REFERENCES slots(id),
  user_id          UUID NOT NULL REFERENCES users(id),
  group_id         UUID REFERENCES booking_groups(id),
  status           VARCHAR(30) NOT NULL DEFAULT 'pending_lock'
                     CHECK (status IN (
                       'pending_lock', 'valid', 'listed',
                       'returned_to_owner', 'sold_to_buyer', 'used'
                     )),
  purchased_price  NUMERIC(10,2) NOT NULL,
  totp_seed        VARCHAR(255) NOT NULL,
  relist_used      BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status  ON tickets(status);

-- ─────────────────────────────────────────────
-- 8. transactions
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  ticket_id        UUID REFERENCES tickets(id),
  amount           NUMERIC(10,2) NOT NULL,
  type             VARCHAR(20) NOT NULL
                     CHECK (type IN ('purchase', 'relist_fine', 'refund')),
  idempotency_key  VARCHAR(255) UNIQUE NOT NULL,
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_idempotency ON transactions(idempotency_key);

-- ─────────────────────────────────────────────
-- 9. resale_marketplace
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resale_marketplace (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        UUID NOT NULL REFERENCES tickets(id),
  seller_user_id   UUID NOT NULL REFERENCES users(id),
  buyer_user_id    UUID REFERENCES users(id),
  list_price       NUMERIC(10,2) NOT NULL,
  purchased_price  NUMERIC(10,2) NOT NULL,
  relist_fine      NUMERIC(10,2) NOT NULL,
  fine_refunded    BOOLEAN NOT NULL DEFAULT false,
  status           VARCHAR(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'sold', 'expired_unsold')),
  listed_at        TIMESTAMP DEFAULT NOW(),
  closes_at        TIMESTAMP NOT NULL,
  CONSTRAINT price_cap CHECK (list_price <= purchased_price)
);

CREATE INDEX IF NOT EXISTS idx_resale_status    ON resale_marketplace(status);
CREATE INDEX IF NOT EXISTS idx_resale_closes_at ON resale_marketplace(closes_at);
