from linkedin_finder.drafting import _enforce_tone_rules, _fallback_template


def test_em_dash_stripped():
    out = _enforce_tone_rules("Hi — there")
    assert "—" not in out
    assert "," in out


def test_quotes_stripped():
    assert _enforce_tone_rules('"Hi there"') == "Hi there"


def test_fallback_recruiter_format():
    msg = _fallback_template("Kush", "Jane Doe", "Software Engineer", "Anthropic", is_recruiter=True)
    assert msg.startswith("Hi Jane,")
    assert "Software Engineer" in msg
    assert "Anthropic" in msg
    assert msg.endswith("Thanks, Kush")
    assert "—" not in msg


def test_fallback_peer_uses_if_it_feels_right():
    msg = _fallback_template("Kush", "Bob Smith", "Backend Engineer", "Stripe", is_recruiter=False)
    assert "if it feels right" in msg
