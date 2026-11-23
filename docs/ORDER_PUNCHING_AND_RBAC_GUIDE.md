# Login, RBAC & Step-by-Step Order Punching Architecture

## 1. Auth & RBAC Foundation (Completed Baseline)

- **Session Store:** Stateful PostgreSQL sessions via `express-session` + `connect-pg-simple` (`session` table: `sid`, `sess`, `expire`)[cite: 1].
- **Credentials & Hashing:** `users` table (`id`, `username`, `password_hash`, `role`, `created_at`) with `bcrypt` cost `12` and constant-time comparison (`DUMMY_HASH`) in `controllers/authController.js`[cite: 1].
- **Rate Limiting:** `loginLimiter` on `POST /login` (`5` attempts / `15 min` $\rightarrow$ `429`) and two-layer AI rate limiters (`aiBurstLimiter`, `aiSustainedLimiter`) in `app.js`[cite: 1].
- **Middleware Order (`app.js`):** `helmet` $\rightarrow$ body parsers/`method-override` $\rightarrow$ `session` $\rightarrow$ `attachUserToLocals` $\rightarrow$ rate limiters $\rightarrow$ routers $\rightarrow$ `404` handler[cite: 1].
- **Authorization Rules (`middleware/authMiddleware.js`):**
  - Unauthenticated (`!req.session?.userId`): `401` JSON for API/XHR, `302` redirect to `/login` for browser requests[cite: 1].
  - `superadmin`: full bypass across role-protected routes[cite: 1].
  - Unauthorized authenticated role (e.g., `cashier` on admin-only routes): `403 Forbidden` (JSON or `views/403.ejs`)[cite: 1].
- **EJS UI Helper:** `canManage` (`["admin", "superadmin"].includes(currentUser.role)`) toggles management controls in views, while `requireRole` enforces real security on the server[cite: 1].

---

## 2. Full System Vision (Future Phases — Do Not Build in One Shot)

1. **Order Punching & Stock Deduction:** Punch order line items (`item_id`, `quantity`), validate `quantity > 0`, atomically deduct `items.stock_count`, snapshot `item_name` and `unit_price` in `order_items`, and prevent duplicate charges via `idempotency_key`.
2. **Checkout Modes & Order Types:** Support `DINE_IN` vs. `TAKEAWAY` / parcel, plus `QUICK_PAY` vs. `PLACE_ORDER` (`PENDING` / pay-later).
3. **Kitchen & Waiter Lifecycle:** Move orders/items through `PENDING` $\rightarrow$ `PREPARING` $\rightarrow$ `READY` $\rightarrow$ `SERVED`, including adding items mid-meal to an open order.
4. **Settlement, Voids, Audit Trail & Night Closing:** Record payments (`CASH`, `CARD`, `GATEWAY`), complete orders, handle soft-voids/cancellations with stock restoration and `audit_logs`, and build daily sales / POS print reports.

---

## 3. Incremental Build & Failure-First Workflow

### Step 1 (Current): `db/migrations/005_create_orders.sql` + `models/orderModel.js`

- **Goal:** Create `orders` and `order_items` tables and implement transactional order creation with atomic `stock_count` deduction[cite: 1].
- **Schema Alignment:** Matches `items` (`id`, `name`, `price`, `stock_count`) and `users` (`id`)[cite: 1].
- **Failure Modes to Practice Breaking & Fixing:**
  - `quantity <= 0` or non-integer quantity $\rightarrow$ reject before committing.
  - Item missing or `stock_count < quantity` $\rightarrow$ `ROLLBACK` transaction so zero stock is deducted and no partial order is saved.
  - Concurrent requests on the last stock $\rightarrow$ conditional update (`WHERE id = $2 AND stock_count >= $1`) inside a transaction prevents overselling.
  - Duplicate `idempotency_key` $\rightarrow$ return existing order or handle `23505` cleanly without double-deducting stock.
  - Error mid-transaction $\rightarrow$ `ROLLBACK` and always `client.release()` in `finally`.

### Step 2: Route & Controller Wiring (`routes/orderRouter.js` + `controllers/orderController.js`)

- Protect endpoints with `requireRole("admin", "cashier")` (with `superadmin` passing automatically)[cite: 1].
- Map domain/validation/stock errors cleanly to HTTP status codes (`400`, `404`, `409`, `201`) instead of leaking raw DB errors.

### Step 3: Minimal UI + Integration & Concurrency Verification

- Build a focused order-punching view/form and test edge cases (zero/negative qty, out-of-stock rollback, retry with same idempotency key, and concurrent requests).

### Step 4: Refactor & Review

- Extract repeated validation/error helpers, verify `git diff`, and update docs/notes before starting the next feature slice.
