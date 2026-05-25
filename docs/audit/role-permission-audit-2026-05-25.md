# 角色权限 Audit · 2026-05-25

> 目的: PM Q2.3 要求 review 代码权限 vs PM 明确的 4 角色定义 (Q2 完整回答), 找冲突.
> 输入: `backend/app/models.py` + `backend/app/auth.py` + `backend/app/access_control.py` + `backend/app/routers/*` + `frontend/src/lib/api.ts` + `frontend/src/app/me/profile/*` + `backend/app/demo_seed.py` + `CLAUDE.md`
> 范围: 只读 review, 不改代码.

---

## 0. TL;DR (给 PM 5 行)

- **代码里实际是 5 个 user role + 1 deprecated + 1 platform-admin email 白名单 + 1 个 Agent.role 字段**, 不是 PM 描述的 4 个.
- **`leader` 在代码里是 `admin` 的**别名**, 不是 PM 说的"workspace 最高权限, 高于 admin"** — 这是最大语义冲突.
- **`manager` 是代码里活跃的第 5 角色 (= v26.5 spec 里的"科长/部门 AI 维护人")**, PM 现在描述里直接把它合到 `member`, 跟实际 demo seed 数据 (10 个 manager user) **直接矛盾**.
- **`expert` 在代码里是双重含义**: ① 老 `WorkspaceMembership.role='expert'` (deprecated, 仍存活在 type / dashboard / demo seed) ② `Agent.role='expert'` (AI 角色, 跟 PM "expert = AI Agent" 概念匹配) — 两个意思共用同一个字符串值, 容易混淆.
- **`owner` 不是 PM 说的"系统拥有者最高权限"** — 代码里 owner = 该 workspace 的注册者, 一个 workspace 一个 owner. PM 想要的"系统拥有者"概念在代码里是 `platform_admin` (email 白名单 env var, 不在 `WorkspaceMembership.role` 里).

**建议 PM 先聊**: 冲突 #1 (owner 的语义) + 冲突 #2 (leader vs admin 谁高) + 冲突 #3 (manager 角色到底要不要保留).

---

## 1. PM 定义的角色 (Source of Truth)

PM Q2 完整回答里说的 4 角色 (按权限层级, 高 → 低):

| 序 | 角色 | PM 描述 | 关键权限 |
|---|---|---|---|
| 1 | **owner** | 系统拥有者, 最高权限 | 所有空间和角色数据的增删改查 (跨 workspace) |
| 2 | **leader** | 某个 workspace 的管理员 | workspace 下的最高权限 |
| 3 | **admin** | 某个 workspace 的科室长 | 科室内人员管理 + 发起会议 |
| 4 | **member** | 某 workspace 成员 | 仅能查看及发起会议 |

PM 补充: **`expert` = AI Agent 专家 (虚拟实体, 如 Aria / Stratos), 不是真人用户角色**.
PM 补充: **`manager` / `user` 是"普通用户"统称, 应映射到 `member`**.

---

## 2. 代码实际角色实现

### 2.1 User-role 枚举值 (源: backend/app/routers/team.py:103-105)

```python
_ALL_ROLES: frozenset[str] = frozenset(
    {"owner", "admin", "leader", "manager", "expert", "member"}
)
```

6 个字面值, 都存活在 `WorkspaceMembership.role` (String(16), 无 enum 约束).

### 2.2 Leader-or-admin 集合 (源: backend/app/auth.py:223)

```python
_LEADER_ROLES: frozenset[str] = frozenset({"owner", "admin", "leader"})
```

**`is_leader_or_admin` 把 owner / admin / leader 当**完全等同**对待** — 这是核心 helper, 全代码库用了 ~30 处.

### 2.3 邀请允许的 role (源: team.py:358)

```python
_INVITABLE_ROLES = {"admin", "leader", "manager", "member"}
```

`POST /api/team/invitations` 接受这 4 个 role. `owner` 不让邀请 (走 transfer-ownership). `expert` 不让选 (deprecated).

### 2.4 改派允许的 role (源: team.py:107-109)

```python
_PATCHABLE_ROLES: frozenset[str] = frozenset(
    {"admin", "leader", "manager", "member"}
)
```

`PATCH /api/team/members/{uid}` 改派目标 role 的集合. 也不含 owner / expert.

### 2.5 平台超管 (跨 workspace 上帝视角)

源: `backend/app/auth.py:488-498` + `backend/app/config.py` (env `PLATFORM_ADMIN_EMAILS`)

**不入库**, 完全靠 email 白名单. 当前白名单含 `bluesurfiregpt@gmail.com`.
- 切到任何 workspace 视为 owner (auth.py:223 经 `is_leader_or_admin` short-circuit)
- 所有 `/api/super/*` 端点必须 `require_platform_admin` (super.py:90, 188, 340)
- `/api/auth/me` 返回 `effective_role="owner"` (auth.py:1101) 即使没 membership 行

### 2.6 Agent.role (跟用户 role 字段重名 - 冲突源)

源: `models.py:288`

```python
role: Mapped[str] = mapped_column(String(16), default="expert")  # expert | moderator
```

**这是 Agent 表的 role 字段**, 不是 user 字段. 值: `"expert"` (用户配置的领域 AI) | `"moderator"` (内置主持人 AI). 这才是 PM 说的"expert = AI Agent". 但跟 `WorkspaceMembership.role='expert'` (deprecated user 角色) **同名同值**, 看代码极易误读.

### 2.7 v26.5 引入的 ABAC helper

源: `backend/app/auth.py`

| Helper | 行号 | 语义 |
|---|---|---|
| `is_leader_or_admin` | 240-253 | owner/admin/leader 任一 → True |
| `is_expert` | 256-259 | DEPRECATED. role=='expert' |
| `is_manager` | 262-266 | role=='manager' |
| `is_agent_manager` | 290-315 | leader+ **OR** 是该 agent 的 primary_user |
| `can_write_kb` | 358-388 | leader+ **OR** (KB.owner_agent.primary_user==caller) |
| `can_write_memory` | 407-457 | leader+ **OR** memory primary agent 的 primary_user |
| `require_platform_admin` | 501-505 | email 白名单 |

---

## 3. 权限对照表 (按 endpoint)

### 3.1 Workspace 级写

| Endpoint | 文件:行 | 实际允许角色 | PM 期望 | 冲突? |
|---|---|---|---|---|
| `POST /api/team/invitations` | team.py:348-380 | owner/admin/leader (`_require_admin`) | owner+admin? 还是只 owner+leader? PM 未明确 | 🟡 不明 |
| `PATCH /api/team/members/{uid}` | team.py:170-274 | owner/admin/leader | 同上 | 🟡 不明 |
| `DELETE /api/team/members/{uid}` | team.py:277-312 | owner/admin/leader | 同上 | 🟡 不明 |
| `POST /api/meetings` (human/hybrid) | meetings.py:100-223 | **任何已登录 ws 成员** | PM: "admin 跟 member 都能" | 🟢 OK |
| `POST /api/meetings` (auto 模式) | meetings.py:110-114 | owner/admin/leader 才能开 auto | PM 未明确, spec §决策点 1 推 A (member 允许 hybrid) | 🟢 跟 spec 对得上 |
| `POST /api/meetings/{id}/orchestrate/*` | meetings.py:628-712 | owner/admin/leader | PM 未明确 | 🟢 合理 |
| `POST /api/meetings/{id}/finalize` | meetings.py:730 | (没看到 guard, 只看到 ws 校验 — 待确认) | 应至少 召集人 / leader+ | 🟡 待查 |
| `POST /api/me/tasks/{id}/dispatch` | me.py:470 | owner/admin/leader | PM: admin 派任务 OK | 🟢 OK |
| `POST /api/me/tasks/{id}/auto-route` | me.py:1587 | owner/admin/leader | 同上 | 🟢 OK |
| `POST /api/me/tasks/{id}/consolidate` | me.py:1168 | owner/admin/leader | 同上 | 🟢 OK |
| `/api/cron-rules/*` (CRUD) | cron_rules.py:129-246 | owner/admin/leader | PM 未明确, 系统配置类 | 🟢 合理 |
| `/api/reports/*` (CRUD) | reports.py:107-454 | owner/admin/leader | 同上 | 🟢 OK |
| `/api/search-providers/*` (CRUD) | search_providers.py:167-294 | owner/admin/leader | 同上 | 🟢 OK |
| `/api/asr-vocabulary/*` (CRUD) | asr_vocabulary.py:98-156 | owner/admin/leader | 同上 | 🟢 OK |
| `/api/agent-templates/*` (CRUD) | agent_templates.py:245-268 | owner/admin/leader | 同上 | 🟢 OK |

### 3.2 Agent / KB / Memory 写 (PM Q2.2 关注: "编辑 AI / 知识库 / 记忆 只能 owner/leader, 不能 admin/member")

| Endpoint | 文件:行 | 实际允许角色 | PM 期望 (Q2.2) | 冲突? |
|---|---|---|---|---|
| `POST /api/agents` (创建 AI) | agents.py:187-221 | owner/admin/leader (`require_leader_or_admin`) | PM: 只 owner/leader | 🔴 **admin 也可创建 AI** — 跟 PM 冲突 |
| `PATCH /api/agents/{id}` (改 AI 配置) | agents.py:250-301 | owner/admin/leader **OR** Agent.primary_user (manager) | PM: 只 owner/leader | 🔴 **admin + manager 都可改 AI** — 跟 PM 冲突 |
| `PATCH .primary_user_id` (转主责) | agents.py:269-274 | owner/admin/leader | PM: 只 owner/leader | 🔴 admin 仍可转 |
| `DELETE /api/agents/{id}` | agents.py:304+ | owner/admin/leader **OR** primary_user | PM: 只 owner/leader | 🔴 同上 |
| `POST /api/knowledge-bases` (创建 KB) | knowledge.py:216-224 | owner/admin/leader | PM: 只 owner/leader | 🔴 admin 可创建 KB |
| `POST /api/knowledge-bases/{id}/documents` (上传 KB 文档) | knowledge.py:370-383 | `require_kb_writer`: leader+ OR primary_user 的 KB | PM: 只 owner/leader | 🔴 manager (科长) 可上传自己 AI 的 KB |
| `DELETE .../documents/{doc_id}` | knowledge.py:431-440 | 同上 | 同上 | 🔴 同上 |
| `POST /api/memory` (写长期记忆) | memory.py:181-214 | leader+ OR `is_agent_manager`(第一个 agent) | PM: 只 owner/leader | 🔴 admin + manager 都可写 memory |
| `DELETE /api/memory/{id}` | memory.py:253-270 | `require_memory_writer`: leader+ OR memory 的 primary agent 的 primary_user | PM: 只 owner/leader | 🔴 同上 |
| `POST /api/sedimentation-drafts/{id}/approve` | kb_sedimentation.py:184+ | leader+ OR draft.primary_user | PM: 只 owner/leader 应审批沉淀 | 🔴 manager (科长) 自己审批自己科室 AI 的沉淀 |

### 3.3 跨 workspace 数据查 (PM Q2.1: "只 owner")

| Endpoint | 文件:行 | 实际允许角色 | PM 期望 | 冲突? |
|---|---|---|---|---|
| `GET /api/super/workspaces` (列所有 ws) | super.py:80 | platform_admin (email 白名单) | PM: owner | 🟡 **代码里这是 `platform_admin` 不是 `owner`** — 命名不一致 |
| `POST /api/super/workspaces` (创建 ws) | super.py:175-188 | platform_admin | PM: owner | 🟡 同上 |
| `POST /api/super/switch/{ws_id}` (跨 ws 切) | super.py:322-340 | platform_admin | PM: owner | 🟡 同上 |
| `POST /api/auth/register` (新建 ws + 自动 owner) | auth.py:215-232 | 任何 reg 用户 | PM: 只系统拥有者 owner 能建 ws? | 🔴 **任何人注册都自动建一个新 workspace + 自己当 owner**, 跟 PM "owner = 系统拥有者最高权限" 严重冲突 |

### 3.4 Read 端点 (workspace 内可见性)

源: `access_control.py:82-133`

| caller role | 能看的范围 |
|---|---|
| owner/admin/leader | 全部 |
| owner-of-resource | 全部 |
| 任意 (含 member) | classification ∈ {public, general} 都可读 |
| expert (deprecated) | 自己 bound agent 范围内 |
| member | 需 active access_request 才能读 sensitive+ |

- `GET /api/team/members` (team.py:127-134): owner/admin/leader **专属**, member/expert 403. (源说明 v25-bug-fix #6 防 expert 拉全员邮箱.)
- `GET /api/agents` (agents.py:147-184): leader+ 看全部, expert 仅 bound, member 看 全部基础信息 (`_to_out` 脱敏).
- `GET /api/knowledge-bases` (knowledge.py:147): leader+ 看 全部, 其他用 KB.owner_agent_id ABAC.
- `GET /api/dashboard/*`: leader+ 看 全局, expert 看 bound agent, member 看 自己的 (`dashboard.py:35`).

PM 没明确 read 权限. 代码 read 比 PM "member 仅能查看" 更精细 (按 classification 分级).

---

## 4. 冲突清单 (按 critical 排序)

### 🔴 冲突 #1 — `owner` 语义跟 PM 的"系统拥有者最高权限"严重不符

**PM 说**: owner = "系统拥有者, 最高权限, 所有空间和角色数据的增删改查".

**代码实际**:
- `owner` 是单个 workspace 的注册者. 任何人 `/api/auth/register` 不带 invite token, 都会**自动建一个新 workspace + 自己当 owner** (`backend/app/routers/auth.py:215-232`).
- 多个 workspace 各有 owner. owner 不跨 workspace.
- PM 想要的"全空间增删改查"概念在代码里是 `platform_admin` (email 白名单 env var, 见 `backend/app/auth.py:488-505` + `backend/app/routers/super.py`).

**证据**:
```python
# auth.py:232 — 注册即 owner
ws = Workspace(name=name_for_ws, slug=slug)
session.add(ws)
await session.flush()
role = "owner"
```

```python
# auth.py:488-498
def is_platform_admin_email(email: Optional[str]) -> bool:
    """email 是否在 env PLATFORM_ADMIN_EMAILS 白名单 (case-insensitive)."""
    ...
    return email.lower().strip() in get_settings().platform_admin_emails_set
```

**建议修复**: 跟 PM 确认 — 她说的 "owner" 是 `platform_admin` 这个概念 (跨 ws 系统级) 还是 现有 workspace `owner` (单 ws 内)? 如果是前者, 需要把概念命名跟代码对齐 (e.g. UI 上 `platform_admin` 显示为 "系统拥有者", `WorkspaceMembership.role='owner'` 改成 "空间所有者").

---

### 🔴 冲突 #2 — `leader` 跟 `admin` 在代码里完全等同, 不是 PM 说的"leader > admin"

**PM 说**: leader = workspace 下最高权限 > admin = 科室长.

**代码实际**: `_LEADER_ROLES = {"owner", "admin", "leader"}` (`auth.py:223`), 三者在所有 30+ 处 `is_leader_or_admin` 判定**完全等同**. 没有任何 endpoint 区分 leader 跟 admin.

**证据**:
```python
# auth.py:223
_LEADER_ROLES: frozenset[str] = frozenset({"owner", "admin", "leader"})

# auth.py:240-253
async def is_leader_or_admin(session, auth) -> bool:
    if is_platform_admin(auth):
        return True
    role = await get_membership_role(session, auth.user.id, auth.workspace.id)
    return role in _LEADER_ROLES
```

```python
# team.py:42-44 (注释明确写这是 v25 妥协)
# v25-bug-fix W-2: 智慧住建文档 §2.1.2 — leader 等同于 admin 权限.
from ..auth import is_leader_or_admin
if not await is_leader_or_admin(session, auth):
```

**v26.5 spec 原话** (`docs/v26.5-role-redesign-spec.md:46`):
> `leader` | 副局长 / 等同 admin 别名 | ✓ | ✓ | ✓ | ✓ 任免 manager/member (**不可改 admin/owner**)

— **spec 写了 "不可改 admin/owner" 但代码里没实现这条** (PATCH /team/members 只挡 owner, 不挡 admin).

**建议修复**:
- 如果按 PM Q2 新定义 (leader > admin), 需要新建 helper `is_workspace_leader(session, auth)` 只接 owner/leader, 然后:
  - "编辑 AI / KB / memory" 类端点改用它 (PM Q2.2 要求)
  - "邀请用户" 类: PM Q2 没明说 admin 能不能邀请, 待确认
- 如果按 v26.5 spec (leader = admin 别名), 跟 PM 重新对齐叫法.

---

### 🔴 冲突 #3 — `manager` 角色在数据库 / FE / spec 都活着, PM 说"map 到 member"

**PM 说**: "manager 跟 user 是同一类('普通用户'统称, 应该映射到 member?)"

**代码实际**:
- 5 角色矩阵 (v26.5 spec, 已落地 `team.py:103`): owner/admin/leader/**manager**/member.
- `demo_seed.py:251-262` 创建 **10 个 demo manager** user (科长们), demo 数据已经在生产里.
- FE 个人中心 sidebar (`frontend/src/app/me/profile/layout.tsx:170-172`) 有 `needsRole: "manager+"` 这条路径, manager 能进部分系统配置.
- `is_agent_manager` helper (`auth.py:290-315`) 把 **manager 作为 KB / memory / agent 编辑的合法主体** — 这是 v26.5 P0 堵漏洞的核心设计.

**证据**:
```python
# demo_seed.py:251-262 (10 个 demo manager)
("赵伟", "demo.zhaow@futian.gov.cn", "manager", "机关党委(办公室)", "综合事务AI专家"),
... (10 个 manager 共)
```

```python
# auth.py:262-266
async def is_manager(session, auth) -> bool:
    """v26.5: caller 在当前 workspace 是 manager 角色?
    (manager = 部门 AI 维护人, 取代 v21 expert 概念)"""
    role = await get_membership_role(session, auth.user.id, auth.workspace.id)
    return role == "manager"
```

**建议修复**: 跟 PM 沟通 — manager 是不是真的要废? 如果要废, 需要做的大动作:
1. demo_seed.py 把 10 个 manager 改成 member
2. team.py 的 `_INVITABLE_ROLES` / `_PATCHABLE_ROLES` 拿掉 manager
3. is_agent_manager 改成只 leader+ (但这样 KB/memory 的"科长可管自己 AI"语义就丢了)
4. FE 个人中心 sidebar 删 manager+ 这条
5. v26.5 spec 标 deprecated

——— 或者 PM 是听不懂"manager"这个英文词, 中文叫"科长"她就懂了. 建议先跟 PM 确认 v26.5 spec 的"科长 = 部门 AI 维护人" 这个概念她到底接不接受.

---

### 🔴 冲突 #4 — PM "admin/member 都能创建会议" vs 代码 (auto 模式拦 member)

**PM 说**: "创建会议谁能做 (按 PM: admin + member 都能)"
**代码实际**:
- `human / hybrid` 模式: 任何 ws 成员都能开 (`meetings.py:100-104`, 没 guard, 只看 `get_current_auth`) — 跟 PM 一致 ✓
- `auto` 模式 (全 AI 自主推进): 只 owner/admin/leader (`meetings.py:114`)

PM 没区分 mode. 但 v26.5 spec §决策点 1 推 A (allow member 开 hybrid). 实际跟 spec 对齐.

**建议**: 跟 PM 确认: auto 模式 (跨科室 AI 决策会) 让 member 也能开 OK 吗? 现在 v26.3-spec 明确 "auto 是跨科室决策, 由 leader/admin/owner 召集, expert/member 0 交集".

---

### 🔴 冲突 #5 — PM "编辑 AI / KB / 记忆: 只 owner/leader" vs 代码 (admin + manager 都能)

**PM 说**: "编辑 AI 专家 / 知识库 / 记忆 (按 PM: 只能 owner / leader, 不能 admin / member?)"

**代码实际** (见 §3.2 表):
- 创建 AI: owner/admin/leader (v26.5-01d 的设计意图: 创建后指定 primary_user 给 manager)
- 改 AI 配置: owner/admin/leader **OR** 该 AI 的 primary_user (manager)
- 上传 KB 文档 / 删 KB 文档: leader+ **OR** KB.owner_agent.primary_user (manager)
- 写 memory: leader+ **OR** memory primary agent 的 primary_user (manager)
- 审批 KB 沉淀: leader+ **OR** draft.primary_user (manager)

跟 PM 期望的最大冲突点:
1. **`admin` 在代码里能做这些, PM 说不能**
2. **`manager` 在代码里能做这些 (有限范围), PM 直接不认 manager 这个角色**

**证据**:
```python
# agents.py:194 — 创建 AI 用 require_leader_or_admin (=owner/admin/leader)
await require_leader_or_admin(session, auth)
```

```python
# agents.py:258-263 — manager 可改自己 primary 的 AI
if not await is_agent_manager(session, auth, a.id):
    raise HTTPException(
        403,
        "[权限不足] 仅 owner / admin / leader,或该 AI 专家的 primary_user 可修改配置"
    )
```

**建议修复**: 这是这次 review 最大的设计分歧 — 在最敏感的"AI / 知识 / 记忆"写入域, PM 主张 **集中权力** (只 2 角色, owner/leader), 代码主张 **分权** (owner/admin/leader 全权 + manager 限范围). 必须当面跟 PM 拍板, 因为这影响 ABAC 整套设计 (v26.5 P0 完整落地了"分权"方案).

---

### 🟡 冲突 #6 (次要) — `Agent.role='expert'` 跟 PM "expert = AI Agent" 语义一致, 但跟老的 `WorkspaceMembership.role='expert'` (user) 同名混淆

**PM 说**: "expert = AI Agent 专家 (虚拟实体, 如 Aria / Stratos), 不是真人用户角色"

**代码实际**:
- `Agent.role` 字段 (`models.py:288`): 值 `expert | moderator`, 这才是 PM 说的"AI Agent" — ✓ 概念匹配
- `WorkspaceMembership.role` (`models.py:113`) 仍含 `expert` 值 (deprecated v26.5), 老 demo data 已 migrate 成 manager (init_db.py:347), 但代码里仍有 `is_expert` helper / `expert_bound_agent_id` 在跑 (`auth.py:256-341`).
- FE 老组件还在用 `role === "expert"` 显示 "AI 专家用户" (`frontend/src/app/dashboard/page.tsx:603` / `frontend/src/app/me/profile/team/page.tsx:224` 等 — 都是 老 UI 残留).

**建议**: 既然 PM 决定不要 user 层的 expert, 应该:
1. `_ALL_ROLES` 去掉 'expert'
2. 删 `is_expert` / `expert_bound_agent_id` helper (改 caller)
3. 清理 FE 所有 `role === "expert"` 分支
4. `Agent.role` 字段保留 (这才是真 AI 角色)

---

### 🟡 冲突 #7 — FE/BE 邀请 role 选项不一致

`backend/app/routers/team.py:358`:
```python
_INVITABLE_ROLES = {"admin", "leader", "manager", "member"}
```

`frontend/src/app/me/profile/team/page.tsx:35`:
```typescript
const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
```

**FE 邀请 dropdown 只有 admin / member, 但 BE 接 4 种**. 结果: BE 已经把 v26.5 manager/leader 接上但 FE 没更新 UI, manager 角色实际**只能靠 PATCH /api/team/members 改派, 没法直接邀请**.

**证据**:
```typescript
// frontend/src/app/me/profile/team/page.tsx:172-174
value={inviteRole}
onChange={(e) =>
  setInviteRole(e.target.value as "admin" | "member")
}
```

---

### 🟡 冲突 #8 — FE/BE leader 的"可见性" 不一致

`frontend/src/app/me/profile/team/page.tsx:67`:
```typescript
const canManage = me?.role === "owner" || me?.role === "admin";
```

—— **FE 不认 leader 当 manager** (邀请按钮 hide). 但 backend `is_leader_or_admin` 接 leader, 调 API 会通过.

这导致 leader 在 FE 看不到 "邀请 / 改派" 按钮, 但 API 调用其实能通过 — UX 跟 ABAC 漂移.

---

## 5. 角色映射建议

PM 想要 4 角色, 代码现在是 5 + 1 平台超管. 三种收敛方案:

### 方案 A · 按 PM 4 角色严格收敛 (大动手术)

| PM 角色 | 代码现状映射到 | 改动 |
|---|---|---|
| owner (系统拥有者) | `platform_admin` (email 白名单) | 把 `platform_admin` 重命名 owner, 砍掉 `WorkspaceMembership.role='owner'` 概念 (改成 `space_admin`?) |
| leader (ws 最高权限) | `WorkspaceMembership.role='owner'` + `='leader'` | 合并成新 `leader` |
| admin (科室长) | `WorkspaceMembership.role='admin'` | 砍 admin 创建/改 AI/KB/memory 的权 (现在能) |
| member (普通员工) | `member` + `manager` | manager 全降级成 member, 拆掉 `is_agent_manager` 这套 v26.5 P0 ABAC |

风险: 砍 manager 这套 ABAC 后, KB / memory / agent 编辑权重新集中到 leader, 客户可能不接受 (智慧住建 16 AI 各科室自己管的逻辑没了).

### 方案 B · 保留代码 5 角色 + 把 PM "owner" 改叫"系统拥有者 (platform admin)"

| PM 名 | 代码字符串 | 备注 |
|---|---|---|
| 系统拥有者 (PM 的 owner) | `platform_admin` | env 白名单, 跨 ws |
| 空间所有者 | `owner` | 单 ws 注册者 |
| 局长 (PM 的 leader) | `leader` | 但要把 leader > admin |
| 科长 / 副局 (PM 的 admin) | `admin` | 改派下属 |
| 部门 AI 维护人 | `manager` | v26.5 引入, 保留 |
| 普通员工 (PM 的 member) | `member` | 默认 |

需做: 改 `_LEADER_ROLES = {owner, leader}` (admin 不再等同), 让 admin 跟 leader 分开. 然后明确每条 endpoint 是 leader+ 还是 admin+.

### 方案 C · 部分妥协 (最小动手术)

只改 v26.5 spec 的命名让 PM 接受:
- 给 PM 提议: 把代码 `manager` 在 UI 上显示成 "科长 (中级管理员)" — 别说 "manager" 这个英文
- PM 看到中文 "科长" 可能就接受了 (她原话用了 "科室长" 描述 admin)
- 然后 PM 4 角色 → 代码 5 角色 实际对应:
  - PM "owner" = 代码 platform_admin (跨 ws) + owner (本 ws, 同 leader)
  - PM "leader" = 代码 leader (= admin 别名)
  - PM "admin (科室长)" = 代码 manager (部门 AI 维护人)
  - PM "member" = 代码 member

— 这等于把 PM 命名跟代码字面值对应错位. 不推荐 (将来维护痛).

---

## 6. 测试账号验证 (CLAUDE.md vs 代码实际)

| 邮箱 | CLAUDE.md 说的角色 | demo_seed.py 实际 WorkspaceMembership.role | 实际能做什么 |
|---|---|---|---|
| `bluesurfiregpt@gmail.com` | "owner / 召集人 / workspace 拥有者" | `owner` (`auth.py:527` reg flow) **+ platform_admin** (env 白名单) | 全部, 跨 workspace 切, 创新 ws |
| `demo.lijg@futian.gov.cn` | "leader / 局长" | `leader` (demo_seed.py:245) | 等同 owner/admin 全权 (代码里 leader = admin 别名) |
| `demo.chensy@futian.gov.cn` | "admin / 物业科长" | `admin` (demo_seed.py:250) | 等同 owner/leader 全权 (代码里 admin = leader 等同) — 可改 AI / KB / memory |
| `demo.fengl@futian.gov.cn` | "**expert (bound AI-08) / 物业 expert**" | **`manager`** (demo_seed.py:259, `bound_agent_name="物业监管AI专家"`) | manager 角色, 通过 Agent.primary_user_id 反向查管的 AI; 可改自己 primary AI 的 KB/memory; 不能改其他科室 AI |
| `demo.hanx@futian.gov.cn` | "member / 物业普通员工" | `member` (demo_seed.py:264) | 看 (按 classification), 开 human/hybrid 会议; 不能改 AI/KB/memory |

**关键不一致**: 
- **`demo.fengl` 在 CLAUDE.md 写 "expert(bound AI-08)" 但实际代码是 `manager`** — CLAUDE.md 是 v26.5 改名前的老版本, 需要同步.
- 文档里 "bound AI-08" 这种表述也已过时 (v26.5 把 `bound_agent_id` 字段作废, 改用 `Agent.primary_user_id` 反向查).

---

## 7. 建议下一步

### P0 — 跟 PM 当面拍板 3 件事 (1 小时)

1. **冲突 #1 / #3**: PM 说的 "owner" 是 `platform_admin` 还是 `WorkspaceMembership.role='owner'`? — 这决定整个权限模型命名.
2. **冲突 #2 / #5**: 编辑 AI / KB / memory 是 集中权 (只 leader+) 还是 分权 (leader+ + 各 AI 的 primary_user manager)? — 决定 v26.5 P0 已落地的 ABAC 要不要拆.
3. **冲突 #3**: `manager` 这个角色保留还是合并到 member? — 决定是否要 demo data migration + FE / spec 改动.

### P1 — 拍板后的代码同步 (1-3 天)

按方案 A/B/C 任一执行. 都会涉及:
- `backend/app/auth.py` `_LEADER_ROLES` / helper rename
- `backend/app/routers/team.py` `_ALL_ROLES` / `_INVITABLE_ROLES`
- `backend/app/demo_seed.py` 10 个 manager 是否降级 member
- `backend/app/init_db.py` migration SQL
- `frontend/src/lib/api.ts` `TeamRole` type
- `frontend/src/app/me/profile/team/page.tsx` `inviteRole` 类型
- `frontend/src/app/me/profile/layout.tsx` `FULL_ADMIN_ROLES` set
- `CLAUDE.md` 测试账号表 (fengl 改 manager + 解释)

### P2 — Kimi 用例

`docs/kimi-tests/v26.5-role-final-kimi.md` (假名), 覆盖:
- 5 测试账号 × 关键 endpoint 矩阵 (创建会议 / 改 AI / 上传 KB / 写 memory / 列成员)
- 每个 cell 输出 200/403 字面值 + 截图
- 反向验证 (manager 改非自己 primary 的 AI → 403)

### P3 — 文档同步

- `docs/v26.5-role-redesign-spec.md` 升 v27 (反映 PM 最终决定)
- `CLAUDE.md` 测试账号表 重写
- README.md 加 "角色矩阵" 一节
- `docs/error-codes.md` 角色相关 error code 一览

---

## 附录 A — `Agent.role` vs `WorkspaceMembership.role` 字段对照表

| 表 | 字段 | 字面值 | 含义 |
|---|---|---|---|
| `workspace_membership` | `role` | owner/admin/leader/manager/member/expert(dep) | 该 user 在该 ws 内的真人角色 |
| `agent` | `role` | expert/moderator | 该 AI agent 的功能类型 (领域专家 vs 内置主持人) |

PM "expert = AI Agent" → 代码 `Agent.role='expert'`. 不要混到 `WorkspaceMembership.role`.

---

## 附录 B — 关键代码定位锚 (供 PM 后续单点 review)

| 角色逻辑 | 文件:行 |
|---|---|
| 全部 role 字面值定义 | `backend/app/routers/team.py:103-105` |
| leader/admin/owner 等同集合 | `backend/app/auth.py:223` |
| Platform admin 白名单 helper | `backend/app/auth.py:488-505` |
| is_agent_manager (v26.5 分权核心) | `backend/app/auth.py:290-315` |
| can_write_kb / can_write_memory | `backend/app/auth.py:358-469` |
| 注册即 owner | `backend/app/routers/auth.py:215-232` |
| 创建会议 (auto 拦 member) | `backend/app/routers/meetings.py:100-114` |
| 创建 AI 守卫 | `backend/app/routers/agents.py:194` |
| KB 写守卫 | `backend/app/routers/knowledge.py:370-477` |
| 5 角色 demo seed | `backend/app/demo_seed.py:243-267` |
| FE role type | `frontend/src/lib/api.ts:1054-1060` |
| FE FULL_ADMIN_ROLES | `frontend/src/app/me/profile/layout.tsx:41` |
| v26.5 spec (历史) | `docs/v26.5-role-redesign-spec.md` |
