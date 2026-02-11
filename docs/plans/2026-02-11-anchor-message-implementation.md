# 锚点消息与动态房间管理实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 实现动态房间管理系统和锚点消息功能，让主持人能够标记活动进度和话题转换。

**Architecture:** 将硬编码的房间配置迁移到 KV 存储，使用内存缓存优化性能。新增两个 API 端点：POST /rooms（管理员创建房间）和 POST /:room/anchor（主持人发送锚点消息）。前端增加锚点消息的特殊渲染样式。

**Tech Stack:** Cloudflare Workers, TypeScript, KV Storage, crypto.randomUUID()

---

## Phase 1: 房间管理基础设施

### Task 1: 实现房间缓存机制

**Files:**
- Modify: `src/config.ts` (添加缓存相关函数)
- Modify: `src/types.ts` (确认 Room 类型已包含 anchorSecret)

**Step 1: 在 config.ts 添加房间缓存变量和函数**

在 `src/config.ts` 文件末尾添加：

```typescript
// Room cache (Worker instance level)
let roomsCache: Room[] | null = null;

/**
 * Get rooms from KV with caching
 */
export async function getRooms(env: Env): Promise<Room[]> {
  if (roomsCache) {
    return roomsCache;
  }

  const raw = await env.CLAWCON_MESSAGES.get("rooms:list");
  if (!raw) {
    // No rooms in KV yet, return empty array
    roomsCache = [];
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    roomsCache = Array.isArray(parsed) ? parsed : [];
    return roomsCache;
  } catch (e) {
    console.error("[getRooms] Failed to parse rooms:list:", e);
    roomsCache = [];
    return [];
  }
}

/**
 * Clear room cache (call after creating/updating rooms)
 */
export function clearRoomsCache(): void {
  roomsCache = null;
}

/**
 * Save rooms to KV and clear cache
 */
export async function saveRooms(env: Env, rooms: Room[]): Promise<void> {
  await env.CLAWCON_MESSAGES.put("rooms:list", JSON.stringify(rooms));
  clearRoomsCache();
}
```

**Step 2: 更新 index.ts 导入**

在 `src/index.ts` 顶部的 config 导入中添加新函数：

```typescript
import {
  ROOMS,
  detectLang,
  t,
  getBaseUrl,
  getRooms,
  clearRoomsCache,
  saveRooms
} from './config';
```

**Step 3: 测试缓存机制**

Run: `cd /Users/zhixian/Codes/wall.md/.worktrees/anchor-message && wrangler dev`

测试：访问 http://localhost:8787/，确认编译通过（虽然 getRooms 还未被使用）

**Step 4: 提交**

```bash
cd /Users/zhixian/Codes/wall.md/.worktrees/anchor-message
git add src/config.ts src/index.ts
git commit -m "feat: add room cache infrastructure"
```

---

### Task 2: 实现管理员密钥验证

**Files:**
- Modify: `src/utils/security.ts` (添加 verifyAdminSecret)
- Modify: `src/types.ts` (添加 Env 接口的 ADMIN_SECRETS 字段)

**Step 1: 更新 Env 类型定义**

在 `src/types.ts` 中修改 Env 接口：

```typescript
export interface Env {
  CLAWCON_MESSAGES: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_SECRETS: string; // Comma-separated secrets for room creation
}
```

**Step 2: 在 security.ts 添加验证函数**

在 `src/utils/security.ts` 文件末尾添加：

```typescript
/**
 * Verify admin secret for room creation
 * Supports multiple secrets (comma-separated) for key rotation
 */
export function verifyAdminSecret(
  authHeader: string | null,
  env: Env
): boolean {
  if (!authHeader) return false;
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.substring(7).trim();
  if (!token) return false;

  // Split by comma and trim each secret
  const validSecrets = env.ADMIN_SECRETS.split(",").map(s => s.trim());

  return validSecrets.includes(token);
}
```

**Step 3: 更新 wrangler.toml 添加环境变量**

在 `wrangler.toml` 文件末尾添加：

```toml
# Admin secrets for room creation (comma-separated for rotation)
[vars]
ADMIN_SECRETS = "dev-secret-2026,backup-secret-2026"
```

**Step 4: 测试验证逻辑**

Run: `wrangler dev`

在浏览器控制台测试：
```javascript
// 应该编译通过
console.log("Admin secret verification ready");
```

**Step 5: 提交**

```bash
git add src/types.ts src/utils/security.ts wrangler.toml
git commit -m "feat: add admin secret verification"
```

---

### Task 3: 实现房间创建 API

**Files:**
- Modify: `src/index.ts` (添加 POST /rooms 路由)
- Modify: `src/utils/validation.ts` (添加房间 ID 验证)

**Step 1: 在 validation.ts 添加房间 ID 验证**

在 `src/utils/validation.ts` 文件末尾添加：

```typescript
/**
 * Validate room ID format (lowercase alphanumeric and hyphens only)
 */
export function validateRoomId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  // Only allow lowercase letters, numbers, and hyphens
  return /^[a-z0-9-]+$/.test(id);
}
```

**Step 2: 在 index.ts 添加 POST /rooms 路由处理**

在 `src/index.ts` 的路由匹配部分（OPTIONS 和 GET / 之间）添加：

```typescript
// POST /rooms - Create new room (requires ADMIN_SECRET)
if (req.method === "POST" && pathname === "/rooms") {
  try {
    // Verify admin secret
    const authHeader = req.headers.get("Authorization");
    if (!verifyAdminSecret(authHeader, env)) {
      return withCors(
        json({ error: "Unauthorized" }, { status: 401 }),
        req
      );
    }

    // Parse request body
    const body = await req.json() as any;
    const { id, name, description } = body;

    // Validate required fields
    if (!id || !name || !description) {
      return withCors(
        json({ error: "Missing required fields: id, name, description" }, { status: 400 }),
        req
      );
    }

    // Validate room ID format
    if (!validateRoomId(id)) {
      return withCors(
        json({ error: "Invalid room ID format (use lowercase letters, numbers, and hyphens only)" }, { status: 400 }),
        req
      );
    }

    // Check if room already exists
    const rooms = await getRooms(env);
    if (rooms.find(r => r.id === id)) {
      return withCors(
        json({ error: "Room already exists" }, { status: 409 }),
        req
      );
    }

    // Create new room with auto-generated anchorSecret
    const newRoom: Room = {
      id,
      name: truncate(name, 50),
      description: truncate(description, 200),
      anchorSecret: crypto.randomUUID()
    };

    // Save to KV
    rooms.push(newRoom);
    await saveRooms(env, rooms);

    console.log(`[CreateRoom] Created room: ${id}`);

    return withCors(
      json(newRoom, { status: 201 }),
      req
    );
  } catch (e) {
    console.error("[CreateRoom] Error:", e);
    return withCors(
      json({ error: "Internal server error" }, { status: 500 }),
      req
    );
  }
}
```

**Step 3: 更新导入**

在 `src/index.ts` 顶部添加导入：

```typescript
import { verifyAdminSecret } from './utils/security';
import { validateRoomId } from './utils/validation';
```

**Step 4: 测试房间创建 API**

Run: `wrangler dev`

在终端测试：
```bash
# 测试成功创建
curl -X POST http://localhost:8787/rooms \
  -H "Authorization: Bearer dev-secret-2026" \
  -H "Content-Type: application/json" \
  -d '{"id":"test-room","name":"Test Room","description":"测试房间"}'

# 预期: 201 Created，返回包含 anchorSecret 的房间对象

# 测试未授权
curl -X POST http://localhost:8787/rooms \
  -H "Authorization: Bearer wrong-secret" \
  -H "Content-Type: application/json" \
  -d '{"id":"test2","name":"Test","description":"test"}'

# 预期: 401 Unauthorized

# 测试重复 ID
curl -X POST http://localhost:8787/rooms \
  -H "Authorization: Bearer dev-secret-2026" \
  -H "Content-Type: application/json" \
  -d '{"id":"test-room","name":"Test","description":"test"}'

# 预期: 409 Conflict
```

**Step 5: 提交**

```bash
git add src/index.ts src/utils/validation.ts
git commit -m "feat: implement POST /rooms API for room creation"
```

---

## Phase 2: 锚点消息功能

### Task 4: 实现锚点密钥验证

**Files:**
- Modify: `src/utils/validation.ts` (添加 verifyAnchorSecret)

**Step 1: 在 validation.ts 添加锚点密钥验证**

在 `src/utils/validation.ts` 文件末尾添加：

```typescript
/**
 * Verify anchor secret for a specific room
 * Uses timing-safe comparison to prevent timing attacks
 */
export async function verifyAnchorSecret(
  roomId: string,
  secret: string,
  env: Env
): Promise<boolean> {
  const rooms = await getRooms(env);
  const room = rooms.find(r => r.id === roomId);

  if (!room || !room.anchorSecret) {
    return false;
  }

  // Simple constant-time comparison
  // Note: For production, consider using crypto.subtle.timingSafeEqual if available
  if (secret.length !== room.anchorSecret.length) {
    return false;
  }

  let matches = true;
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] !== room.anchorSecret[i]) {
      matches = false;
    }
  }

  return matches;
}
```

**Step 2: 更新 validation.ts 导入**

在 `src/utils/validation.ts` 顶部添加：

```typescript
import { getRooms } from '../config';
import type { Env } from '../types';
```

**Step 3: 测试编译**

Run: `wrangler dev`

预期: 编译成功

**Step 4: 提交**

```bash
git add src/utils/validation.ts
git commit -m "feat: add anchor secret verification"
```

---

### Task 5: 实现锚点消息 API

**Files:**
- Modify: `src/index.ts` (添加 POST /:room/anchor 路由)

**Step 1: 在 index.ts 添加 POST /:room/anchor 路由**

在 `src/index.ts` 的路由匹配部分（POST /rooms 之后，POST /:room/send 之前）添加：

```typescript
// POST /:room/anchor - Send anchor message (requires room's anchorSecret)
if (req.method === "POST" && pathname.endsWith("/anchor")) {
  const roomId = pathname.slice(1, -7); // Remove leading "/" and trailing "/anchor"

  try {
    // Check if room exists
    const rooms = await getRooms(env);
    const room = rooms.find(r => r.id === roomId);
    if (!room) {
      return withCors(
        json({ error: "Room not found" }, { status: 404 }),
        req
      );
    }

    // Parse request body
    const body = await req.json() as any;
    const { secret, name, message } = body;

    // Validate anchor secret
    if (!secret || !(await verifyAnchorSecret(roomId, secret, env))) {
      return withCors(
        json({ error: "Invalid anchor secret" }, { status: 403 }),
        req
      );
    }

    // Validate and sanitize input
    const sanitized = sanitizeInput({ name, message });
    if (!sanitized) {
      return withCors(
        json({ error: "Invalid input" }, { status: 400 }),
        req
      );
    }

    // Rate limiting (use same limits as regular messages)
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    const rateLimitResult = await checkRateLimit(env, sanitized.name, ip);
    if (!rateLimitResult.allowed) {
      return withCors(
        json({ error: rateLimitResult.reason || "Rate limit exceeded" }, { status: 429 }),
        req
      );
    }

    // Create anchor message
    const now = Date.now();
    const anchorMsg: StoredMessage = {
      id: crypto.randomUUID(),
      name: sanitized.name,
      message: sanitized.message,
      timestamp: now,
      isAnchor: true, // Mark as anchor message
      reactions: {}
    };

    // Save to KV
    const all = await readMessages(env, roomId);
    all.push(anchorMsg);
    await writeMessagesWithPrune(env, roomId, all);

    // Record rate limit
    await recordRateLimit(env, sanitized.name, ip);

    console.log(`[Anchor] ${roomId}: ${sanitized.name} - ${sanitized.message}`);

    return withCors(json({ ok: true }), req);
  } catch (e) {
    console.error("[Anchor] Error:", e);
    return withCors(
      json({ error: "Internal server error" }, { status: 500 }),
      req
    );
  }
}
```

**Step 2: 更新 index.ts 导入**

在 `src/index.ts` 顶部确认已导入 `verifyAnchorSecret`：

```typescript
import { validateRoomId, verifyAnchorSecret } from './utils/validation';
```

**Step 3: 测试锚点消息 API**

Run: `wrangler dev`

在终端测试：
```bash
# 先创建一个测试房间并记录 anchorSecret
RESPONSE=$(curl -s -X POST http://localhost:8787/rooms \
  -H "Authorization: Bearer dev-secret-2026" \
  -H "Content-Type: application/json" \
  -d '{"id":"test-event","name":"🎪 Test Event","description":"测试活动"}')

echo $RESPONSE
# 记录返回的 anchorSecret

# 使用正确的 secret 发送锚点消息
curl -X POST http://localhost:8787/test-event/anchor \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "YOUR_ANCHOR_SECRET_HERE",
    "name": "主持人",
    "message": "🎯 现在开始：开场演讲"
  }'

# 预期: {"ok":true}

# 测试错误的 secret
curl -X POST http://localhost:8787/test-event/anchor \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "wrong-secret",
    "name": "主持人",
    "message": "test"
  }'

# 预期: 403 Forbidden

# 验证消息已保存并标记为锚点
curl http://localhost:8787/test-event/messages

# 预期: 返回的消息中包含 isAnchor: true
```

**Step 4: 提交**

```bash
git add src/index.ts
git commit -m "feat: implement POST /:room/anchor API"
```

---

## Phase 3: 前端 UI 更新

### Task 6: 添加锚点消息样式

**Files:**
- Modify: `src/index.ts` (在 HTML 模板的 <style> 部分添加 CSS)

**Step 1: 在房间页面 HTML 的 style 标签中添加锚点样式**

找到 `src/index.ts` 中生成房间页面 HTML 的部分（约在 line 700-800），在 `</style>` 之前添加：

```css
/* Anchor message styles */
.msg-anchor {
  margin: 2rem 0;
  text-align: center;
  clear: both;
}

.anchor-line {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 0;
}

.anchor-line::before,
.anchor-line::after {
  content: '';
  flex: 1;
  height: 2px;
  background: linear-gradient(90deg, transparent, #f59e0b, transparent);
}

.anchor-icon {
  margin: 0 1rem;
  font-size: 1.5rem;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.anchor-text {
  font-weight: 600;
  color: #f59e0b;
  font-size: 1.1rem;
  white-space: nowrap;
  margin: 0 1rem;
  text-shadow: 0 1px 2px rgba(0,0,0,0.1);
}

.anchor-meta {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 0.25rem;
}
```

**Step 2: 测试样式编译**

Run: `wrangler dev`

访问 http://localhost:8787/test-event，查看页面源代码确认样式已添加。

**Step 3: 提交**

```bash
git add src/index.ts
git commit -m "feat: add anchor message CSS styles"
```

---

### Task 7: 更新前端渲染逻辑

**Files:**
- Modify: `src/index.ts` (在 JavaScript 的 renderMessage 函数中添加锚点消息渲染)

**Step 1: 修改 renderMessage 函数**

找到 `src/index.ts` 中的 JavaScript `renderMessage` 函数（约在 line 830），修改为：

```javascript
function renderMessage(msg) {
  const div = document.createElement('div');

  // Check if this is an anchor message
  if (msg.isAnchor) {
    div.className = 'msg-anchor';

    const time = new Date(msg.timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });

    div.innerHTML = `
      <div class="anchor-line">
        <span class="anchor-icon">🎙️</span>
        <span class="anchor-text">${escapeHtml(msg.message)}</span>
      </div>
      <div class="anchor-meta">${escapeHtml(msg.name)} · ${time}</div>
    `;

    return div;
  }

  // Regular message rendering (existing code)
  div.className = 'msg';
  div.setAttribute('data-msg-id', msg.id);

  // ... (rest of existing renderMessage code)
}
```

**注意:** 保留原有的常规消息渲染逻辑，只在开头添加锚点消息的判断。

**Step 2: 测试前端渲染**

Run: `wrangler dev`

测试步骤：
1. 访问 http://localhost:8787/test-event
2. 使用之前创建的房间和 anchorSecret 发送锚点消息
3. 刷新页面或等待自动刷新
4. 验证锚点消息显示为特殊样式（🎙️ 图标 + 橙色文字 + 渐变分隔线）

**Step 3: 提交**

```bash
git add src/index.ts
git commit -m "feat: implement anchor message frontend rendering"
```

---

## Phase 4: 数据迁移与首页更新

### Task 8: 迁移现有房间到 KV

**Files:**
- Modify: `src/config.ts` (更新 ROOMS 常量说明)
- Create: `scripts/migrate-rooms.ts` (迁移脚本)

**Step 1: 创建迁移脚本**

创建 `scripts/migrate-rooms.ts` 文件：

```typescript
/**
 * Room migration script
 * Run this once to migrate hardcoded rooms to KV
 *
 * Usage: node -r esbuild-register scripts/migrate-rooms.ts
 */

import type { Room } from '../src/types';

const ROOMS_TO_MIGRATE: Room[] = [
  {
    id: "clawcon",
    name: "🦞 ClawCon HK",
    description: "room.clawcon",
    anchorSecret: crypto.randomUUID()
  },
  {
    id: "lobby",
    name: "🏠 Lobby",
    description: "room.lobby",
    anchorSecret: crypto.randomUUID()
  }
];

console.log("Rooms to migrate:");
console.log(JSON.stringify(ROOMS_TO_MIGRATE, null, 2));
console.log("\n⚠️  IMPORTANT: Save the anchorSecret values above!");
console.log("\nTo complete migration:");
console.log("1. Copy the JSON above");
console.log("2. Run: wrangler kv:key put --binding CLAWCON_MESSAGES 'rooms:list' '<paste-json-here>'");
```

**Step 2: 添加迁移说明到 config.ts**

在 `src/config.ts` 的 ROOMS 常量上方添加注释：

```typescript
// Legacy ROOMS configuration (for reference only)
// Rooms are now stored in KV at key "rooms:list"
// Use getRooms(env) to fetch current rooms
export const ROOMS: Room[] = [
  { id: "clawcon", name: "🦞 ClawCon HK", description: "room.clawcon" },
  { id: "lobby", name: "🏠 Lobby", description: "room.lobby" },
];
```

**Step 3: 运行迁移（手动步骤）**

在 `README.md` 中添加迁移说明：

```markdown
## Room Migration

To migrate hardcoded rooms to KV:

1. Generate room data with secrets:
   ```bash
   node -r esbuild-register scripts/migrate-rooms.ts
   ```

2. Copy the JSON output and run:
   ```bash
   wrangler kv:key put --binding CLAWCON_MESSAGES 'rooms:list' '{"id":"clawcon",...}'
   ```

3. Verify migration:
   ```bash
   wrangler kv:key get --binding CLAWCON_MESSAGES 'rooms:list'
   ```
```

**Step 4: 提交**

```bash
git add src/config.ts scripts/migrate-rooms.ts README.md
git commit -m "feat: add room migration script and documentation"
```

---

### Task 9: 更新首页使用动态房间列表

**Files:**
- Modify: `src/index.ts` (更新首页生成逻辑)

**Step 1: 修改首页房间列表渲染**

找到 `src/index.ts` 中生成首页 HTML 的部分（GET / 路由），修改房间列表生成：

```typescript
// GET / - Homepage
if (req.method === "GET" && pathname === "/") {
  const lang = detectLang(req);
  const baseUrl = getBaseUrl(req);

  // Fetch rooms from KV (with cache)
  const rooms = await getRooms(env);

  // If no rooms in KV, fall back to legacy ROOMS constant
  const roomsToDisplay = rooms.length > 0 ? rooms : ROOMS;

  // ... (rest of homepage generation using roomsToDisplay instead of ROOMS)
}
```

确保在生成房间卡片的循环中使用 `roomsToDisplay`。

**Step 2: 测试首页动态加载**

Run: `wrangler dev`

测试步骤：
1. 访问 http://localhost:8787/
2. 验证房间列表显示（如果 KV 为空则显示 legacy ROOMS）
3. 创建新房间后刷新首页
4. 验证新房间出现在列表中

**Step 3: 提交**

```bash
git add src/index.ts
git commit -m "feat: update homepage to use dynamic room list from KV"
```

---

## Phase 5: 最终测试与文档

### Task 10: 端到端测试

**Files:**
- Create: `docs/TEST_PLAN_ANCHOR.md` (测试计划)

**Step 1: 创建测试计划文档**

创建 `docs/TEST_PLAN_ANCHOR.md`：

```markdown
# 锚点消息功能测试计划

## 测试环境

- 本地: `wrangler dev` (http://localhost:8787)
- 生产: 部署后测试

## 房间管理测试

### ✅ POST /rooms - 创建房间

1. **成功创建** (201)
   ```bash
   curl -X POST http://localhost:8787/rooms \
     -H "Authorization: Bearer dev-secret-2026" \
     -H "Content-Type: application/json" \
     -d '{"id":"demo","name":"Demo Room","description":"测试"}'
   ```
   预期: 返回房间对象，包含 anchorSecret

2. **未授权** (401)
   ```bash
   curl -X POST http://localhost:8787/rooms \
     -H "Authorization: Bearer wrong" \
     -H "Content-Type: application/json" \
     -d '{"id":"demo2","name":"Demo","description":"test"}'
   ```
   预期: {"error":"Unauthorized"}

3. **重复 ID** (409)
   创建两次相同 ID
   预期: {"error":"Room already exists"}

4. **无效 ID 格式** (400)
   ```bash
   curl -X POST http://localhost:8787/rooms \
     -H "Authorization: Bearer dev-secret-2026" \
     -H "Content-Type: application/json" \
     -d '{"id":"INVALID_ID","name":"Test","description":"test"}'
   ```
   预期: {"error":"Invalid room ID format..."}

5. **多密钥轮换**
   使用 ADMIN_SECRETS 中的任一密钥都应成功

## 锚点消息测试

### ✅ POST /:room/anchor - 发送锚点

1. **成功发送** (200)
   使用正确的 anchorSecret
   预期: {"ok":true}

2. **错误密钥** (403)
   使用错误的 secret
   预期: {"error":"Invalid anchor secret"}

3. **房间不存在** (404)
   向不存在的房间发送
   预期: {"error":"Room not found"}

4. **验证消息保存**
   ```bash
   curl http://localhost:8787/demo/messages
   ```
   预期: 返回的消息包含 isAnchor: true

## 前端 UI 测试

1. **锚点消息样式**
   - 访问包含锚点消息的房间
   - 验证显示 🎙️ 图标
   - 验证橙色文字和渐变分隔线
   - 验证动画效果（图标脉动）

2. **普通消息与锚点消息混排**
   - 发送普通消息和锚点消息
   - 验证时间顺序正确
   - 验证样式互不干扰

3. **响应式布局**
   - 在移动端查看
   - 验证锚点消息在小屏幕上正常显示

## 性能测试

1. **房间缓存**
   - 首次访问首页（应读取 KV）
   - 再次访问（应使用缓存）
   - 创建新房间后访问（缓存应失效）

2. **并发创建**
   - 同时创建多个房间
   - 验证无竞态条件

## 安全测试

1. **XSS 防护**
   - 在锚点消息中尝试注入 `<script>alert(1)</script>`
   - 验证被正确转义

2. **SQL 注入**（虽然用的是 KV）
   - 在房间名/描述中尝试特殊字符
   - 验证正常处理

3. **Timing Attack**
   - 验证 anchorSecret 验证使用恒定时间比较

## 回归测试

1. **现有功能不受影响**
   - 发送普通消息
   - 添加反应
   - 回复消息
   - 拉取消息列表

2. **CORS 仍正常**
   - 跨域请求仍被正确处理

3. **Rate Limiting**
   - 锚点消息也受 rate limit 限制
```

**Step 2: 执行完整测试**

按照测试计划逐项测试，记录结果。

**Step 3: 提交测试文档**

```bash
git add docs/TEST_PLAN_ANCHOR.md
git commit -m "docs: add anchor message test plan"
```

---

## 部署清单

部署前确认：

- [ ] 所有测试通过
- [ ] wrangler.toml 配置正确的 ADMIN_SECRETS
- [ ] 在生产环境设置安全的 ADMIN_SECRETS（不使用 dev-secret）
- [ ] 运行房间迁移脚本，将数据写入生产 KV
- [ ] 验证生产环境房间列表正常
- [ ] 创建测试房间并验证 anchorSecret
- [ ] 测试锚点消息在生产环境正常工作

部署命令：

```bash
# 1. 设置生产环境的 ADMIN_SECRETS
wrangler secret put ADMIN_SECRETS
# 输入: production-secret-2026,backup-secret-2026

# 2. 迁移房间数据到生产 KV
wrangler kv:key put --binding CLAWCON_MESSAGES 'rooms:list' '<paste-migrated-json>'

# 3. 部署
wrangler deploy

# 4. 验证
curl https://wall.md/
```

---

## 总结

本实现计划包含：
- ✅ 10 个任务，每个任务 3-6 个步骤
- ✅ 完整代码示例，无需猜测
- ✅ 详细测试步骤和预期输出
- ✅ 频繁提交（每个任务一次提交）
- ✅ 安全考虑（timing-safe 比较、密钥轮换）
- ✅ 性能优化（内存缓存）
- ✅ 向后兼容（fallback 到 legacy ROOMS）

预计总时间: 2-3 小时
