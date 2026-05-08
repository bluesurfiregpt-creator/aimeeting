"""
v18 — Task 状态机 + 转换合法性 + ActionItem 状态镜像。

设计目标:
  1. **单一真相源**:`_ALLOWED_TRANSITIONS` 是合法转换的唯一定义,
     新增动作时改这一处。
  2. **拒绝非法转换**:`assert_transition()` 在 router 入口处把守,
     非法转换返回 422 而不是 500。
  3. **ActionItem 镜像**:Task 经过 `dispatched / accepted / in_progress`
     时,旧 UI(ActionItemsCard / 简报跨会议跟进)看到的还是 'open',
     这样 v18 上线后 v16/v17 的所有读路径继续工作。

每个动作 (action) 对应一组 (from_status → to_status) + 该动作要做的副作用
(stamp 时间戳、写 audit、发通知等)。本模块只管「能不能转」+「转过去
status 应该是什么」+「ActionItem 应该镜像成什么」;副作用由 router 写。
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException


# 动作枚举 — 和 router 端点一一对应。
TASK_ACTION_DISPATCH = "dispatch"
TASK_ACTION_ACCEPT = "accept"
TASK_ACTION_RETURN = "return"
TASK_ACTION_START = "start"
TASK_ACTION_COMPLETE = "complete"
TASK_ACTION_CANCEL = "cancel"

# 直接 status 修改(legacy 兼容,v17 ActionItem PATCH 走的就是这个)
TASK_ACTION_LEGACY_PATCH = "legacy_patch"


# (action, from_status) → to_status
# return 的目标 status 是 'open' 且会清空 assignee — 由 router 处理 assignee 重置
_ALLOWED_TRANSITIONS: dict[tuple[str, str], str] = {
    # 派发:open → dispatched(必须有 assignee_user_id)
    (TASK_ACTION_DISPATCH, "open"): "dispatched",

    # 签收:dispatched → accepted(只能由 assignee 触发)
    (TASK_ACTION_ACCEPT, "dispatched"): "accepted",

    # 退回:dispatched → open(清空 assignee + 记原因)
    (TASK_ACTION_RETURN, "dispatched"): "open",

    # 开始办理:accepted → in_progress(隐式时,任何 assignee 行为都可触发)
    (TASK_ACTION_START, "accepted"): "in_progress",
    # 兼容跳过签收的快速场景:open → in_progress(legacy 直跳)
    # 我们允许这个是为了 v17 ActionItem PATCH 直接 status='done' 的场景
    # 不会被状态机阻断 — 见 LEGACY_PATCH。

    # 办结:in_progress → done
    (TASK_ACTION_COMPLETE, "in_progress"): "done",
    # 兼容:open / accepted → done(legacy patch 或一键完成)
    (TASK_ACTION_COMPLETE, "open"): "done",
    (TASK_ACTION_COMPLETE, "accepted"): "done",

    # 取消:任何活跃态都可以取消
    (TASK_ACTION_CANCEL, "open"): "cancelled",
    (TASK_ACTION_CANCEL, "dispatched"): "cancelled",
    (TASK_ACTION_CANCEL, "accepted"): "cancelled",
    (TASK_ACTION_CANCEL, "in_progress"): "cancelled",
}


# v17 ActionItem PATCH 的 status 直跳合法集 — legacy 兼容,不强制走完整状态机
_LEGACY_DIRECT_STATUSES = frozenset({"open", "done", "cancelled"})


def transition(action: str, from_status: str) -> str:
    """
    返回从 `from_status` 经过 `action` 后的 to_status。
    非法转换抛 HTTPException(422)。
    """
    key = (action, from_status)
    if key not in _ALLOWED_TRANSITIONS:
        raise HTTPException(
            422,
            f"task transition '{action}' not allowed from status '{from_status}'",
        )
    return _ALLOWED_TRANSITIONS[key]


def is_legacy_direct_status(status: str) -> bool:
    """v17 ActionItem PATCH 用的状态值集合,用于 status 直跳兼容路径。"""
    return status in _LEGACY_DIRECT_STATUSES


# Task.status → ActionItem.status 的镜像表。新状态(dispatched / accepted /
# in_progress)在 ActionItem 一侧统一映射成 'open',这样 v17 的所有 UI / 简报 /
# Y 系列测试不用动。
_TASK_TO_ACTION_STATUS: dict[str, str] = {
    "open": "open",
    "dispatched": "open",
    "accepted": "open",
    "in_progress": "open",
    "done": "done",
    "cancelled": "cancelled",
    # v19 占位:submitted (上报办结申请) 也镜像为 'open' — 它本质上还是
    # 「assignee 把球踢回去等审核」,从用户感知上仍未关闭
    "submitted": "open",
    # v19+: archived 镜像为 done(归档后行动项视图也只是已完成的归档)
    "archived": "done",
}


def mirror_to_action_status(task_status: str) -> str:
    """
    把 Task.status 翻译成对应的 ActionItem.status。Task 引入新状态时
    这里加一行,旧的 ActionItem UI 完全不用改。
    """
    return _TASK_TO_ACTION_STATUS.get(task_status, "open")
