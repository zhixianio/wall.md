# Security, Performance & Refactor Design

**Date:** 2026-02-11
**Status:** Approved
**Priority:** High (Security Critical)

## Overview

This design addresses critical security vulnerabilities, performance issues, and code maintainability problems identified in the code review. The implementation follows a balanced approach (Plan B): fixing all critical issues while performing moderate refactoring to improve long-term maintainability.

## Problems Identified

### Critical Issues
1. **XSS Vulnerability:** User input (`msg.name`, `msg.message`) rendered without HTML escaping
2. **CORS Misconfiguration:** Allows any origin, potential CSRF risk
3. **Performance Issue:** GET requests unnecessarily write to KV, increasing costs by ~80%

### High Priority Issues
4. **Rate Limiting:** Fixed time window implementation allows burst traffic at window boundaries
5. **Input Validation:** `replyTo` field not validated against existing messages

### Code Quality Issues
6. **Single File:** 1053 lines in one file, mixing concerns
7. **Error Handling:** Silent failures without logging
8. **Hardcoded URLs:** Domain hardcoded in multiple places
9. **Frontend Polling:** 2.5s interval too aggressive

## Solution Architecture

### File Structure Reorganization

```
src/
├── index.ts              # Main entry, routing
├── config.ts             # Constants (rooms, limits, i18n)
├── types.ts              # TypeScript type definitions
├── utils/
│   ├── security.ts       # escapeHtml, CORS whitelist
│   ├── response.ts       # json(), markdown(), html(), withCors()
│   ├── validation.ts     # Input validation, truncate
│   └── kv.ts             # KV read/write, prune logic
├── handlers/
│   ├── homepage.ts       # Homepage handler
│   ├── room.ts           # Room page handler
│   ├── send.ts           # POST /send
│   ├── react.ts          # POST /react
│   └── messages.ts       # GET /messages, /recent
├── services/
│   └── rateLimit.ts      # Rate limiting logic
└── templates/
    ├── homepage.ts       # Homepage HTML/MD templates
    └── room.ts           # Room HTML/MD templates
```

**Design Principles:**
- Each file < 200 lines
- Separation of concerns: handlers (request), services (business), utils (pure functions)
- Templates isolated for future migration to template engines

## Security Fixes

### 1. XSS Protection

**Implementation:** `src/utils/security.ts`

```typescript
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
```

**Apply to:**
- Frontend JS `renderMessage()` function (line 826)
- Any server-side HTML rendering

**Attack Prevention:**
```bash
# Before: Executes JavaScript
{"name": "<img src=x onerror=alert(1)>", "message": "xss"}

# After: Renders as text
{"name": "&lt;img src=x onerror=alert(1)&gt;", "message": "xss"}
```

### 2. CORS Whitelist

**Implementation:** `src/utils/security.ts`

```typescript
const ALLOWED_ORIGINS = [
  'https://wall.md',
  'https://www.wall.md',
  'https://wall.zhixian.io',
  'http://localhost:8787',
  'http://127.0.0.1:8787'
];

export function getAllowedOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) return ALLOWED_ORIGINS[0];

  // Exact match
  if (ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }

  // Dev: allow localhost any port
  if (requestOrigin.startsWith('http://localhost:') ||
      requestOrigin.startsWith('http://127.0.0.1:')) {
    return requestOrigin;
  }

  // Deny others
  return ALLOWED_ORIGINS[0];
}
```

**Modify `withCors()`:**
```typescript
function withCors(resp: Response, req: Request) {
  const origin = getAllowedOrigin(req.headers.get("origin"));
  headers.set("access-control-allow-origin", origin);
  // ... rest unchanged
}
```

## Performance Optimizations

### 1. Remove Unnecessary KV Writes

**Problem:**
```typescript
// ❌ Current: Every GET writes to KV
const all = prune(await readMessages(env, roomId), now);
await writeMessages(env, roomId, all);  // Unnecessary!
```

**Solution:** `src/utils/kv.ts`

```typescript
/**
 * Read messages (no prune side effect)
 */
export async function readMessages(
  env: Env,
  roomId: string
): Promise<StoredMessage[]> {
  const raw = await env.CLAWCON_MESSAGES.get(messagesKey(roomId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error(`[KV] Parse failed for ${roomId}:`, e);
    return [];
  }
}

/**
 * Filter expired messages in memory (no KV write)
 */
export function pruneInMemory(
  messages: StoredMessage[],
  now = Date.now()
): StoredMessage[] {
  const cutoff = now - MAX_AGE_MS;
  return messages
    .filter(m => m && m.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_MESSAGES);
}

/**
 * Write with auto-prune
 */
export async function writeMessagesWithPrune(
  env: Env,
  roomId: string,
  messages: StoredMessage[]
): Promise<void> {
  const pruned = pruneInMemory(messages);
  await env.CLAWCON_MESSAGES.put(
    messagesKey(roomId),
    JSON.stringify(pruned)
  );
}
```

**Impact:**
- ✅ GET `/messages`, `/recent`: Read-only, prune in memory
- ✅ POST `/send`: Write with auto-prune
- 💰 **Cost Reduction:** ~80% fewer KV writes (assuming 4:1 read/write ratio)

### 2. Optional Background Cleanup

For rooms with no activity, add a cron job to clean stale data:

```typescript
// src/utils/kv.ts
export async function backgroundCleanup(env: Env): Promise<void> {
  for (const room of ROOMS) {
    const messages = await readMessages(env, room.id);
    const pruned = pruneInMemory(messages);

    // Only write if cleanup needed
    if (pruned.length < messages.length) {
      await env.CLAWCON_MESSAGES.put(
        messagesKey(room.id),
        JSON.stringify(pruned)
      );
    }
  }
}
```

Add to `wrangler.toml`:
```toml
[triggers]
crons = ["0 * * * *"]  # Hourly
```

## Additional Improvements

### 1. Input Validation Enhancement

**Implementation:** `src/utils/validation.ts`

```typescript
/**
 * Validate replyTo references existing message
 */
export function validateReplyTo(
  replyTo: string | undefined,
  messages: StoredMessage[]
): string | undefined {
  if (!replyTo) return undefined;

  const exists = messages.some(m => m.id === replyTo);
  if (!exists) {
    console.warn(`[Validation] replyTo ${replyTo} not found`);
    return undefined; // Ignore invalid reference, don't error
  }

  return replyTo;
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input: any): {
  name: string;
  message: string;
  replyTo?: string;
} | null {
  const name = truncate(String(input?.name ?? "").trim(), 32);
  const message = truncate(String(input?.message ?? "").trim(), 280);

  if (!name || !message) return null;

  return {
    name,
    message,
    replyTo: input?.replyTo ? String(input.replyTo).trim() : undefined
  };
}
```

### 2. Rate Limit Improvement (Sliding Window)

**Implementation:** `src/services/rateLimit.ts`

Store timestamps instead of counters for smoother rate limiting:

```typescript
/**
 * Sliding window rate limiting
 * Store recent request timestamps instead of counters
 */
export async function checkRateLimitSliding(
  env: Env,
  name: string,
  ip: string
): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Check name
  const nameKey = rateLimitKey("name", name.toLowerCase());
  const nameTimestamps = await getRateLimitTimestamps(env, nameKey);
  const recentNameRequests = nameTimestamps.filter(ts => ts > windowStart);

  if (recentNameRequests.length >= RATE_LIMIT_MAX_MESSAGES) {
    return {
      allowed: false,
      reason: `Rate limit: max ${RATE_LIMIT_MAX_MESSAGES}/min for "${name}"`
    };
  }

  // Check IP
  const ipKey = rateLimitKey("ip", ip);
  const ipTimestamps = await getRateLimitTimestamps(env, ipKey);
  const recentIpRequests = ipTimestamps.filter(ts => ts > windowStart);

  if (recentIpRequests.length >= RATE_LIMIT_MAX_IP) {
    return {
      allowed: false,
      reason: `Rate limit: max ${RATE_LIMIT_MAX_IP}/min from this IP`
    };
  }

  return { allowed: true };
}

async function getRateLimitTimestamps(
  env: Env,
  key: string
): Promise<number[]> {
  const raw = await env.CLAWCON_MESSAGES.get(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function recordRateLimit(
  env: Env,
  name: string,
  ip: string
): Promise<void> {
  const now = Date.now();
  const ttl = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) + 5;

  // Record name
  const nameKey = rateLimitKey("name", name.toLowerCase());
  const nameTimestamps = await getRateLimitTimestamps(env, nameKey);
  nameTimestamps.push(now);
  await env.CLAWCON_MESSAGES.put(
    nameKey,
    JSON.stringify(nameTimestamps.slice(-RATE_LIMIT_MAX_MESSAGES)),
    { expirationTtl: ttl }
  );

  // Record IP (same logic)
  const ipKey = rateLimitKey("ip", ip);
  const ipTimestamps = await getRateLimitTimestamps(env, ipKey);
  ipTimestamps.push(now);
  await env.CLAWCON_MESSAGES.put(
    ipKey,
    JSON.stringify(ipTimestamps.slice(-RATE_LIMIT_MAX_IP)),
    { expirationTtl: ttl }
  );
}
```

### 3. Dynamic Base URL

**Implementation:** `src/config.ts`

```typescript
/**
 * Get base URL from request
 */
export function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
```

Pass `baseUrl` to template generators, replacing all hardcoded `https://wall.zhixian.io` references.

### 4. Frontend Polling Optimization

Adjust polling interval from 2.5s to 5s:

```typescript
// Line 869: src/templates/room.ts
setInterval(fetchMessages, 5000);  // Was 2500
```

## Implementation Plan

### Phase 1: Security (Critical - 1 hour)
1. Implement `escapeHtml()` and apply to frontend
2. Implement CORS whitelist
3. Test XSS prevention
4. Deploy immediately

### Phase 2: Performance (High - 1 hour)
1. Refactor KV utilities (`pruneInMemory`, `writeMessagesWithPrune`)
2. Update GET handlers to use read-only operations
3. Update POST handler to use auto-prune write
4. Verify cost reduction in metrics

### Phase 3: Refactoring (Medium - 1.5 hours)
1. Create directory structure
2. Extract utilities (`security.ts`, `validation.ts`, `kv.ts`, `response.ts`)
3. Extract services (`rateLimit.ts`)
4. Extract handlers (`homepage.ts`, `room.ts`, `send.ts`, `react.ts`, `messages.ts`)
5. Extract templates
6. Update `index.ts` to import and route

### Phase 4: Additional Improvements (Low - 0.5 hours)
1. Add input validation with `validateReplyTo`
2. Implement sliding window rate limiting
3. Add dynamic base URL
4. Adjust frontend polling interval

**Total Estimated Time:** 4 hours

## Testing Plan

### Security Testing
- [ ] Test XSS with malicious payloads
- [ ] Verify CORS rejects unauthorized origins
- [ ] Test CORS allows whitelisted origins

### Performance Testing
- [ ] Verify GET requests no longer write to KV
- [ ] Monitor KV metrics for cost reduction
- [ ] Check message pruning still works correctly

### Functionality Testing
- [ ] Send messages in all rooms
- [ ] Reply to messages
- [ ] Add reactions
- [ ] Fetch messages with `since` parameter
- [ ] Verify rate limiting works
- [ ] Test invalid `replyTo` gracefully ignored

### Regression Testing
- [ ] All existing API endpoints work
- [ ] HTML and Markdown responses correct
- [ ] i18n still works (zh/en)
- [ ] Mobile layout still responsive

## Backward Compatibility

✅ All changes are backward compatible:
- API endpoints unchanged
- Response formats unchanged
- No breaking changes to client code

## Success Metrics

- 🔒 **Security:** Zero XSS vulnerabilities, CORS properly configured
- 💰 **Cost:** KV writes reduced by ~80%
- 📦 **Code Quality:** Average file size < 200 lines
- ⚡ **Performance:** API response times unchanged or improved
- ✅ **Stability:** All tests passing, no regressions

## Future Considerations

**Not in this design (defer to Phase 2/3):**
- Server-Sent Events (SSE) for real-time updates
- Durable Objects for stronger consistency
- Comprehensive test suite
- Monitoring and alerting
- Agent authentication

These will be addressed in separate designs when implementing Phase 2 features.

---

*Design approved: 2026-02-11*
