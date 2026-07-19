from __future__ import annotations

import os
import urllib.error
import urllib.request
from typing import Any, Callable


_settings_provider: Callable[[], dict[str, Any]] | None = None


def configure_settings_provider(provider: Callable[[], dict[str, Any]] | None) -> None:
    global _settings_provider
    _settings_provider = provider


def _settings() -> dict[str, Any]:
    if _settings_provider is not None:
        try:
            configured = _settings_provider()
            if configured.get("base_url") and configured.get("model"):
                return configured
        except Exception:
            pass
    return {
        "provider": os.environ.get("LLM_PROVIDER", "local").strip().lower(),
        "base_url": os.environ.get("LLM_BASE_URL", "").strip(),
        "model": os.environ.get("LLM_MODEL", "").strip(),
        "api_key": os.environ.get("LLM_API_KEY", "local"),
    }


class LocalLLM:
    def complete(self, system: str, user: str) -> str:
        from openai import OpenAI

        settings = _settings()
        provider = settings.get("provider", "local")
        if provider not in {"local", "openai"}:
            raise RuntimeError(f"Unsupported LLM provider: {provider!r}")
        base_url = str(settings.get("base_url", "")).strip()
        model = str(settings.get("model", "")).strip()
        if not base_url or not model:
            raise RuntimeError("Configure an LLM API URL and model in the internal admin settings or environment.")
        client = OpenAI(
            base_url=base_url,
            api_key=str(settings.get("api_key", "local")),
            timeout=float(os.environ.get("LLM_TIMEOUT_SECONDS", "60")),
        )
        resp = client.chat.completions.create(
            model=model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        return resp.choices[0].message.content or ""


def health_status() -> str:
    settings = _settings()
    base_url = settings.get("base_url")
    if not base_url:
        return "unconfigured"
    try:
        req = urllib.request.Request(
            base_url.rstrip("/") + "/models",
            headers={"Authorization": f"Bearer {settings.get('api_key', 'local')}"},
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            return "ok" if resp.status < 500 else "unreachable"
    except (OSError, urllib.error.URLError):
        return "unreachable"
