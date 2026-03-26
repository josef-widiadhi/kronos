"""
KRONOS PDF Parser
=================
Tries parsers in order of quality:

1. LiteParse (liteparse by run-llama)
   - Layout-aware spatial text extraction
   - Preserves columns, tables, bounding boxes
   - OCR fallback for scanned pages (needs Tesseract)
   - TypeScript/Node.js CLI called via subprocess
   - Install: npm install -g @llamaindex/liteparse

2. pypdf (fallback)
   - Fast, pure Python
   - OK for simple text PDFs, poor on columns/tables
   - Always available (in requirements.txt)

Usage:
    text = await parse_pdf(file_bytes, filename="report.pdf")
    text, method = await parse_pdf_with_meta(file_bytes)
"""

import io
import json
import logging
import tempfile
import asyncio
import subprocess
import shutil
from pathlib import Path
from typing import Tuple, Optional

logger = logging.getLogger("kronos.pdf_parser")


async def _try_liteparse(pdf_bytes: bytes, ocr: bool = False) -> Optional[str]:
    """
    Call `lit parse` CLI and return extracted text, or None if unavailable.
    LiteParse must be installed: npm install -g @llamaindex/liteparse
    """
    lit_bin = shutil.which("lit") or shutil.which("lit.cmd")  # lit.cmd on Windows
    if not lit_bin:
        logger.debug("LiteParse not found (lit CLI not in PATH)")
        return None

    with tempfile.TemporaryDirectory() as tmpdir:
        pdf_path = Path(tmpdir) / "input.pdf"
        out_path = Path(tmpdir) / "output.json"
        pdf_path.write_bytes(pdf_bytes)

        cmd = [
            lit_bin, "parse",
            str(pdf_path),
            "-o", str(out_path),
            "--format", "json",
            "--quiet",
        ]
        if ocr:
            cmd += ["--ocr-language", "en"]
        else:
            cmd += ["--no-ocr"]

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)

            if proc.returncode != 0:
                logger.warning(f"LiteParse exited {proc.returncode}: {stderr.decode()[:200]}")
                return None

            if out_path.exists():
                raw = json.loads(out_path.read_text(encoding="utf-8"))
                # LiteParse JSON output: {"pages": [{"text": "...", "pageNumber": 1}, ...]}
                pages = raw.get("pages", [])
                if pages:
                    return "\n\n".join(p.get("text", "") for p in pages).strip()

            # If no JSON file, check if text was printed to stdout
            text = stdout.decode("utf-8", errors="ignore").strip()
            return text if len(text) > 50 else None

        except asyncio.TimeoutError:
            logger.warning("LiteParse timed out (>120s)")
            return None
        except Exception as e:
            logger.warning(f"LiteParse error: {e}")
            return None


def _try_pypdf(pdf_bytes: bytes) -> Optional[str]:
    """Extract text with pypdf — fast but layout-blind."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages_text = []
        for page in reader.pages:
            t = page.extract_text() or ""
            if t.strip():
                pages_text.append(t)
        return "\n\n".join(pages_text).strip() or None
    except ImportError:
        logger.warning("pypdf not installed")
        return None
    except Exception as e:
        logger.warning(f"pypdf error: {e}")
        return None


async def parse_pdf(pdf_bytes: bytes, ocr: bool = False) -> str:
    """
    Parse PDF bytes to text using the best available parser.
    Returns extracted text (empty string if all parsers fail).
    """
    text, _ = await parse_pdf_with_meta(pdf_bytes, ocr=ocr)
    return text


async def parse_pdf_with_meta(pdf_bytes: bytes, ocr: bool = False) -> Tuple[str, str]:
    """
    Parse PDF and return (text, parser_used).
    parser_used is one of: "liteparse", "pypdf", "failed"
    """
    # Try LiteParse first
    text = await _try_liteparse(pdf_bytes, ocr=ocr)
    if text and len(text.split()) > 20:
        logger.info(f"PDF parsed with LiteParse: {len(text.split())} words")
        return text, "liteparse"

    # Fall back to pypdf
    text = _try_pypdf(pdf_bytes)
    if text and len(text.split()) > 5:
        logger.info(f"PDF parsed with pypdf: {len(text.split())} words")
        return text, "pypdf"

    logger.warning("All PDF parsers failed or returned empty text")
    return "", "failed"


def liteparse_available() -> bool:
    """Check if the `lit` CLI is available."""
    return bool(shutil.which("lit") or shutil.which("lit.cmd"))
