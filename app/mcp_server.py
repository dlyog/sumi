from __future__ import annotations

import os
from typing import Any

from mcp.server.fastmcp import FastMCP

from .engine import run
from .llm import LocalLLM, configure_settings_provider
from .manifest import manifest_from_ir
from .nl2circuit import known_request_fallback, translate_with_fidelity
from .persistence import store_from_environment
from .simplify import describe_ir


WIDGET_URI = "ui://quantumyog/circuit-visualizer-v1.html"
WIDGET_MIME = "text/html;profile=mcp-app"

_mcp_store = store_from_environment()
configure_settings_provider(lambda: _mcp_store.get_llm_settings(include_secret=True))


WIDGET_HTML = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#10181d;--panel:#162128;--line:#31414a;--text:#edf3f5;--muted:#a1b0b8;--teal:#5bd4c4;--amber:#efb452}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.45 ui-sans-serif,system-ui,sans-serif}
main{padding:14px}header{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:10px}
h1{margin:0;font-size:16px;letter-spacing:0}.badge{color:var(--teal);font:700 10px ui-monospace,monospace}.summary{margin:10px 0;color:var(--muted)}
.circuit{display:grid;gap:8px;border:1px solid var(--line);border-radius:6px;padding:12px;background:var(--panel);overflow:auto}.wire{display:flex;align-items:center;min-width:max-content}
.wire-label{width:28px;color:var(--muted);font:11px ui-monospace,monospace}.line{height:1px;width:16px;background:#61717a}.gate{display:grid;place-items:center;min-width:31px;height:31px;margin:0 3px;border:1px solid var(--teal);border-radius:4px;color:var(--teal);font:700 10px ui-monospace,monospace}.gate.two{border-color:var(--amber);color:var(--amber)}
.hist{display:grid;gap:7px;margin-top:12px}.bar{display:grid;grid-template-columns:30px 1fr 48px;gap:8px;align-items:center;color:var(--muted);font:10px ui-monospace,monospace}.track{height:7px;background:#28353d}.fill{height:100%;background:var(--amber)}
.empty{color:var(--muted)}
</style></head><body><main><header><h1>1StopQuantum circuit</h1><span class="badge">SIMULATED</span></header><p class="summary" id="summary">Waiting for circuit data…</p><div class="circuit" id="circuit"></div><div class="hist" id="hist"></div></main>
<script>
const summary=document.getElementById('summary'),circuit=document.getElementById('circuit'),hist=document.getElementById('hist');
function gateTouches(g,q){return (g.targets||[]).includes(q)||(g.controls||[]).includes(q)}
function render(data){if(!data?.ir){circuit.innerHTML='<p class="empty">No circuit result yet.</p>';return}summary.textContent=data.interpretation||'Validated circuit';circuit.replaceChildren();
for(let q=0;q<data.ir.num_qubits;q++){const row=document.createElement('div');row.className='wire';const label=document.createElement('span');label.className='wire-label';label.textContent='q'+q;row.append(label);for(const gate of data.ir.gates){const line=document.createElement('i');line.className='line';row.append(line);if(gateTouches(gate,q)){const node=document.createElement('b');node.className='gate '+((gate.controls||[]).length||gate.targets.length>1?'two':'');node.textContent=gate.op==='measure'?'M':gate.op;node.title=gate.op;row.append(node)}else{const gap=document.createElement('span');gap.style.width='37px';row.append(gap)}}circuit.append(row)}
hist.replaceChildren();const total=Object.values(data.counts||{}).reduce((a,b)=>a+b,0)||1;for(const [state,count] of Object.entries(data.counts||{})){const row=document.createElement('div');row.className='bar';const pct=100*count/total;row.innerHTML='<b>'+state+'</b><i class="track"><i class="fill" style="display:block;width:'+pct.toFixed(1)+'%"></i></i><span>'+pct.toFixed(1)+'%</span>';hist.append(row)}}
render(window.openai?.toolOutput);window.addEventListener('openai:set_globals',event=>render(event.detail?.globals?.toolOutput||window.openai?.toolOutput),{passive:true});
</script></body></html>"""


def visualize_quantum_circuit(text: str, backend: str = "qiskit") -> dict[str, Any]:
    if backend not in {"qiskit", "cirq"}:
        raise ValueError("backend must be qiskit or cirq")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("text is required")
    try:
        outcome = translate_with_fidelity(text, LocalLLM())
        ir = outcome.ir
        warning = outcome.warning
    except Exception:
        ir = known_request_fallback(text)
        if ir is None:
            raise
        warning = None
    simulated = run(ir, backend=backend)
    structured = {
        "ir": simulated.ir,
        "counts": simulated.counts,
        "statevector": simulated.statevector,
        "bloch": simulated.bloch,
        "interpretation": describe_ir(simulated.ir),
        "warning": warning,
        "manifest": manifest_from_ir(
            simulated.ir,
            name="chatgpt-circuit",
            backend=backend,
            description="Generated through the 1StopQuantum ChatGPT integration.",
            source_prompt=text,
        ),
        "execution": {"backend": backend, "engine": simulated.engine, "simulated": True},
    }
    return {
        "structuredContent": structured,
        "content": [{"type": "text", "text": f"1StopQuantum simulated: {structured['interpretation']}"}],
        "_meta": {
            "ui": {"resourceUri": WIDGET_URI},
            "openai/outputTemplate": WIDGET_URI,
        },
    }


def circuit_widget_resource() -> dict[str, Any]:
    return {
        "uri": WIDGET_URI,
        "mimeType": WIDGET_MIME,
        "text": WIDGET_HTML,
        "_meta": {"ui": {"prefersBorder": True}},
    }


mcp = FastMCP(
    "1StopQuantum",
    instructions=(
        "Use visualize_quantum_circuit when a user asks to build, explain, or simulate a quantum circuit. "
        "All returned execution is local simulation; never describe it as real QPU execution."
    ),
    host=os.getenv("MCP_HOST", "127.0.0.1"),
    port=int(os.getenv("MCP_PORT", "8001")),
    streamable_http_path="/mcp",
    stateless_http=True,
    json_response=True,
)


@mcp.resource(
    WIDGET_URI,
    name="1StopQuantum circuit visualizer",
    description="Interactive circuit and simulated measurement visualization for ChatGPT.",
    mime_type=WIDGET_MIME,
    meta={"ui": {"prefersBorder": True}},
)
def circuit_widget() -> str:
    return WIDGET_HTML


@mcp.tool(
    name="visualize_quantum_circuit",
    title="Build and visualize a quantum circuit",
    description=(
        "Translate a natural-language quantum circuit request into validated Circuit IR, run it on a local "
        "Qiskit or Cirq simulator, and render the circuit and outcomes. Use for circuits and algorithms, not "
        "general quantum-computing questions."
    ),
    meta={
        "ui": {"resourceUri": WIDGET_URI},
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "Building the simulated circuit…",
        "openai/toolInvocation/invoked": "Circuit simulation complete.",
    },
    structured_output=True,
)
def chatgpt_visualize(text: str, backend: str = "qiskit") -> dict[str, Any]:
    return visualize_quantum_circuit(text, backend)["structuredContent"]


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
