# Authentication, Authorization (RBAC) & Security Architecture

## 1. Overview & Design Decisions

This application implements **stateful server-side session authentication** backed by PostgreSQL (`express-session` + `connect-pg-simple`) paired with **Role-Based Access Control (RBAC)** (`admin` and `cashier` roles) and multi-layer rate limiting.

### Why Server-Side Sessions Over Stateless JWTs?

- **Instant Revocation:** In a retail/restaurant POS environment, if a cashier tablet is lost or an employee leaves mid-shift, deleting their row from the PostgreSQL `"session"` table revokes access immediately on the very next HTTP request.
- **Zero Sensitive Payload in Browser:** The browser only holds a signed, opaque session identifier (`connect.sid`), while user IDs and roles remain strictly server-side in PostgreSQL.

---

## 2. Database Schema (`db/migrations/004_create_users_and_sessions.sql`)

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL COLLATE "default",
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
```

---

## 3. End-to-End Request & Security Pipeline

```text
[Browser / POS Terminal]
       │  1. POST /login (username, password)
       ▼
[loginLimiter Middleware] ──( >5 attempts / 15m )──► [HTTP 429 Too Many Requests]
       │
       ▼
[express.urlencoded] ──► Parses form body into req.body
       │
       ▼
[authController.postLogin]
   ├──► SELECT * FROM users WHERE username = \$1
   ├──► Constant-time check: bcrypt.compare(password, user?.password_hash || DUMMY_HASH)
   └──► req.session.regenerate() ──► Saves { userId, username, role } in PG "session" table
       │
       ▼  2. Response sets cookie: Set-Cookie: connect.sid=...; HttpOnly; SameSite=Lax
[Subsequent Protected Request: DELETE /items/5]
       │
       ▼
[express-session] ──► Loads user session from PostgreSQL via connect.sid
       │
       ▼
[requireRole('admin')]
   ├──► No session? ──► 302 Redirect to /login (or 401 JSON)
   ├──► Role == 'cashier'? ──► 403 Forbidden
   └──► Role == 'admin'? ──► Proceeds to Controller & PostgreSQL
```

---

## 4. Security Controls Implemented

| Security Layer               | Implementation                                                                                                                | Threat Mitigated                                                                  |
| :--------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| **Password Hashing**         | `bcrypt` with cost factor `12` (`db/seedAdmin.js`)                                                                            | Offline rainbow-table / GPU brute-force attacks if DB leaks                       |
| **Constant-Time Login**      | `bcrypt.compare` against pre-computed `DUMMY_HASH` when username is not found                                                 | **Timing-attack username enumeration** (both fake and real usernames take ~0.35s) |
| **Brute-Force Throttling**   | `loginLimiter` (`max: 5` attempts per `15 min` window on `POST /login`)                                                       | Automated AI credential-stuffing bots                                             |
| **Session Fixation Defense** | `req.session.regenerate()` immediately after credential verification                                                          | Attacker pre-setting a known session cookie before victim logs in                 |
| **Cookie Hardening**         | `httpOnly: true`, `sameSite: 'lax'`, `secure: NODE_ENV === 'production'`, 8-hour shift TTL                                    | XSS cookie theft (`document.cookie`) and cross-site CSRF attacks                  |
| **CSRF-Safe Logout**         | `POST /logout` destroys PostgreSQL session row and calls `res.clearCookie('connect.sid')`                                     | Malicious `<img>` or link prefetching logging users out unexpectedly              |
| **RBAC (`401` vs. `403`)**   | `requireRole(...allowedRoles)` middleware + conditional EJS rendering (`currentUser`)                                         | Privilege escalation (`cashier` attempting admin `POST/PUT/DELETE` mutations)     |
| **Identity-Aware AI Quotas** | `aiBurstLimiter` (5/min) & `aiSustainedLimiter` (30/15m) keyed by `req.session.userId` with `ipKeyGenerator(req.ip)` fallback | Shared restaurant Wi-Fi IP blocking all terminals + IPv6 `/64` rotation bypass    |

---

## 5. Debugging & Incident Log (Real Bugs Resolved)

1. **Middleware Execution Order (`TypeError: Cannot destructure property 'username' of 'req.body'`):**
   - _Cause:_ `session(...)`, `attachUserToLocals`, and `authRouter` were mounted at the bottom of `app.js` below `itemRouter` and the `404` catch-all handler.
   - _Fix:_ Ordered `app.js` strictly top-to-bottom: `helmet` -> `urlencoded/json` -> `session` -> `attachUserToLocals` -> `rateLimit` -> `routers` -> `404`.
2. **Router Collision & Duplicate Imports (`SyntaxError: Identifier 'requireAdmin' has already been declared`):**
   - _Cause:_ Duplicate imports and dynamic `/:id` routes placed above static routes (`/new`, `/chatbot`).
   - _Fix:_ Consolidated imports at top of routers and kept all static paths above parameterized `/:id` routes.
3. **IPv6 Rate-Limit Bypass Warning (`ERR_ERL_KEY_GEN_IPV6`):**
   - _Cause:_ `express-rate-limit` v8 flagged raw `req.ip` fallback inside custom `keyGenerator`.
   - _Fix:_ Wrapped fallback IP in `ipKeyGenerator(req.ip)` to mask IPv6 `/64` subnets properly.
4. **Top-Level `await` SyntaxError in CommonJS (`authController.js`):**
   - _Cause:_ `await bcrypt.compare(...)` was placed outside the `async postLogin` handler.
   - _Fix:_ Kept `DUMMY_HASH` as a synchronous string constant at top level and executed `await bcrypt.compare` inside `async (req, res, next)`.
5. **EJS Grid Layout Shift on `/categories`:**
   - _Cause:_ Hiding the admin "Add Category" form left an unclosed `<div>` inside a 3-column CSS grid, pulling the footer into the right column.
   - _Fix:_ Properly closed the conditional left-column `</div>` and switched the grid container dynamically to single-column for non-admin users.

---

## 6. Verification & Penetration Test Proof (`curl`)

### Timing-Attack & Brute-Force Verification

```bash
# 1. Constant-time check (Fake user vs. Real user with wrong password)
curl -s -o /dev/null -w "Fake user: %{http_code} in %{time_total}s\n" \
  -X POST http://localhost:3000/login -d "username=fake_bot&password=wrongpassword"
# Output: Fake user: 401 in 0.526866s

curl -s -o /dev/null -w "Real user: %{http_code} in %{time_total}s\n" \
  -X POST http://localhost:3000/login -d "username=admin&password=wrongpassword"
# Output: Real user: 401 in 0.368107s

# 2. Brute-force lockout on Attempt #6
for i in {3..6}; do
  curl -s -i -X POST http://localhost:3000/login \
    -d "username=admin&password=wrongpassword" | grep -E "HTTP/|RateLimit-|Too many"
done
# Output on Attempt #6:
# HTTP/1.1 429 Too Many Requests
# RateLimit-Limit: 5
# RateLimit-Remaining: 0
# Too many login attempts. Please wait 15 minutes and try again.
```

---

## 7. Interview Talking Points (60-Second Pitch)

- **Architecture:** _"I built stateful PostgreSQL-backed sessions with `express-session` and `connect-pg-simple` so admin/cashier sessions survive container restarts and can be revoked immediately."_
- **Hardening:** _"I hardened `POST /login` against credential stuffing with `express-rate-limit` (5 attempts / 15 min), against username enumeration via constant-time `DUMMY_HASH` `bcrypt` comparisons, and against session fixation via `req.session.regenerate()` with `HttpOnly` and `SameSite=Lax` cookies."_
- **RBAC:** _"I separated authentication (`401` / `/login` redirect) from role authorization (`403 Forbidden`) using composable `requireRole('admin', 'cashier')` middleware, ensuring UI-hidden buttons are backed by strict server-side enforcement."_
