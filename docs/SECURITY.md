# Security Architecture & Hardening Guide

## 1. Implemented Security Controls

### Authentication & Role-Based Access Control (RBAC)

- **Session-Backed Identity:** User identity (`req.session.userId`) and role (`req.session.role`) are stored server-side in PostgreSQL session storage—never trusted from client-supplied JSON fields like `createdBy`.
- **Route-Level Enforcement:** `POST /orders` and `GET /orders` are guarded by `requireRole("admin", "cashier")`. Unauthenticated callers receive `401 Unauthorized` (or redirect to `/login`), and unauthorized roles receive `403 Forbidden`.
- **Audit Attribution:** `orders.created_by` is populated directly from `req.session.userId`, creating a tamper-resistant audit trail of who punched every order.

### Data Integrity & Injection Prevention

- **Parameterized Queries Everywhere:** All SQL statements use `$1, $2, ...` bind parameters via `pg`, eliminating SQL injection across order creation, listing, and stock updates.
- **Strict Input Validation:** `itemId` and `quantity` are coerced and verified as positive integers (`Number.isInteger(val) && val > 0`), rejecting floats, `0`, negative numbers, empty carts, and malformed payloads before opening a database transaction.
- **Database-Level Guardrails:** `CHECK` constraints (`quantity > 0`, `unit_price >= 0`, `total_amount >= 0`, status enum) and `UNIQUE` (`idempotency_key`) enforce invariants even if a future code path bypasses model validation.

### Error Handling & Information Disclosure

- **Controlled Error Surface:** Domain errors return structured, actionable codes (`OUT_OF_STOCK`, `INSUFFICIENT_STOCK`, `ITEM_NOT_FOUND`, `INVALID_QUANTITY`) without exposing raw PostgreSQL stack traces, table names, or internal connection details.

---

## 2. Known Security Gaps & Next Hardening Steps

1. **CSRF Protection on Browser Form/Fetch Routes:** Because authentication uses session cookies (`SameSite` cookie policy), adding a CSRF token (or enforcing strict `SameSite=Lax`/`Strict` + custom header verification) protects state-changing endpoints like `POST /orders` against cross-site request forgery.
2. **Rate Limiting on Order & Auth Endpoints:** Add `express-rate-limit` on `/login` and `/orders` to prevent brute-force credential stuffing or automated inventory-locking abuse.
3. **Authorization Scoping on Order Details / Cancellation:** When adding `GET /orders/:id` or `POST /orders/:id/cancel`, enforce role rules (e.g., allowing `cashier` to view orders while restricting `CANCELLED` / refunds to `admin` or `superadmin`, or requiring manager PIN/audit log entry).
4. **Idempotency Key Ownership:** Scope `idempotency_key` uniqueness or validation so one user cannot probe another user's order by guessing an idempotency key (using high-entropy UUIDv4 keys mitigates guessing).
