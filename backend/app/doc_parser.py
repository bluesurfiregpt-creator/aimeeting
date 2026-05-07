"""
Document text extractor.

Inputs: filename + raw bytes. Output: a single plaintext string.

Format coverage for Sprint I:
- pdf  : pypdf (fast, lightweight, no system deps)
- docx : python-docx
- xlsx : openpyxl, joining each row's cells with tab + newline between rows
- txt / md / text-shaped extensions : decode as UTF-8 (with fallback)

Anything else → ValueError so the caller can mark the document failed.
"""

from __future__ import annotations

import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)


SUPPORTED_EXTENSIONS = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".xlsx": "xlsx",
    ".xls": "xlsx",
    ".txt": "text",
    ".md": "text",
    ".markdown": "text",
    ".text": "text",
    ".csv": "text",
    ".log": "text",
    ".json": "text",
    ".yaml": "text",
    ".yml": "text",
}


def kind_from_filename(filename: str) -> Optional[str]:
    name = (filename or "").lower()
    for ext, kind in SUPPORTED_EXTENSIONS.items():
        if name.endswith(ext):
            return kind
    return None


def extract_text(filename: str, content: bytes) -> str:
    kind = kind_from_filename(filename)
    if kind is None:
        raise ValueError(f"unsupported file type: {filename}")
    if kind == "pdf":
        return _extract_pdf(content)
    if kind == "docx":
        return _extract_docx(content)
    if kind == "xlsx":
        return _extract_xlsx(content)
    if kind == "text":
        return _decode_text(content)
    raise ValueError(f"unhandled kind: {kind}")


def _decode_text(content: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gb18030", "gbk", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    # Last resort
    return content.decode("utf-8", errors="replace")


def _extract_pdf(content: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(content))
    parts: list[str] = []
    for i, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            logger.exception("pdf page %d extraction failed", i)
            text = ""
        if text.strip():
            parts.append(text)
    return "\n\n".join(parts)


def _extract_docx(content: bytes) -> str:
    from docx import Document  # python-docx

    doc = Document(io.BytesIO(content))
    parts: list[str] = []
    # Body paragraphs
    for p in doc.paragraphs:
        if p.text and p.text.strip():
            parts.append(p.text)
    # Tables (joined cell text per row, tab-separated)
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text]
            if cells:
                parts.append("\t".join(cells))
    return "\n".join(parts)


def _extract_xlsx(content: bytes) -> str:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    parts: list[str] = []
    for sheet in wb.worksheets:
        parts.append(f"### {sheet.title}")
        for row in sheet.iter_rows(values_only=True):
            cells = ["" if v is None else str(v).strip() for v in row]
            # Skip rows that are all empty
            if any(c for c in cells):
                parts.append("\t".join(cells))
        parts.append("")
    return "\n".join(parts)
