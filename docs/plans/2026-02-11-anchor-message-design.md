# 锚点消息与动态房间管理功能设计

**日期:** 2026-02-11
**状态:** 已批准
**优先级:** 高

## 概述

本设计为 wall.md 添加两个核心功能：**动态房间管理** 和 **锚点消息系统**。主要用于活动场景，让主持人能够标记话题转换和现场进度，引导讨论与活动进度关联。

## 第一部分：整体架构概述

### 新增功能模块

**动态房间管理**：
- 将当前硬编码的 `ROOMS` 数组迁移到 KV 存储（key: `rooms:list`）
- 房间创建时自动生成 UUID 格式的 `anchorSecret`
- 使用 Worker 全局变量缓存房间列表，减少 KV 读取
- 每次房间更新后清除缓存，下次请求时重新加载

**锚点消息系统**：
- 新增 `POST /:room/anchor` 端点，验证该房间的 `anchorSecret`
- 锚点消息存储在普通消息流中，通过 `isAnchor: true` 标识
- 前端渲染时给锚点消息特殊样式（类似日期分隔线 + 🎙️ 图标）

### 数据流向

```
创建房间: 管理员 → POST /rooms (验证 ADMIN_SECRET) → 生成 anchorSecret → 存 KV
发送锚点: 主持人 → POST /:room/anchor (验证 anchorSecret) → 标记 isAnchor → 存 KV
展示消息: 用户 → GET /:room → 普通消息 + 锚点消息混合展示
```

## 第二部分：数据模型与存储

### KV 存储结构

**房间列表（统一存储）**：

```typescript
Key: "rooms:list"
Value: Room[] = [
  {
    id: "clawcon",
    name: "🦞 ClawCon HK",
    description: "room.clawcon",
    anchorSecret: "550e8400-e29b-41d4-a716-446655440000"
  },
  {
    id: "lobby",
    name: "🏠 Lobby",
    description: "room.lobby",
    anchorSecret: "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
  }
]
```

**消息存储（保持不变）**：

```typescript
Key: "messages:clawcon"
Value: StoredMessage[] = [
  { id: "msg1", name: "Alice", message: "Hello", timestamp: 123, isAnchor: false },
  { id: "msg2", name: "Host", message: "现在开始Q&A环节", timestamp: 456, isAnchor: true }
]
```

### 内存缓存实现

```typescript
// 全局变量（Worker 实例级别）
let roomsCache: Room[] | null = null;

async function getRooms(env: Env): Promise<Room[]> {
  if (roomsCache) return roomsCache;

  const raw = await env.CLAWCON_MESSAGES.get("rooms:list");
  roomsCache = raw ? JSON.parse(raw) : [];
  return roomsCache;
}

function clearRoomsCache() {
  roomsCache = null;
}
```

### anchorSecret 生成

使用 `crypto.randomUUID()` 生成标准 UUID v4。

## 第三部分：API 设计

### 新增接口

#### 1. POST /rooms - 创建房间

**请求示例**：

```bash
curl -X POST https://wall.md/rooms \
  -H "Authorization: Bearer <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "techfest-2025",
    "name": "🎪 Tech Fest 2025",
    "description": "年度技术嘉年华"
  }'
```

**成功响应 (201 Created)**：

```json
{
  "id": "techfest-2025",
  "name": "🎪 Tech Fest 2025",
  "description": "年度技术嘉年华",
  "anchorSecret": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

**错误响应**：
- `401 Unauthorized` - ADMIN_SECRET 错误
- `409 Conflict` - 房间 ID 已存在
- `400 Bad Request` - 参数验证失败

#### 2. POST /:room/anchor - 发送锚点消息

**请求示例**：

```bash
curl -X POST https://wall.md/clawcon/anchor \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "550e8400-e29b-41d4-a716-446655440000",
    "name": "主持人",
    "message": "🎯 现在开始：AI Agent 架构设计"
  }'
```

**成功响应 (200 OK)**：

```json
{ "ok": true }
```

**错误响应**：
- `403 Forbidden` - anchorSecret 错误
- `404 Not Found` - 房间不存在
- `400 Bad Request` - 参数验证失败

### 现有接口变化

- `GET /` - 从 KV 读取房间列表（有缓存）
- 其他接口保持不变

## 第四部分：权限验证逻辑

### ADMIN_SECRET 多密钥验证

```typescript
// src/utils/security.ts 新增
export function verifyAdminSecret(
  authHeader: string | null,
  env: Env
): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;

  const token = authHeader.substring(7);
  const validSecrets = env.ADMIN_SECRETS.split(",").map(s => s.trim());

  return validSecrets.includes(token);
}
```

### anchorSecret 验证

```typescript
// src/utils/validation.ts 新增
export async function verifyAnchorSecret(
  roomId: string,
  secret: string,
  env: Env
): Promise<boolean> {
  const rooms = await getRooms(env);
  const room = rooms.find(r => r.id === roomId);

  if (!room || !room.anchorSecret) return false;

  // 使用恒定时间比较，防止 timing attack
  return timingSafeEqual(
    Buffer.from(secret),
    Buffer.from(room.anchorSecret)
  );
}
```

### 环境变量配置

```toml
# wrangler.toml
[vars]
ADMIN_SECRETS = "secret-2024-abc,secret-2025-xyz"
```

### 安全考虑

- 使用 `timingSafeEqual` 防止时序攻击
- Authorization header 只支持 Bearer token 格式
- 验证失败统一返回 401/403，不泄露具体原因

## 第五部分：前端 UI 变化

### 锚点消息样式设计

锚点消息采用类似日期分隔线的横贯式设计，但更醒目：

**HTML 结构**：

```html
<!-- 普通消息 -->
<div class="msg">
  <strong>Alice</strong>: Hello world
</div>

<!-- 锚点消息 -->
<div class="msg-anchor">
  <div class="anchor-line">
    <span class="anchor-icon">🎙️</span>
    <span class="anchor-text">现在开始：AI Agent 架构设计</span>
  </div>
  <div class="anchor-meta">主持人 · 14:30</div>
</div>
```

**CSS 样式**：

```css
.msg-anchor {
  margin: 2rem 0;
  text-align: center;
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
}

.anchor-text {
  font-weight: 600;
  color: #f59e0b;
  font-size: 1.1rem;
  white-space: nowrap;
  margin: 0 1rem;
}

.anchor-meta {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 0.25rem;
}
```

### 渲染逻辑

JavaScript 渲染函数中增加判断：

```javascript
function renderMessage(msg) {
  if (msg.isAnchor) {
    return renderAnchorMessage(msg);
  }
  return renderNormalMessage(msg);
}
```

## 第六部分：错误处理与边界情况

### 房间创建错误处理

```typescript
async function handleCreateRoom(req: Request, env: Env) {
  try {
    // 1. 验证 ADMIN_SECRET
    if (!verifyAdminSecret(req.headers.get("Authorization"), env)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. 解析请求体
    const body = await req.json();
    const { id, name, description } = body;

    // 3. 参数验证
    if (!id || !name || !description) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!/^[a-z0-9-]+$/.test(id)) {
      return json({ error: "Invalid room ID format" }, { status: 400 });
    }

    // 4. 检查重复
    const rooms = await getRooms(env);
    if (rooms.find(r => r.id === id)) {
      return json({ error: "Room already exists" }, { status: 409 });
    }

    // 5. 创建房间
    const newRoom = {
      id,
      name: truncate(name, 50),
      description: truncate(description, 200),
      anchorSecret: crypto.randomUUID()
    };

    rooms.push(newRoom);
    await env.CLAWCON_MESSAGES.put("rooms:list", JSON.stringify(rooms));
    clearRoomsCache();

    return json(newRoom, { status: 201 });

  } catch (e) {
    console.error("[CreateRoom]", e);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
```

### 降级策略

- KV 读取失败时返回空数组，不阻断服务
- 缓存失效时自动重新加载
- 所有错误都记录到 console

## 第七部分：测试策略

### 功能测试清单

**房间管理**：
- [ ] 创建房间成功（正确的 ADMIN_SECRET）
- [ ] 创建房间失败（错误的 ADMIN_SECRET）
- [ ] 创建房间失败（重复的 room ID）
- [ ] 创建房间失败（无效的 ID 格式，如包含大写/特殊字符）
- [ ] 多密钥轮换（旧密钥和新密钥都能用）
- [ ] 房间列表正确显示新创建的房间
- [ ] 缓存机制工作（第二次请求不读 KV）

**锚点消息**：
- [ ] 发送锚点消息成功（正确的 anchorSecret）
- [ ] 发送锚点消息失败（错误的 anchorSecret）
- [ ] 发送锚点消息失败（不存在的房间）
- [ ] 锚点消息在列表中正确标记 `isAnchor: true`
- [ ] 前端正确渲染锚点样式（🎙️ 图标 + 分隔线）
- [ ] 锚点消息和普通消息混排顺序正确

**安全测试**：
- [ ] timing attack 防护（验证时间恒定）
- [ ] SQL/XSS 注入测试（房间名/描述）
- [ ] CORS 仍然正常工作

**性能测试**：
- [ ] 房间列表缓存生效（监控 KV 读取次数）
- [ ] 100 个房间时响应时间 < 500ms

## 向后兼容性

### 数据迁移

现有的 `clawcon` 和 `lobby` 房间需要迁移到 KV：

1. 创建初始化脚本生成 anchorSecret
2. 写入 `rooms:list`
3. 部署后验证房间列表正常显示

### API 兼容性

- 所有现有 API 端点保持不变
- 只新增 `POST /rooms` 和 `POST /:room/anchor`
- 前端渲染兼容没有 `isAnchor` 字段的旧消息

## 成功指标

- 🔐 **安全:** ADMIN_SECRET 和 anchorSecret 验证正常，防 timing attack
- 🚀 **性能:** 房间列表缓存生效，KV 读取次数减少 >90%
- 🎨 **体验:** 锚点消息视觉效果清晰，易于区分话题
- ✅ **稳定:** 所有测试通过，无回归问题

---

*设计已批准: 2026-02-11*
