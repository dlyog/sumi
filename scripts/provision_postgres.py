#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import quote
from uuid import NAMESPACE_URL, uuid5

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.persistence import _password_hash, _recovery_answer_hash


DEMO_EMAIL = "learner@1stopquantum.local"
DEMO_PASSWORD = "LearnQuantum2026!"
DEMO_RECOVERY_QUESTION = "What recovery word did you choose?"
DEMO_RECOVERY_ANSWER = "superposition"


def local_setting(name: str, default: str = "") -> str:
    if name in os.environ:
        return os.environ[name]
    env_path = ROOT / ".env"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return default


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision the local 1StopQuantum PostgreSQL database")
    parser.add_argument("--admin-dsn", default=os.getenv("POSTGRES_ADMIN_URL", "postgresql:///postgres"))
    parser.add_argument(
        "--database-url",
        default="",
        help="Reuse an existing application database instead of creating a local role/database",
    )
    args = parser.parse_args()

    database_url = args.database_url.strip()
    if not database_url:
        name = os.getenv("QUANTUMYOG_DB_NAME", "quantumyog")
        user = os.getenv("QUANTUMYOG_DB_USER", "quantumyog")
        password = os.getenv("QUANTUMYOG_DB_PASSWORD", "quantumyog-local")
        if not name.replace("_", "").isalnum() or not user.replace("_", "").isalnum():
            raise SystemExit("Database name and user may contain only letters, numbers, and underscores.")

        with psycopg.connect(args.admin_dsn, autocommit=True) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (user,))
                if cursor.fetchone() is None:
                    cursor.execute(
                        sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
                            sql.Identifier(user), sql.Literal(password)
                        )
                    )
                else:
                    cursor.execute(
                        sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(
                            sql.Identifier(user), sql.Literal(password)
                        )
                    )
                cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
                if cursor.fetchone() is None:
                    cursor.execute(
                        sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(name), sql.Identifier(user))
                    )

        database_url = f"postgresql://{quote(user)}:{quote(password)}@127.0.0.1:5432/{quote(name)}"
    schema = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")
    seed = (ROOT / "database" / "seed.sql").read_text(encoding="utf-8")
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute(schema)
        connection.execute(seed)
        admin_email = local_setting("QUANTUMYOG_ADMIN_EMAIL").strip().lower()
        admin_password = local_setting("QUANTUMYOG_ADMIN_PASSWORD")
        if admin_email and admin_password and not admin_password.startswith("replace-with"):
            admin_id = uuid5(NAMESPACE_URL, f"1stopquantum-admin:{admin_email}")
            connection.execute(
                """INSERT INTO users (id, email, display_name, password_hash, role)
                   VALUES (%s, %s, 'Internal administrator', %s, 'admin')
                   ON CONFLICT (email) DO UPDATE SET
                     role = 'admin'""",
                (admin_id, admin_email, _password_hash(admin_password)),
            )
            connection.execute(
                """INSERT INTO subscriptions (user_id, plan, status)
                   SELECT id, 'lab', 'active' FROM users WHERE email = %s
                   ON CONFLICT (user_id) DO UPDATE SET plan = 'lab', status = 'active'""",
                (admin_email,),
            )
        demo_id = uuid5(NAMESPACE_URL, f"1stopquantum-demo:{DEMO_EMAIL}")
        connection.execute(
            """INSERT INTO users
               (id, email, display_name, password_hash, password_hint,
                recovery_question, recovery_answer_hash, role)
               VALUES (%s, %s, 'Demo learner', %s, %s, %s, %s, 'learner')
               ON CONFLICT (email) DO UPDATE SET
                 display_name = EXCLUDED.display_name,
                 password_hash = EXCLUDED.password_hash,
                 password_hint = EXCLUDED.password_hint,
                 recovery_question = EXCLUDED.recovery_question,
                 recovery_answer_hash = EXCLUDED.recovery_answer_hash,
                 role = 'learner'""",
            (
                demo_id,
                DEMO_EMAIL,
                _password_hash(DEMO_PASSWORD),
                "Starts with Learn and ends with 2026!",
                DEMO_RECOVERY_QUESTION,
                _recovery_answer_hash(DEMO_RECOVERY_ANSWER),
            ),
        )
        connection.execute(
            """INSERT INTO subscriptions (user_id, plan, status)
               SELECT id, 'scholar', 'active' FROM users WHERE email = %s
               ON CONFLICT (user_id) DO UPDATE SET plan = 'scholar', status = 'active'""",
            (DEMO_EMAIL,),
        )
    print(database_url)


if __name__ == "__main__":
    main()
