"""Encryption for the reorder messages saved in the database.

The manager's note on an order request, the buyer's "unavailable" reason, and
every notification's title and text are encrypted before they're saved, so
someone who can read the database directly (a leaked dump, a shared login) sees
scrambled text. The backend decrypts them for the people allowed to see them;
nothing changes in the app.

Fernet (from the cryptography library) is AES with a tamper check, so a changed
value fails to decrypt instead of showing something else.

The key is MESSAGE_KEY in backend/.env (from AWS Secrets Manager once
deployed). Without one, the shared development key below is used, so a fresh
clone works with no setup; a deployed server must set its own. To change keys without losing old messages, put the new key first:
MESSAGE_KEY="new-key,old-key". New text uses the first; old text still opens.
Make a key with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from dotenv import load_dotenv
from psycopg import Connection

load_dotenv()

# Every Fernet value starts with this (its version byte and the time it was made)
TOKEN_PREFIX = "gAAAAA"

# Shown instead of a message that can't be opened with the current key
UNREADABLE = "[This message was encrypted with a different key and can't be shown.]"

# Every encrypted column: (table, column)
ENCRYPTED_FIELDS = (
    ("order_requests", "note"),
    ("order_request_items", "reason"),
    ("messages", "subject"),
    ("messages", "body"),
)


# The development key (also in .env.example), used when MESSAGE_KEY isn't set.
# It's public in the repo, so it only shows the encryption working; a deployed
# server sets its own MESSAGE_KEY.
DEVELOPMENT_KEY = "w1X1LVN5CTGkzxMG0WCpeaK1HVF9OQB_0Ja-beAQd9A="


class MissingKey(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _keys() -> MultiFernet:
    raw = os.getenv("MESSAGE_KEY", "").strip()
    if not raw:
        print("MESSAGE_KEY isn't set: encrypting reorder messages with the shared development key")
        raw = DEVELOPMENT_KEY
    try:
        return MultiFernet([Fernet(key.strip()) for key in raw.split(",") if key.strip()])
    except ValueError as error:
        raise MissingKey(
            "MESSAGE_KEY isn't a valid key. Make one with: python -c \"from cryptography.fernet"
            " import Fernet; print(Fernet.generate_key().decode())\""
        ) from error


def check_key() -> None:
    """Fail at startup, with a clear message, rather than on the first message."""
    _keys()


def encrypt(text: str | None) -> str:
    """The text, encrypted. Empty stays empty (nothing to hide)."""
    if not text:
        return ""
    return _keys().encrypt(text.encode("utf-8")).decode("ascii")


def decrypt(value: str | None) -> str:
    """The original text, or a notice when the key doesn't match."""
    if not value:
        return ""
    try:
        return _keys().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError):
        return UNREADABLE


def decrypt_rows(rows: list[dict], *fields: str) -> list[dict]:
    """Decrypts these fields in each row, in place."""
    for row in rows:
        for field in fields:
            if field in row:
                row[field] = decrypt(row[field])
    return rows


def encrypt_existing(conn: Connection) -> int:
    """Encrypts anything saved before encryption was added. Safe to run every
    startup: values that are already encrypted are skipped."""
    changed = 0
    for table, column in ENCRYPTED_FIELDS:
        rows = conn.execute(
            f"SELECT ctid::TEXT AS row_id, {column} AS value FROM {table}"
            f" WHERE {column} <> '' AND {column} NOT LIKE %s",
            (TOKEN_PREFIX + "%",),
        ).fetchall()
        for row in rows:
            conn.execute(
                f"UPDATE {table} SET {column} = %s WHERE ctid = %s::tid",
                (encrypt(row["value"]), row["row_id"]),
            )
        changed += len(rows)
    return changed
