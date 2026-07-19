from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_database_package_is_portable_and_idempotent():
    database = ROOT / "database"
    schema = (database / "schema.sql").read_text(encoding="utf-8")
    seed = (database / "seed.sql").read_text(encoding="utf-8")
    readme = (database / "README.md").read_text(encoding="utf-8")

    for table in ("plans", "users", "subscriptions", "improvement_jobs", "improvement_runs"):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in schema

    assert "ON CONFLICT (code) DO UPDATE" in seed
    assert all(plan in seed for plan in ("explorer", "scholar", "lab"))
    assert "schema.sql" in readme and "seed.sql" in readme


def test_setup_script_provisions_the_database_package():
    setup = (ROOT / "scripts" / "setup-postgres.sh").read_text(encoding="utf-8")
    provisioner = (ROOT / "scripts" / "provision_postgres.py").read_text(encoding="utf-8")

    assert "provision_postgres.py" in setup
    assert 'ROOT / "database" / "schema.sql"' in provisioner
    assert 'ROOT / "database" / "seed.sql"' in provisioner
