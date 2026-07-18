"""Loads reason_codes.md and slices out the section for a given reason code.

We parse the rules file once and pass only the relevant section to the LLM —
the analyst pain point is "re-reading the scheme rules", so the tool does the
lookup deterministically rather than asking the model to search the whole file.
"""
from __future__ import annotations

import re
from functools import lru_cache

from . import config


@lru_cache(maxsize=1)
def _load_sections() -> dict[str, str]:
    """Split reason_codes.md into sections keyed by heading text (lowercased)."""
    text = config.REASON_CODES_FILE.read_text()
    sections: dict[str, str] = {}
    current_key = None
    current_lines: list[str] = []
    for line in text.splitlines():
        if re.match(r"^#{1,4}\s", line):
            if current_key:
                sections[current_key] = "\n".join(current_lines).strip()
            current_key = line.lstrip("#").strip().lower()
            current_lines = [line]
        else:
            current_lines.append(line)
    if current_key:
        sections[current_key] = "\n".join(current_lines).strip()
    return sections


def rules_for(scheme: str, reason_code: str) -> str:
    """Best-effort match of a rules section for scheme + reason code.

    Falls back to the full rules file if no section matches, so an unexpected
    heading format degrades gracefully instead of dropping the rules.
    """
    sections = _load_sections()
    scheme_l = scheme.lower()
    code_l = reason_code.lower()

    for key, body in sections.items():
        if code_l in key and (scheme_l in key or scheme_l not in ("visa", "mastercard")):
            return body
    for key, body in sections.items():
        if code_l in key:
            return body

    return config.REASON_CODES_FILE.read_text()
