"""Shared LLM call helper.

The OpenAI SDK auto-retries 429/5xx but not 401. Some project-scoped keys
intermittently return 401 'insufficient permissions' on newer models even
though the same call succeeds on retry, so we retry auth errors briefly too.
"""
from __future__ import annotations

import time

from openai import AuthenticationError, OpenAI


def parse_with_retry(client: OpenAI, attempts: int = 4, backoff: float = 1.5, **kwargs):
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            return client.chat.completions.parse(**kwargs)
        except AuthenticationError as e:
            last_err = e
            time.sleep(backoff * (i + 1))
    raise last_err
