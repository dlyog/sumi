from __future__ import annotations

import json
import struct
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[2]
PUBLIC = PROJECT / "public"


def _png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", data[16:24])


def test_pwa_manifest_worker_and_icons_are_installable():
    manifest = json.loads((PUBLIC / "manifest.webmanifest").read_text(encoding="utf-8"))
    worker = (PUBLIC / "service-worker.js").read_text(encoding="utf-8")
    index = (PUBLIC / "index.html").read_text(encoding="utf-8")

    assert manifest["name"] == "1StopQuantum"
    assert manifest["display"] == "standalone"
    assert manifest["start_url"] == "/?source=pwa"
    assert {icon["sizes"] for icon in manifest["icons"]} >= {"192x192", "512x512"}
    assert _png_size(PUBLIC / "icons" / "quantumyog-192.png") == (192, 192)
    assert _png_size(PUBLIC / "icons" / "quantumyog-512.png") == (512, 512)
    assert "quantumyog-cache-" in worker
    assert "networkFirst" in worker
    assert "caches.delete" in worker
    assert 'rel="manifest"' in index
    assert "navigator.serviceWorker" in index and ".register(" in index
    assert 'updateViaCache: "none"' in index


def test_managed_restart_rotates_the_browser_cache_version():
    manager = (PROJECT / "manage.sh").read_text(encoding="utf-8")
    static_server = (PROJECT / "scripts" / "static_server.py").read_text(encoding="utf-8")
    dev_server = (PROJECT / "scripts" / "dev-server.js").read_text(encoding="utf-8")

    assert "refresh_build_id" in manager
    assert "build-id" in manager
    assert "QYOG_BUILD_ID" in static_server
    assert "do_HEAD" in static_server
    assert "Cache-Control" in static_server and "no-store" in static_server
    assert "QYOG_BUILD_ID" in dev_server
    assert "cache-control" in dev_server and "no-store" in dev_server


def test_beginner_flow_starts_from_a_classical_bit_without_assumed_vocabulary():
    index = (PUBLIC / "index.html").read_text(encoding="utf-8")
    app = (PUBLIC / "app.js").read_text(encoding="utf-8")

    assert 'data-testid="beginner-flow"' in index
    assert "Start with what you know" in index
    assert "One switch stores either 0 or 1" in index
    assert "Prepare" in app and "Transform" in app and "Measure" in app
    assert "visualSteps" in app
