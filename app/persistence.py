from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
from collections import Counter
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import RLock
from typing import Any
from urllib.parse import urlparse
from uuid import UUID, uuid4

from .improvement import improve_circuit


PLANS = {
    "explorer": {"name": "Explorer", "scheduled_job_limit": 1, "max_iterations": 2},
    "scholar": {"name": "Scholar", "scheduled_job_limit": 10, "max_iterations": 4},
    "lab": {"name": "Lab", "scheduled_job_limit": 50, "max_iterations": 8},
}
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PASSWORD_ITERATIONS = 260_000
RECOVERY_QUESTIONS = {
    "What recovery word did you choose?",
    "What was the title of the first book you remember?",
    "What city was your first school in?",
}


class AuthenticationError(ValueError):
    pass


def _password_hash(value: Any) -> str:
    if value is None or value == "":
        raise ValueError("password is required and must be 8 to 128 characters")
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise ValueError("password must be 8 to 128 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", value.encode(), salt, PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}"


def _normalize_recovery_answer(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("recovery answer must be 3 to 128 characters")
    normalized = " ".join(value.strip().lower().split())
    if not 3 <= len(normalized) <= 128:
        raise ValueError("recovery answer must be 3 to 128 characters")
    return normalized


def _recovery_answer_hash(value: Any) -> str:
    normalized = _normalize_recovery_answer(value)
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", normalized.encode(), salt, PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}"


def _password_matches(value: Any, encoded: str | None) -> bool:
    if encoded is None:
        return False
    if not isinstance(value, str):
        return False
    try:
        algorithm, iterations, salt, expected = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", value.encode(), bytes.fromhex(salt), int(iterations)).hex()
    except (TypeError, ValueError):
        return False
    return hmac.compare_digest(actual, expected)


def _recovery_answer_matches(value: Any, encoded: str | None) -> bool:
    try:
        normalized = _normalize_recovery_answer(value)
    except ValueError:
        return False
    return _password_matches(normalized, encoded)


def _public_account(account: dict[str, Any]) -> dict[str, Any]:
    private_fields = {"password_hash", "password_hint", "recovery_question", "recovery_answer_hash"}
    return deepcopy({key: value for key, value in account.items() if key not in private_fields})


def _iso(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.replace("+00:00", "Z")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_schedule(value: str | None) -> datetime:
    if not value:
        return datetime.now(UTC)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("schedule_at must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _validate_role(role: Any) -> str:
    if role not in {"learner", "contributor", "reviewer", "admin"}:
        raise ValueError("role must be learner, contributor, reviewer, or admin")
    return str(role)


def _validate_visitor(body: dict[str, Any]) -> tuple[str, str | None]:
    visitor_id = body.get("visitor_id")
    if not isinstance(visitor_id, str) or not 8 <= len(visitor_id.strip()) <= 128:
        raise ValueError("visitor_id must be 8 to 128 characters")
    user_id = body.get("user_id")
    if user_id is not None and not isinstance(user_id, str):
        raise ValueError("user_id must be a string when provided")
    return visitor_id.strip(), user_id or None


def _validate_event(body: dict[str, Any]) -> tuple[str, str | None, str, str]:
    visitor_id, user_id = _validate_visitor(body)
    page = body.get("page")
    event_type = body.get("event_type", "page_view")
    if not isinstance(page, str) or not 1 <= len(page.strip()) <= 120:
        raise ValueError("page must be 1 to 120 characters")
    if event_type != "page_view":
        raise ValueError("event_type must be page_view")
    return visitor_id, user_id, page.strip(), event_type


def _validate_feedback(body: dict[str, Any]) -> tuple[str, str | None, str, str, str]:
    visitor_id, user_id = _validate_visitor(body)
    content_id = body.get("content_id")
    kind = body.get("kind")
    message = body.get("message", "")
    if not isinstance(content_id, str) or not 1 <= len(content_id.strip()) <= 120:
        raise ValueError("content_id must be 1 to 120 characters")
    if kind not in {"like", "inaccuracy"}:
        raise ValueError("kind must be like or inaccuracy")
    if not isinstance(message, str) or len(message.strip()) > 2000:
        raise ValueError("message must be at most 2000 characters")
    if kind == "inaccuracy" and len(message.strip()) < 10:
        raise ValueError("inaccuracy feedback must be at least 10 characters")
    return visitor_id, user_id, content_id.strip(), kind, message.strip()


def _validate_llm_settings(body: dict[str, Any], *, require_key: bool) -> dict[str, str]:
    provider = str(body.get("provider", "")).strip().lower()
    base_url = str(body.get("base_url", "")).strip().rstrip("/")
    model = str(body.get("model", "")).strip()
    api_key = str(body.get("api_key", "")).strip()
    parsed = urlparse(base_url)
    if provider not in {"local", "openai"}:
        raise ValueError("provider must be local or openai")
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("base_url must be an http or https URL without embedded credentials")
    if not 1 <= len(model) <= 200:
        raise ValueError("model must be 1 to 200 characters")
    if require_key and not api_key:
        raise ValueError("api_key is required for the first provider configuration")
    if len(api_key) > 1000:
        raise ValueError("api_key must be at most 1000 characters")
    return {"provider": provider, "base_url": base_url, "model": model, "api_key": api_key}


def _validate_community_submission(body: dict[str, Any]) -> dict[str, Any]:
    kind = str(body.get("kind", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    email = str(body.get("email", "")).strip().lower()
    title = str(body.get("title", "")).strip()
    summary = str(body.get("summary", "")).strip()
    consent = body.get("consent") is True
    if kind not in {"research", "contributor", "reviewer"}:
        raise ValueError("kind must be research, contributor, or reviewer")
    if not 1 <= len(name) <= 120:
        raise ValueError("name is required and must be at most 120 characters")
    if not EMAIL_PATTERN.match(email):
        raise ValueError("a valid email is required")
    if len(title) > 240 or len(summary) > 5000:
        raise ValueError("title or summary exceeds the submission limit")
    if not consent:
        raise ValueError("consent is required to retain and review this request")
    labels = {
        "research": "Research publication inquiry",
        "contributor": "Contributor application",
        "reviewer": "Reviewer application",
    }
    return {
        "kind": kind,
        "name": name,
        "email": email,
        "title": title or labels[kind],
        "summary": summary,
        "license": str(body.get("license", "CC BY 4.0 when published")).strip()[:120],
    }


def _public_submission(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: deepcopy(value)
        for key, value in item.items()
        if key not in {"email", "consent_at", "retention_until", "review_note", "reviewed_by"}
    }


def _fernet():
    from cryptography.fernet import Fernet

    key = os.getenv("LLM_SETTINGS_ENCRYPTION_KEY", "").strip()
    if not key or key.startswith("replace-with"):
        raise ValueError("LLM_SETTINGS_ENCRYPTION_KEY must be configured before saving provider credentials")
    try:
        return Fernet(key.encode("ascii"))
    except (TypeError, ValueError) as exc:
        raise ValueError("LLM_SETTINGS_ENCRYPTION_KEY must be a valid Fernet key") from exc


def _environment_llm_settings(*, include_secret: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "provider": os.getenv("LLM_PROVIDER", "local").strip().lower() or "local",
        "base_url": os.getenv("LLM_BASE_URL", "").strip(),
        "model": os.getenv("LLM_MODEL", "").strip(),
        "api_key_configured": bool(os.getenv("LLM_API_KEY", "").strip()),
        "source": "environment",
    }
    if include_secret:
        payload["api_key"] = os.getenv("LLM_API_KEY", "local")
    return payload


def _validate_account(email: Any, display_name: Any, plan: Any) -> tuple[str, str, str]:
    if not isinstance(email, str) or not EMAIL_PATTERN.match(email.strip().lower()):
        raise ValueError("a valid email is required")
    if not isinstance(display_name, str) or not 1 <= len(display_name.strip()) <= 80:
        raise ValueError("display_name is required and must be at most 80 characters")
    if plan not in PLANS:
        raise ValueError("plan must be explorer, scholar, or lab")
    return email.strip().lower(), display_name.strip(), plan


def _validate_recovery(
    password: Any, password_hint: Any, recovery_question: Any, recovery_answer: Any
) -> tuple[str, str, str]:
    values = (password_hint, recovery_question, recovery_answer)
    if all(value is None or value == "" for value in values):
        return "", "", ""
    if any(value is None or value == "" for value in values):
        raise ValueError("password recovery requires a hint, question, and answer")
    hint = str(password_hint).strip()
    question = str(recovery_question).strip()
    if not 3 <= len(hint) <= 120:
        raise ValueError("password hint must be 3 to 120 characters")
    if isinstance(password, str) and password.lower() in hint.lower():
        raise ValueError("password hint must not contain the password")
    if question not in RECOVERY_QUESTIONS:
        raise ValueError("select one of the supported recovery questions")
    return hint, question, _recovery_answer_hash(recovery_answer)


class MemoryStore:
    def __init__(self, report_dir: str | Path = "artifacts/improvements"):
        self.report_dir = Path(report_dir)
        self.accounts: dict[str, dict[str, Any]] = {}
        self.jobs: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []
        self.feedback: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.llm_settings: dict[str, Any] | None = None
        self.community_submissions: dict[str, dict[str, Any]] = {}
        self.community_audit_log: list[dict[str, Any]] = []
        self._lock = RLock()

    def health(self) -> str:
        return "memory"

    def create_account(
        self,
        *,
        email: Any,
        display_name: Any,
        plan: Any,
        password: Any = None,
        role: Any = "learner",
        password_hint: Any = None,
        recovery_question: Any = None,
        recovery_answer: Any = None,
    ) -> dict[str, Any]:
        email, display_name, plan = _validate_account(email, display_name, plan)
        role = _validate_role(role)
        password_hash = _password_hash(password)
        hint, question, answer_hash = _validate_recovery(
            password, password_hint, recovery_question, recovery_answer
        )
        with self._lock:
            if any(account["email"] == email for account in self.accounts.values()):
                raise ValueError("an account with this email already exists")
            user_id = str(uuid4())
            account = {
                "id": user_id,
                "email": email,
                "display_name": display_name,
                "password_hash": password_hash,
                "password_hint": hint,
                "recovery_question": question,
                "recovery_answer_hash": answer_hash,
                "role": role,
                "created_at": _iso(datetime.now(UTC)),
                "subscription": {"plan": plan, "status": "active", "renewal_at": None},
            }
            self.accounts[user_id] = account
            return _public_account(account)

    def get_account(self, user_id: str) -> dict[str, Any] | None:
        with self._lock:
            account = self.accounts.get(user_id)
            return _public_account(account) if account else None

    def authenticate_account(self, *, email: Any, password: Any = None) -> dict[str, Any]:
        normalized = email.strip().lower() if isinstance(email, str) else ""
        with self._lock:
            account = next((candidate for candidate in self.accounts.values() if candidate["email"] == normalized), None)
            if account is None or not _password_matches(password, account.get("password_hash")):
                raise AuthenticationError("invalid email or password")
            return _public_account(account)

    def change_password(self, user_id: str, current_password: Any, new_password: Any) -> dict[str, bool]:
        with self._lock:
            account = self.accounts.get(user_id)
            if account is None or not _password_matches(current_password, account.get("password_hash")):
                raise AuthenticationError("current password is incorrect")
            account["password_hash"] = _password_hash(new_password)
        return {"changed": True}

    def recovery_challenge(self, email: Any) -> dict[str, str]:
        normalized = email.strip().lower() if isinstance(email, str) else ""
        with self._lock:
            account = next((candidate for candidate in self.accounts.values() if candidate["email"] == normalized), None)
            if not account or not account.get("recovery_question") or not account.get("recovery_answer_hash"):
                raise ValueError("password recovery is not configured for this account")
            return {
                "password_hint": account.get("password_hint", ""),
                "recovery_question": account["recovery_question"],
            }

    def reset_password(self, email: Any, recovery_answer: Any, new_password: Any) -> dict[str, bool]:
        normalized = email.strip().lower() if isinstance(email, str) else ""
        with self._lock:
            account = next((candidate for candidate in self.accounts.values() if candidate["email"] == normalized), None)
            if account is None or not _recovery_answer_matches(recovery_answer, account.get("recovery_answer_hash")):
                raise AuthenticationError("recovery answer is incorrect")
            account["password_hash"] = _password_hash(new_password)
        return {"changed": True}

    def submit_community(self, body: dict[str, Any]) -> dict[str, Any]:
        values = _validate_community_submission(body)
        now = datetime.now(UTC)
        item = {
            "id": str(uuid4()),
            **values,
            "status": "submitted",
            "consent_at": _iso(now),
            "retention_until": _iso(now + timedelta(days=730)),
            "review_note": "",
            "reviewed_by": None,
            "created_at": _iso(now),
            "updated_at": _iso(now),
        }
        with self._lock:
            self.community_submissions[item["id"]] = item
        return _public_submission(item)

    def list_community_submissions(self) -> list[dict[str, Any]]:
        with self._lock:
            return sorted(deepcopy(list(self.community_submissions.values())), key=lambda item: item["created_at"], reverse=True)

    def moderate_community(self, submission_id: str, body: dict[str, Any], admin_id: str) -> dict[str, Any]:
        status = str(body.get("status", "")).strip().lower()
        note = str(body.get("note", "")).strip()
        if status not in {"under_review", "approved", "rejected"}:
            raise ValueError("status must be under_review, approved, or rejected")
        if len(note) > 2000:
            raise ValueError("moderation note must be at most 2000 characters")
        with self._lock:
            item = self.community_submissions.get(submission_id)
            if item is None:
                raise ValueError("submission not found")
            before = item["status"]
            item.update({"status": status, "review_note": note, "reviewed_by": admin_id, "updated_at": _iso(datetime.now(UTC))})
            if status == "approved" and item["kind"] in {"contributor", "reviewer"}:
                account = next((candidate for candidate in self.accounts.values() if candidate["email"] == item["email"]), None)
                if account and account["role"] != "admin":
                    account["role"] = item["kind"]
            self.community_audit_log.append({
                "id": str(uuid4()), "submission_id": submission_id, "admin_id": admin_id,
                "from_status": before, "to_status": status, "note": note, "created_at": _iso(datetime.now(UTC)),
            })
            return deepcopy(item)

    def community_audit(self, submission_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return deepcopy([row for row in self.community_audit_log if row["submission_id"] == submission_id])

    def community_publications(self) -> list[dict[str, Any]]:
        with self._lock:
            approved = [item for item in self.community_submissions.values() if item["status"] == "approved"]
        return [_public_submission(item) for item in sorted(approved, key=lambda item: item["updated_at"], reverse=True)]

    def community_interests(self) -> dict[str, int]:
        with self._lock:
            counts = Counter(item["kind"] for item in self.community_submissions.values())
        return {kind: counts.get(kind, 0) for kind in ("research", "contributor", "reviewer")}

    def request_community_deletion(self, submission_id: str, email: Any) -> dict[str, bool]:
        normalized = str(email).strip().lower()
        with self._lock:
            item = self.community_submissions.get(submission_id)
            if item is None or not hmac.compare_digest(item["email"], normalized):
                raise AuthenticationError("submission and email did not match")
            item["delete_requested_at"] = _iso(datetime.now(UTC))
            item["updated_at"] = item["delete_requested_at"]
        return {"deletion_requested": True}

    def record_event(self, body: dict[str, Any]) -> dict[str, Any]:
        visitor_id, user_id, page, event_type = _validate_event(body)
        event = {
            "id": str(uuid4()),
            "visitor_id": visitor_id,
            "user_id": user_id,
            "page": page,
            "event_type": event_type,
            "created_at": _iso(datetime.now(UTC)),
        }
        with self._lock:
            self.events.append(event)
        return deepcopy(event)

    def save_feedback(self, body: dict[str, Any]) -> dict[str, int]:
        visitor_id, user_id, content_id, kind, message = _validate_feedback(body)
        item = {
            "id": str(uuid4()),
            "visitor_id": visitor_id,
            "user_id": user_id,
            "content_id": content_id,
            "kind": kind,
            "message": message,
            "created_at": _iso(datetime.now(UTC)),
        }
        with self._lock:
            self.feedback[(visitor_id, content_id, kind)] = item
        return self.feedback_summary(content_id)

    def feedback_summary(self, content_id: str) -> dict[str, int]:
        with self._lock:
            items = [item for item in self.feedback.values() if item["content_id"] == content_id]
        return {
            "likes": sum(item["kind"] == "like" for item in items),
            "reports": sum(item["kind"] == "inaccuracy" for item in items),
        }

    def analytics_summary(self) -> dict[str, Any]:
        today = datetime.now(UTC).date().isoformat()
        with self._lock:
            events = deepcopy(self.events)
            feedback = deepcopy(list(self.feedback.values()))
        by_day: dict[str, list[dict[str, Any]]] = {}
        for event in events:
            by_day.setdefault(str(event["created_at"])[:10], []).append(event)
        daily = []
        for day in sorted(by_day, reverse=True)[:30]:
            rows = by_day[day]
            daily.append({
                "date": day,
                "visitors": len({row["user_id"] or row["visitor_id"] for row in rows}),
                "page_views": len(rows),
            })
        pages = Counter(event["page"] for event in events)
        today_rows = by_day.get(today, [])
        return {
            "totals": {
                "visitors_today": len({row["user_id"] or row["visitor_id"] for row in today_rows}),
                "page_views_today": len(today_rows),
                "likes": sum(item["kind"] == "like" for item in feedback),
                "reports": sum(item["kind"] == "inaccuracy" for item in feedback),
            },
            "daily_visitors": daily,
            "popular_pages": [{"page": page, "views": views} for page, views in pages.most_common(20)],
            "recent_feedback": sorted(feedback, key=lambda item: item["created_at"], reverse=True)[:50],
        }

    def get_llm_settings(self, *, include_secret: bool = False) -> dict[str, Any]:
        with self._lock:
            settings = deepcopy(self.llm_settings)
        if settings is None:
            return _environment_llm_settings(include_secret=include_secret)
        payload = {
            "provider": settings["provider"], "base_url": settings["base_url"],
            "model": settings["model"], "api_key_configured": bool(settings["api_key"]),
            "source": "database", "updated_at": settings["updated_at"],
        }
        if include_secret:
            payload["api_key"] = settings["api_key"]
        return payload

    def save_llm_settings(self, body: dict[str, Any], admin_id: str) -> dict[str, Any]:
        current = self.get_llm_settings(include_secret=True)
        settings = _validate_llm_settings(body, require_key=not bool(current.get("api_key")))
        if not settings["api_key"]:
            settings["api_key"] = current.get("api_key", "")
        settings["updated_by"] = admin_id
        settings["updated_at"] = _iso(datetime.now(UTC))
        with self._lock:
            self.llm_settings = settings
        return self.get_llm_settings()

    def create_job(self, body: dict[str, Any]) -> dict[str, Any]:
        user_id = str(body.get("user_id", ""))
        account = self.get_account(user_id)
        if account is None:
            raise ValueError("user_id does not identify an account")
        plan = account["subscription"]["plan"]
        maximum = body.get("max_iterations", 3)
        if not isinstance(maximum, int) or not 1 <= maximum <= PLANS[plan]["max_iterations"]:
            raise ValueError(f"max_iterations exceeds the {PLANS[plan]['name']} plan limit")
        schedule = _parse_schedule(body.get("schedule_at"))
        objective = body.get("objective")
        if not isinstance(objective, str) or not objective.strip():
            raise ValueError("objective is required")
        job_id = str(uuid4())
        job = {
            "id": job_id,
            "user_id": user_id,
            "circuit": deepcopy(body.get("circuit")),
            "objective": objective.strip(),
            "schedule_at": _iso(schedule),
            "max_iterations": maximum,
            "status": "scheduled",
            "result": None,
            "report_url": None,
        }
        with self._lock:
            active_jobs = sum(
                candidate["user_id"] == user_id and candidate["status"] in {"scheduled", "running"}
                for candidate in self.jobs.values()
            )
            if active_jobs >= PLANS[plan]["scheduled_job_limit"]:
                raise ValueError(f"active scheduled-job limit reached for the {PLANS[plan]['name']} plan")
            self.jobs[job_id] = job
        if body.get("run_now"):
            return self.run_job(job_id)
        return deepcopy(job)

    def run_job(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            job = self.jobs.get(job_id)
            if job is None:
                raise ValueError("job not found")
            job["status"] = "running"
        try:
            result = improve_circuit(
                job["circuit"],
                objective=job["objective"],
                max_iterations=job["max_iterations"],
                report_dir=self.report_dir,
            )
            with self._lock:
                job["status"] = "completed"
                job["result"] = result
                job["report_url"] = f"/improvements/reports/{job_id}"
        except Exception as exc:
            with self._lock:
                job["status"] = "failed"
                job["result"] = {"error": str(exc)}
        return deepcopy(job)

    def run_due_jobs(self) -> list[dict[str, Any]]:
        now = datetime.now(UTC)
        due = [
            job_id
            for job_id, job in list(self.jobs.items())
            if job["status"] == "scheduled" and _parse_schedule(job["schedule_at"]) <= now
        ]
        return [self.run_job(job_id) for job_id in due]

    def list_jobs(self, user_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [deepcopy(job) for job in self.jobs.values() if job["user_id"] == user_id]

    def report_path(self, job_id: str) -> Path | None:
        with self._lock:
            result = (self.jobs.get(job_id) or {}).get("result") or {}
            path = result.get("report_path")
        return Path(path) if path else None


class PostgresStore:
    def __init__(self, database_url: str, report_dir: str | Path = "artifacts/improvements"):
        self.database_url = database_url
        self.report_dir = Path(report_dir)

    def _connect(self):
        import psycopg
        from psycopg.rows import dict_row

        return psycopg.connect(self.database_url, row_factory=dict_row)

    def health(self) -> str:
        try:
            with self._connect() as connection:
                connection.execute("SELECT 1")
            return "ok"
        except Exception:
            return "unreachable"

    def create_account(
        self,
        *,
        email: Any,
        display_name: Any,
        plan: Any,
        password: Any = None,
        role: Any = "learner",
        password_hint: Any = None,
        recovery_question: Any = None,
        recovery_answer: Any = None,
    ) -> dict[str, Any]:
        from psycopg.errors import UniqueViolation

        email, display_name, plan = _validate_account(email, display_name, plan)
        role = _validate_role(role)
        password_hash = _password_hash(password)
        hint, question, answer_hash = _validate_recovery(
            password, password_hint, recovery_question, recovery_answer
        )
        user_id = uuid4()
        try:
            with self._connect() as connection:
                connection.execute(
                    """INSERT INTO users
                       (id, email, display_name, password_hash, role, password_hint, recovery_question, recovery_answer_hash)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                    (user_id, email, display_name, password_hash, role, hint, question, answer_hash),
                )
                connection.execute(
                    "INSERT INTO subscriptions (user_id, plan, status) VALUES (%s, %s, 'active')",
                    (user_id, plan),
                )
        except UniqueViolation as exc:
            raise ValueError("an account with this email already exists") from exc
        return self.get_account(str(user_id)) or {}

    def authenticate_account(self, *, email: Any, password: Any = None) -> dict[str, Any]:
        normalized = email.strip().lower() if isinstance(email, str) else ""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id, password_hash FROM users WHERE email = %s",
                (normalized,),
            ).fetchone()
        if row is None or not _password_matches(password, row["password_hash"]):
            raise AuthenticationError("invalid email or password")
        account = self.get_account(str(row["id"]))
        if account is None:
            raise AuthenticationError("invalid email or password")
        return account

    def change_password(self, user_id: str, current_password: Any, new_password: Any) -> dict[str, bool]:
        try:
            parsed_id = UUID(user_id)
        except ValueError as exc:
            raise AuthenticationError("current password is incorrect") from exc
        with self._connect() as connection:
            row = connection.execute("SELECT password_hash FROM users WHERE id = %s", (parsed_id,)).fetchone()
            if row is None or not _password_matches(current_password, row["password_hash"]):
                raise AuthenticationError("current password is incorrect")
            connection.execute("UPDATE users SET password_hash = %s WHERE id = %s", (_password_hash(new_password), parsed_id))
        return {"changed": True}

    def recovery_challenge(self, email: Any) -> dict[str, str]:
        normalized = email.strip().lower() if isinstance(email, str) else ""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT password_hint, recovery_question, recovery_answer_hash FROM users WHERE email = %s",
                (normalized,),
            ).fetchone()
        if row is None or not row["recovery_question"] or not row["recovery_answer_hash"]:
            raise ValueError("password recovery is not configured for this account")
        return {"password_hint": row["password_hint"], "recovery_question": row["recovery_question"]}

    def reset_password(self, email: Any, recovery_answer: Any, new_password: Any) -> dict[str, bool]:
        normalized = email.strip().lower() if isinstance(email, str) else ""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id, recovery_answer_hash FROM users WHERE email = %s",
                (normalized,),
            ).fetchone()
            if row is None or not _recovery_answer_matches(recovery_answer, row["recovery_answer_hash"]):
                raise AuthenticationError("recovery answer is incorrect")
            connection.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (_password_hash(new_password), row["id"]),
            )
        return {"changed": True}

    def submit_community(self, body: dict[str, Any]) -> dict[str, Any]:
        values = _validate_community_submission(body)
        submission_id = uuid4()
        with self._connect() as connection:
            row = connection.execute(
                """INSERT INTO community_submissions
                   (id, kind, name, email, title, summary, license, consent_at, retention_until)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW() + INTERVAL '730 days')
                   RETURNING *""",
                (submission_id, values["kind"], values["name"], values["email"], values["title"], values["summary"], values["license"]),
            ).fetchone()
        payload = dict(row)
        payload.update({key: _iso(payload[key]) for key in ("consent_at", "retention_until", "created_at", "updated_at")})
        payload["id"] = str(payload["id"])
        return _public_submission(payload)

    def list_community_submissions(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM community_submissions ORDER BY created_at DESC").fetchall()
        payload = []
        for row in rows:
            item = dict(row)
            item["id"] = str(item["id"])
            item["reviewed_by"] = str(item["reviewed_by"]) if item.get("reviewed_by") else None
            for key in ("consent_at", "retention_until", "created_at", "updated_at"):
                item[key] = _iso(item[key])
            payload.append(item)
        return payload

    def moderate_community(self, submission_id: str, body: dict[str, Any], admin_id: str) -> dict[str, Any]:
        status = str(body.get("status", "")).strip().lower()
        note = str(body.get("note", "")).strip()
        if status not in {"under_review", "approved", "rejected"}:
            raise ValueError("status must be under_review, approved, or rejected")
        if len(note) > 2000:
            raise ValueError("moderation note must be at most 2000 characters")
        try:
            parsed_submission = UUID(submission_id)
            parsed_admin = UUID(admin_id)
        except ValueError as exc:
            raise ValueError("submission not found") from exc
        with self._connect() as connection:
            row = connection.execute("SELECT status FROM community_submissions WHERE id = %s FOR UPDATE", (parsed_submission,)).fetchone()
            if row is None:
                raise ValueError("submission not found")
            connection.execute(
                """UPDATE community_submissions SET status = %s, review_note = %s,
                   reviewed_by = %s, updated_at = NOW() WHERE id = %s""",
                (status, note, parsed_admin, parsed_submission),
            )
            if status == "approved":
                candidate = connection.execute("SELECT kind, email FROM community_submissions WHERE id = %s", (parsed_submission,)).fetchone()
                if candidate["kind"] in {"contributor", "reviewer"}:
                    connection.execute(
                        "UPDATE users SET role = %s WHERE email = %s AND role <> 'admin'",
                        (candidate["kind"], candidate["email"]),
                    )
            connection.execute(
                """INSERT INTO community_audit_log
                   (id, submission_id, admin_id, from_status, to_status, note)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (uuid4(), parsed_submission, parsed_admin, row["status"], status, note),
            )
        return next(item for item in self.list_community_submissions() if item["id"] == submission_id)

    def community_audit(self, submission_id: str) -> list[dict[str, Any]]:
        try:
            parsed = UUID(submission_id)
        except ValueError:
            return []
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM community_audit_log WHERE submission_id = %s ORDER BY created_at", (parsed,)
            ).fetchall()
        return [{
            "id": str(row["id"]), "submission_id": str(row["submission_id"]), "admin_id": str(row["admin_id"]),
            "from_status": row["from_status"], "to_status": row["to_status"], "note": row["note"],
            "created_at": _iso(row["created_at"]),
        } for row in rows]

    def community_publications(self) -> list[dict[str, Any]]:
        return [_public_submission(item) for item in self.list_community_submissions() if item["status"] == "approved"]

    def community_interests(self) -> dict[str, int]:
        with self._connect() as connection:
            rows = connection.execute("SELECT kind, COUNT(*) AS count FROM community_submissions GROUP BY kind").fetchall()
        counts = {row["kind"]: row["count"] for row in rows}
        return {kind: counts.get(kind, 0) for kind in ("research", "contributor", "reviewer")}

    def request_community_deletion(self, submission_id: str, email: Any) -> dict[str, bool]:
        normalized = str(email).strip().lower()
        try:
            parsed = UUID(submission_id)
        except ValueError as exc:
            raise AuthenticationError("submission and email did not match") from exc
        with self._connect() as connection:
            row = connection.execute("SELECT email FROM community_submissions WHERE id = %s", (parsed,)).fetchone()
            if row is None or not hmac.compare_digest(row["email"], normalized):
                raise AuthenticationError("submission and email did not match")
            connection.execute(
                "UPDATE community_submissions SET delete_requested_at = NOW(), updated_at = NOW() WHERE id = %s", (parsed,)
            )
        return {"deletion_requested": True}

    def get_account(self, user_id: str) -> dict[str, Any] | None:
        try:
            parsed_id = UUID(user_id)
        except ValueError:
            return None
        with self._connect() as connection:
            row = connection.execute(
                """SELECT u.id, u.email, u.display_name, u.role, u.created_at,
                          s.plan, s.status, s.renewal_at
                   FROM users u JOIN subscriptions s ON s.user_id = u.id
                   WHERE u.id = %s""",
                (parsed_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "email": row["email"],
            "display_name": row["display_name"],
            "role": row["role"],
            "created_at": _iso(row["created_at"]),
            "subscription": {
                "plan": row["plan"],
                "status": row["status"],
                "renewal_at": _iso(row["renewal_at"]),
            },
        }

    def record_event(self, body: dict[str, Any]) -> dict[str, Any]:
        visitor_id, user_id, page, event_type = _validate_event(body)
        try:
            parsed_user = UUID(user_id) if user_id else None
        except ValueError as exc:
            raise ValueError("user_id must be a valid account identifier") from exc
        event_id = uuid4()
        with self._connect() as connection:
            row = connection.execute(
                """INSERT INTO page_events (id, visitor_id, user_id, page_key, event_type)
                   VALUES (%s, %s, %s, %s, %s)
                   RETURNING id, visitor_id, user_id, page_key, event_type, created_at""",
                (event_id, visitor_id, parsed_user, page, event_type),
            ).fetchone()
        return {
            "id": str(row["id"]),
            "visitor_id": row["visitor_id"],
            "user_id": str(row["user_id"]) if row["user_id"] else None,
            "page": row["page_key"],
            "event_type": row["event_type"],
            "created_at": _iso(row["created_at"]),
        }

    def save_feedback(self, body: dict[str, Any]) -> dict[str, int]:
        visitor_id, user_id, content_id, kind, message = _validate_feedback(body)
        try:
            parsed_user = UUID(user_id) if user_id else None
        except ValueError as exc:
            raise ValueError("user_id must be a valid account identifier") from exc
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO content_feedback
                   (id, content_id, visitor_id, user_id, kind, message)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (content_id, visitor_id, kind)
                   DO UPDATE SET user_id = EXCLUDED.user_id, message = EXCLUDED.message, created_at = NOW()""",
                (uuid4(), content_id, visitor_id, parsed_user, kind, message),
            )
        return self.feedback_summary(content_id)

    def feedback_summary(self, content_id: str) -> dict[str, int]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT kind, COUNT(*) AS count FROM content_feedback WHERE content_id = %s GROUP BY kind",
                (content_id,),
            ).fetchall()
        counts = {row["kind"]: row["count"] for row in rows}
        return {"likes": counts.get("like", 0), "reports": counts.get("inaccuracy", 0)}

    def analytics_summary(self) -> dict[str, Any]:
        with self._connect() as connection:
            daily_rows = connection.execute(
                """SELECT created_at::date AS date, COUNT(*) AS page_views,
                          COUNT(DISTINCT COALESCE(user_id::text, visitor_id)) AS visitors
                   FROM page_events GROUP BY created_at::date ORDER BY date DESC LIMIT 30"""
            ).fetchall()
            page_rows = connection.execute(
                """SELECT page_key AS page, COUNT(*) AS views FROM page_events
                   GROUP BY page_key ORDER BY views DESC, page_key LIMIT 20"""
            ).fetchall()
            totals = connection.execute(
                """SELECT
                     (SELECT COUNT(DISTINCT COALESCE(user_id::text, visitor_id)) FROM page_events WHERE created_at::date = CURRENT_DATE) AS visitors_today,
                     (SELECT COUNT(*) FROM page_events WHERE created_at::date = CURRENT_DATE) AS page_views_today,
                     (SELECT COUNT(*) FROM content_feedback WHERE kind = 'like') AS likes,
                     (SELECT COUNT(*) FROM content_feedback WHERE kind = 'inaccuracy') AS reports"""
            ).fetchone()
            feedback_rows = connection.execute(
                """SELECT content_id, kind, message, created_at FROM content_feedback
                   ORDER BY created_at DESC LIMIT 50"""
            ).fetchall()
        return {
            "totals": dict(totals),
            "daily_visitors": [
                {"date": str(row["date"]), "visitors": row["visitors"], "page_views": row["page_views"]}
                for row in daily_rows
            ],
            "popular_pages": [dict(row) for row in page_rows],
            "recent_feedback": [
                {
                    "content_id": row["content_id"],
                    "kind": row["kind"],
                    "message": row["message"],
                    "created_at": _iso(row["created_at"]),
                }
                for row in feedback_rows
            ],
        }

    def get_llm_settings(self, *, include_secret: bool = False) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                """SELECT provider, base_url, model, api_key_ciphertext, updated_at
                   FROM llm_settings WHERE id = 1"""
            ).fetchone()
        if row is None:
            return _environment_llm_settings(include_secret=include_secret)
        payload: dict[str, Any] = {
            "provider": row["provider"],
            "base_url": row["base_url"],
            "model": row["model"],
            "api_key_configured": bool(row["api_key_ciphertext"]),
            "source": "database",
            "updated_at": _iso(row["updated_at"]),
        }
        if include_secret:
            try:
                payload["api_key"] = _fernet().decrypt(bytes(row["api_key_ciphertext"])).decode("utf-8")
            except Exception as exc:
                raise ValueError("stored LLM API key could not be decrypted with this deployment key") from exc
        return payload

    def save_llm_settings(self, body: dict[str, Any], admin_id: str) -> dict[str, Any]:
        current = self.get_llm_settings(include_secret=True)
        settings = _validate_llm_settings(body, require_key=not bool(current.get("api_key")))
        api_key = settings["api_key"] or current.get("api_key", "")
        ciphertext = _fernet().encrypt(api_key.encode("utf-8"))
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO llm_settings
                   (id, provider, base_url, model, api_key_ciphertext, updated_by)
                   VALUES (1, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET
                     provider = EXCLUDED.provider,
                     base_url = EXCLUDED.base_url,
                     model = EXCLUDED.model,
                     api_key_ciphertext = EXCLUDED.api_key_ciphertext,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = NOW()""",
                (settings["provider"], settings["base_url"], settings["model"], ciphertext, UUID(admin_id)),
            )
        return self.get_llm_settings()

    def create_job(self, body: dict[str, Any]) -> dict[str, Any]:
        from psycopg.types.json import Jsonb

        user_id = str(body.get("user_id", ""))
        account = self.get_account(user_id)
        if account is None:
            raise ValueError("user_id does not identify an account")
        plan = account["subscription"]["plan"]
        maximum = body.get("max_iterations", 3)
        if not isinstance(maximum, int) or not 1 <= maximum <= PLANS[plan]["max_iterations"]:
            raise ValueError(f"max_iterations exceeds the {PLANS[plan]['name']} plan limit")
        objective = body.get("objective")
        if not isinstance(objective, str) or not objective.strip():
            raise ValueError("objective is required")
        schedule = _parse_schedule(body.get("schedule_at"))
        job_id = uuid4()
        with self._connect() as connection:
            connection.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (UUID(user_id),))
            active_jobs = connection.execute(
                """SELECT COUNT(*) AS count FROM improvement_jobs
                   WHERE user_id = %s AND status IN ('scheduled', 'running')""",
                (UUID(user_id),),
            ).fetchone()["count"]
            if active_jobs >= PLANS[plan]["scheduled_job_limit"]:
                raise ValueError(f"active scheduled-job limit reached for the {PLANS[plan]['name']} plan")
            connection.execute(
                """INSERT INTO improvement_jobs
                   (id, user_id, circuit, objective, schedule_at, max_iterations)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (job_id, UUID(user_id), Jsonb(body.get("circuit")), objective.strip(), schedule, maximum),
            )
        if body.get("run_now"):
            return self.run_job(str(job_id))
        return self._get_job(str(job_id)) or {}

    def _get_job(self, job_id: str) -> dict[str, Any] | None:
        try:
            parsed_id = UUID(job_id)
        except ValueError:
            return None
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM improvement_jobs WHERE id = %s", (parsed_id,)).fetchone()
        return self._job_payload(row) if row else None

    def _job_payload(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": str(row["id"]),
            "user_id": str(row["user_id"]),
            "circuit": row["circuit"],
            "objective": row["objective"],
            "schedule_at": _iso(row["schedule_at"]),
            "max_iterations": row["max_iterations"],
            "status": row["status"],
            "result": row["result"],
            "report_url": f"/improvements/reports/{row['id']}" if row["report_path"] else None,
        }

    def run_job(self, job_id: str) -> dict[str, Any]:
        from psycopg.types.json import Jsonb

        job = self._get_job(job_id)
        if job is None:
            raise ValueError("job not found")
        with self._connect() as connection:
            connection.execute("UPDATE improvement_jobs SET status = 'running', updated_at = NOW() WHERE id = %s", (UUID(job_id),))
        try:
            result = improve_circuit(
                job["circuit"],
                objective=job["objective"],
                max_iterations=job["max_iterations"],
                report_dir=self.report_dir,
            )
            with self._connect() as connection:
                connection.execute(
                    """UPDATE improvement_jobs SET status = 'completed', result = %s,
                       report_path = %s, updated_at = NOW() WHERE id = %s""",
                    (Jsonb(result), result["report_path"], UUID(job_id)),
                )
                connection.execute(
                    """INSERT INTO improvement_runs
                       (id, job_id, iteration, before_ir, after_ir, metrics, decision, report_path)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        uuid4(), UUID(job_id), len(result["iterations"]), Jsonb(result["original_ir"]),
                        Jsonb(result["improved_ir"]),
                        Jsonb({"before": result["before_metrics"], "after": result["after_metrics"]}),
                        "accepted" if result["accepted"] else "unchanged", result["report_path"],
                    ),
                )
        except Exception as exc:
            with self._connect() as connection:
                connection.execute(
                    "UPDATE improvement_jobs SET status = 'failed', result = %s, updated_at = NOW() WHERE id = %s",
                    (Jsonb({"error": str(exc)}), UUID(job_id)),
                )
        return self._get_job(job_id) or {}

    def run_due_jobs(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id FROM improvement_jobs WHERE status = 'scheduled' AND schedule_at <= NOW() ORDER BY schedule_at"
            ).fetchall()
        return [self.run_job(str(row["id"])) for row in rows]

    def list_jobs(self, user_id: str) -> list[dict[str, Any]]:
        try:
            parsed_id = UUID(user_id)
        except ValueError:
            return []
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM improvement_jobs WHERE user_id = %s ORDER BY created_at DESC", (parsed_id,)
            ).fetchall()
        return [self._job_payload(row) for row in rows]

    def report_path(self, job_id: str) -> Path | None:
        job = self._get_job(job_id)
        if not job or not job["result"] or not job["result"].get("report_path"):
            return None
        return Path(job["result"]["report_path"])


def store_from_environment() -> MemoryStore | PostgresStore:
    database_url = os.getenv("DATABASE_URL", "").strip()
    store: MemoryStore | PostgresStore = PostgresStore(database_url) if database_url else MemoryStore()
    admin_email = os.getenv("QUANTUMYOG_ADMIN_EMAIL", "").strip()
    admin_password = os.getenv("QUANTUMYOG_ADMIN_PASSWORD", "")
    if isinstance(store, MemoryStore) and admin_email and admin_password and not admin_password.startswith("replace-with"):
        store.create_account(
            email=admin_email,
            display_name="Internal administrator",
            plan="lab",
            password=admin_password,
            role="admin",
        )
    return store
