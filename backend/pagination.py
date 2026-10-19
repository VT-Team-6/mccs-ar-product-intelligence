"""Opaque keyset-pagination cursors shared by the /api/me list endpoints.

A cursor encodes the last row of a page as small JSON (for example
``{"v": "2026-10-18T14:42:00+00:00", "id": 42}``) so the next page can resume
with a "strictly after this row" comparison instead of an offset. Offsets shift
when rows are added while the client is paging; keyset comparisons do not.

Cursors are not secret, but they are base64url-encoded so clients treat them as
opaque values rather than depending on the JSON layout.
"""

import base64
import binascii
import json
from typing import Any


class InvalidCursor(ValueError):
    """Raised when a cursor cannot be decoded into the expected keys."""


def encode_cursor(values: dict[str, Any]) -> str:
    """Encode a cursor payload as a URL-safe string."""
    raw = json.dumps(values, separators=(",", ":"), default=str).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str, keys: tuple[str, ...]) -> dict[str, Any]:
    """Decode a cursor and check it carries exactly ``keys``.

    Raises InvalidCursor for malformed input or a missing key, which the routers
    turn into an HTTP 400 so a stale or hand-edited cursor never returns data
    from the wrong position in the list.
    """
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise InvalidCursor("Cursor is not valid") from error

    if not isinstance(payload, dict) or any(key not in payload for key in keys):
        raise InvalidCursor("Cursor is missing pagination values")
    return payload
