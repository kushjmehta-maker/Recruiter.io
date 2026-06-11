"""Resume parsing: PDF / DOCX / MD / TEX / TXT -> plain text + extracted name.

Used by:
- ranking.py (pass full resume text to Haiku for fit-scoring)
- drafting.py (pass full resume + job description to Sonnet for outreach)
- session login check (compare extracted name to LinkedIn profile name)
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Resume:
    path: Path
    text: str
    name: str | None


def _read_pdf(path: Path) -> str:
    import pdfplumber
    parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    return "\n".join(parts)


def _read_docx(path: Path) -> str:
    import docx
    doc = docx.Document(str(path))
    return "\n".join(p.text for p in doc.paragraphs)


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def parse_resume(path: Path) -> Resume:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        text = _read_pdf(path)
    elif suffix == ".docx":
        text = _read_docx(path)
    elif suffix in {".md", ".tex", ".txt"}:
        text = _read_text(path)
    else:
        raise ValueError(f"unsupported resume format: {suffix}")

    return Resume(path=path, text=text, name=_extract_name(text))


def _extract_name(text: str) -> str | None:
    """Heuristic: first non-empty line that looks like a person name.

    A name is 2-4 capitalized words, no digits, no email, no obvious headers.
    """
    SKIP_TOKENS = {"resume", "curriculum", "cv", "vitae"}
    for raw_line in text.splitlines()[:20]:
        line = raw_line.strip()
        if not line or len(line) > 80:
            continue
        if "@" in line or any(ch.isdigit() for ch in line):
            continue
        if line.lower() in SKIP_TOKENS:
            continue
        words = line.split()
        if not (2 <= len(words) <= 4):
            continue
        if all(re.match(r"^[A-Z][a-zA-Z'\-]+$", w) for w in words):
            return line
    return None


def find_resume(resumes_dir: Path, preferred_filename: str | None = None) -> Resume | None:
    """Pick the resume to use. If preferred_filename is set, use that.
    Otherwise, take the first non-README file in resumes_dir.
    """
    if preferred_filename:
        candidate = resumes_dir / preferred_filename
        if candidate.exists():
            return parse_resume(candidate)

    for p in sorted(resumes_dir.glob("*")):
        if p.name == "README.md" or p.name == "search_profile.md":
            continue
        if p.suffix.lower() in {".pdf", ".docx", ".md", ".tex", ".txt"}:
            return parse_resume(p)
    return None


def find_search_profile(resumes_dir: Path) -> str:
    """Return the search_profile.md text, or empty string."""
    p = resumes_dir / "search_profile.md"
    return p.read_text(encoding="utf-8") if p.exists() else ""
