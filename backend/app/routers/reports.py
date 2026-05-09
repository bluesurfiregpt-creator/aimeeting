"""
v23 — 报表导出 (Excel only).

设计哲学:
- 政务用户拿到报表后会自己改表头 / 着色 / 挑数据 → Excel 优于 PDF (灵活)
- 后端用 openpyxl 生成 (已经在依赖里 — KB 文档解析也用)
- 表头加粗 + 冻结首行,基本可读
- 文件名带时间戳防覆盖

输出:
  /api/reports/monthly-evaluation?period=YYYY-MM
    → 月度 4 维评价表(全员一行一份),含 完成率/及时率/质量/协作/综合
  /api/reports/status-distribution?days=30
    → 末 N 天状态分布趋势(每天一行,各状态计数)
"""

from __future__ import annotations

import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import AuthContext, get_current_auth, require_leader_or_admin
from ..db import get_session
from ..models import Task, TaskEvaluation, User

router = APIRouter(prefix="/api/reports", tags=["reports"])
logger = logging.getLogger(__name__)

# Excel content-type & 中文文件名 (RFC 5987)
_XLSX_CT = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


def _xlsx_response(wb: Workbook, filename: str) -> StreamingResponse:
    """openpyxl Workbook → StreamingResponse (utf-8 文件名).

    Starlette 把 headers 强制 encode 成 latin-1,所以裸中文 filename 会爆
    UnicodeEncodeError.正确做法:
      - `filename=` 段必须 ASCII 安全(给老浏览器看)
      - `filename*=UTF-8''<percent-encoded>` 段给 modern 浏览器(RFC 5987),
        decode 后才是真正的中文文件名

    实测 Chrome / Edge / Firefox / Safari 都优先取 filename*= 后呈现.
    """
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    from urllib.parse import quote

    encoded = quote(filename)
    # ASCII fallback — 把所有非 ASCII 字符替换成下划线,保证 latin-1 可编码
    ascii_fallback = filename.encode("ascii", errors="replace").decode("ascii").replace("?", "_")
    return StreamingResponse(
        buf,
        media_type=_XLSX_CT,
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{ascii_fallback}\"; "
                f"filename*=UTF-8''{encoded}"
            ),
        },
    )


# ---- 月度评价导出 ----------------------------------------------------------


_HEADER_FILL = PatternFill(start_color="FF1F2430", end_color="FF1F2430", fill_type="solid")
_HEADER_FONT = Font(bold=True, color="FFFFFFFF")
_CENTER = Alignment(horizontal="center", vertical="center")


def _autosize_columns(ws, max_width: int = 40) -> None:
    """简易列宽自适应 — openpyxl 没有 auto-fit,用最长字符数估算."""
    for col_cells in ws.columns:
        col_letter = get_column_letter(col_cells[0].column)
        max_len = max(
            (len(str(c.value)) for c in col_cells if c.value is not None),
            default=0,
        )
        ws.column_dimensions[col_letter].width = min(max_len + 4, max_width)


@router.get("/monthly-evaluation")
async def monthly_evaluation_xlsx(
    period: Optional[str] = Query(
        None, regex=r"^\d{4}-\d{2}$", description="YYYY-MM,默认本月"
    ),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v23: 月度 4 维评价导出 (Excel).
    leader/admin only — 个人和 expert 看自己的就够,不需要全员表.
    """
    await require_leader_or_admin(session, auth)
    p = period or datetime.now(timezone.utc).strftime("%Y-%m")

    rows = (
        await session.execute(
            select(TaskEvaluation, User)
            .join(User, User.id == TaskEvaluation.assignee_user_id)
            .where(
                TaskEvaluation.workspace_id == auth.workspace.id,
                TaskEvaluation.period == p,
            )
            .order_by(
                (
                    TaskEvaluation.completion_rate * 0.3
                    + TaskEvaluation.on_time_rate * 0.3
                    + TaskEvaluation.quality_score * 0.2
                    + TaskEvaluation.collaboration_score * 0.2
                ).desc()
            )
        )
    ).all()

    wb = Workbook()
    ws = wb.active
    ws.title = f"{p} 月度评价"

    # 顶部 meta(merge cells)
    ws.cell(row=1, column=1, value=f"工作空间:{auth.workspace.name}").font = Font(bold=True)
    ws.cell(row=2, column=1, value=f"周期:{p}")
    ws.cell(row=3, column=1, value=f"导出时间:{datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d %H:%M')}")
    ws.cell(
        row=4,
        column=1,
        value="综合分 = 完成率 ×30% + 及时率 ×30% + 质量 ×20% + 协作 ×20%",
    ).font = Font(italic=True, color="888888")

    # 表头(第 6 行)
    headers = [
        "排名", "姓名", "完成率", "及时率", "质量分", "协作分",
        "综合分", "本月分配", "本月完成", "本月超期",
    ]
    header_row = 6
    for col, h in enumerate(headers, start=1):
        c = ws.cell(row=header_row, column=col, value=h)
        c.font = _HEADER_FONT
        c.fill = _HEADER_FILL
        c.alignment = _CENTER

    # 数据行
    for i, (e, u) in enumerate(rows, start=1):
        composite = round(
            e.completion_rate * 0.3
            + e.on_time_rate * 0.3
            + e.quality_score * 0.2
            + e.collaboration_score * 0.2,
            3,
        )
        ws.cell(row=header_row + i, column=1, value=i)
        ws.cell(row=header_row + i, column=2, value=u.name)
        ws.cell(row=header_row + i, column=3, value=round(e.completion_rate, 3))
        ws.cell(row=header_row + i, column=4, value=round(e.on_time_rate, 3))
        ws.cell(row=header_row + i, column=5, value=round(e.quality_score, 3))
        ws.cell(row=header_row + i, column=6, value=round(e.collaboration_score, 3))
        ws.cell(row=header_row + i, column=7, value=composite)
        ws.cell(row=header_row + i, column=8, value=e.total_assigned or 0)
        ws.cell(row=header_row + i, column=9, value=e.total_done or 0)
        ws.cell(row=header_row + i, column=10, value=e.total_overdue or 0)

    # 数值列百分比格式
    for col in range(3, 8):
        for r in range(header_row + 1, header_row + 1 + len(rows)):
            cell = ws.cell(row=r, column=col)
            cell.number_format = "0.0%"

    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)
    _autosize_columns(ws)

    fname = f"月度评价_{auth.workspace.name}_{p}_{datetime.now().strftime('%Y%m%d-%H%M')}.xlsx"
    return _xlsx_response(wb, fname)


# ---- 状态分布趋势导出 -----------------------------------------------------


@router.get("/status-distribution")
async def status_distribution_xlsx(
    days: int = Query(30, ge=7, le=180),
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_current_auth),
):
    """
    v23: 末 N 天状态分布趋势导出 (Excel,leader/admin only).

    每行一天,各状态计数 + 当天创建数 + 当天完成数.
    便于看「这 X 天积压有没有改善」.
    """
    await require_leader_or_admin(session, auth)
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)

    # 按 (date, status) 聚合 created
    created_rows = (
        await session.execute(
            select(
                func.date(Task.created_at).label("d"),
                Task.status,
                func.count(Task.id),
            )
            .where(
                Task.workspace_id == auth.workspace.id,
                Task.created_at >= start,
            )
            .group_by("d", Task.status)
            .order_by("d")
        )
    ).all()
    # 每天 done 计数(updated_at 为终结时间)
    done_rows = (
        await session.execute(
            select(
                func.date(Task.updated_at).label("d"),
                func.count(Task.id),
            )
            .where(
                Task.workspace_id == auth.workspace.id,
                Task.status == "done",
                Task.updated_at >= start,
            )
            .group_by("d")
            .order_by("d")
        )
    ).all()

    # 索引化
    created_by_day_status: dict[str, dict[str, int]] = {}
    for d, s, n in created_rows:
        created_by_day_status.setdefault(str(d), {})[s] = int(n)
    done_by_day = {str(d): int(n) for d, n in done_rows}

    wb = Workbook()
    ws = wb.active
    ws.title = f"末 {days} 天状态分布"

    ws.cell(row=1, column=1, value=f"工作空间:{auth.workspace.name}").font = Font(bold=True)
    ws.cell(row=2, column=1, value=f"区间:近 {days} 天")
    ws.cell(row=3, column=1, value=f"导出时间:{now.astimezone().strftime('%Y-%m-%d %H:%M')}")

    statuses = ["open", "dispatched", "accepted", "in_progress", "submitted", "done", "archived", "cancelled"]
    cn_status = {
        "open": "未派发", "dispatched": "待签收", "accepted": "已签收",
        "in_progress": "办理中", "submitted": "待审核", "done": "已完成",
        "archived": "已归档", "cancelled": "已取消",
    }

    headers = ["日期", *[cn_status[s] for s in statuses], "当日新建总数", "当日完成数"]
    header_row = 5
    for col, h in enumerate(headers, start=1):
        c = ws.cell(row=header_row, column=col, value=h)
        c.font = _HEADER_FONT
        c.fill = _HEADER_FILL
        c.alignment = _CENTER

    # 把 N 天每天填齐
    for i in range(days, -1, -1):
        d_iso = (now - timedelta(days=i)).date().isoformat()
        row_idx = header_row + (days - i) + 1
        ws.cell(row=row_idx, column=1, value=d_iso)
        per_status = created_by_day_status.get(d_iso, {})
        total_created = 0
        for j, s in enumerate(statuses, start=2):
            n = per_status.get(s, 0)
            total_created += n
            ws.cell(row=row_idx, column=j, value=n)
        ws.cell(row=row_idx, column=2 + len(statuses), value=total_created)
        ws.cell(row=row_idx, column=3 + len(statuses), value=done_by_day.get(d_iso, 0))

    ws.freeze_panes = ws.cell(row=header_row + 1, column=2)
    _autosize_columns(ws)

    fname = f"状态分布_{auth.workspace.name}_近{days}天_{now.strftime('%Y%m%d-%H%M')}.xlsx"
    return _xlsx_response(wb, fname)
