# Engineering & Verification Log

## 2026-11-19 — Two-Layer AI API Rate Limiting & HTTP Security Hardening

### Problem Statement

Unrestricted POST requests to AI endpoints (`/items/suggest-category`, `/items/generate-description`, `/items/chat`, `/items/scan`) risk exhausting the Gemini API free-tier quota (`5 RPM` burst limit) or enabling automated quota scraping over longer windows.

### Engineering Solution

Implemented defense-in-depth middleware in `app.js`:

1. **HTTP Security Headers (`helmet`):** Configured Content Security Policy (`CSP`) directives allowing Tailwind CDN (`://tailwindcss.com`), Google Fonts, and Base64 image previews while blocking XSS and clickjacking vectors.
2. **Layer 1 — Burst Limiter (`aiBurstLimiter`):** Caps each IP to **5 requests per 1 minute** (`windowMs: 60 * 1000`, `max: 5`) to match upstream Gemini per-minute limits.
3. **Layer 2 — Sustained Limiter (`aiSustainedLimiter`):** Caps each IP to **30 requests per 15 minutes** (`windowMs: 15 * 60 * 1000`, `max: 30`) to prevent slow, continuous quota exhaustion.

### Terminal Verification Proof (`curl`)

Executed a 7-request rapid loop against `POST /items/suggest-category`:

```bash
for i in {1..7}; do
  echo "Request #\$i:"
  curl -s -i -X POST http://localhost:3000/items/suggest-category \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d '{"name":"Chef Knife"}' | grep -E "HTTP/|RateLimit-|error"
  echo "---"
done
```

### Observed Output

- **Requests #1–#5:** Returned `HTTP/1.1 200 OK` with `RateLimit-Remaining` decrementing (`29` -> `25`).
- **Requests #6–#7:** Immediately blocked at Layer 1 with `HTTP/1.1 429 Too Many Requests`, `RateLimit-Limit: 5`, `RateLimit-Remaining: 0`, and JSON error payload `{"error":"Rate limit exceeded (max 5 AI requests per minute). Please wait 60 seconds."}` before reaching the Gemini API or Layer 2.
