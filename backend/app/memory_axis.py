"""
v1.4.0 · Saga T5 (Phase 2 W3) · MemoryRadar 6 轴 keyword 分类.

设计稿 (mobile-screens.jsx MemoryRadar) 固定 6 个领域:
  数据洞察 / 产品策略 / UX 体验 / 法规合规 / 财务建模 / 客户体验

PM 决策 3 = 两阶段:
  - V1 (本 saga): keyword 匹配, 60-70% 准确
  - V1.5 (延后): LLM 聚类回填 (qwen-max)

ABAC: 本模块不依赖 workspace_id — 纯文本分类 helper, 不访问 DB.
"""

from __future__ import annotations

from typing import Optional


# 6 轴 → 关键词集合 (V1 keyword 匹配).
# 关键词覆盖业务面: 中文 + 英文 + 缩写 + 同义词.
# 命中最多 keyword 的轴 win. 多轴并列时按 AXES 顺序取第一个.
AXIS_KEYWORDS: dict[str, set[str]] = {
    "数据洞察": {
        "数据", "指标", "趋势", "kpi", "报表", "看板", "统计", "分析",
        "metric", "metrics", "dashboard", "数据看板", "数据分析", "数据中心",
        "数据洞察", "BI", "etl", "data", "insight",
    },
    "产品策略": {
        "路线图", "需求", "产品", "策略", "roadmap", "feature", "prd",
        "迭代", "上线", "产品规划", "产品策略", "需求文档", "feature flag",
        "用户故事", "user story", "spec", "规格", "路径",
    },
    "UX 体验": {
        "体验", "交互", "ux", "ui", "可用性", "用户测试", "原型", "易用",
        "界面", "视觉", "设计稿", "design", "wireframe", "mockup", "用户体验",
        "交互设计", "页面", "screen",
    },
    "法规合规": {
        "合规", "审查", "法律", "pii", "gdpr", "隐私", "条例", "审计",
        "整改", "法规合规", "数据安全", "敏感信息", "合规审查", "合规风险",
        "信息安全", "isms", "iso27001", "等保", "网安", "数安",
    },
    "财务建模": {
        "预算", "成本", "roi", "财务", "收入", "支出", "估算", "投资",
        "回报", "财务建模", "现金流", "p&l", "盈利", "亏损", "kpi 财务",
        "预测", "财务报表", "成本核算",
    },
    "客户体验": {
        "客户", "反馈", "投诉", "nps", "满意度", "服务", "客诉", "回访",
        "客户体验", "客户旅程", "用户反馈", "service", "support", "complaint",
        "客户成功", "cs",
    },
}

# 固定 axes 顺序 — 跟 SCHEMA-mobile-v2.md §4.3 + mobile-screens.jsx MemoryRadar 一致.
# 前端按 index 渲染 SVG 6 个顶点, 顺序不能漂.
AXES: list[str] = [
    "数据洞察",
    "产品策略",
    "UX 体验",
    "法规合规",
    "财务建模",
    "客户体验",
]


def classify_memory_to_axis(text: Optional[str]) -> Optional[str]:
    """根据 memory.content (或 title) keyword 匹配返回 axis_tag.

    Args:
        text: memory 文本内容 (content 优先, fallback 到 title 等).

    Returns:
        axis_tag (AXES 之一) 或 None (没命中任何 keyword).

    算法:
      1. text 转小写
      2. 对每个 axis 计算命中 keyword 数 (substring match)
      3. 取最高分; tie 时按 AXES 顺序取第一个
      4. 全 0 → 返 None (不归类)

    V1 准确率 ~60-70% (PM 已知). V1.5 LLM 聚类回填.
    """
    if not text or not text.strip():
        return None

    text_lower = text.lower()
    scores: dict[str, int] = {}
    for axis in AXES:
        kws = AXIS_KEYWORDS[axis]
        scores[axis] = sum(1 for kw in kws if kw.lower() in text_lower)

    # 取最高分 (按 AXES 顺序处理 tie)
    best_axis = None
    best_score = 0
    for axis in AXES:
        if scores[axis] > best_score:
            best_score = scores[axis]
            best_axis = axis

    return best_axis if best_score > 0 else None
