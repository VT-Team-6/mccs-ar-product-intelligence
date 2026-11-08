"""The recommendation test set stays usable as the catalog changes: every product
it names exists, and every case that expects results has a product worth
showing. Also checks the NDCG scoring itself."""

from urllib.parse import quote

import psycopg
import pytest
from testcontainers.community.postgres import PostgresContainer

from conftest import apply_init_sql
from scripts.evaluate_recommendations import dcg
from scripts.recommendation_cases import CASES


@pytest.fixture(scope="module")
def catalog():
    with PostgresContainer("postgres:17") as pg:
        url = (
            f"postgresql://{quote(pg.username)}:{quote(pg.password)}"
            f"@{pg.get_container_host_ip()}:{pg.get_exposed_port(5432)}/{pg.dbname}"
        )
        with psycopg.connect(url, autocommit=True, row_factory=psycopg.rows.dict_row) as conn:
            apply_init_sql(conn)
            yield conn.execute(
                """
                SELECT p.product_id, p.name, p.product_type, p.category, p.description,
                       (SELECT AVG(price) FROM inventory i WHERE i.product_id = p.product_id) AS price
                FROM products p WHERE p.deleted_at IS NULL
                """
            ).fetchall()


def test_case_names_are_unique():
    names = [case.name for case in CASES]
    assert len(names) == len(set(names))


def test_every_named_product_exists_once(catalog):
    names = [p["name"] for p in catalog]
    for case in CASES:
        if case.product:
            assert names.count(case.product) == 1, case.name


@pytest.mark.parametrize("case", [c for c in CASES if not c.expects_nothing], ids=lambda c: c.name)
def test_every_case_has_a_product_worth_showing(catalog, case):
    best = max(case.grade(p) for p in catalog if p["name"] != case.product)
    assert best >= 2, f"{case.name}: the best product in the catalog only grades {best}"


def test_dcg_rewards_the_best_products_first():
    assert dcg([3, 2, 1]) > dcg([1, 2, 3]) > dcg([0, 0, 1])
    assert dcg([]) == 0
