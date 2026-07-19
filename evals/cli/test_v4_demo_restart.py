from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_static_server_reuses_port_after_an_immediate_restart():
    server = (ROOT / "scripts" / "static_server.py").read_text(encoding="utf-8")

    assert "class ReusableTCPServer" in server
    assert "allow_reuse_address = True" in server
    assert 'with ReusableTCPServer(("", PORT), Handler)' in server
