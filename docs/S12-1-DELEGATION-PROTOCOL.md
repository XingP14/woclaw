# S12-1: 委托协议设计

> 状态：✅ 设计完成

## 1. 目标

支持 Agent 通过 WoClaw Hub 将任务委托给其他已连接的 Agent，实现跨 Agent 任务分发与状态追踪。

## 2. 协议设计

### 2.1 委托生命周期

```
DELEGATE_REQUESTED  ──→  DELEGATE_ACCEPTED  ──→  DELEGATE_RUNNING  ──→  DELEGATE_DONE
                         ↓                           ↓
                    DELEGATE_REJECTED           DELEGATE_FAILED
                         ↓
                    DELEGATE_CANCELLED（DELEGATE_REQUESTED 状态下可取消）
```

### 2.2 WebSocket 消息类型（Hub ↔ Agents）

#### Agent → Hub

```typescript
// 发起委托
interface DelegateRequest {
  type: 'delegate_request';
  id: string;              // UUID，委托唯一标识
  task: {
    description: string;   // 任务描述
    payload?: any;          // 任务数据（可选）
    priority?: 'low' | 'normal' | 'high';
  };
  toAgent: string;          // 目标 Agent ID
  topic?: string;           // 可选：结果发送到特定 topic
}

// 委托响应（delegate 执行者）
interface DelegateResponse {
  type: 'delegate_response';
  id: string;              // 对应委托 ID
  status: 'accepted' | 'rejected';
  note?: string;           // 接受/拒绝原因
}

// 任务进度（delegate 执行者）
interface DelegateProgress {
  type: 'delegate_progress';
  id: string;
  progress: number;         // 0-100
  message?: string;
}

// 任务完成（delegate 执行者）
interface DelegateResult {
  type: 'delegate_result';
  id: string;
  status: 'done' | 'failed';
  result?: any;            // 执行结果
  error?: string;          // 失败原因
  summary?: string;        // 执行摘要
}

// 取消委托（delegator 发起）
interface DelegateCancel {
  type: 'delegate_cancel';
  id: string;
  reason?: string;
}
```

#### Hub → Agent

```typescript
// 委托通知（发送给 toAgent）
interface DelegateIncoming {
  type: 'delegate_incoming';
  id: string;
  fromAgent: string;
  task: {
    description: string;
    payload?: any;
    priority?: 'low' | 'normal' | 'high';
  };
  topic?: string;
  createdAt: number;
}

// 委托状态更新（发送给 delegator）
interface DelegateStatusUpdate {
  type: 'delegate_status';
  id: string;
  status: DelegationStatus;
  fromAgent?: string;      // 更新来源 agent
  note?: string;
  progress?: number;       // 进度百分比
  result?: any;
  error?: string;
  summary?: string;
  updatedAt: number;
}

type DelegationStatus =
  | 'requested'
  | 'accepted'
  | 'rejected'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';
```

### 2.3 REST API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /delegations | 列出所有委托（可过滤 byStatus/fromAgent/toAgent）|
| GET | /delegations/:id | 获取单个委托详情 |
| POST | /delegations | 创建新委托（Hub → Agent） |
| DELETE | /delegations/:id | 取消委托 |
| GET | /delegations/pending | 获取当前 agent 待处理的委托 |

```
GET /delegations?fromAgent=agent-b&status=requested
POST /delegations  body: { toAgent, task, topic? }
DELETE /delegations/:id
```

### 2.4 Hub 侧存储

```typescript
interface Delegation {
  id: string;
  fromAgent: string;        // 委托发起方
  toAgent: string;          // 委托执行方
  task: {
    description: string;
    payload?: any;
    priority?: 'low' | 'normal' | 'high';
  };
  topic?: string;          // 结果发布 topic
  status: DelegationStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  acceptedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
  summary?: string;
  note?: string;            // 接受/拒绝/取消原因
}
```

存储方案：Hub 内存 Map（`delegations: Map<string, Delegation>`）+ 持久化到 `db.ts`。

## 3. 实现计划（S12-1 到 S12-5）

### S12-1（本次）：协议设计 ✅
- WebSocket 消息类型定义（types.ts）
- REST API 端点设计
- Hub 存储结构设计

### S12-2：WebSocket delegate 消息处理
- `handleDelegateRequest()`: 存储委托，通知 toAgent
- `handleDelegateResponse()`: 更新状态，通知 fromAgent
- `handleDelegateProgress()`: 更新进度
- `handleDelegateResult()`: 标记完成
- `handleDelegateCancel()`: 取消委托

### S12-3：状态追踪 + CANCEL 支持
- `delegations` Map 实现
- Hub 向双方推送状态变更

### S12-4：REST API 端点
- `GET /delegations`
- `POST /delegations`
- `DELETE /delegations/:id`
- `GET /delegations/pending`

### S12-5：CLI 支持 + 测试
- `woclaw delegate <toAgent> <task>` 命令
- 完整流程测试

## 4. 关键设计决策

1. **Hub 中转模式**：委托消息经 Hub 路由，保证 Hub 掌握完整状态历史
2. **无轮询**：所有状态变更通过 WebSocket 实时推送
3. **可取消**：delegator 在 `requested/accepted/running` 状态下可取消
4. **无超时自动失败**：超时由客户端自行处理（Hub 不主动超时）
5. **topic 结果发布**：delegate 完成后，结果可发布到指定 topic，供其他 Agent 订阅

## 5. 安全考量

- 委托操作需要 Hub auth token（已有）
- Agent 只能操作自己的委托（fromAgent === 连接 agentId）
- `DELETE /delegations/:id` 需要验证权限
