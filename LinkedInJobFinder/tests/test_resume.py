from pathlib import Path

from linkedin_finder.resume import _extract_name, parse_resume


def test_extract_name_simple():
    assert _extract_name("Kush Mehta\nSoftware Engineer\nkush@example.com") == "Kush Mehta"


def test_extract_name_skips_header():
    assert _extract_name("Resume\nKush Mehta\n") == "Kush Mehta"


def test_extract_name_returns_none_when_unclear():
    assert _extract_name("software engineer\n123 Main St\n") is None


def test_parse_text_file(tmp_path: Path):
    p = tmp_path / "r.txt"
    p.write_text("Jane Doe\nSoftware Engineer\nPython, Go, SQL\n")
    r = parse_resume(p)
    assert r.name == "Jane Doe"
    assert "Python" in r.text
