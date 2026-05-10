"""
v25-2 — OCR 文本抽取(Qwen-VL-Plus 多模态).

智慧住建文档 §3.1 知识消化:政务大量历史文档是扫描件 PDF / 拍照,
传统 pypdf 抽不出文字 → Agent 知识库永远空.

实现:
  - 图片 → 直接调 Qwen-VL-Plus 提取文字
  - 扫描件 PDF → pypdfium2 把每页 render 成 PNG → 逐页 OCR → 拼接
  - 用户已有 DASHSCOPE_API_KEY,无需新接 OCR provider

成本估算(qwen-vl-plus 通过 DashScope OpenAI 兼容):
  - 输入:每张图 ~ 1k vision tokens + 100 text tokens
  - 输出:每页 ~ 500-1500 tokens(中文)
  - 单价 ¥0.008/千 token(2026 年价格)
  - 每张扫描页 ≈ ¥0.01-0.02

限制:
  - PDF 最多 OCR 30 页(防止恶意上传 1000 页扫描书稿烧 token)
  - 单张图片 max 10MB
  - 超时 60s/页

Fallback:OCR 失败 → 返回空字符串(让 caller 决定 mark failed 还是显示提示)
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
from typing import Optional

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)


# Qwen-VL-Plus(多模态)— 性价比最优,中文 OCR 准确率高
OCR_MODEL = "qwen-vl-plus"
DASHSCOPE_OPENAI_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
OCR_TIMEOUT_SECONDS = 60.0
OCR_MAX_PDF_PAGES = 30
OCR_MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10MB

# 图片格式 → MIME (用于 data URL)
IMAGE_MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

OCR_PROMPT = (
    "请把图片中的所有文字按原排版顺序提取出来,只输出文字内容,不要解释,"
    "不要补充缺失内容,不要 markdown 标记.如果没有文字,只回复\"(无文字)\"."
)


class OCRError(RuntimeError):
    """OCR 失败 — 包括:DSN 缺失、API 超时、HTTP 4xx/5xx、空响应."""


def is_image_extension(filename: str) -> bool:
    name = (filename or "").lower()
    return any(name.endswith(ext) for ext in IMAGE_MIME_BY_EXT)


def image_mime_for_filename(filename: str) -> str:
    name = (filename or "").lower()
    for ext, mime in IMAGE_MIME_BY_EXT.items():
        if name.endswith(ext):
            return mime
    return "image/jpeg"  # default


async def ocr_image(
    image_bytes: bytes,
    *,
    mime_type: str = "image/jpeg",
    page_label: Optional[str] = None,
) -> str:
    """
    单张图片 OCR.返回提取的文字(可能空).出错抛 OCRError.

    page_label:供日志识别(如 "PDF page 3").
    """
    settings = get_settings()
    if not settings.dashscope_api_key:
        raise OCRError("DASHSCOPE_API_KEY 未配置 — OCR 不可用")
    if not image_bytes:
        return ""
    if len(image_bytes) > OCR_MAX_IMAGE_BYTES:
        raise OCRError(
            f"图片过大 {len(image_bytes)} bytes > {OCR_MAX_IMAGE_BYTES} bytes"
        )

    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{b64}"

    body = {
        "model": OCR_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": OCR_PROMPT},
                ],
            }
        ],
    }
    headers = {
        "Authorization": f"Bearer {settings.dashscope_api_key.strip()}",
        "Content-Type": "application/json",
    }

    label = page_label or "image"
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(OCR_TIMEOUT_SECONDS, connect=10.0)
        ) as c:
            r = await c.post(
                f"{DASHSCOPE_OPENAI_BASE}/chat/completions",
                headers=headers,
                json=body,
            )
    except httpx.TimeoutException as e:
        raise OCRError(f"OCR 超时({label}): {e}") from e
    except httpx.HTTPError as e:
        raise OCRError(f"OCR 网络错误({label}): {e}") from e

    if r.status_code >= 400:
        raise OCRError(f"OCR HTTP {r.status_code}({label}): {r.text[:300]}")

    try:
        data = r.json()
        text = data["choices"][0]["message"]["content"] or ""
    except Exception as e:
        raise OCRError(f"OCR 响应解析失败({label}): {e}") from e

    if isinstance(text, list):
        # 某些多模态返回 content list,合并成字符串
        text = "".join(
            (item.get("text", "") if isinstance(item, dict) else str(item))
            for item in text
        )
    text = (text or "").strip()
    if text == "(无文字)":
        return ""
    return text


async def ocr_pdf_via_render(
    pdf_bytes: bytes,
    *,
    max_pages: int = OCR_MAX_PDF_PAGES,
    render_scale: float = 2.0,
) -> str:
    """
    扫描件 PDF → 每页 render 成 PNG → 逐页 OCR → 用 \\n\\n--- 分隔拼接.

    render_scale=2.0 ≈ 144 DPI(原 PDF 默认 72 DPI 翻倍),适合识别小字.
    Higher 更清但 token 数线性增长.

    出错抛 OCRError(任一页失败都中断,因为 OCR 烧 token,不希望部分成功
    给用户错觉).
    """
    try:
        import pypdfium2 as pdfium
    except ImportError as e:
        raise OCRError(f"pypdfium2 未安装: {e}") from e

    try:
        doc = pdfium.PdfDocument(pdf_bytes)
    except Exception as e:
        raise OCRError(f"PDF 打开失败(可能损坏 / 加密): {e}") from e

    n_pages = min(len(doc), max_pages)
    if n_pages == 0:
        return ""

    page_texts: list[str] = []
    for i in range(n_pages):
        page = doc[i]
        try:
            pil_image = page.render(scale=render_scale).to_pil()
        except Exception as e:
            raise OCRError(f"PDF 第 {i+1} 页 render 失败: {e}") from e

        buf = io.BytesIO()
        pil_image.save(buf, format="PNG")
        png_bytes = buf.getvalue()

        text = await ocr_image(
            png_bytes,
            mime_type="image/png",
            page_label=f"PDF page {i+1}",
        )
        if text:
            page_texts.append(f"## 第 {i+1} 页\n\n{text}")

    if len(doc) > max_pages:
        page_texts.append(
            f"\n\n_(剩余 {len(doc) - max_pages} 页未 OCR — "
            f"超过本系统 {max_pages} 页/文件 上限,如需处理请拆分文件)_"
        )

    return "\n\n---\n\n".join(page_texts)


async def maybe_ocr_pdf_if_empty(
    extracted_text: str,
    pdf_bytes: bytes,
    *,
    min_chars_threshold: int = 30,
) -> tuple[str, bool]:
    """
    给定 pypdf 抽出的文本,如果文本量 < 阈值,认为是扫描件,触发 OCR.

    返回 (final_text, ocr_used).ocr_used=True 时 final_text 是 OCR 结果.
    OCR 失败时返回 (extracted_text, False) — 不破坏 pypdf 已抽到的内容.
    """
    if extracted_text and len(extracted_text.strip()) >= min_chars_threshold:
        return extracted_text, False
    try:
        ocr_text = await ocr_pdf_via_render(pdf_bytes)
        if ocr_text and ocr_text.strip():
            return ocr_text, True
    except OCRError as e:
        logger.warning("OCR fallback 失败: %s", e)
    return extracted_text, False
