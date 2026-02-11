# 锚点消息功能测试计划

## 测试环境

- 本地: `wrangler dev` (http://localhost:8787)
- 生产: 部署后测试
- 测试日期: 2026-02-12

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

   状态: ✅ PASSED - HTTP 201, 返回完整房间对象含 anchorSecret

2. **未授权** (401)
   ```bash
   curl -X POST http://localhost:8787/rooms \
     -H "Authorization: Bearer wrong" \
     -H "Content-Type: application/json" \
     -d '{"id":"demo2","name":"Demo","description":"test"}'
   ```
   预期: {"error":"Unauthorized"}

   状态: ✅ PASSED - HTTP 401, 错误消息正确

3. **重复 ID** (409)
   创建两次相同 ID
   预期: {"error":"Room already exists"}

   状态: ✅ PASSED - HTTP 409, 重复 ID 被正确拒绝

4. **无效 ID 格式** (400)
   ```bash
   curl -X POST http://localhost:8787/rooms \
     -H "Authorization: Bearer dev-secret-2026" \
     -H "Content-Type: application/json" \
     -d '{"id":"INVALID_ID","name":"Test","description":"test"}'
   ```
   预期: {"error":"Invalid room ID format..."}

   状态: ✅ PASSED - HTTP 400, ID 格式验证正常

5. **多密钥轮换**
   使用 ADMIN_SECRETS 中的任一密钥都应成功

   状态: ✅ PASSED - backup-secret-2026 创建房间成功

## 锚点消息测试

### ✅ POST /:room/anchor - 发送锚点

1. **成功发送** (200)
   使用正确的 anchorSecret
   预期: {"ok":true}

   状态: ❌ FAILED - HTTP 404, 动态房间无法访问（Bug: line 927）

2. **错误密钥** (403)
   使用错误的 secret
   预期: {"error":"Invalid anchor secret"}

   状态: ⚠️ SKIPPED - 依赖测试 1

3. **房间不存在** (404)
   向不存在的房间发送
   预期: {"error":"Room not found"}

   状态: ✅ PASSED - HTTP 404, 错误处理正确

4. **验证消息保存**
   ```bash
   curl http://localhost:8787/demo/messages
   ```
   预期: 返回的消息包含 isAnchor: true

   状态: ⚠️ SKIPPED - 依赖测试 1

## 前端 UI 测试

1. **锚点消息样式**
   - 访问包含锚点消息的房间
   - 验证显示 🎙️ 图标
   - 验证橙色文字和渐变分隔线
   - 验证动画效果（图标脉动）

   状态: ⚠️ SKIPPED - 依赖锚点消息发送成功

2. **普通消息与锚点消息混排**
   - 发送普通消息和锚点消息
   - 验证时间顺序正确
   - 验证样式互不干扰

   状态: ⚠️ SKIPPED - 依赖锚点消息发送成功

3. **响应式布局**
   - 在移动端查看
   - 验证锚点消息在小屏幕上正常显示

   状态: ⚠️ SKIPPED - 依赖锚点消息发送成功

4. **首页动态房间列表**
   - 访问 GET / 验证显示动态房间列表
   - 验证房间数量、名称、描述正确
   - 验证新创建的房间出现在列表中

   状态: ✅ PASSED - HTML 和 Markdown 版本都显示动态房间

## 性能测试

1. **房间缓存**
   - 首次访问首页（应读取 KV）
   - 再次访问（应使用缓存）
   - 创建新房间后访问（缓存应失效）

   状态: ⚠️ NOT TESTED - 需要性能分析工具

2. **并发创建**
   - 同时创建多个房间
   - 验证无竞态条件

   状态: ⚠️ NOT TESTED - 需要并发测试工具

## 安全测试

1. **XSS 防护**
   - 在锚点消息中尝试注入 `<script>alert(1)</script>`
   - 验证被正确转义

   状态: ⚠️ SKIPPED - 依赖锚点消息功能

2. **SQL 注入**（虽然用的是 KV）
   - 在房间名/描述中尝试特殊字符
   - 验证正常处理

   状态: ⚠️ NOT TESTED - 低优先级（使用 KV 无 SQL）

3. **Timing Attack**
   - 验证 anchorSecret 验证使用恒定时间比较

   状态: ⚠️ NOT TESTED - 代码审查显示使用标准比较

## 回归测试

1. **现有功能不受影响**
   - 发送普通消息
   - 添加反应
   - 回复消息
   - 拉取消息列表

   状态: ✅ PARTIAL - Legacy 房间（lobby）正常工作

2. **CORS 仍正常**
   - 跨域请求仍被正确处理

   状态: ✅ PASSED - 所有响应包含 CORS 头

3. **Rate Limiting**
   - 锚点消息也受 rate limit 限制

   状态: ⚠️ SKIPPED - 依赖锚点消息功能

## 测试执行记录

### 测试环境设置
- 测试时间: 2026-02-12
- 测试环境: wrangler dev (http://localhost:8787)
- ADMIN_SECRETS: dev-secret-2026,backup-secret-2026
- KV Namespace: CLAWCON_MESSAGES (c6d925a8b4cf48b5b4a8bbe4c7344207)

### 执行日志

#### 房间管理测试 ✅

1. **POST /rooms - 成功创建** (201) ✅ PASSED
   - 使用 dev-secret-2026 创建房间 test-demo
   - 返回: {"id":"test-demo","name":"Test Demo Room","description":"端到端测试房间","anchorSecret":"99592173-dbf9-412d-88a0-d3311251d05e"}
   - HTTP 201 Created

2. **POST /rooms - 未授权** (401) ✅ PASSED
   - 使用错误密钥 "wrong-secret"
   - 返回: {"error":"Unauthorized: Invalid admin secret"}
   - HTTP 401 Unauthorized

3. **POST /rooms - 重复 ID** (409) ✅ PASSED
   - 尝试再次创建 test-demo
   - 返回: {"error":"Room with ID 'test-demo' already exists"}
   - HTTP 409 Conflict

4. **POST /rooms - 无效 ID 格式** (400) ✅ PASSED
   - 使用大写字母 "INVALID_ID"
   - 返回: {"error":"Invalid room ID format: must be lowercase alphanumeric and hyphens only"}
   - HTTP 400 Bad Request

5. **POST /rooms - 多密钥轮换** ✅ PASSED
   - 使用 backup-secret-2026 创建房间 backup-test
   - 返回: {"id":"backup-test","name":"Backup Key Test","description":"测试备用密钥","anchorSecret":"8fd7b8af-008b-48ae-97d0-e38dfd342d53"}
   - HTTP 201 Created
   - 验证: 两个密钥都能正常工作

#### 锚点消息测试 ⚠️

1. **POST /:room/anchor - 成功发送** (200) ❌ FAILED
   - 向 test-demo 发送锚点消息
   - 返回: {"error":"Room 'test-demo' not found"}
   - HTTP 404 Not Found
   - 原因: **BUG** - 代码在 line 927 只检查 ROOMS 常量，未检查 KV 中的动态房间

2. **POST /:room/anchor - 错误密钥** (403) ⚠️ SKIPPED
   - 依赖上一个测试

3. **POST /:room/anchor - 房间不存在** (404) ✅ PASSED
   - 向不存在的房间 nonexistent-room 发送
   - 返回: {"error":"Room 'nonexistent-room' not found"}
   - HTTP 404 Not Found

4. **验证消息保存** ⚠️ SKIPPED
   - 依赖测试 1

#### 首页测试 ✅

1. **GET / - HTML 首页显示动态房间** ✅ PASSED
   - 访问 http://localhost:8787/
   - 验证: test-demo 和 backup-test 都显示在房间列表中
   - HTML 结构正确，包含房间名称和描述

2. **GET / - Markdown 首页显示动态房间** ✅ PASSED
   - 使用 Accept: text/markdown
   - 验证: 返回 markdown 格式的房间列表
   - 包含所有 KV 中的房间

3. **访问房间页面** ⚠️ PARTIAL
   - test-demo: HTTP 404 (Bug: 未检查 KV 房间)
   - lobby: HTTP 200 (Legacy 房间正常工作)

### 发现的问题

#### 🐛 BUG: 动态房间无法访问

**文件**: src/index.ts, line 927
**问题**: 房间路由只检查 ROOMS 常量，不检查 KV 中的动态房间

```typescript
const room = ROOMS.find(r => r.id === roomId);  // line 927

if (!room) {
  return withCors(json({ error: `Room '${roomId}' not found` }, { status: 404 }), req);
}
```

**影响**:
- 动态创建的房间无法访问（404）
- 无法发送锚点消息到动态房间
- 无法发送普通消息到动态房间

**建议修复**:
```typescript
// 应该同时检查 ROOMS 和 KV
const rooms = await getRooms(env);
const allRooms = rooms.length > 0 ? rooms : ROOMS;
const room = allRooms.find(r => r.id === roomId);
```

### 测试总结

#### 通过的测试 (9/12)
- ✅ POST /rooms 所有场景（5/5）
- ✅ 首页动态房间显示（2/2）
- ✅ Legacy 房间访问（1/1）
- ✅ 房间不存在错误处理（1/1）

#### 失败/跳过的测试 (3/12)
- ❌ 动态房间访问（发现 Bug）
- ⚠️ 锚点消息发送（依赖动态房间访问）
- ⚠️ 前端 UI 锚点样式测试（依赖锚点消息）

#### 核心功能状态
- ✅ 房间创建 API - 完全正常
- ✅ 管理员密钥验证 - 完全正常
- ✅ 首页动态列表 - 完全正常
- ❌ 动态房间访问 - 需要修复
- ❌ 锚点消息 API - 需要修复动态房间访问后测试

### 下一步

1. **修复 Bug**: 更新房间路由逻辑，支持 KV 动态房间
2. **重新测试**: 修复后测试锚点消息和前端 UI
3. **部署前检查**: 确保所有测试通过
