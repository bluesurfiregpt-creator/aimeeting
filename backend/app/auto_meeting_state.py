"""
v26.3-02 — Auto meeting (mode='auto') 状态机 transitions.

跟 v18 task_lifecycle (task 状态机) 同风格:
  1. 状态枚举 + 合法 transitions 字典
  2. transition(action, current_phase) → new_phase 或 raise
  3. helper: 安全更新 meeting.auto_state.phase

被 auto_meeting_orchestrator 和 召集人 control endpoints 共用:
  - orchestrator 内部: idle → running, running → consensus_wait,
                       consensus_wait → running (review resolved),
                       running → done, * → failed
  - leader endpoints:  running → paused, paused → running, * → cancelled

# 状态语义

  idle                刚创建 mode=auto 会议,worker 还没启动
  running             orchestrator 正在跑议程项
  paused              召集人手动暂停;不主动推进,但保持上下文
  consensus_wait      v26.3 Q3 选 D 后此状态不再阻塞议程(批量裁决会后做),
                      留 status 供 v26.3.1 选 E (打断式) 时启用
  done                所有议程项跑完,meeting.status='finished' 触发 finalize
  failed              orchestrator 不可恢复错误 (LLM 总挂 / DB 写不进)
  cancelled           召集人主动取消;不再恢复

# 调用方:
    new_phase = transition_phase(AUTO_ACTION_START, current_phase)
    if new_phase is None:  # 非法 transition
        raise HTTPException(409, "phase X 不能 action Y")
    meeting.auto_state["phase"] = new_phase
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional, Set


# ---- 阶段(phase)枚举 ------------------------------------------------------

PHASE_IDLE = "idle"
PHASE_RUNNING = "running"
PHASE_PAUSED = "paused"
PHASE_CONSENSUS_WAIT = "consensus_wait"   # 预留 v26.3.1 选项 E (打断式裁决)
PHASE_DONE = "done"
PHASE_FAILED = "failed"
PHASE_CANCELLED = "cancelled"

ALL_PHASES: Set[str] = {
    PHASE_IDLE, PHASE_RUNNING, PHASE_PAUSED, PHASE_CONSENSUS_WAIT,
    PHASE_DONE, PHASE_FAILED, PHASE_CANCELLED,
}

# 终态(不可再切)
TERMINAL_PHASES: Set[str] = {PHASE_DONE, PHASE_FAILED, PHASE_CANCELLED}


# ---- 动作枚举 ---------------------------------------------------------------

AUTO_ACTION_START = "start"            # orchestrator 启动
AUTO_ACTION_PAUSE = "pause"            # leader 暂停
AUTO_ACTION_RESUME = "resume"          # leader 恢复
AUTO_ACTION_DISSENT_WAIT = "dissent_wait"     # v26.3.1 预留:进入 consensus_wait
AUTO_ACTION_DISSENT_RESOLVE = "dissent_resolve"  # v26.3.1 预留:出 consensus_wait
AUTO_ACTION_COMPLETE = "complete"      # 所有议程跑完
AUTO_ACTION_FAIL = "fail"              # 不可恢复错误
AUTO_ACTION_CANCEL = "cancel"          # leader 主动取消


# ---- 合法 transitions ------------------------------------------------------

# key: action;value: {from_phase: to_phase}
_TRANSITIONS: dict[str, dict[str, str]] = {
    AUTO_ACTION_START: {
        PHASE_IDLE: PHASE_RUNNING,
    },
    AUTO_ACTION_PAUSE: {
        PHASE_RUNNING: PHASE_PAUSED,
    },
    AUTO_ACTION_RESUME: {
        PHASE_PAUSED: PHASE_RUNNING,
    },
    AUTO_ACTION_DISSENT_WAIT: {
        PHASE_RUNNING: PHASE_CONSENSUS_WAIT,
    },
    AUTO_ACTION_DISSENT_RESOLVE: {
        PHASE_CONSENSUS_WAIT: PHASE_RUNNING,
    },
    AUTO_ACTION_COMPLETE: {
        PHASE_RUNNING: PHASE_DONE,
        PHASE_CONSENSUS_WAIT: PHASE_DONE,   # consensus_wait 也可直接完成
    },
    AUTO_ACTION_FAIL: {
        # 任何 非终态 都可挂掉
        PHASE_IDLE: PHASE_FAILED,
        PHASE_RUNNING: PHASE_FAILED,
        PHASE_PAUSED: PHASE_FAILED,
        PHASE_CONSENSUS_WAIT: PHASE_FAILED,
    },
    AUTO_ACTION_CANCEL: {
        PHASE_IDLE: PHASE_CANCELLED,
        PHASE_RUNNING: PHASE_CANCELLED,
        PHASE_PAUSED: PHASE_CANCELLED,
        PHASE_CONSENSUS_WAIT: PHASE_CANCELLED,
    },
}


class IllegalPhaseTransition(Exception):
    """非法状态转换 — caller 应该 raise HTTPException(409) 或 log + skip."""
    def __init__(self, action: str, from_phase: str):
        self.action = action
        self.from_phase = from_phase
        super().__init__(
            f"auto meeting phase '{from_phase}' 不允许 action '{action}'"
        )


# ---- transition 主函数 ----------------------------------------------------


def transition_phase(action: str, from_phase: str) -> str:
    """
    返回新 phase.非法 transition → IllegalPhaseTransition.

    用法:
        try:
            new_phase = transition_phase(AUTO_ACTION_PAUSE, current_phase)
        except IllegalPhaseTransition as e:
            raise HTTPException(409, str(e))
        meeting.auto_state = {**(meeting.auto_state or {}), 'phase': new_phase}
    """
    if action not in _TRANSITIONS:
        raise IllegalPhaseTransition(action, from_phase)
    transitions_for_action = _TRANSITIONS[action]
    if from_phase not in transitions_for_action:
        raise IllegalPhaseTransition(action, from_phase)
    return transitions_for_action[from_phase]


# ---- auto_state helpers ----------------------------------------------------


def default_auto_state() -> dict[str, Any]:
    """新建 mode='auto' meeting 时的初始 auto_state."""
    return {
        "phase": PHASE_IDLE,
        "current_agenda_idx": 0,
        "current_speaker_agent_id": None,
        "started_at": None,
        "paused_at": None,
        "paused_by_user_id": None,
        "turn_count": 0,
        "dissent_count": 0,
        "last_error": None,
    }


def get_phase(meeting_auto_state: Optional[dict[str, Any]]) -> str:
    """安全取 phase.缺字段 → idle."""
    if not isinstance(meeting_auto_state, dict):
        return PHASE_IDLE
    p = meeting_auto_state.get("phase")
    return p if isinstance(p, str) and p in ALL_PHASES else PHASE_IDLE


def is_terminal(phase: str) -> bool:
    return phase in TERMINAL_PHASES


def apply_transition(
    meeting_auto_state: Optional[dict[str, Any]],
    action: str,
    *,
    actor_user_id: Optional[str] = None,
    extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    返回 新 auto_state dict(深拷贝).非法 transition raise.

    side effects:
      - phase 更新
      - action=start: started_at = now
      - action=pause: paused_at + paused_by_user_id
      - action=resume: paused_at + paused_by_user_id 清空
      - action=fail: last_error 从 extra['error'] 取
    """
    current = get_phase(meeting_auto_state)
    new_phase = transition_phase(action, current)

    base = dict(meeting_auto_state) if isinstance(meeting_auto_state, dict) else default_auto_state()
    base["phase"] = new_phase
    now_iso = datetime.now(timezone.utc).isoformat()

    if action == AUTO_ACTION_START:
        base["started_at"] = now_iso
    elif action == AUTO_ACTION_PAUSE:
        base["paused_at"] = now_iso
        if actor_user_id:
            base["paused_by_user_id"] = actor_user_id
    elif action == AUTO_ACTION_RESUME:
        base["paused_at"] = None
        base["paused_by_user_id"] = None
    elif action == AUTO_ACTION_FAIL:
        if extra and "error" in extra:
            base["last_error"] = str(extra["error"])[:500]

    if extra:
        # 允许 caller 额外注入(比如 current_agenda_idx 推进)
        for k, v in extra.items():
            if k == "error":
                continue
            base[k] = v

    return base
