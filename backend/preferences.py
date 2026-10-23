"""A shopper's preferences: which shopping criteria matter most to them, in order.

Each criterion has a rank: 1 = matters most, 2 = next, and so on, and 0 = not
ranked. A user who has never saved anything has no row in ``user_preferences``
and gets the defaults (nothing ranked), so the recommendation engine can always
ask for a full set of ranks.
"""

from psycopg import Connection

# Must match the columns in db/migrations/003-user-preferences.sql
CRITERIA = ("price", "rating", "brand", "quality", "durability", "comfort")

# Not ranked, the same default the table and the mobile screen use
NOT_RANKED = 0


def default_preferences() -> dict[str, int]:
    return {criterion: NOT_RANKED for criterion in CRITERIA}


def rank_weights(ranks: dict[str, int]) -> dict[str, int]:
    """Turn ranks into weights for the recommendation engine.

    #1 counts 6, #2 counts 5, ... #6 counts 1, and every unranked criterion
    counts 1. So ranking only Price makes it 6 times as important as each
    of the others.
    """
    return {
        criterion: len(CRITERIA) + 1 - rank if rank else 1
        for criterion, rank in ranks.items()
    }


def has_ranking(ranks: dict[str, int]) -> bool:
    """True if the user ranked at least one criterion."""
    return any(rank > 0 for rank in ranks.values())


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