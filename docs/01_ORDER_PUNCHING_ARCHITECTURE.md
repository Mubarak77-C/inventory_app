# Feature 01: Order Punching & Atomic Inventory Deduction

## 1. Problem Statement & Core Invariants

In a restaurant POS and inventory system, punching an order must satisfy four strict invariants even under network retries or concurrent cashiers:

1. **No Overselling:** `items.stock_count` must never drop below `0`, even if two cashiers punch the last unit at the exact same millisecond.
2. **All-or-Nothing Atomicity:** If an order has 3 line items and the 3rd item lacks stock, the 1st and 2nd items must **not** have their stock deducted, and no partial `orders` row may persist.
3. **Idempotency (Safe Retries):** If a client retries the same request due to a timeout or double-click with the same `Idempotency-Key`, the server must return the original order (`200 OK`, `idempotentReplay: true`) without deducting stock a second time.
4. **Historical Price & Name Immutability:** Editing an item's menu price or name later (or deleting it) must never corrupt past order receipts.

---

## 2. End-to-End Request Sequence (Step-by-Step)

When a cashier or admin submits `POST /orders`, execution flows through four layers in strict sequence:

1. **Middleware Layer (`app.js` + `middleware/authMiddleware.js`):**
   - `express.json()` parses the JSON payload; `express-session` loads the user's server-side session (`req.session.userId`, `req.session.role`).
   - `requireRole("admin", "cashier")` verifies the caller is authenticated (`401` if not) and authorized (`admin`, `cashier`, or `superadmin` bypass; `403` otherwise).
2. **Controller Layer (`controllers/orderController.js`):**
   - Extracts `idempotencyKey` from headers (`Idempotency-Key` / `X-Idempotency-Key`) or request body, plus `items` and `createdBy = req.session.userId`.
   - Delegates business execution to `orderModel.createOrder(...)`.
   - Translates domain errors (`statusCode` + `code`) into clean HTTP status codes (`201`, `200`, `400`, `404`, `409`) without leaking raw SQL errors.
3. **Model & Transaction Layer (`models/orderModel.js`):**
   - Validates and normalizes `items` (merging duplicate `itemId` entries in the same cart so total requested quantity is checked as a single unit).
   - Acquires a dedicated connection (`const client = await pool.connect()`) and executes `BEGIN`.
   - **Idempotency Check:** Queries `orders` by `idempotency_key`. If found, commits and returns `{ order, items, idempotentReplay: true }`.
   - **Atomic Conditional Stock Deduction:** For each item, executes:
     ```sql
     UPDATE public.items
     SET stock_count = stock_count - $1
     WHERE id = $2 AND stock_count >= $1
     RETURNING id, name, price, stock_count;
     ```
   - **Failure Diagnostics:** If `rowCount === 0`, queries `items` by `id` to distinguish:
     - Row missing $\rightarrow$ throws `ITEM_NOT_FOUND` (`404`).
     - `stock_count === 0` $\rightarrow$ throws `OUT_OF_STOCK` (`409`).
     - `0 < stock_count < requested` $\rightarrow$ throws `INSUFFICIENT_STOCK` (`409`) with exact `available` vs. `requested` counts.
   - **Persistence & Snapshot:** Inserts into `public.orders` and snapshots `item_name`, `unit_price`, `quantity`, and `line_total` into `public.order_items`, then executes `COMMIT`.
   - **Rollback & Release:** Any thrown error runs `ROLLBACK` in `catch` (plus a `23505` unique-constraint fallback if two identical keys race concurrently) and always calls `client.release()` in `finally`.
4. **Presentation Layer (`views/orders/index.ejs`):**
   - Browser generates a UUID `currentIdempotencyKey` per order attempt, sends `fetch("/orders", { method: "POST", ... })`, displays exact error codes (`OUT_OF_STOCK`, `INSUFFICIENT_STOCK`, `ITEM_NOT_FOUND`) on `4xx`, and rotates the key only after a `2xx` success.

---

## 3. Database Schema & Constraints (`db/migrations/005_create_orders.sql`)

| Table / Constraint                                  | Purpose                                                                                              |
| :-------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `orders.idempotency_key` (`UNIQUE`, `NOT NULL`)     | Database-level guarantee against duplicate orders on concurrent retries.                             |
| `orders.status` (`CHECK` enum)                      | Restricts lifecycle states to `PENDING`, `PREPARING`, `READY`, `SERVED`, `COMPLETED`, `CANCELLED`.   |
| `orders.total_amount >= 0` (`CHECK`)                | Prevents negative order totals at the storage layer.                                                 |
| `orders.created_by` (`ON DELETE SET NULL`)          | Preserves audit trail of which staff member punched the order while allowing staff account cleanup.  |
| `order_items.order_id` (`ON DELETE CASCADE`)        | Cleans up child lines if a parent order row is removed.                                              |
| `order_items.item_id` (`ON DELETE RESTRICT`)        | Blocks hard-deleting a menu item referenced by historical orders (encourages soft-delete/archiving). |
| `order_items.item_name`, `unit_price`, `line_total` | Point-in-time snapshot so future menu price edits do not rewrite past bills.                         |

---

## 4. Verification & Edge-Case Test Matrix

Every scenario below was executed and verified against PostgreSQL and Express:

| Scenario                            | Input / Setup                                              | Expected Outcome                                                                 | Verified Result                                    |
| :---------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------- |
| **Valid Order Punch**               | Item #1 (`Chef Knife`, stock `12`, `$45.99`), `qty = 1`    | `201 Created`, `orders` + `order_items` inserted, stock $\rightarrow 11$         | Passed (`order #1` & `#2`, stock `12 -> 11 -> 10`) |
| **Idempotent Replay**               | Same `idempotencyKey` sent twice                           | `200 OK`, `idempotentReplay: true`, stock deducted only once                     | Passed (returned original order, stock unchanged)  |
| **Zero / Negative Qty**             | `quantity: 0`                                              | `400 Bad Request` (`INVALID_QUANTITY`), transaction rolled back                  | Passed (`INVALID_QUANTITY`, stock unchanged)       |
| **Out of Stock (`0` left)**         | Item #9 (`Brownies`, stock `0`), `qty = 1`                 | `409 Conflict` (`OUT_OF_STOCK`, `available: 0`), rolled back                     | Passed (`OUT_OF_STOCK`, stock stayed `0`)          |
| **Insufficient Stock (`> 0` left)** | Item #4 (`Pepsi`, stock `1`), `qty = 3`                    | `409 Conflict` (`INSUFFICIENT_STOCK`, `requested: 3, available: 1`), rolled back | Passed (`INSUFFICIENT_STOCK`, stock stayed `1`)    |
| **Non-Existent Item**               | `itemId: 999999`, `qty = 1`                                | `404 Not Found` (`ITEM_NOT_FOUND`), rolled back                                  | Passed (`ITEM_NOT_FOUND`, no order created)        |
| **Unauthenticated Call**            | `POST /orders` without session cookie                      | `401 Unauthorized` JSON error                                                    | Passed                                             |
| **Order Listing (`GET /orders`)**   | Authenticated `cashier1` / `admin` browser & JSON requests | `200 OK` returning aggregated order + line-item snapshots                        | Passed                                             |

---

## 5. Failure Modes, Bottlenecks & Scaling Playbook

### A. What if two cashiers punch the last unit at the exact same millisecond?

- **What happens:** Both transactions run `UPDATE items SET stock_count = stock_count - $1 WHERE id = $2 AND stock_count >= $1`. PostgreSQL acquires a row-level exclusive lock on that `items` row for the first transaction. The second transaction waits until the first commits, re-evaluates `stock_count >= $1` against the updated row, gets `rowCount = 0`, and cleanly returns `OUT_OF_STOCK` (`409`).
- **Watch out for Deadlocks:** If Order A locks Item 1 then Item 2, while Order B locks Item 2 then Item 1, PostgreSQL raises deadlock error `40P01`.
- **Fix:** Sort `requestedItems` by `itemId ASC` inside `normalizeAndAggregateItems()` before running the `UPDATE` loop so every transaction always acquires row locks in the exact same deterministic order.

### B. What if `orders` grows to millions of rows?

- **Bottleneck:** `GET /orders` currently runs `GROUP BY o.id` across `orders` and `order_items` without a date filter or cursor pagination.
- **Fix:** Add composite index `(created_at DESC, id DESC)` on `orders`, switch from `OFFSET/LIMIT` to keyset/cursor pagination (`WHERE (created_at, id) < ($1, $2)`), and filter by active shift/date by default.

### C. What if JavaScript floating-point math causes a 1-cent rounding drift on taxes/discounts?

- **Bottleneck:** Computing `unitPrice * quantity` in JS `Number` uses IEEE-754 binary floats.
- **Fix:** Store/compute monetary values in integer cents (paise) in application code or let PostgreSQL compute exact `NUMERIC(12,2)` expressions directly inside the `INSERT` / `UPDATE` query.

---

## 6. Startup & Backend Interview Q&A

**Q1: Why didn't you just run `SELECT stock_count FROM items` in Node.js, check `if (stock >= qty)`, and then run `UPDATE items`?**

> Because that creates a **Time-of-Check to Time-of-Use (TOCTOU) race condition**. Two concurrent requests can both read `stock_count = 1`, both pass the `if` check in JavaScript, and both decrement stock—resulting in `stock_count = -1` (overselling). Combining the check and mutation into a single atomic `UPDATE ... WHERE id = $2 AND stock_count >= $1` delegates concurrency control to PostgreSQL's row-level locking.

**Q2: Why call `pool.connect()` instead of `pool.query()` for order creation?**

> `pool.query()` checks out an arbitrary connection from the pool for each statement. In PostgreSQL, `BEGIN`, the `UPDATE` statements, the `INSERT` statements, and `COMMIT`/`ROLLBACK` must execute on the **exact same database session/connection** to form an atomic transaction.

**Q3: Why store `item_name` and `unit_price` inside `order_items` when `item_id` already references `items`?**

> Normalization is right for current catalog state, but financial records require **point-in-time snapshots**. If "Chef Knife" costs `45.99` today and `55.00` next month, historical receipts and daily revenue reports must still reflect `45.99`.

**Q4: How does your idempotency key protect against double-charging or double-deducting stock on flaky restaurant Wi-Fi?**

> Before modifying any stock, the transaction checks `orders` for `idempotency_key`. If the key exists, it returns the previously committed order without re-running stock deductions. Even if two duplicate requests arrive simultaneously before either commits, the `UNIQUE` constraint on `orders.idempotency_key` (`23505`) ensures only one succeeds while the loser rolls back and reads the winner's committed order.

**Q5: How would you handle order cancellation (`CANCELLED`) safely?**

> Run a reverse transaction: lock the order row (`SELECT ... FOR UPDATE`), verify its current status is eligible for cancellation (e.g., `PENDING` and not already `CANCELLED` so stock isn't refunded twice), update status to `CANCELLED`, and atomically add `oi.quantity` back to `items.stock_count`.
