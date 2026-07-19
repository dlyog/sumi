from __future__ import annotations

import base64
import json
import os
import re
import secrets
import time
from html import escape
from pathlib import Path
from threading import Event, Thread
from urllib.error import HTTPError, URLError
from urllib.request import Request as URLRequest, urlopen

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from starlette.concurrency import run_in_threadpool

from .benchmarking import assess_claim, digest, forecast, overview, recommend, use_cases
from .drug import score_molecule
from .engine import run
from .ir import IRValidationError, normalize_ir
from .llm import LocalLLM, configure_settings_provider, health_status
from .manifest import (
    ManifestValidationError,
    default_manifest_name,
    dump_manifest,
    load_manifest,
    manifest_from_ir,
)
from .media import ImageGenerationRequest, generate_lesson_image
from .mcp_server import visualize_quantum_circuit
from .nl2circuit import IRValidationError as NLIRValidationError
from .nl2circuit import (
    NotACircuitError,
    TranslationOutcome,
    known_request_fallback,
    translate,
    translate_with_fidelity,
)
from .providers import QUBOValidationError, provider_catalog, route_intent, run_qubo
from .persistence import AuthenticationError, PostgresStore, store_from_environment
from .simplify import describe_ir
from .templates import expand_template


app = FastAPI(title="1StopQuantum local simulator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _request_kokoro(kokoro_url: str, text: str) -> bytes:
    body = json.dumps({"text": text, "voice": "af_heart", "speed": 0.94}).encode("utf-8")
    upstream = URLRequest(f"{kokoro_url}/api/speak", data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(upstream, timeout=20) as result:
            return result.read()
    except HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Kokoro returned HTTP {exc.code}") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=503, detail="Kokoro service is unavailable") from exc


@app.post("/api/v1/co-teacher/speak")
async def co_teacher_speak(request: Request) -> Response:
    """Proxy bounded narration requests to the configured Kokoro service."""
    payload = await request.json()
    text = str(payload.get("text", "")).strip()
    if not text or len(text) > 1200:
        raise HTTPException(status_code=400, detail="Narration text must contain 1 to 1200 characters")
    kokoro_url = os.environ.get("KOKORO_API_URL", "http://127.0.0.1:5152").rstrip("/")
    return Response(content=await run_in_threadpool(_request_kokoro, kokoro_url, text), media_type="audio/wav")


SUMI_REGISTRY_PATH = Path(__file__).resolve().parents[1] / "public" / "sumi-screen-registry.json"
SUMI_SCREEN_REGISTRY = json.loads(SUMI_REGISTRY_PATH.read_text(encoding="utf-8"))
CO_TEACHER_ACTIONS = {str(item["id"]) for item in SUMI_SCREEN_REGISTRY["actions"]}


def _registered_sumi_intent(normalized: str, screen_id: str = "circuits") -> tuple[str, str] | None:
    """Resolve safety-critical commands and cached explanations from the registry."""
    screen = SUMI_SCREEN_REGISTRY.get("screens", {}).get(screen_id, {})
    allowed_actions = set(screen.get("allowed_actions", []))
    action_matches: list[tuple[int, str]] = []
    for entry in SUMI_SCREEN_REGISTRY["actions"]:
        action_id = str(entry["id"])
        if action_id not in allowed_actions:
            continue
        for alias in entry.get("aliases", []):
            normalized_alias = str(alias).lower()
            if normalized_alias and normalized_alias in normalized:
                action_matches.append((len(normalized_alias), action_id))
    critical_matches = [match for match in action_matches if match[1] in {"skip_intro", "stop_conversation"}]
    if critical_matches:
        return max(critical_matches)[1], ""
    explanation_requested = normalized.endswith("?") or any(
        normalized.startswith(prefix) for prefix in ("what is ", "what does ", "explain ", "tell me about ", "teach me ")
    )
    if explanation_requested:
        matches = []
        allowed_terms = set(screen.get("term_ids", []))
        for term in SUMI_SCREEN_REGISTRY.get("terms", []):
            if allowed_terms and str(term["id"]) not in allowed_terms:
                continue
            if not allowed_terms and screen_id != "circuits":
                continue
            for alias in term.get("aliases", []):
                if str(alias).lower() in normalized:
                    matches.append((len(str(alias)), str(term["id"])))
        if matches:
            return "explain_term", max(matches)[1]
    parameterized_circuit_actions = {
        "load_template", "describe_and_run_circuit", "read_measurement_results", "show_bloch_qubit", "export_circuit"
    }
    bounded_matches = [
        match for match in action_matches
        if match[1] not in {"answer_question", "unsupported"}
        and (screen_id != "circuits" or match[1] in parameterized_circuit_actions)
    ]
    if bounded_matches:
        return max(bounded_matches)[1], ""
    return None


@app.post("/api/v1/co-teacher/answer")
async def co_teacher_answer(request: Request) -> dict[str, str]:
    """Answer a learner question without granting the model any UI actions."""
    payload = await request.json()
    text = str(payload.get("text", "")).strip()
    if not text or len(text) > 1000:
        raise HTTPException(status_code=400, detail="Question must contain 1 to 1000 characters")
    supplied_context = payload.get("context", {})
    context = supplied_context if isinstance(supplied_context, dict) else {}
    screens = SUMI_SCREEN_REGISTRY.get("screens", {})
    requested_screen_id = str(context.get("screen_id", "circuits"))
    screen_id = requested_screen_id if requested_screen_id in screens else "circuits"
    screen_config = screens[screen_id]
    screen = str(screen_config.get("title", "Algorithm Studio"))[:80]
    description = str(screen_config.get("description", ""))[:1200]
    concepts = [str(item)[:80] for item in screen_config.get("concepts", [])[:20]]
    supplied_visible_state = context.get("visible_state", {})
    visible_state = supplied_visible_state if isinstance(supplied_visible_state, dict) else {}
    safe_visible_state = {
        str(key)[:50]: str(value)[:180]
        for key, value in list(visible_state.items())[:20]
        if isinstance(value, (str, int, float, bool)) or value is None
    }
    try:
        qubits = max(0, min(64, int(context.get("qubits", 0))))
        operations = max(0, min(10000, int(context.get("operations", 0))))
    except (TypeError, ValueError):
        qubits, operations = 0, 0
    system = (
        "You are Sumi, the voice-first AI Co-Teacher in 1StopQuantum. Return exactly one JSON object with one key named answer. "
        "The answer value must be one natural, spoken-friendly answer of no more than 100 words. "
        "Use accurate, stable quantum-computing concepts and the supplied deterministic application context. "
        "If the request is ambiguous or you are uncertain, say so honestly and offer a specific safe next question or experiment. "
        "Never claim that you operated, clicked, simulated, measured, or verified anything. Never return code, selectors, or an action request. "
        "The application, not you, is the authority for circuit and simulation results."
    )
    user = (
        f"Current screen: {screen}. Registered screen purpose: {description} "
        f"Registered concepts: {', '.join(concepts)}. Visible state: {json.dumps(safe_visible_state, ensure_ascii=True)}. "
        f"Current circuit: {qubits} qubits and {operations} operations. "
        f"Learner question: {text}\nAnswer conversationally now."
    )
    try:
        raw_answer = str(await run_in_threadpool(LocalLLM().complete, system, user)).strip()
        try:
            first, last = raw_answer.find("{"), raw_answer.rfind("}")
            decoded_answer = json.loads(raw_answer[first:last + 1] if first >= 0 and last > first else raw_answer)
            answer = str(decoded_answer.get("answer", "")).strip() if isinstance(decoded_answer, dict) else raw_answer
        except json.JSONDecodeError:
            answer = raw_answer
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The configured co-teacher is unavailable") from exc
    if not answer:
        raise HTTPException(status_code=503, detail="The configured co-teacher returned no answer")
    return {"answer": answer[:1200]}


@app.post("/api/v1/co-teacher/route")
async def co_teacher_route(request: Request) -> dict[str, object]:
    """Use the configured LLM only to classify a turn into a bounded action."""
    payload = await request.json()
    text = str(payload.get("text", "")).strip()
    if not text or len(text) > 1000:
        raise HTTPException(status_code=400, detail="Request text must contain 1 to 1000 characters")
    requested_screen = str(payload.get("screen_id", "circuits"))
    screens = SUMI_SCREEN_REGISTRY.get("screens", {})
    screen_id = requested_screen if requested_screen in screens else "circuits"
    screen = screens[screen_id]
    include_args = bool(payload.get("include_args", False))
    allowed_actions = set(screen.get("allowed_actions", CO_TEACHER_ACTIONS))
    action_descriptions = {
        str(entry["id"]): str(entry.get("description", ""))
        for entry in SUMI_SCREEN_REGISTRY.get("actions", [])
        if str(entry["id"]) in allowed_actions
    }
    system = (
        f"You are an intent classifier for the {screen['title']} screen. Output exactly one JSON object with keys action and experiment and no prose. "
        f"action must be exactly one of: {', '.join(sorted(allowed_actions))}. "
        f"The registered screen purpose is: {screen.get('description', '')} "
        f"The registered concepts are: {', '.join(str(item) for item in screen.get('concepts', []))}. "
        f"Registered action meanings: {json.dumps(action_descriptions, ensure_ascii=True)}. "
        "Use guided_experiment when the learner asks both how to use the screen and to perform or show an experiment. "
        "Use explain_experiments when the learner asks to run an algorithm or experiment but does not name one, or asks what experiments are available. "
        "Use run_named_experiment with experiment set to bell, ghz, hadamard, rotation, grover, deutsch_jozsa, or qrng when the learner names one of those experiments. "
        "Use build_experiment only when the learner clearly describes a quantum circuit or experiment. "
        "Use skip_intro when the learner wants to skip or end only the introduction. Use stop_conversation when the learner wants Sumi to stop or turn off. "
        "Use explain_term with experiment set to the registered term id when the learner asks about a named screen concept. "
        "Use answer_question for conceptual questions, explanations, greetings, or natural conversation that does not require changing the screen. "
        "Use unsupported when no registered action clearly matches. "
        "Never invent controls, selectors, results, or executable code."
        + (" For a parameterized UI action, include an args object containing only the registered action parameters." if include_args else "")
    )
    try:
        user = f"Current screen: {screen['title']}. Learner request: {text}\nReturn the JSON object now."
        raw = await run_in_threadpool(LocalLLM().complete, system, user)
        first, last = raw.find("{"), raw.rfind("}")
        result = json.loads(raw[first:last + 1] if first >= 0 and last > first else raw)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The configured action router is unavailable") from exc
    action = str(result.get("action", ""))
    if action not in CO_TEACHER_ACTIONS:
        raise HTTPException(status_code=422, detail="The model returned an unsupported action")
    if action not in allowed_actions:
        action = "unsupported"
        result["experiment"] = ""
    normalized = " ".join(
        "".join(character if character.isalnum() or character in "-_" else " " for character in text.lower()).split()
    )
    has_question_mark = text.rstrip().endswith("?")
    registered_intent = _registered_sumi_intent(normalized, screen_id)
    asks_concept_question = (
        has_question_mark
        or any(normalized.startswith(prefix) for prefix in ("what ", "why ", "explain ", "tell me about "))
    ) and not any(verb in normalized for verb in ("run", "perform", "demonstrate", "select"))
    requested_named_experiment = ""
    named_experiments = (
        ("deutsch_jozsa", ("deutsch-jozsa", "deutsch jozsa", "deutsch", "jozsa")),
        ("qrng", ("quantum random number", "random number", "qrng")),
        ("hadamard", ("hadamard", "superposition")),
        ("rotation", ("rotation", "rotate")),
        ("grover", ("grover",)),
        ("bell", ("bell", "bell pair")),
        ("ghz", ("ghz",)),
    )
    action_verbs = ("run", "show", "perform", "try", "demonstrate", "start", "select")
    question_words = ("what", "why", "how", "when", "where", "who", "explain", "teach")
    for experiment_name, markers in named_experiments:
        exact_name = normalized in markers
        requests_action = any(verb in normalized for verb in action_verbs)
        asks_question = has_question_mark or any(normalized.startswith(f"{word} ") for word in question_words)
        if (
            any(marker in normalized for marker in markers)
            and not any(code in normalized for code in ("qiskit", "cirq"))
            and (exact_name or (requests_action and not asks_question))
        ):
            requested_named_experiment = experiment_name
            break
    requests_unspecified_experiment = (
        any(verb in normalized for verb in ("run", "show", "perform", "try"))
        and any(noun in normalized for noun in ("algorithm", "experiment"))
        and "current" not in normalized
        and not any(
            specific in normalized
            for specific in (
                "bell",
                "ghz",
                "hadamard",
                "grover",
                "deutsch",
                "jozsa",
                "qrng",
                "random number",
                "rotation",
                "rotate",
            )
        )
    )
    experiment = str(result.get("experiment", text))[:1000]
    if registered_intent and registered_intent[0] in allowed_actions:
        action, experiment = registered_intent
    elif screen_id == "learn" and any(level in normalized for level in ("high school", "undergraduate", "masters", "master's")) and any(word in normalized for word in ("switch", "move", "set", "change", "level", "track")):
        action, experiment = "set_learning_level", ""
    elif screen_id == "learn" and "lesson" in normalized and any(marker in normalized for marker in ("bits and qubits", "bloch sphere", "gates and circuits", "measurement and shots", "01.1", "01.2", "01.3", "01.4")):
        action, experiment = "open_lesson", ""
    elif screen_id == "circuits" and "sample prompt" in normalized and any(word in normalized for word in ("run", "perform", "select")):
        action, experiment = "run_simulation", ""
    elif screen_id == "circuits" and "template" in normalized and any(marker in normalized for marker in ("grover", "ghz", "deutsch", "qrng", "random")):
        action, experiment = "load_template", ""
    elif screen_id == "circuits" and ("measurement" in normalized or "measured" in normalized) and any(word in normalized for word in ("read", "what", "result", "outcome")):
        action, experiment = "read_measurement_results", ""
    elif screen_id == "circuits" and re.search(r"\bq(?:ubit)?\s*\d+\b", normalized) and any(word in normalized for word in ("show", "switch", "display")):
        action, experiment = "show_bloch_qubit", ""
    elif screen_id == "circuits" and any(fmt in normalized for fmt in ("svg", "png")) and any(word in normalized for word in ("export", "download", "save")):
        action, experiment = "export_circuit", ""
    elif screen_id == "circuits" and requested_named_experiment:
        action = "run_named_experiment"
        experiment = requested_named_experiment
    elif asks_concept_question:
        action = "answer_question"
        experiment = ""
    elif screen_id == "circuits" and requests_unspecified_experiment and action != "guided_experiment":
        # Explicit imperatives execute the current circuit. Catalogue requests
        # remain explanatory (for example, "what algorithms are available?").
        if any(word in normalized for word in ("run", "perform", "try")) and not has_question_mark:
            action = "run_simulation"
        else:
            action = "explain_experiments"
        experiment = ""
    if action in {"skip_intro", "stop_conversation", "unsupported"}:
        experiment = ""
    response: dict[str, object] = {"action": action, "experiment": experiment}
    if include_args:
        model_args = result.get("args", {})
        args = model_args if isinstance(model_args, dict) else {}
        if action == "set_learning_level":
            if "undergraduate" in normalized:
                args = {"level": "Undergraduate"}
            elif "master" in normalized:
                args = {"level": "Master's"}
            elif "high school" in normalized or "high-school" in normalized:
                args = {"level": "High school"}
        elif action == "open_lesson":
            match = re.search(r"(?:lesson\s*)?(\d+\.\d+|state and the bloch sphere|gates and circuits|measurement and shots|bits and qubits)", text, re.IGNORECASE)
            if match:
                args = {"lesson": match.group(1)}
        elif action == "load_template":
            template_args = ("deutsch_jozsa" if "deutsch" in normalized else "grover" if "grover" in normalized else "ghz" if "ghz" in normalized else "qrng" if "qrng" in normalized or "random" in normalized else "")
            if template_args:
                args = {"template": template_args}
            elif "sample prompt" in normalized:
                action = "run_simulation"
        elif action == "describe_and_run_circuit":
            args = {"description": text}
        elif action == "show_bloch_qubit":
            match = re.search(r"(?:q(?:ubit)?\s*)(\d+)", normalized)
            if match:
                args = {"qubit": int(match.group(1))}
        elif action == "export_circuit":
            args = {"format": "png" if "png" in normalized else "svg"}
        response["args"] = args
        response["action"] = action
    return response

_default_translate = translate
platform_store = store_from_environment()
configure_settings_provider(lambda: platform_store.get_llm_settings(include_secret=True))
admin_sessions: dict[str, str] = {}
community_submission_windows: dict[str, list[float]] = {}
recovery_attempt_windows: dict[str, list[float]] = {}
_scheduler_stop = Event()
_scheduler_thread: Thread | None = None


def _translate_request(text: str, llm: LocalLLM) -> TranslationOutcome:
    # Keep the v0.1 endpoint's monkeypatch hook while using the richer v0.2 path.
    if translate is not _default_translate:
        return TranslationOutcome(ir=translate(text, llm))
    return translate_with_fidelity(text, llm)


def _result_payload(ir: dict, backend: str, cursor: int | None = None) -> dict:
    res = run(ir, backend=backend, cursor=cursor)
    manifest = manifest_from_ir(res.ir, backend=backend)
    return {
        "ir": res.ir,
        "counts": res.counts,
        "statevector": res.statevector,
        "bloch": res.bloch,
        "execution": {"backend": res.backend, "engine": res.engine, "simulated": res.simulated},
        "source": {
            "qiskit": res.qiskit_source,
            "cirq": res.cirq_source,
            "manifest": dump_manifest(manifest),
        },
        "manifest": manifest,
        "simplification": {"removed": res.simplified_removed},
        "interpretation": describe_ir(res.ir),
        "cursor": res.cursor,
        "step_count": res.step_count,
        "entanglement": res.entanglement or [],
    }


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "simulator": "ok",
        "llm": health_status(),
        "database": platform_store.health(),
        "mcp": "http://127.0.0.1:8001/mcp",
    }


@app.post("/accounts/signup", status_code=201)
def signup_endpoint(body: dict) -> dict:
    try:
        return platform_store.create_account(
            email=body.get("email"),
            display_name=body.get("display_name"),
            plan=body.get("plan", "explorer"),
            password=body.get("password"),
            password_hint=body.get("password_hint"),
            recovery_question=body.get("recovery_question"),
            recovery_answer=body.get("recovery_answer"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/accounts/signin")
def signin_endpoint(body: dict) -> dict:
    try:
        return platform_store.authenticate_account(
            email=body.get("email"),
            password=body.get("password"),
        )
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.post("/accounts/recovery/challenge")
def account_recovery_challenge_endpoint(body: dict) -> dict:
    try:
        return platform_store.recovery_challenge(body.get("email"))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/accounts/recovery/reset")
def account_recovery_reset_endpoint(body: dict) -> dict:
    email = str(body.get("email", "")).strip().lower()
    now = time.monotonic()
    attempts = [stamp for stamp in recovery_attempt_windows.get(email, []) if now - stamp < 300]
    if len(attempts) >= 5:
        raise HTTPException(status_code=429, detail="too many recovery attempts; try again in five minutes")
    attempts.append(now)
    recovery_attempt_windows[email] = attempts
    try:
        result = platform_store.reset_password(
            email=email,
            recovery_answer=body.get("recovery_answer"),
            new_password=body.get("new_password"),
        )
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    recovery_attempt_windows.pop(email, None)
    return result


@app.get("/accounts/{user_id}")
def account_endpoint(user_id: str) -> dict:
    account = platform_store.get_account(user_id)
    if account is None:
        raise HTTPException(status_code=404, detail="account not found")
    return account


@app.post("/analytics/events", status_code=202)
def analytics_event_endpoint(body: dict) -> dict:
    try:
        return platform_store.record_event(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/feedback", status_code=201)
def feedback_endpoint(body: dict) -> dict:
    try:
        return platform_store.save_feedback(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/feedback/summary/{content_id}")
def feedback_summary_endpoint(content_id: str) -> dict:
    if not content_id or len(content_id) > 120:
        raise HTTPException(status_code=422, detail="content_id must be 1 to 120 characters")
    return platform_store.feedback_summary(content_id)


@app.post("/admin/signin")
def admin_signin_endpoint(body: dict) -> dict:
    try:
        account = platform_store.authenticate_account(email=body.get("email"), password=body.get("password"))
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    if account.get("role") != "admin":
        raise HTTPException(status_code=403, detail="internal admin access required")
    token = secrets.token_urlsafe(32)
    admin_sessions[token] = account["id"]
    return {"token": token, "account": account}


def _require_admin(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="admin session required")
    token = authorization.removeprefix("Bearer ").strip()
    account_id = admin_sessions.get(token)
    account = platform_store.get_account(account_id) if account_id else None
    if not account or account.get("role") != "admin":
        raise HTTPException(status_code=403, detail="internal admin access required")
    return account


@app.get("/admin/analytics")
def admin_analytics_endpoint(authorization: str | None = Header(default=None)) -> dict:
    _require_admin(authorization)
    return platform_store.analytics_summary()


@app.get("/admin/llm-settings")
def admin_llm_settings_endpoint(authorization: str | None = Header(default=None)) -> dict:
    _require_admin(authorization)
    return platform_store.get_llm_settings()


@app.put("/admin/llm-settings")
def update_admin_llm_settings_endpoint(body: dict, authorization: str | None = Header(default=None)) -> dict:
    account = _require_admin(authorization)
    try:
        return platform_store.save_llm_settings(body, account["id"])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.put("/admin/password")
def update_admin_password_endpoint(body: dict, authorization: str | None = Header(default=None)) -> dict:
    account = _require_admin(authorization)
    try:
        result = platform_store.change_password(account["id"], body.get("current_password"), body.get("new_password"))
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # A changed credential invalidates every active internal session.
    admin_sessions.clear()
    return result


@app.get("/admin/community/submissions")
def admin_community_submissions_endpoint(authorization: str | None = Header(default=None)) -> dict:
    _require_admin(authorization)
    return {"items": platform_store.list_community_submissions()}


@app.put("/admin/community/submissions/{submission_id}")
def admin_community_moderate_endpoint(
    submission_id: str, body: dict, authorization: str | None = Header(default=None)
) -> dict:
    account = _require_admin(authorization)
    try:
        return platform_store.moderate_community(submission_id, body, account["id"])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/admin/community/submissions/{submission_id}/audit")
def admin_community_audit_endpoint(submission_id: str, authorization: str | None = Header(default=None)) -> dict:
    _require_admin(authorization)
    return {"items": platform_store.community_audit(submission_id)}


@app.delete("/admin/session", status_code=204)
def admin_logout_endpoint(authorization: str | None = Header(default=None)) -> None:
    _require_admin(authorization)
    token = authorization.removeprefix("Bearer ").strip()
    admin_sessions.pop(token, None)


def _public_data(name: str) -> dict:
    path = Path(__file__).resolve().parents[1] / "public" / "data" / name
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/v1/use-cases")
def use_case_catalog_endpoint() -> dict:
    return _public_data("use_cases.json")


@app.get("/api/v1/content/catalog")
def public_content_catalog_endpoint() -> dict:
    curriculum = _public_data("quantum_curriculum.json")
    use_case_catalog = _public_data("use_cases.json")
    podcast = _public_data("podcast_catalog.json")
    return {
        "schema_version": "1.0",
        "product": "1StopQuantum",
        "courses": [{"id": item["id"], "title": item["title"], "lesson_count": len(item["lessons"])} for item in curriculum["courses"]],
        "use_case_domains": sorted({item["domain"] for item in use_case_catalog["use_cases"]}),
        "podcast_episodes": [{"id": item["id"], "title": item["title"]} for item in podcast["episodes"]],
        "documentation": ["/docs/ACADEMIC_GUIDE.md", "/docs/COMMUNITY_API.md", "/docs/BENCHMARK_INTELLIGENCE.md"],
        "attribution": "See /credits.html and source links in each catalog.",
    }


@app.get("/api/v1/podcast/catalog")
def podcast_catalog_endpoint(request: Request) -> dict:
    payload = _public_data("podcast_catalog.json")
    base_url = str(request.base_url).rstrip("/")
    for episode in payload["episodes"]:
        episode["audio_url"] = f"{base_url}{episode['audio']}"
        episode["transcript_url"] = f"{base_url}/api/v1/podcast/episodes/{episode['id']}/transcript"
    payload["feed_url"] = f"{base_url}/api/v1/podcast/feed.xml"
    return payload


@app.get("/api/v1/podcast/episodes/{episode_id}/transcript")
def podcast_transcript_endpoint(episode_id: str) -> dict:
    episode = next((item for item in _public_data("podcast_catalog.json")["episodes"] if item["id"] == episode_id), None)
    if episode is None:
        raise HTTPException(status_code=404, detail="podcast episode not found")
    return {
        "schema_version": "1.0", "id": episode["id"], "title": episode["title"],
        "chapters": episode["chapters"], "transcript": episode["transcript"],
    }


@app.get("/api/v1/podcast/feed.xml")
def podcast_feed_endpoint(request: Request) -> Response:
    catalog = podcast_catalog_endpoint(request)
    items = []
    for episode in catalog["episodes"]:
        items.append(
            "<item>"
            f"<guid isPermaLink=\"false\">{escape(episode['id'])}</guid>"
            f"<title>{escape(episode['title'])}</title>"
            f"<description>{escape(episode['summary'])}</description>"
            f"<pubDate>{escape(episode['published'])} 12:00:00 GMT</pubDate>"
            f"<enclosure url=\"{escape(episode['audio_url'])}\" type=\"audio/wav\" length=\"{episode.get('bytes', 0)}\"/>"
            f"<itunes:duration>{int(episode['duration_seconds'])}</itunes:duration>"
            "</item>"
        )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>'
        f"<title>{escape(catalog['title'])}</title><description>{escape(catalog['description'])}</description>"
        f"<link>{escape(str(request.base_url))}</link><language>{escape(catalog['language'])}</language>"
        + "".join(items) + "</channel></rss>"
    )
    return Response(content=xml, media_type="application/rss+xml")


def _check_submission_rate(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    cutoff = time.monotonic() - 60
    active = [stamp for stamp in community_submission_windows.get(key, []) if stamp >= cutoff]
    if len(active) >= 5:
        raise HTTPException(status_code=429, detail="submission rate limit reached; retry in one minute")
    active.append(time.monotonic())
    community_submission_windows[key] = active


@app.post("/api/v1/community/submissions", status_code=201)
def community_submission_endpoint(body: dict, request: Request) -> dict:
    _check_submission_rate(request)
    try:
        return platform_store.submit_community(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/v1/community/submissions/{submission_id}/deletion")
def community_deletion_endpoint(submission_id: str, body: dict) -> dict:
    try:
        return platform_store.request_community_deletion(submission_id, body.get("email"))
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.get("/api/v1/community/publications")
def community_publications_endpoint() -> dict:
    return {
        "schema_version": "1.0",
        "items": platform_store.community_publications(),
        "privacy": {
            "approved_only": True,
            "contact_details_exposed": False,
            "private_feedback_exposed": False,
            "raw_visitor_identifiers_exposed": False,
        },
        "attribution": "Author names and license fields apply only to approved records.",
    }


@app.get("/api/v1/community/interests")
def community_interests_endpoint() -> dict:
    return {
        "schema_version": "1.0",
        "aggregate_only": True,
        "counts": platform_store.community_interests(),
        "private_fields_exposed": False,
    }


@app.post("/improvements/jobs", status_code=201)
def create_improvement_job_endpoint(body: dict) -> dict:
    try:
        return platform_store.create_job(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/improvements/jobs")
def improvement_jobs_endpoint(user_id: str) -> list[dict]:
    return platform_store.list_jobs(user_id)


@app.get("/improvements/reports/{job_id}")
def improvement_report_endpoint(job_id: str):
    report = platform_store.report_path(job_id)
    if report is None or not report.is_file():
        raise HTTPException(status_code=404, detail="improvement report not found")
    return FileResponse(report, media_type="text/html")


@app.post("/integrations/chatgpt/visualize")
def chatgpt_visualize_endpoint(body: dict) -> dict:
    try:
        result = visualize_quantum_circuit(body.get("text", ""), body.get("backend", "qiskit"))
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    payload = result["structuredContent"]
    encoded = base64.urlsafe_b64encode(json.dumps(payload["manifest"]).encode()).decode().rstrip("=")
    base_url = os.getenv("PUBLIC_APP_URL", "http://localhost:8080").rstrip("/")
    return {
        "interpretation": payload["interpretation"],
        "ir": payload["ir"],
        "counts": payload["counts"],
        "manifest": payload["manifest"],
        "visualization_url": f"{base_url}/#manifest={encoded}",
        "simulated": True,
    }


@app.get("/providers")
def providers_endpoint() -> dict:
    return provider_catalog()


@app.post("/media/images/generate", status_code=201)
def generate_image_endpoint(body: ImageGenerationRequest) -> dict:
    try:
        return generate_lesson_image(body)
    except (RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/benchmarking/overview")
def benchmarking_overview_endpoint() -> dict:
    try:
        return overview()
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/benchmarking/recommend")
def benchmarking_recommend_endpoint(body: dict) -> dict:
    try:
        return recommend(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/benchmarking/forecast")
def benchmarking_forecast_endpoint(body: dict) -> dict:
    try:
        return forecast(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/benchmarking/digest")
def benchmarking_digest_endpoint(days: int = 7) -> dict:
    try:
        return digest(days)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/benchmarking/claims/assess")
def benchmarking_claim_endpoint(body: dict) -> dict:
    try:
        return assess_claim(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/benchmarking/use-cases")
def benchmarking_use_cases_endpoint() -> dict:
    return use_cases()


@app.post("/run")
def run_endpoint(body: dict) -> dict:
    backend = body.pop("backend", "qiskit")
    cursor = body.pop("cursor", None)
    try:
        ir = normalize_ir(body)
        return _result_payload(ir, backend, cursor=cursor)
    except (IRValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/nl2circuit")
def nl2circuit_endpoint(body: dict) -> dict:
    text = body.get("text", "")
    backend = body.get("backend", "qiskit")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=422, detail="text is required")
    known = known_request_fallback(text)
    if known is not None and known["gates"][0]["op"] in {"RX", "RY", "RZ"}:
        payload = _result_payload(known, backend)
        payload["warning"] = None
        payload["simplification"] = {"removed": 0}
        payload["translation"] = {"source": "deterministic-known-request"}
        return payload
    try:
        outcome = _translate_request(text, LocalLLM())
        payload = _result_payload(outcome.ir, backend)
        payload["warning"] = outcome.warning
        payload["simplification"] = {"removed": outcome.simplified_removed}
        if outcome.template:
            payload["template"] = outcome.template
        return payload
    except NotACircuitError as exc:
        fallback = known_request_fallback(text)
        if fallback is not None:
            payload = _result_payload(fallback, backend)
            payload["translation"] = {"source": "deterministic-template-fallback"}
            return payload
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (NLIRValidationError, IRValidationError) as exc:
        fallback = known_request_fallback(text)
        if fallback is not None:
            payload = _result_payload(fallback, backend)
            payload["translation"] = {"source": "deterministic-template-fallback"}
            return payload
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        fallback = known_request_fallback(text)
        if fallback is not None:
            payload = _result_payload(fallback, backend)
            payload["translation"] = {"source": "deterministic-template-fallback"}
            return payload
        raise HTTPException(status_code=422, detail=f"Unable to generate a quantum circuit: {exc}") from exc


@app.post("/nl2manifest")
def nl2manifest_endpoint(body: dict) -> dict:
    text = body.get("text", "")
    backend = body.get("backend", "qiskit")
    name = body.get("name") or default_manifest_name(text)
    payload = nl2circuit_endpoint({"text": text, "backend": backend})
    try:
        manifest = manifest_from_ir(
            payload["ir"],
            name=name,
            backend=backend,
            description="Generated from a natural-language request.",
            source_prompt=text,
        )
    except (IRValidationError, ManifestValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    payload["manifest"] = manifest
    payload["source"]["manifest"] = dump_manifest(manifest)
    return payload


@app.post("/manifests/compile")
def manifest_compile_endpoint(body: dict) -> dict:
    document = body.get("document")
    cursor = body.get("cursor")
    if not isinstance(document, (str, dict)):
        raise HTTPException(status_code=422, detail="document must be YAML, JSON, or an object")
    try:
        parsed = load_manifest(document)
        payload = _result_payload(parsed.ir, parsed.backend, cursor=cursor)
        payload["manifest"] = parsed.manifest
        payload["source"]["manifest"] = dump_manifest(parsed.manifest)
        return payload
    except (ManifestValidationError, IRValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/drug/score")
def drug_score_endpoint(body: dict) -> dict:
    smiles = body.get("smiles", "")
    if not isinstance(smiles, str) or not smiles.strip():
        raise HTTPException(status_code=422, detail="smiles is required")
    return score_molecule(smiles)


@app.post("/templates/expand")
def template_endpoint(body: dict) -> dict:
    name = body.get("template")
    params = body.get("params", {})
    backend = body.get("backend", "qiskit")
    if not isinstance(name, str) or not name.strip() or not isinstance(params, dict):
        raise HTTPException(status_code=422, detail="template and params are required")
    try:
        ir = normalize_ir(expand_template({"template": name, "params": params}))
        payload = _result_payload(ir, backend)
        payload["template"] = {"name": name, "params": params}
        return payload
    except (IRValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/anneal")
def anneal_endpoint(body: dict) -> dict:
    try:
        return run_qubo(body)
    except (QUBOValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/route")
def route_endpoint(body: dict) -> dict:
    text = body.get("text", "")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=422, detail="text is required")
    return route_intent(text)


def _scheduler_loop() -> None:
    while not _scheduler_stop.wait(2.0):
        try:
            platform_store.run_due_jobs()
        except Exception:
            # A failed poll must not stop the API; the next interval retries.
            continue


@app.on_event("startup")
def start_improvement_scheduler() -> None:
    global _scheduler_thread
    if not isinstance(platform_store, PostgresStore) or os.getenv("QLAB_SCHEDULER", "1") != "1":
        return
    if _scheduler_thread is None or not _scheduler_thread.is_alive():
        _scheduler_stop.clear()
        _scheduler_thread = Thread(target=_scheduler_loop, name="quantumyog-scheduler", daemon=True)
        _scheduler_thread.start()


@app.on_event("shutdown")
def stop_improvement_scheduler() -> None:
    _scheduler_stop.set()
    if _scheduler_thread and _scheduler_thread.is_alive():
        _scheduler_thread.join(timeout=3)
