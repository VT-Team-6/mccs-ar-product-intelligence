"""A shopper's preferences: how much each shopping criterion matters to them.

Each criterion is rated 0 (Skip) to 3 (High). A user who has never saved
anything has no row in ``user_preferences`` and gets the defaults, so the
recommendation engine can always ask for a full set of weights.

Like ``user_products``, every function takes an explicit ``user_id`` and a
connection, and always filters on that id, so one user can never read or
change another user's preferences.
"""

from psycopg import Connection

# Must match the columns in db/migrations/003-user-preferences.sql
CRITERIA = ("price", "rating", "brand", "quality", "durability", "comfort")

# Medium, the same default the table and the mobile screen use
DEFAULT_IMPORTANCE = 2


def default_preferences() -> dict[str, int]:
    return {criterion: DEFAULT_IMPORTANCE for criterion in CRITERIA}


def get_preferences(conn: Connection, user_id: int) -> dict[str, int]:
    """The user's saved preferences, or the defaults if they have none yet."""
    row = conn.execute(
        f"SELECT {', '.join(CRITERIA)} FROM user_preferences WHERE user_id = %s",
        (user_id,),
    ).fetchone()
    if row is None:
        return default_preferences()
    return {criterion: row[criterion] for criterion in CRITERIA}


def save_preferences(
    conn: Connection, user_id: int, preferences: dict[str, int]
) -> dict[str, int]:
    """Create or replace the user's preferences and return what was saved."""
    columns = ", ".join(CRITERIA)
    placeholders = ", ".join(["%s"] * len(CRITERIA))
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in CRITERIA)
    values = [preferences[criterion] for criterion in CRITERIA]
    conn.execute(
        f"INSERT INTO user_preferences (user_id, {columns}) "
        f"VALUES (%s, {placeholders}) "
        f"ON CONFLICT (user_id) DO UPDATE SET {updates}, updated_at = CURRENT_TIMESTAMP",
        (user_id, *values),
    )
    return get_preferences(conn, user_id)