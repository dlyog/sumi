const API = `${window.location.protocol}//${window.location.hostname}:8000`;

const byId = (id) => document.getElementById(id);
const nlInput = byId("nlInput");
const runBtn = byId("runBtn");
const backendSelect = byId("backendSelect");
const nlError = byId("nlError");
const circuitCanvas = byId("circuitCanvas");
const histogram = byId("histogram");
const sourcePanel = byId("sourcePanel");
const sourceEditor = byId("sourceEditor");
const qiskitTab = byId("qiskitTab");
const cirqTab = byId("cirqTab");
const manifestTab = byId("manifestTab");
const learningView = byId("learning-view");
const circuitPage = byId("circuitPage");
const drugView = byId("drug-view");
const providersView = byId("providers-view");
const benchmarkingView = byId("benchmarking-view");
const guideView = byId("guide-view");
const improvementView = byId("improvement-view");
const useCasesView = byId("useCasesView");
const podcastView = byId("podcastView");
const communityView = byId("communityView");
const faqView = byId("faqView");

let lastSource = { qiskit: "", cirq: "", manifest: "" };
let currentIR = null;
let currentBloch = [];
let selectedQubit = 0;
let sourceKind = "qiskit";
let monacoEditor = null;
let moleculeObjectUrl = null;
let currentCursor = 0;
let currentStepCount = 0;
let currentEntanglement = [];
let currentResult = null;
let currentAccount = null;
let tutorialVisuals = null;
let selectedPrediction = null;
let benchmarkOverview = null;
let landscapeDates = [];
let landscapeTimer = null;
let currentDigest = null;
let curriculumData = null;
let currentCurriculumLesson = null;
let currentCurriculumCourse = null;
let activeWorkspace = "learn";
let faqData = [];
let lastTrackedPage = "";
let pendingProtectedView = null;
let useCaseData = null;
let activeUseCase = null;
let podcastData = null;
let podcastIndex = 0;
let productTours = null;
let tourStep = 0;

const PROTECTED_VIEWS = new Set(["circuits", "use-cases", "drug", "providers", "benchmarking", "improve", "podcast", "community"]);

const SESSION_KEY = "quantumyog.session.v2";
const ACCOUNT_KEY = "quantumyog.account.v1";
const LEARNING_KEY = "quantumyog.learning.v1";
const COURSE_KEY = "quantumyog.course.v1";
const VISITOR_KEY = "1stopquantum.visitor.v1";
const LIKES_KEY = "1stopquantum.likes.v1";
const ADMIN_TOKEN_KEY = "1stopquantum.admin.session";
const PODCAST_KEY = "1stopquantum.podcast.v1";

class NetworkUnavailableError extends Error {}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, options);
  } catch (error) {
    throw new NetworkUnavailableError(error.message);
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status === 404) throw new NetworkUnavailableError(`Feature unavailable: ${path}`);
  if (!response.ok) throw new Error(payload.detail || "The local service rejected this request.");
  return payload;
}

function visitorId() {
  try {
    let value = localStorage.getItem(VISITOR_KEY);
    if (!value) {
      value = window.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(VISITOR_KEY, value);
    }
    return value;
  } catch (_) {
    return "visitor-local-preview";
  }
}

function engagementIdentity() {
  return { visitor_id: visitorId(), ...(currentAccount?.id ? { user_id: currentAccount.id } : {}) };
}

function trackPageView(page) {
  if (!page || page === lastTrackedPage) return;
  lastTrackedPage = page;
  requestJson("/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...engagementIdentity(), page, event_type: "page_view" }),
  }).catch(() => {});
}

function bellIR() {
  return {
    version: "1.0",
    num_qubits: 2,
    gates: [
      { op: "H", targets: [0] },
      { op: "CNOT", controls: [0], targets: [1] },
      { op: "measure", targets: [0, 1] }
    ],
    shots: 1024,
    seed: 42
  };
}

function manifestForIR(ir, backend = backendSelect.value, name = "generated-circuit") {
  return {
    apiVersion: "quantumyog.dev/v1",
    kind: "Circuit",
    metadata: { name },
    spec: { backend, circuit: JSON.parse(JSON.stringify(ir)) }
  };
}

function yamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (/^[A-Za-z_][A-Za-z0-9_.\/-]*$/.test(value) && !["true", "false", "null"].includes(value.toLowerCase())) return value;
  return JSON.stringify(value);
}

function yamlLines(value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) {
      return [`${prefix}[${value.map(yamlScalar).join(", ")}]`];
    }
    return value.flatMap((item) => {
      if (item && typeof item === "object") {
        const lines = yamlLines(item, indent + 2);
        return [`${prefix}- ${lines[0].trimStart()}`, ...lines.slice(1)];
      }
      return [`${prefix}- ${yamlScalar(item)}`];
    });
  }
  return Object.entries(value).flatMap(([key, item]) => {
    if (item && typeof item === "object") {
      if (Array.isArray(item) && item.every((entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry))) {
        return [`${prefix}${key}: [${item.map(yamlScalar).join(", ")}]`];
      }
      return [`${prefix}${key}:`, ...yamlLines(item, indent + 2)];
    }
    return [`${prefix}${key}: ${yamlScalar(item)}`];
  });
}

function manifestYaml(manifest) {
  return `${yamlLines(manifest).join("\n")}\n`;
}

function localCompileManifest(value) {
  const manifest = typeof value === "string" ? JSON.parse(value) : value;
  if (!manifest || manifest.apiVersion !== "quantumyog.dev/v1" || manifest.kind !== "Circuit") {
    throw new Error("Manifest requires apiVersion quantumyog.dev/v1 and kind Circuit.");
  }
  if (!manifest.metadata?.name || !manifest.spec) throw new Error("Manifest metadata.name and spec are required.");
  const backend = manifest.spec.backend || "qiskit";
  if (!['qiskit', 'cirq'].includes(backend)) throw new Error("Manifest backend must be qiskit or cirq.");
  let ir;
  if (manifest.spec.circuit && !manifest.spec.template) ir = manifest.spec.circuit;
  else if (manifest.spec.template && !manifest.spec.circuit) ir = localTemplateIR(manifest.spec.template.name);
  else throw new Error("Manifest spec requires exactly one circuit or template.");
  if (ir?.version !== "1.0" || !Number.isInteger(ir.num_qubits) || !Array.isArray(ir.gates)) {
    throw new Error("Manifest circuit is not valid Circuit IR.");
  }
  return { manifest, ir, backend };
}

function localTranslate(text) {
  const lower = text.toLowerCase().trim();
  if (!lower || /weather|recipe|stock price|football/.test(lower)) {
    throw new Error("Please describe a quantum circuit or algorithm request.");
  }
  if (lower.includes("ghz")) {
    const count = Math.min(6, Math.max(2, Number(lower.match(/(\d+)[ -]?qubit/)?.[1] || 3)));
    return {
      version: "1.0",
      num_qubits: count,
      gates: [{ op: "H", targets: [0] }, ...Array.from({ length: count - 1 }, (_, index) => ({ op: "CNOT", controls: [0], targets: [index + 1] })), { op: "measure", targets: Array.from({ length: count }, (_, index) => index) }],
      shots: 1024,
      seed: 42
    };
  }
  const entangleMatch = lower.match(/\bentangle\s+(\d+|one|two|three|four|five|six)\s+qubits?\b/);
  if (entangleMatch) {
    const numbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const token = entangleMatch[1];
    const count = /^\d+$/.test(token) ? Number(token) : numbers[token];
    if (count >= 3) {
      return {
        version: "1.0",
        num_qubits: count,
        gates: [{ op: "H", targets: [0] }, ...Array.from({ length: count - 1 }, (_, index) => ({ op: "CNOT", controls: [0], targets: [index + 1] })), { op: "measure", targets: Array.from({ length: count }, (_, index) => index) }],
        shots: 1024,
        seed: 42
      };
    }
    if (count === 2) return bellIR();
    throw new Error("Entanglement requires at least two qubits.");
  }
  if (lower.includes("grover")) {
    return {
      version: "1.0",
      num_qubits: 2,
      gates: [
        { op: "H", targets: [0] }, { op: "H", targets: [1] },
        { op: "CZ", controls: [0], targets: [1] },
        { op: "H", targets: [0] }, { op: "H", targets: [1] },
        { op: "X", targets: [0] }, { op: "X", targets: [1] },
        { op: "CZ", controls: [0], targets: [1] },
        { op: "X", targets: [0] }, { op: "X", targets: [1] },
        { op: "H", targets: [0] }, { op: "H", targets: [1] },
        { op: "measure", targets: [0, 1] }
      ],
      shots: 1024,
      seed: 42
    };
  }
  if (/random|qrng/.test(lower)) {
    return { version: "1.0", num_qubits: 1, gates: [{ op: "H", targets: [0] }, { op: "measure", targets: [0] }], shots: 1024, seed: 42 };
  }
  if (/entangle|bell/.test(lower)) return bellIR();
  if (lower.includes("superposition")) {
    return { version: "1.0", num_qubits: 1, gates: [{ op: "H", targets: [0] }, { op: "measure", targets: [0] }], shots: 1024, seed: 42 };
  }
  if (/flip|pauli x/.test(lower)) {
    return { version: "1.0", num_qubits: 1, gates: [{ op: "X", targets: [0] }, { op: "measure", targets: [0] }], shots: 1024, seed: 42 };
  }
  if (/rotate|rotation/.test(lower)) {
    return { version: "1.0", num_qubits: 1, gates: [{ op: "RX", targets: [0], params: [Math.PI / 2] }, { op: "measure", targets: [0] }], shots: 1024, seed: 42 };
  }
  if (lower.includes("swap")) {
    return { version: "1.0", num_qubits: 2, gates: [{ op: "SWAP", targets: [0, 1] }, { op: "measure", targets: [0, 1] }], shots: 1024, seed: 42 };
  }
  throw new Error("Please describe a supported quantum circuit or named algorithm.");
}

function generatedSource(ir, backend = backendSelect.value, manifest = null) {
  const qiskit = ["from qiskit import QuantumCircuit", `qc = QuantumCircuit(${ir.num_qubits}, ${ir.num_qubits})`];
  const cirq = ["import cirq", `q = cirq.LineQubit.range(${ir.num_qubits})`, "circuit = cirq.Circuit()"];
  ir.gates.forEach((gate) => {
    const target = gate.targets[0];
    if (gate.op === "measure") {
      qiskit.push(`qc.measure(${JSON.stringify(gate.targets)}, ${JSON.stringify(gate.targets)})`);
      cirq.push(`circuit.append(cirq.measure(${gate.targets.map((q) => `q[${q}]`).join(", ")}, key='result'))`);
    } else if (["CNOT", "CZ"].includes(gate.op)) {
      qiskit.push(`qc.${gate.op === "CNOT" ? "cx" : "cz"}(${gate.controls[0]}, ${target})`);
      cirq.push(`circuit.append(cirq.${gate.op}(q[${gate.controls[0]}], q[${target}]))`);
    } else if (gate.op === "SWAP") {
      qiskit.push(`qc.swap(${gate.targets.join(", ")})`);
      cirq.push(`circuit.append(cirq.SWAP(${gate.targets.map((q) => `q[${q}]`).join(", ")}))`);
    } else if (["RX", "RY", "RZ"].includes(gate.op)) {
      qiskit.push(`qc.${gate.op.toLowerCase()}(${gate.params[0]}, ${target})`);
      cirq.push(`circuit.append(cirq.${gate.op.toLowerCase()}(${gate.params[0]})(q[${target}]))`);
    } else {
      qiskit.push(`qc.${gate.op.toLowerCase()}(${target})`);
      cirq.push(`circuit.append(cirq.${gate.op}(q[${target}]))`);
    }
  });
  const document = manifest || manifestForIR(ir, backend);
  return { qiskit: qiskit.join("\n"), cirq: cirq.join("\n"), manifest: manifestYaml(document) };
}

function bitAt(index, qubit, count) {
  return (index >> (count - qubit - 1)) & 1;
}

function complexAdd(left, right) { return [left[0] + right[0], left[1] + right[1]]; }
function complexMul(left, right) { return [left[0] * right[0] - left[1] * right[1], left[0] * right[1] + left[1] * right[0]]; }

function singleMatrix(gate) {
  const s = Math.SQRT1_2;
  const angle = gate.params?.[0] || 0;
  if (gate.op === "H") return [[[s, 0], [s, 0]], [[s, 0], [-s, 0]]];
  if (gate.op === "X") return [[[0, 0], [1, 0]], [[1, 0], [0, 0]]];
  if (gate.op === "Y") return [[[0, 0], [0, -1]], [[0, 1], [0, 0]]];
  if (gate.op === "Z") return [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]];
  if (gate.op === "S") return [[[1, 0], [0, 0]], [[0, 0], [0, 1]]];
  if (gate.op === "T") return [[[1, 0], [0, 0]], [[0, 0], [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)]]];
  if (gate.op === "RX") return [[[Math.cos(angle / 2), 0], [0, -Math.sin(angle / 2)]], [[0, -Math.sin(angle / 2)], [Math.cos(angle / 2), 0]]];
  if (gate.op === "RY") return [[[Math.cos(angle / 2), 0], [-Math.sin(angle / 2), 0]], [[Math.sin(angle / 2), 0], [Math.cos(angle / 2), 0]]];
  return [[[Math.cos(-angle / 2), Math.sin(-angle / 2)], [0, 0]], [[0, 0], [Math.cos(angle / 2), Math.sin(angle / 2)]]];
}

function simulateState(ir, cursor) {
  const count = ir.num_qubits;
  let state = Array.from({ length: 2 ** count }, () => [0, 0]);
  state[0] = [1, 0];
  const unitary = ir.gates.filter((gate) => gate.op !== "measure").slice(0, cursor);
  unitary.forEach((gate) => {
    if (["H", "X", "Y", "Z", "S", "T", "RX", "RY", "RZ"].includes(gate.op)) {
      const matrix = singleMatrix(gate);
      const next = state.map((value) => [...value]);
      state.forEach((_, index) => {
        if (bitAt(index, gate.targets[0], count) !== 0) return;
        const pair = index ^ (1 << (count - gate.targets[0] - 1));
        next[index] = complexAdd(complexMul(matrix[0][0], state[index]), complexMul(matrix[0][1], state[pair]));
        next[pair] = complexAdd(complexMul(matrix[1][0], state[index]), complexMul(matrix[1][1], state[pair]));
      });
      state = next;
    } else if (gate.op === "CNOT") {
      const next = Array.from({ length: state.length }, () => [0, 0]);
      state.forEach((value, index) => {
        const destination = bitAt(index, gate.controls[0], count) ? index ^ (1 << (count - gate.targets[0] - 1)) : index;
        next[destination] = complexAdd(next[destination], value);
      });
      state = next;
    } else if (gate.op === "CZ") {
      state = state.map((value, index) => bitAt(index, gate.controls[0], count) && bitAt(index, gate.targets[0], count) ? [-value[0], -value[1]] : value);
    } else if (gate.op === "SWAP") {
      const next = Array.from({ length: state.length }, () => [0, 0]);
      state.forEach((value, index) => {
        const left = bitAt(index, gate.targets[0], count);
        const right = bitAt(index, gate.targets[1], count);
        const destination = left === right ? index : index ^ (1 << (count - gate.targets[0] - 1)) ^ (1 << (count - gate.targets[1] - 1));
        next[destination] = complexAdd(next[destination], value);
      });
      state = next;
    }
  });
  return state;
}

function interpretationFor(ir) {
  const parts = ir.gates.map((gate) => {
    if (gate.op === "measure") return "measure";
    if (["CNOT", "CZ"].includes(gate.op)) return `${gate.op} q${gate.controls[0]} to q${gate.targets[0]}`;
    if (gate.op === "SWAP") return `SWAP q${gate.targets[0]} with q${gate.targets[1]}`;
    return `${gate.op} on q${gate.targets[0]}`;
  });
  return `Built: ${ir.num_qubits} qubit${ir.num_qubits === 1 ? "" : "s"} — ${parts.join(", then ")} (${ir.shots || 1024} shots).`;
}

function localResult(ir, backend = backendSelect.value, cursor = null, manifest = null) {
  const unitary = ir.gates.filter((gate) => gate.op !== "measure");
  const activeCursor = cursor === null ? unitary.length : Math.max(0, Math.min(cursor, unitary.length));
  const state = simulateState(ir, activeCursor);
  const shots = ir.shots || 1024;
  const statevector = [];
  const counts = {};
  state.forEach(([real, imag], index) => {
    const probability = real * real + imag * imag;
    if (probability < 1e-10) return;
    const basis = index.toString(2).padStart(ir.num_qubits, "0");
    statevector.push({ basis, real, imag });
    counts[basis] = Math.round(probability * shots);
  });
  const bloch = Array.from({ length: ir.num_qubits }, (_, qubit) => {
    let x = 0; let y = 0; let z = 0;
    state.forEach(([real, imag], index) => {
      const probability = real * real + imag * imag;
      z += bitAt(index, qubit, ir.num_qubits) ? -probability : probability;
      if (bitAt(index, qubit, ir.num_qubits) === 0) {
        const pair = index ^ (1 << (ir.num_qubits - qubit - 1));
        const [pairReal, pairImag] = state[pair];
        x += 2 * (real * pairReal + imag * pairImag);
        y += 2 * (real * pairImag - imag * pairReal);
      }
    });
    return { x, y, z };
  });
  const entanglement = [];
  unitary.slice(0, activeCursor).forEach((gate) => {
    if (!["CNOT", "CZ"].includes(gate.op)) return;
    const control = gate.controls[0]; const target = gate.targets[0];
    if (Math.hypot(...Object.values(bloch[control])) < 0.15 && Math.hypot(...Object.values(bloch[target])) < 0.15) {
      if (!entanglement.some((link) => link.control === control && link.target === target)) entanglement.push({ control, target });
    }
  });
  const document = manifest || manifestForIR(ir, backend);
  return {
    ir, counts, statevector, bloch, entanglement,
    manifest: document,
    cursor: activeCursor,
    step_count: unitary.length,
    interpretation: interpretationFor(ir),
    simplification: { removed: 0 },
    source: generatedSource(ir, backend, document),
    execution: { backend, engine: "Browser statevector simulator", simulated: true }
  };
}

function renderCircuit(ir, cursor = null, entanglement = []) {
  currentIR = ir;
  circuitCanvas.replaceChildren();
  const diagram = element("div", "circuit-diagram");
  const columnWidth = 58;
  const rowHeight = 60;
  const labelWidth = 48;
  diagram.style.setProperty("--gate-count", String(Math.max(ir.gates.length, 1)));
  diagram.style.minWidth = `${labelWidth + ir.gates.length * columnWidth + 24}px`;

  for (let qubit = 0; qubit < ir.num_qubits; qubit += 1) {
    const wire = element("div", "wire");
    wire.dataset.qubit = String(qubit);
    if (entanglement.some((link) => link.control === qubit || link.target === qubit)) wire.classList.add("entangled-wire");
    const label = element("span", "wire-label", `q${qubit}`);
    wire.appendChild(label);
    let unitaryIndex = 0;
    ir.gates.forEach((gate) => {
      const cell = element("span", "gate-cell");
      const isControl = (gate.controls || []).includes(qubit);
      const isTarget = gate.targets.includes(qubit);
      if (isControl) {
        cell.appendChild(element("span", "control-dot"));
      } else if (isTarget) {
        const glyph = gate.op === "measure" ? "M" : gate.op === "CNOT" ? "X" : gate.op;
        const gateNode = element("span", `gate gate-${gate.op.toLowerCase()}`, glyph);
        if (gate.op !== "measure" && cursor !== null && unitaryIndex === cursor - 1) gateNode.classList.add("active-step");
        gateNode.title = `${gate.op} on q${qubit}`;
        cell.appendChild(gateNode);
      }
      wire.appendChild(cell);
      if (gate.op !== "measure") unitaryIndex += 1;
    });
    diagram.appendChild(wire);
  }

  ir.gates.forEach((gate, index) => {
    if (!gate.controls?.length) return;
    const endpoints = [...gate.controls, ...gate.targets];
    const first = Math.min(...endpoints);
    const last = Math.max(...endpoints);
    const connector = element("span", "entangle-connector");
    connector.style.left = `${labelWidth + index * columnWidth + columnWidth / 2}px`;
    connector.style.top = `${first * rowHeight + rowHeight / 2}px`;
    connector.style.height = `${(last - first) * rowHeight}px`;
    diagram.appendChild(connector);
  });
  circuitCanvas.appendChild(diagram);
  byId("circuitMeta").textContent = `${ir.num_qubits} qubit${ir.num_qubits === 1 ? "" : "s"} / ${ir.gates.length} operations`;
}

function renderHistogram(counts) {
  histogram.replaceChildren();
  const total = Math.max(Object.values(counts).reduce((sum, value) => sum + value, 0), 1);
  Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)).forEach(([outcome, count]) => {
    const probability = count / total;
    const row = element("div", "histogram-row");
    row.appendChild(element("strong", "outcome", outcome));
    const track = element("span", "bar-track");
    const fill = element("span", "bar-fill");
    fill.style.width = `${Math.max(probability * 100, 1)}%`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(element("span", "probability", `${(probability * 100).toFixed(1)}%`));
    histogram.appendChild(row);
  });
}

function renderBloch(bloch, entanglement = currentEntanglement) {
  currentBloch = bloch?.length ? bloch : [{ x: 0, y: 0, z: 1 }];
  selectedQubit = Math.min(selectedQubit, currentBloch.length - 1);
  const tabs = byId("qubitTabs");
  tabs.replaceChildren();
  currentBloch.forEach((_, index) => {
    const button = element("button", index === selectedQubit ? "active" : "", `q${index}`);
    button.addEventListener("click", () => {
      selectedQubit = index;
      renderBloch(currentBloch, currentEntanglement);
    });
    tabs.appendChild(button);
  });
  const point = currentBloch[selectedQubit];
  const length = Math.min(1, Math.hypot(point.x, point.y, point.z));
  const angle = Math.atan2(point.x, point.z) * (180 / Math.PI);
  const vector = byId("blochVector");
  vector.style.height = `${68 * length}px`;
  vector.style.transform = `rotate(${angle}deg)`;
  vector.classList.toggle("mixed", length < 0.08);
  const isEntangled = length < 0.15 && entanglement.some((link) => link.control === selectedQubit || link.target === selectedQubit);
  byId("entanglementMessage").hidden = !isEntangled;
  vector.hidden = isEntangled;
  byId("blochValues").textContent = `x ${point.x.toFixed(2)}   y ${point.y.toFixed(2)}   z ${point.z.toFixed(2)}`;
}

function renderStatevector(values = []) {
  const container = byId("statevector");
  container.replaceChildren();
  values.slice(0, 8).forEach((item) => {
    const magnitude = Math.hypot(item.real, item.imag);
    const row = element("div", "state-row");
    row.appendChild(element("strong", "", `|${item.basis}>`));
    const phase = element("span", "phase-track");
    const phaseFill = element("span", "phase-fill");
    const phaseAngle = (Math.atan2(item.imag, item.real) + Math.PI * 2) % (Math.PI * 2);
    const hue = Math.round(phaseAngle / (Math.PI * 2) * 360);
    phaseFill.dataset.phase = phaseAngle.toFixed(4);
    phaseFill.setAttribute("style", `width:${magnitude * 100}%; background-color:hsl(${hue} 72% 58%)`);
    phase.appendChild(phaseFill);
    row.appendChild(phase);
    row.appendChild(element("span", "", magnitude.toFixed(3)));
    container.appendChild(row);
  });
}

function setSource(kind) {
  sourceKind = kind;
  qiskitTab.setAttribute("aria-selected", kind === "qiskit" ? "true" : "false");
  cirqTab.setAttribute("aria-selected", kind === "cirq" ? "true" : "false");
  manifestTab.setAttribute("aria-selected", kind === "manifest" ? "true" : "false");
  const source = lastSource[kind] || "";
  sourcePanel.textContent = source;
  byId("downloadSource").textContent = kind === "manifest" ? "Download .qyog.yaml" : "Download .py";
  if (monacoEditor) {
    monacoEditor.setValue(source);
    window.monaco.editor.setModelLanguage(monacoEditor.getModel(), kind === "manifest" ? "yaml" : "python");
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = element("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copySource() {
  const source = lastSource[sourceKind] || "";
  try {
    await navigator.clipboard.writeText(source);
  } catch (_) {
    const textarea = element("textarea");
    textarea.value = source;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  byId("copySource").textContent = "Copied";
  setTimeout(() => { byId("copySource").textContent = "Copy"; }, 1200);
}

function circuitSvg(ir) {
  const width = Math.max(520, 90 + ir.gates.length * 70);
  const height = 52 + ir.num_qubits * 62;
  const lines = ir.gates.map((gate, index) => {
    const x = 80 + index * 70;
    const nodes = [];
    if (gate.controls?.length) {
      const controlY = 45 + gate.controls[0] * 62;
      const targetY = 45 + gate.targets[0] * 62;
      nodes.push(`<line x1="${x}" y1="${controlY}" x2="${x}" y2="${targetY}" stroke="#825500" stroke-width="2"/>`);
      nodes.push(`<circle cx="${x}" cy="${controlY}" r="5" fill="#825500"/>`);
    }
    gate.targets.forEach((target) => {
      const y = 45 + target * 62;
      const label = gate.op === "measure" ? "M" : gate.op === "CNOT" ? "X" : gate.op;
      nodes.push(`<rect x="${x - 18}" y="${y - 18}" width="36" height="36" rx="4" fill="#e2f2ee" stroke="#006b5f"/>`);
      nodes.push(`<text x="${x}" y="${y + 4}" fill="#111312" text-anchor="middle" font-family="monospace" font-size="11">${label}</text>`);
    });
    return nodes.join("");
  }).join("");
  const wires = Array.from({ length: ir.num_qubits }, (_, qubit) => {
    const y = 45 + qubit * 62;
    return `<text x="15" y="${y + 4}" fill="#4e5854" font-family="monospace" font-size="12">q${qubit}</text><line x1="50" y1="${y}" x2="${width - 20}" y2="${y}" stroke="#6e7773"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${wires}${lines}</svg>`;
}

function downloadDiagramSvg() {
  downloadBlob(new Blob([circuitSvg(currentIR)], { type: "image/svg+xml" }), "1stopquantum-circuit.svg");
}

function downloadDiagramPng() {
  const svgUrl = URL.createObjectURL(new Blob([circuitSvg(currentIR)], { type: "image/svg+xml" }));
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, "1stopquantum-circuit.png");
      URL.revokeObjectURL(svgUrl);
    }, "image/png");
  };
  image.src = svgUrl;
}

function renderExecution(data) {
  byId("executionBackend").textContent = data.execution?.backend === "cirq" ? "Cirq" : "Qiskit";
  byId("executionEngine").textContent = data.execution?.engine || "Local simulator";
  byId("executionShots").textContent = Number(data.ir.shots || 1024).toLocaleString();
}

function renderResult(data) {
  currentResult = data;
  const manifest = data.manifest || manifestForIR(data.ir, data.execution?.backend || backendSelect.value);
  data.manifest = manifest;
  currentStepCount = data.step_count ?? data.ir.gates.filter((gate) => gate.op !== "measure").length;
  currentCursor = data.cursor ?? currentStepCount;
  currentEntanglement = data.entanglement || [];
  renderCircuit(data.ir, currentCursor, currentEntanglement);
  renderHistogram(data.counts);
  renderBloch(data.bloch, currentEntanglement);
  renderStatevector(data.statevector);
  renderExecution(data);
  lastSource = { ...generatedSource(data.ir, data.execution?.backend || backendSelect.value, manifest), ...(data.source || {}) };
  setSource(sourceKind);
  byId("interpretationEcho").textContent = data.interpretation || interpretationFor(data.ir);
  byId("manifestName").textContent = `Manifest: ${manifest.metadata?.name || "generated-circuit"}`;
  byId("fidelityWarning").hidden = !data.warning;
  byId("fidelityWarning").textContent = data.warning || "";
  const removed = data.simplification?.removed || 0;
  byId("simplificationNotice").hidden = removed === 0;
  byId("simplificationNotice").textContent = `simplified: ${removed} ops removed`;
  byId("stepStatus").textContent = `${currentCursor} / ${currentStepCount}`;
  byId("stepFirst").disabled = currentCursor === 0;
  byId("stepPrev").disabled = currentCursor === 0;
  byId("stepNext").disabled = currentCursor === currentStepCount;
  byId("stepLast").disabled = currentCursor === currentStepCount;
  if (data.template) {
    const name = data.template.name.replaceAll("_", "-");
    const params = Object.entries(data.template.params || {}).map(([key, value]) => `${key}: ${value}`).join(", ");
    byId("templateUsed").textContent = `${name} template — ${params}`;
    byId("templateUsed").hidden = false;
  }
  if (byId("improvementCircuit")) byId("improvementCircuit").textContent = JSON.stringify(data.ir, null, 2);
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ir: data.ir, manifest, text: nlInput.value, backend: backendSelect.value }));
  } catch (_) {}
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle("busy", busy);
}

async function runCircuit() {
  nlError.hidden = true;
  nlError.textContent = "";
  byId("templateUsed").hidden = true;
  setBusy(runBtn, true);
  try {
    let data;
    try {
      data = await requestJson("/nl2manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nlInput.value, backend: backendSelect.value })
      });
    } catch (error) {
      if (!(error instanceof NetworkUnavailableError)) throw error;
      const ir = localTranslate(nlInput.value);
      const manifest = manifestForIR(ir, backendSelect.value, "natural-language-circuit");
      manifest.metadata.sourcePrompt = nlInput.value;
      data = localResult(ir, backendSelect.value, null, manifest);
    }
    renderResult(data);
  } catch (error) {
    nlError.textContent = error.message || "Please describe a quantum circuit request.";
    nlError.hidden = false;
  } finally {
    setBusy(runBtn, false);
  }
}

function setInputMode(mode) {
  const manifestMode = mode === "manifest";
  byId("naturalComposer").hidden = manifestMode;
  byId("manifestComposer").hidden = !manifestMode;
  byId("inputModeNatural").classList.toggle("active", !manifestMode);
  byId("inputModeManifest").classList.toggle("active", manifestMode);
  byId("inputModeNatural").setAttribute("aria-selected", manifestMode ? "false" : "true");
  byId("inputModeManifest").setAttribute("aria-selected", manifestMode ? "true" : "false");
  if (manifestMode && !byId("manifestEditor").value) {
    byId("manifestEditor").value = lastSource.manifest || manifestYaml(manifestForIR(currentIR || bellIR()));
  }
}

async function runManifest() {
  const editor = byId("manifestEditor");
  const errorNode = byId("manifestError");
  const button = byId("manifestRun");
  errorNode.hidden = true;
  errorNode.textContent = "";
  setBusy(button, true);
  try {
    let data;
    try {
      data = await requestJson("/manifests/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: editor.value })
      });
    } catch (error) {
      if (!(error instanceof NetworkUnavailableError)) throw error;
      let parsed;
      try {
        parsed = localCompileManifest(editor.value);
      } catch (parseError) {
        throw new Error(`The backend is unavailable; offline manifest input accepts JSON. ${parseError.message}`);
      }
      backendSelect.value = parsed.backend;
      data = localResult(parsed.ir, parsed.backend, null, parsed.manifest);
    }
    if (data.execution?.backend) backendSelect.value = data.execution.backend;
    renderResult(data);
  } catch (error) {
    errorNode.textContent = error.message || "The manifest could not be validated.";
    errorNode.hidden = false;
  } finally {
    setBusy(button, false);
  }
}

async function runIR(ir, cursor = null) {
  const preservedManifest = cursor !== null ? currentResult?.manifest : null;
  let data;
  try {
    data = await requestJson("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ir, backend: backendSelect.value, ...(cursor === null ? {} : { cursor }) })
    });
    if (cursor !== null && (data.cursor === undefined || data.step_count === undefined)) {
      data = localResult(ir, backendSelect.value, cursor);
    }
  } catch (error) {
    if (!(error instanceof NetworkUnavailableError)) throw error;
    data = localResult(ir, backendSelect.value, cursor);
  }
  if (preservedManifest) {
    data.manifest = preservedManifest;
    data.source = { ...(data.source || {}), manifest: manifestYaml(preservedManifest) };
  }
  renderResult(data);
}

async function stepTo(cursor) {
  if (!currentIR) return;
  await runIR(currentIR, Math.max(0, Math.min(cursor, currentStepCount)));
}

const templateSpecs = {
  ghz: { params: { qubits: 3 }, prompt: "Build a 3-qubit GHZ state." },
  grover: { params: { marked: "11" }, prompt: "Grover search for |11> on 2 qubits." },
  deutsch_jozsa: { params: { input_qubits: 2, oracle: "constant" }, prompt: "Run Deutsch-Jozsa on 2 input qubits with a constant oracle." },
  qrng: { params: { qubits: 1 }, prompt: "Make a quantum random number generator." }
};

function localTemplateIR(name) {
  if (name === "ghz") return localTranslate("Build a 3-qubit GHZ state.");
  if (name === "grover") return localTranslate("Grover search for |11> on 2 qubits.");
  if (name === "qrng") return localTranslate("Make a quantum random number generator.");
  return {
    version: "1.0", num_qubits: 3,
    gates: [
      { op: "X", targets: [2] },
      { op: "H", targets: [0] }, { op: "H", targets: [1] }, { op: "H", targets: [2] },
      { op: "H", targets: [0] }, { op: "H", targets: [1] },
      { op: "measure", targets: [0, 1] }
    ],
    shots: 1024, seed: 42
  };
}

async function runTemplate(name) {
  const spec = templateSpecs[name];
  let data;
  try {
    data = await requestJson("/templates/expand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: name, params: spec.params, backend: backendSelect.value })
    });
  } catch (error) {
    if (!(error instanceof NetworkUnavailableError)) throw error;
    data = localResult(localTemplateIR(name), backendSelect.value);
    data.template = { name, params: spec.params };
  }
  renderResult(data);
}

function addGate(op) {
  const ir = currentIR ? JSON.parse(JSON.stringify(currentIR)) : bellIR();
  ir.gates = ir.gates.filter((gate) => gate.op !== "measure");
  if (["CNOT", "SWAP"].includes(op) && ir.num_qubits < 2) ir.num_qubits = 2;
  if (op === "CNOT") ir.gates.push({ op, controls: [0], targets: [1] });
  else if (op === "SWAP") ir.gates.push({ op, targets: [0, 1] });
  else if (op === "RY") ir.gates.push({ op, targets: [0], params: [Math.PI / 2] });
  else if (op !== "measure") ir.gates.push({ op, targets: [0] });
  ir.gates.push({ op: "measure", targets: Array.from({ length: ir.num_qubits }, (_, index) => index) });
  runIR(ir).catch((error) => {
    nlError.textContent = error.message;
    nlError.hidden = false;
  });
}

function scoreFallback(smiles) {
  if (!/^[A-Za-z0-9@+\-[\]()=#$\\/%.]+$/.test(smiles) || smiles.includes("-") || smiles.startsWith("not")) {
    return { valid: false, error: "Invalid SMILES; could not parse molecule." };
  }
  const variation = (smiles.length % 13) / 100;
  const descriptors = { mw: Number((160 + smiles.length * 0.7).toFixed(2)), logp: Number((1.1 + variation).toFixed(3)), donors: 1, acceptors: Math.min(8, Math.max(2, (smiles.match(/[NO]/g) || []).length)), rotatable: 2 };
  return {
    valid: true,
    qed: Number((0.52 + variation).toFixed(4)),
    sa_score: Number((3.5 - variation).toFixed(3)),
    tox_alerts: 0,
    binding: 0.6234,
    lipinski_pass: true,
    descriptors,
    lipinski: {
      molecular_weight: { label: "MW", value: descriptors.mw, limit: "<= 500 Da", pass: descriptors.mw <= 500 },
      logp: { label: "LogP", value: descriptors.logp, limit: "<= 5", pass: descriptors.logp <= 5 },
      h_bond_donors: { label: "HBD", value: descriptors.donors, limit: "<= 5", pass: descriptors.donors <= 5 },
      h_bond_acceptors: { label: "HBA", value: descriptors.acceptors, limit: "<= 10", pass: descriptors.acceptors <= 10 }
    },
    convergence: Array.from({ length: 12 }, (_, step) => Number((-0.6234 * (1 - Math.exp(-step / 2.6))).toFixed(5)))
  };
}

function drawConvergence(values) {
  const canvas = byId("convergenceCanvas");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#d9ddda";
  context.lineWidth = 1;
  for (let line = 0; line < 4; line += 1) {
    const y = 24 + line * 56;
    context.beginPath(); context.moveTo(42, y); context.lineTo(width - 18, y); context.stroke();
  }
  const min = Math.min(...values, -0.1);
  const max = Math.max(...values, 0);
  context.strokeStyle = "#006b5f";
  context.lineWidth = 4;
  context.beginPath();
  values.forEach((value, index) => {
    const x = 42 + (index / Math.max(values.length - 1, 1)) * (width - 70);
    const y = 22 + ((max - value) / Math.max(max - min, 0.001)) * (height - 52);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
  context.fillStyle = "#4e5854";
  context.font = "24px ui-monospace";
  context.fillText("iteration", width - 130, height - 12);
  context.fillText("energy", 8, 22);
}

function drawRadar(data) {
  const canvas = byId("radarCanvas");
  const context = canvas.getContext("2d");
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2 + 6;
  const radius = 102;
  const values = [data.binding, data.qed, 1 - Math.min(data.tox_alerts / 4, 1), 1 - Math.min((data.sa_score - 1) / 9, 1)];
  const labels = ["Binding*", "QED", "Toxicity", "Synthesis"];
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let ring = 1; ring <= 4; ring += 1) {
    context.beginPath();
    labels.forEach((_, index) => {
      const angle = -Math.PI / 2 + index * (Math.PI * 2 / labels.length);
      const x = centerX + Math.cos(angle) * radius * ring / 4;
      const y = centerY + Math.sin(angle) * radius * ring / 4;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.closePath(); context.strokeStyle = "#c5cbc7"; context.stroke();
  }
  context.beginPath();
  values.forEach((value, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / values.length);
    const x = centerX + Math.cos(angle) * radius * value;
    const y = centerY + Math.sin(angle) * radius * value;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.closePath();
  context.fillStyle = "rgba(0, 107, 95, 0.16)"; context.fill();
  context.strokeStyle = "#006b5f"; context.lineWidth = 3; context.stroke();
  context.fillStyle = "#303936"; context.font = "13px system-ui";
  labels.forEach((label, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / labels.length);
    const x = centerX + Math.cos(angle) * (radius + 28);
    const y = centerY + Math.sin(angle) * (radius + 20);
    context.textAlign = Math.cos(angle) > 0.2 ? "left" : Math.cos(angle) < -0.2 ? "right" : "center";
    context.fillText(label, x, y);
  });
}

function renderMolecule(data) {
  const stage = byId("moleculeStage");
  stage.replaceChildren();
  if (moleculeObjectUrl) URL.revokeObjectURL(moleculeObjectUrl);
  if (data.molecule_svg) {
    moleculeObjectUrl = URL.createObjectURL(new Blob([data.molecule_svg], { type: "image/svg+xml" }));
    const image = element("img");
    image.alt = "RDKit two-dimensional molecule structure";
    image.src = moleculeObjectUrl;
    stage.appendChild(image);
  } else {
    const fallback = element("div", "molecule-fallback");
    ["O", "C", "C", "O", "C", "C"].forEach((atom, index) => {
      const atomNode = element("span", index === 0 || index === 3 ? "hetero" : "", atom);
      atomNode.style.setProperty("--index", index);
      fallback.appendChild(atomNode);
    });
    stage.appendChild(fallback);
  }
  const descriptors = byId("descriptorStrip");
  descriptors.replaceChildren();
  const items = data.descriptors || {};
  const descriptorInfo = [
    ["MW", "mw", items.mw, "Molecular weight in daltons"],
    ["LogP", "logp", items.logp, "Octanol-water partition coefficient"],
    ["HBD", "hbd", items.donors, "Hydrogen-bond donors"],
    ["HBA", "hba", items.acceptors, "Hydrogen-bond acceptors"]
  ];
  descriptorInfo.forEach(([label, key, value, title]) => {
    if (value === undefined) return;
    const metric = element("span");
    metric.dataset.descriptor = key;
    metric.title = title;
    metric.append(element("small", "", label), element("strong", "", String(value)));
    descriptors.appendChild(metric);
  });
}

function renderLipinski(data) {
  const container = byId("lipinskiBreakdown");
  container.hidden = false;
  container.replaceChildren(element("strong", "", "Lipinski rules"));
  Object.values(data.lipinski || {}).forEach((rule) => {
    const item = element("div", rule.pass ? "pass" : "fail");
    item.append(element("b", "", rule.label), element("small", "", `${rule.value} / ${rule.limit}`), element("i", "", rule.pass ? "Pass" : "Fail"));
    container.appendChild(item);
  });
}

function renderDrug(data) {
  const card = byId("scorecard");
  card.hidden = false;
  card.replaceChildren();
  [
    ["Binding simulated interaction", data.binding, "Illustrative value"],
    ["Drug-likeness QED", data.qed, data.lipinski_pass ? "Lipinski checks pass" : "Review Lipinski checks"],
    ["Synthetic accessibility", data.sa_score, "Lower raw score is easier"],
    ["Toxicity proxy", data.tox_alerts, "Structural-alert heuristic"]
  ].forEach(([label, value, note]) => {
    const metric = element("div", "metric");
    metric.append(element("span", "", label), element("strong", "", String(value)), element("small", "", note));
    card.appendChild(metric);
  });
  renderMolecule(data);
  renderLipinski(data);
  drawConvergence(data.convergence || []);
  drawRadar(data);
}

function renderComparison(left, right) {
  const container = byId("comparisonScorecard");
  container.hidden = false;
  container.replaceChildren();
  const definitions = [
    { label: "Binding simulated interaction", key: "binding", higher: true },
    { label: "Drug-likeness QED", key: "qed", higher: true },
    { label: "Synthetic accessibility", key: "sa_score", higher: false },
    { label: "Toxicity proxy", key: "tox_alerts", higher: false }
  ];
  const header = element("div", "comparison-head");
  header.append(element("strong", "", "Metric"), element("strong", "", "Candidate A"), element("strong", "", "Candidate B"));
  container.appendChild(header);
  definitions.forEach(({ label, key, higher }) => {
    const row = element("div", "comparison-row");
    const leftBetter = higher ? left[key] >= right[key] : left[key] <= right[key];
    row.append(element("span", "", label), element("strong", leftBetter ? "better" : "", String(left[key])), element("strong", leftBetter ? "" : "better", String(right[key])));
    container.appendChild(row);
  });
}

async function loadDrugScore(smiles) {
  try {
    const data = await requestJson("/drug/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ smiles, target: byId("targetInput").value })
    });
    if (!data.lipinski || !data.descriptors) {
      const fallback = scoreFallback(smiles);
      data.descriptors ||= fallback.descriptors;
      data.lipinski ||= fallback.lipinski;
    }
    return data;
  } catch (error) {
    if (!(error instanceof NetworkUnavailableError)) throw error;
    return scoreFallback(smiles);
  }
}

async function runDrug() {
  const smiles = byId("smilesInput").value.trim();
  const comparisonSmiles = byId("compareSmilesInput").value.trim();
  const card = byId("scorecard");
  const errorNode = byId("drugError");
  const button = byId("drugRun");
  errorNode.textContent = "";
  setBusy(button, true);
  try {
    const data = await loadDrugScore(smiles);
    if (!data.valid) {
      card.hidden = true;
      errorNode.textContent = data.error || "Invalid SMILES; could not parse a valid molecule.";
      return;
    }
    renderDrug(data);
    byId("comparisonScorecard").hidden = true;
    if (comparisonSmiles) {
      const comparison = await loadDrugScore(comparisonSmiles);
      if (!comparison.valid) throw new Error(comparison.error || "Comparison SMILES is invalid.");
      renderComparison(data, comparison);
    }
  } catch (error) {
    card.hidden = true;
    byId("comparisonScorecard").hidden = true;
    errorNode.textContent = error.message || "The simulated study could not run.";
  } finally {
    setBusy(button, false);
  }
}

const fallbackProviders = {
  providers: [
    { id: "qiskit", name: "Qiskit", organization: "IBM", paradigm: "gate", availability: "local", role: "Default SDK and local statevector simulation" },
    { id: "cirq", name: "Cirq", organization: "Google", paradigm: "gate", availability: "local", role: "Alternate hardware-aware circuit adapter" },
    { id: "ionq", name: "IonQ", organization: "IonQ", paradigm: "gate-hardware", availability: "planned", role: "Future trapped-ion target through Circuit IR" },
    { id: "dwave", name: "D-Wave", organization: "D-Wave", paradigm: "annealing", availability: "local-simulated", role: "QUBO lesson with local simulated annealing" }
  ]
};

function renderProviders(catalog) {
  const grid = byId("providerGrid");
  grid.replaceChildren();
  catalog.providers.forEach((provider) => {
    const item = element("article", `provider-item provider-${provider.id}`);
    const head = element("div", "provider-head");
    head.append(element("strong", "provider-monogram", provider.name.slice(0, 2)), element("span", "", provider.organization));
    item.append(head, element("h3", "", provider.name), element("p", "", provider.role));
    const footer = element("div", "provider-foot");
    footer.append(element("span", "", provider.paradigm), element("small", provider.availability.includes("local") ? "available" : "planned", provider.availability));
    item.appendChild(footer);
    grid.appendChild(item);
  });
}

const triangleQubo = {
  version: "1.0",
  kind: "qubo",
  variables: ["a", "b", "c"],
  linear: { a: -2, b: -2, c: -2 },
  quadratic: { "a,b": 2, "b,c": 2, "a,c": 2 },
  num_reads: 100,
  seed: 42
};

async function runAnnealer() {
  const results = byId("annealResults");
  const errorNode = byId("quboError");
  errorNode.textContent = "";
  let qubo;
  try {
    qubo = JSON.parse(byId("quboSource").value);
  } catch (_) {
    errorNode.textContent = "Invalid JSON: correct the QUBO document and retry.";
    return;
  }
  results.textContent = "Running local simulated annealing...";
  try {
    const data = await requestJson("/anneal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(qubo)
    });
    results.replaceChildren();
    results.append(element("small", "", "best simulated sample"), element("strong", "", JSON.stringify(data.best.sample)), element("span", "", `energy ${data.best.energy} / ${data.best.reads} reads`));
    const histogramData = data.energy_histogram?.length
      ? data.energy_histogram
      : [{ energy: data.best.energy, reads: data.best.reads || qubo.num_reads || 1, best: true }];
    renderEnergyHistogram(histogramData);
  } catch (error) {
    if (!(error instanceof NetworkUnavailableError)) {
      errorNode.textContent = error.message;
      results.textContent = "No result.";
      return;
    }
    results.replaceChildren();
    results.append(element("small", "", "offline preview"), element("strong", "", '{"a":0,"b":0,"c":1}'), element("span", "", "energy -2.0 / simulated"));
    renderEnergyHistogram([{ energy: -2, reads: qubo.num_reads || 100, best: true }]);
  }
}

function renderEnergyHistogram(values) {
  const container = byId("energyHistogram");
  container.hidden = false;
  container.replaceChildren(element("strong", "", "Energy distribution"));
  const max = Math.max(1, ...values.map((item) => item.reads));
  values.forEach((item) => {
    const row = element("div", `energy-row${item.best ? " best-energy" : ""}`);
    row.append(element("span", "", String(item.energy)));
    const track = element("i");
    const fill = element("b");
    fill.style.width = `${item.reads / max * 100}%`;
    track.appendChild(fill);
    row.append(track, element("small", "", `${item.reads} reads${item.best ? " / best" : ""}`));
    container.appendChild(row);
  });
}

function localRoute(text) {
  const lower = text.toLowerCase();
  if (/split|graph|optim|route|schedule|knapsack|max.?cut/.test(lower)) {
    return { paradigm: "annealing", reason: "This is a discrete optimization request, so it maps to QUBO and local simulated annealing." };
  }
  return { paradigm: "circuit", reason: "This describes qubits or gates, so it maps to Circuit IR and a gate-model simulator." };
}

async function runRouter() {
  const text = byId("routeInput").value.trim();
  let data;
  try {
    data = await requestJson("/route", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text })
    });
  } catch (error) {
    if (!(error instanceof NetworkUnavailableError)) {
      byId("routeResult").textContent = error.message;
      return;
    }
    data = localRoute(text);
  }
  byId("routeResult").replaceChildren(element("strong", "", data.paradigm), element("span", "", data.reason));
}

function formatBenchmarkDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function selectedLandscapePoints() {
  if (!benchmarkOverview || !landscapeDates.length) return [];
  const benchmark = byId("landscapeBenchmark").value;
  const date = landscapeDates[Number(byId("landscapeTime").value)] || landscapeDates.at(-1);
  const latest = new Map();
  benchmarkOverview.timeline
    .filter((point) => point.benchmark === benchmark && point.timestamp.slice(0, 10) <= date)
    .forEach((point) => {
      const key = `${point.provider}:${point.device}:${point.scale ?? "unknown"}`;
      const previous = latest.get(key);
      if (!previous || point.timestamp > previous.timestamp) latest.set(key, point);
    });
  return [...latest.values()].sort((left, right) =>
    Number(left.scale || 0) - Number(right.scale || 0) || left.device.localeCompare(right.device) || left.provider.localeCompare(right.provider)
  );
}

function renderLandscape() {
  if (!benchmarkOverview) return;
  const benchmark = byId("landscapeBenchmark").value;
  const allDates = [...new Set(
    benchmarkOverview.timeline.filter((point) => point.benchmark === benchmark).map((point) => point.timestamp.slice(0, 10))
  )].sort();
  if (allDates.join("|") !== landscapeDates.join("|")) {
    landscapeDates = allDates;
    byId("landscapeTime").max = String(Math.max(0, allDates.length - 1));
    byId("landscapeTime").value = String(Math.max(0, allDates.length - 1));
  }
  const date = landscapeDates[Number(byId("landscapeTime").value)] || benchmarkOverview.date_range[1].slice(0, 10);
  byId("landscapeDate").textContent = `${formatBenchmarkDate(date)} · ${Number(byId("landscapeTime").value) + 1} of ${Math.max(1, landscapeDates.length)}`;
  const points = selectedLandscapePoints();
  window.QuantumYogTutorialViz?.drawBenchmarkLandscape(byId("landscapeChart"), points, benchmark, date);
  const rows = byId("landscapeRows");
  rows.replaceChildren();
  points.slice(0, 18).forEach((point) => {
    const row = document.createElement("tr");
    [
      point.device,
      point.provider,
      point.scale === null ? "not reported" : `${point.scale} qubits / width`,
      Number(point.value).toFixed(4),
      point.uncertainty === null ? "not reported" : `±${Number(point.uncertainty).toFixed(4)}`,
      formatBenchmarkDate(point.timestamp),
    ].forEach((value) => row.appendChild(element("td", "", value)));
    rows.appendChild(row);
  });
  if (!points.length) {
    const row = document.createElement("tr");
    const cell = element("td", "", "No comparable scaled measurements are available for this benchmark and date.");
    cell.colSpan = 6;
    row.appendChild(cell);
    rows.appendChild(row);
  }
}

function toggleLandscapePlayback() {
  const button = byId("landscapePlay");
  if (landscapeTimer) {
    clearInterval(landscapeTimer);
    landscapeTimer = null;
    button.lastElementChild.textContent = "Play";
    button.firstElementChild.textContent = "▶";
    return;
  }
  if (landscapeDates.length < 2) return;
  button.lastElementChild.textContent = "Pause";
  button.firstElementChild.textContent = "Ⅱ";
  let index = Number(byId("landscapeTime").value);
  landscapeTimer = window.setInterval(() => {
    index = (index + 1) % landscapeDates.length;
    byId("landscapeTime").value = String(index);
    renderLandscape();
  }, 500);
}

function renderQpuRecommendations(payload) {
  const table = byId("qpuMatchResults").querySelector("table");
  const body = table.querySelector("tbody");
  body.replaceChildren();
  payload.recommendations.forEach((item) => {
    const row = document.createElement("tr");
    [
      `#${item.rank}`,
      `${item.device} · ${item.provider}`,
      `${item.qubits} qubits`,
      `${item.fit_score}/100`,
      `${item.evidence_score}/100 · ${item.evidence.benchmark_runs} runs`,
      item.reasons.join(" "),
    ].forEach((value) => row.appendChild(element("td", "", value)));
    body.appendChild(row);
  });
  if (!payload.recommendations.length) {
    const row = document.createElement("tr");
    const cell = element("td", "", "No bundled measured device satisfies this capacity and lifecycle filter.");
    cell.colSpan = 6;
    row.appendChild(cell);
    body.appendChild(row);
  }
  byId("qpuMatchWarning").textContent = payload.warnings.join(" ");
}

async function runQpuMatch(event) {
  event?.preventDefault();
  const button = byId("qpuMatchRun");
  setBusy(button, true);
  try {
    const payload = await requestJson("/benchmarking/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qubits: Number(byId("qpuQubits").value),
        max_depth: Number(byId("qpuDepth").value),
        workload: byId("qpuWorkload").value,
        connectivity: byId("qpuConnectivity").value,
        include_simulators: false,
      }),
    });
    renderQpuRecommendations(payload);
  } catch (error) {
    byId("qpuMatchWarning").textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function runBenchmarkForecast() {
  const button = byId("forecastRun");
  setBusy(button, true);
  try {
    const payload = await requestJson("/benchmarking/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device: byId("forecastDevice").value.trim(),
        benchmark: byId("forecastBenchmark").value.trim(),
        metric: byId("forecastMetric").value.trim(),
        selector: { num_qubits: Number(byId("forecastQubits").value) },
        horizon_days: Number(byId("forecastHorizon").value),
      }),
    });
    window.QuantumYogTutorialViz?.drawBenchmarkForecast(byId("forecastChart"), payload.observed, payload.forecast);
    byId("forecastConfidence").textContent = `${payload.confidence} confidence · ${payload.observed.length} measured points`;
    byId("forecastModel").textContent = payload.model;
    byId("forecastDisclaimer").textContent = `${payload.disclaimer} ${payload.threshold_assessment.reason}`;
  } catch (error) {
    byId("forecastConfidence").textContent = "Forecast unavailable";
    byId("forecastDisclaimer").textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function claimEvidence() {
  return Object.fromEntries(
    [...document.querySelectorAll("[data-claim-evidence]")].map((input) => [input.dataset.claimEvidence, input.checked])
  );
}

function renderClaimAssessment(payload) {
  const result = byId("claimResult");
  result.replaceChildren();
  const summary = element("div", "claim-result-summary");
  const heading = element("div");
  heading.append(element("small", "", payload.provider), element("strong", "", `${payload.evidence_completeness}% evidence complete`));
  summary.append(heading, element("span", "", `${payload.risk_level} risk`));
  result.appendChild(summary);
  payload.qbi_inspired_stages.forEach((stage) => {
    const row = element("div", "claim-stage-result");
    const description = element("div");
    description.append(element("strong", "", `Stage ${stage.stage} · ${stage.name}`), element("small", "", `${stage.complete} of ${stage.total} evidence groups present`));
    row.append(element("span", "", stage.stage), description, element("em", "", stage.status));
    result.appendChild(row);
  });
  result.appendChild(element("div", "missing-evidence", `Missing evidence: ${payload.missing_evidence.join(", ") || "none declared"}.`));
  byId("claimDisclaimer").textContent = payload.disclaimer;
}

async function assessBenchmarkClaim(event) {
  event?.preventDefault();
  const button = byId("claimAssess");
  setBusy(button, true);
  try {
    const payload = await requestJson("/benchmarking/claims/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: byId("claimProvider").value.trim(),
        claim: byId("claimText").value.trim(),
        target_year: Number(byId("claimYear").value),
        evidence: claimEvidence(),
      }),
    });
    renderClaimAssessment(payload);
  } catch (error) {
    byId("claimResult").textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function renderUseCases(payload) {
  const body = byId("useCaseRows");
  body.replaceChildren();
  payload.use_cases.forEach((item) => {
    const row = document.createElement("tr");
    [item.sector, item.problem, item.quantum_approach, item.classical_baseline, item.decision_gate, item.evidence_status]
      .forEach((value) => row.appendChild(element("td", "", value)));
    body.appendChild(row);
  });
}

function renderDigest(payload) {
  currentDigest = payload;
  byId("digestSummary").textContent = `${payload.items.length} source-linked results from ${formatBenchmarkDate(payload.window_start)} through ${formatBenchmarkDate(payload.window_end)}.`;
  const list = byId("digestList");
  list.replaceChildren();
  payload.items.forEach((item) => {
    const row = element("article", "digest-item");
    row.append(
      element("time", "", formatBenchmarkDate(item.timestamp)),
      element("strong", "", `${item.device} · ${item.provider}`),
      element("span", "", item.summary),
      element("code", "", item.source_path),
    );
    list.appendChild(row);
  });
  if (!payload.items.length) list.appendChild(element("p", "coverage-note", "No new measurements are present in this snapshot window."));
}

async function loadBenchmarkDigest() {
  try {
    renderDigest(await requestJson(`/benchmarking/digest?days=${Number(byId("digestDays").value)}`));
  } catch (error) {
    byId("digestSummary").textContent = error.message;
  }
}

function showBenchmarkTab(name) {
  document.querySelectorAll("[data-benchmark-tab]").forEach((button) => {
    const active = button.dataset.benchmarkTab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-benchmark-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.benchmarkPanel !== name;
  });
  if (name === "landscape") requestAnimationFrame(renderLandscape);
  if (name === "digest" && !currentDigest) loadBenchmarkDigest();
}

async function initializeBenchmarking() {
  if (benchmarkOverview) {
    requestAnimationFrame(renderLandscape);
    return;
  }
  try {
    benchmarkOverview = await requestJson("/benchmarking/overview");
    byId("benchmarkRecordCount").textContent = `${benchmarkOverview.record_count} measurements`;
    byId("benchmarkProviderCount").textContent = `${benchmarkOverview.provider_count} providers`;
    byId("benchmarkDeviceCount").textContent = `${benchmarkOverview.device_count} measured devices`;
    byId("benchmarkDateRange").textContent = `${formatBenchmarkDate(benchmarkOverview.date_range[0])} – ${formatBenchmarkDate(benchmarkOverview.date_range[1])}`;
    byId("benchmarkCoverageNote").textContent = benchmarkOverview.coverage_note;
    renderLandscape();
    renderUseCases(await requestJson("/benchmarking/use-cases"));
  } catch (error) {
    byId("benchmarkRecordCount").textContent = "Benchmark API unavailable";
    byId("benchmarkCoverageNote").textContent = error.message;
  }
}

const docsPages = {
  "quantum-101": {
    title: "Quantum 101",
    search: "quantum 101 classical bit qubit high school undergraduate masters curriculum Learn workspace",
    html: `<p class="eyebrow">AI-assisted quantum learning</p><h2>Learn quantum computing by doing</h2><p>Ask in plain language, inspect the circuit and quantum state, then test your prediction in a local simulator. The Learn workspace combines the WebGL Bloch sphere, D3 comparisons, narrated lessons, practicals, and saved checkpoints.</p><button class="docs-action" data-testid="docs-open-learn" data-doc-action="learn">Open interactive Learn workspace <span aria-hidden="true">&#8594;</span></button><h3>Foundation</h3><p>Begin with a classical bit: one recorded value, 0 or 1. A qubit is a two-level quantum system whose state carries complex amplitudes. Measurement still returns one classical outcome, so repeated shots reveal the predicted distribution.</p><h3>Choose your depth</h3><p>High school explanations use familiar switches and waves. Undergraduate explanations add state vectors, amplitudes, and matrices. Master's explanations use Hilbert spaces, density operators, and hardware constraints. All three levels run the same physical simulation.</p><h3>Course sequence</h3><p>Follow Bits and qubits, Qubit state, Gates, Measurement, Interference, Entanglement, and Algorithms. Every module follows the same loop: compare with a classical idea, manipulate the visual state, predict, simulate, explain, and answer a checkpoint.</p><div class="docs-callout"><strong>Do not skip the prediction</strong><span>A prediction exposes your current mental model. The result is useful because you can explain why it agreed or disagreed.</span></div>`
  },
  "getting-started": {
    title: "Getting started with 1StopQuantum",
    search: "introduction first circuit Bell step-through YAML JSON qyog validate",
    html: `<p class="eyebrow">Introduction</p><h2>Getting started with 1StopQuantum</h2><p>If bits, amplitudes, or measurement are new, open Learn and complete the first four Quantum 101 modules. Then use Circuit Studio to turn a natural-language request into validated Circuit IR and a local simulation.</p><h3>First studio circuit</h3><p>After the one-qubit lessons, enter <code>Put one qubit in superposition and measure it</code>. Compare the H gate, Bloch vector, phase-aware amplitudes, and shot counts.</p><h3>CLI quick start</h3><pre><code>./qyog validate examples/superposition.qyog.json\n./qyog plan examples/superposition.qyog.json\n./qyog run examples/superposition.qyog.json</code></pre>`
  },
  "first-circuit": {
    title: "First circuit: a Bell pair",
    search: "Bell Hadamard CNOT entangle measurement first circuit",
    html: `<p class="eyebrow">Tutorial</p><h2>First circuit: a Bell pair</h2><p>Open Circuits and enter <code>Entangle two qubits and measure them</code>. The generated circuit applies H to q0, controls a CNOT from q0 to q1, and measures both qubits.</p><div class="docs-callout"><strong>Expected simulated result</strong><span>Only 00 and 11 appear, with approximately equal probability.</span></div><h3>Why it works</h3><p>H creates two coherent branches. CNOT copies the computational-basis relationship to q1, producing a joint state that cannot be described as independent qubit arrows.</p>`
  },
  "step-through": {
    title: "Step-through debugging",
    search: "step-through statevector amplitudes Bloch entanglement first previous next last",
    html: `<p class="eyebrow">Circuit tools</p><h2>Step-through debugging</h2><p>Use first, previous, next, and last above the circuit. After H, inspect |00&gt; and |10&gt;. After CNOT, inspect |00&gt; and |11&gt; and compare each mixed Bloch sphere with the joint amplitudes.</p><h3>Gate cursor</h3><p>The active gate is highlighted. Measurement remains in the circuit, but the state cursor advances through unitary operations only.</p>`
  },
  manifests: {
    title: "JSON / YAML manifests",
    search: "manifest JSON YAML declarative Circuit IR apiVersion quantumyog.dev",
    html: `<p class="eyebrow">Declarative language</p><h2>JSON / YAML manifests</h2><p>Both formats normalize to the same strict <code>quantumyog.dev/v1</code> document. A manifest contains exactly one inline circuit or deterministic template.</p><pre><code>apiVersion: quantumyog.dev/v1\nkind: Circuit\nmetadata:\n  name: bell-state\nspec:\n  backend: qiskit\n  circuit:\n    version: "1.0"\n    num_qubits: 2\n    gates: [...]</code></pre>`
  },
  cli: {
    title: "CLI workflow",
    search: "qyog init format validate plan compile run generate visualize terraform CLI",
    html: `<p class="eyebrow">Developer workflow</p><h2>CLI workflow</h2><p><code>qyog</code> keeps generation separate from deterministic review and execution.</p><pre><code>./qyog validate examples/bell.qyog.yaml\n./qyog plan examples/bell.qyog.yaml\n./qyog compile examples/bell.qyog.yaml --target qiskit -o bell.py\n./qyog run examples/bell.qyog.yaml\n./qyog visualize examples/bell.qyog.yaml</code></pre>`
  },
  improvement: {
    title: "Circuit improvement reviews",
    search: "recursive self improvement schedule optimizer plan propose review equivalent report",
    html: `<p class="eyebrow">Plan · propose · review</p><h2>Circuit improvement reviews</h2><p>Improvement jobs are bounded to 1–8 iterations by subscription entitlement. Every candidate is validated, simulated, and compared to the original statevector up to global phase.</p><h3>Acceptance rule</h3><p>A rewrite is accepted only when it is equivalent and reduces two-qubit gates, unitary gate count, or depth. Every run writes an HTML review artifact.</p>`
  },
  "use-cases": {
    title: "Quantum Use Case Center",
    search: "use cases classical baseline chemistry materials logistics cybersecurity finance energy climate government evidence",
    html: `<p class="eyebrow">Classical baseline first</p><h2>Quantum Use Case Center</h2><p>The workspace covers eight domains without claiming current production advantage. Choose learner or executive language, then compare the strongest classical baseline with a candidate quantum method.</p><h3>Evidence contract</h3><p>Every record states resource assumptions, present hardware limits, claim strength, provider fit, suitability questions, and primary sources. Educational examples teach a method. Emerging cases require more evidence. Evidence-backed actions support one current decision, such as post-quantum migration, and do not imply general quantum advantage.</p><h3>Practical path</h3><p>Answer every suitability question, then open a related circuit, provider-paradigm, or drug-discovery simulation. A defensible no is a useful result.</p>`
  },
  podcast: {
    title: "Podcast and read-only API",
    search: "podcast audio play all car phone transcript chapter download RSS API offline Kokoro",
    html: `<p class="eyebrow">Listen anywhere</p><h2>1StopQuantum Podcast</h2><p>Four long-form episodes connect classical computing to quantum security, use cases, hardware, benchmarks, and QBI-inspired evidence review. Press Play all once; the page never autoplays. Position and speed resume locally, episodes advance in order, and Media Session metadata supports phone lock screens.</p><h3>Catalog and feed</h3><div class="api-list"><code>GET /api/v1/podcast/catalog</code><span>Versioned episodes, chapters, duration, audio, transcripts, and attribution.</span><code>GET /api/v1/podcast/episodes/{id}/transcript</code><span>One complete transcript and chapter list.</span><code>GET /api/v1/podcast/feed.xml</code><span>RSS feed with WAV enclosures.</span></div><div class="docs-callout"><strong>Runtime boundary</strong><span>All WAV files are pre-generated and PWA-cached. Learners never invoke Kokoro.</span></div>`
  },
  community: {
    title: "Community publishing and privacy",
    search: "community research article contributor reviewer approval moderation privacy consent retention deletion API",
    html: `<p class="eyebrow">Reviewed publication</p><h2>Community and research</h2><p>Initial forms collect only name, email, request type, and explicit consent for a maximum 24-month review period. Research inquiries and contributor or reviewer applications remain private until internal review.</p><h3>Moderation</h3><p>Administrators can move a request through review, approval, or rejection. Every transition is audited. Approval can assign contributor or reviewer to a matching learner account but never grants administrator access.</p><h3>Public API boundary</h3><p>Only approved records are published. Contact details, private feedback, consent and retention timestamps, moderation notes, administrator IDs, and visitor identifiers are removed. The repository-local privacy notice explains access, correction, and deletion requests.</p>`
  },
  chatgpt: {
    title: "ChatGPT app with MCP",
    search: "ChatGPT MCP app Custom GPT Action visualization integration HTTPS",
    html: `<p class="eyebrow">Integrations</p><h2>ChatGPT app with MCP</h2><p>The recommended rich integration is a ChatGPT app backed by 1StopQuantum's Model Context Protocol server. It exposes <code>http://localhost:8001/mcp</code> locally and renders a circuit component directly in ChatGPT.</p><h3>Connect for development</h3><ol><li>Run <code>make demo</code>.</li><li>Expose <code>/mcp</code> through an approved HTTPS tunnel or deployment.</li><li>Enable ChatGPT developer mode and create an app using the HTTPS MCP URL.</li><li>Ask: “Put one qubit in superposition and measure it.”</li></ol><h3>Custom GPT Action</h3><p>For a Custom GPT Action, import <code>integrations/custom-gpt-openapi.json</code> and replace its server URL. Actions return structured circuit data and a visualization link; the MCP App path owns the inline component. A GPT uses apps or Actions as separate configurations.</p>`
  },
  providers: {
    title: "Provider model",
    search: "Qiskit Cirq IonQ D-Wave providers annealing gate model",
    html: `<p class="eyebrow">Execution</p><h2>Provider model</h2><p>Qiskit and Cirq execute the same Circuit IR on local simulators. IonQ is a planned gate-model hardware target. D-Wave-shaped QUBO remains a separate annealing lesson and runs through a local classical sampler.</p>`
  },
  benchmarking: {
    title: "Benchmark intelligence",
    search: "benchmark Metriq QBI DARPA recommender forecast claims evidence government utility scale attribution methodology",
    html: `<p class="eyebrow">Evidence before claims</p><h2>Benchmark intelligence</h2><p>The Benchmark workspace uses a bundled, normalized snapshot of public <a href="https://metriq.info/" target="_blank" rel="noreferrer">Metriq</a> records. Source values are retained; 1StopQuantum adds dates, provider labels, family direction, and display scores. Results from different benchmark families are not interchangeable.</p><h3>QPU Match</h3><p>The <strong>fit score</strong> estimates how closely a device matches the requested qubit scale, connectivity, and benchmark family. The separate <strong>evidence score</strong> describes how much relevant public data supports that match. Missing data means unknown, not poor performance. Recommendations do not include live price, queue, access, or vendor guarantees.</p><h3>Forecasting</h3><p>Forecasts use a transparent linear trend only when at least two comparable observations exist. The widening interval communicates uncertainty. This exploratory projection is not a fault-tolerance test and must not be used as a procurement promise.</p><h3>Claims + QBI</h3><p>The review form is inspired by <a href="https://www.darpa.mil/research/programs/quantum-benchmarking-initiative" target="_blank" rel="noreferrer">DARPA QBI</a>'s staged emphasis on plausible concepts, risk retirement, and independent verification. It is an independent educational screen, not affiliated with DARPA and <strong>not a DARPA determination</strong>.</p><div class="docs-callout"><strong>Decision rule</strong><span>Use the result to identify missing evidence and design an independent evaluation. Do not treat a score as proof that a system is utility-scale.</span></div>`
  },
  api: {
    title: "API reference",
    search: "API endpoint REST nl2manifest run accounts podcast RSS community content use cases improvements MCP health benchmarking recommend forecast digest claims",
    html: `<p class="eyebrow">Reference</p><h2>API reference</h2><div class="api-list"><code>POST /nl2manifest</code><span>Natural language to validated manifest and simulation.</span><code>POST /manifests/compile</code><span>Compile and run JSON or YAML.</span><code>GET /api/v1/use-cases</code><span>Evidence-aware use-case catalog and primary sources.</span><code>GET /api/v1/content/catalog</code><span>Versioned course, use-case, podcast, and documentation index.</span><code>GET /api/v1/podcast/catalog</code><span>Podcast episodes, chapters, transcripts, audio, and attribution.</span><code>GET /api/v1/podcast/feed.xml</code><span>RSS feed with local WAV enclosures.</span><code>POST /api/v1/community/submissions</code><span>Consent-controlled first-contact request.</span><code>GET /api/v1/community/publications</code><span>Approved research without private fields.</span><code>GET /benchmarking/overview</code><span>Bundled benchmark families, devices, dates, and source provenance.</span><code>POST /benchmarking/recommend</code><span>QPU suitability ranking with separate fit and evidence scores.</span><code>POST /accounts/signup</code><span>Create a local membership with a required password hash.</span><code>POST /improvements/jobs</code><span>Schedule or run a bounded circuit review.</span><code>POST /integrations/chatgpt/visualize</code><span>Custom GPT Action-compatible visualization data.</span><code>POST http://localhost:8001/mcp</code><span>Streamable HTTP MCP endpoint for the ChatGPT app.</span></div>`
  },
  concepts: {
    title: "Quantum concepts",
    search: "Hadamard phase Bloch measurement entanglement qubit gates concepts",
    html: `<p class="eyebrow">Reference</p><h2>Quantum concepts</h2><p>Use the gate palette and visual panels together. Hadamard introduces superposition, rotations move a state around the Bloch sphere, controlled gates can entangle qubits, and measurement samples classical outcomes.</p><h3>Read amplitudes before counts</h3><p>Amplitudes retain phase; measurement counts do not. 1StopQuantum colors amplitude bars by phase and keeps sampled counts neutral.</p>`
  }
};

function renderDocsOutline() {
  const outline = document.querySelector(".docs-toc");
  const headings = [...byId("docsArticle").querySelectorAll("h2, h3")];
  outline.replaceChildren(element("p", "", "On this page"));
  headings.forEach((heading, index) => {
    const fallback = `section-${index + 1}`;
    const id = heading.textContent.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || fallback;
    heading.id = id;
    const link = element("a", "", heading.textContent);
    link.href = `#${id}`;
    outline.appendChild(link);
  });
}

function renderDoc(key) {
  const page = docsPages[key] || docsPages["getting-started"];
  byId("docsArticle").innerHTML = page.html;
  renderDocsOutline();
  document.querySelectorAll(".docs-sidebar button[data-doc]").forEach((button) => button.classList.toggle("active", button.dataset.doc === key));
  byId("docsArticle").querySelectorAll("[data-doc-action='learn']").forEach((button) => button.addEventListener("click", () => showView("learn")));
  byId("docsSearchResults").hidden = true;
}

function searchDocs(query) {
  const results = byId("docsSearchResults");
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    results.hidden = true;
    results.replaceChildren();
    return;
  }
  const matches = Object.entries(docsPages).filter(([, page]) => `${page.title} ${page.search}`.toLowerCase().includes(normalized));
  results.replaceChildren();
  matches.forEach(([key, page]) => {
    const button = element("button", "", page.title);
    button.type = "button";
    button.addEventListener("click", () => renderDoc(key));
    results.append(button);
  });
  if (!matches.length) results.append(element("span", "", "No documentation matched your search."));
  results.hidden = false;
}

const learningModules = {
  foundations: {
    number: "00", section: "Foundations", title: "From a classical bit to a qubit",
    explanations: {
      "high-school": "Start with a switch. It stores one value: 0 or 1. A qubit also gives 0 or 1 when we measure it, but a gate can prepare it so repeated runs follow a probability pattern. We call the description used to predict that pattern its state.",
      undergraduate: "A classical bit occupies one of two values. A qubit is a normalized state vector with complex amplitudes for the computational basis states |0> and |1>; measurement samples their squared magnitudes.",
      masters: "A qubit is a ray represented by a normalized complex ket in a two-dimensional Hilbert space. Global phase is unobservable, while relative phase affects later unitary interference.",
    },
    details: {
      "high-school": "You need no physics or linear algebra yet. Follow prepare, transform, and measure, then compare your prediction with the simulator.",
      undergraduate: "Use |psi> = alpha|0> + beta|1> and require |alpha|^2 + |beta|^2 = 1.",
      masters: "Treat pure states projectively; mixed preparation requires a density operator rather than one Bloch vector.",
    },
    comparisonTitle: "Switch vs quantum state",
    comparison: "A classical switch stores one definite value. A qubit measurement also produces 0 or 1, but gates can prepare a state whose pattern appears only when we repeat the same experiment.",
    analogyLimit: "a qubit is not secretly choosing a face while we are not looking.",
    practicalTitle: "Prepare one qubit with H, then measure",
    practicalCopy: "Predict the distribution before running 1,024 repeat shots.",
    checkpoint: ["Both 0 and 1 at once", "One classical outcome: 0 or 1", "The Bloch sphere itself"],
    correct: "balanced",
  },
  qubit: {
    number: "01", section: "Qubit state", title: "Amplitude, probability, and phase",
    explanations: {
      "high-school": "The arrow marks a qubit state. Its tilt changes the chance of reading 0 or 1. Turning around the sphere changes phase, which can matter later even when today's bars look the same.",
      undergraduate: "The amplitudes alpha and beta are complex numbers. Their squared magnitudes are measurement probabilities; their relative phase controls how paths interfere after later gates.",
      masters: "The Bloch vector parameterizes a pure-state ket up to global phase: cos(theta/2)|0> + exp(i phi)sin(theta/2)|1>. Relative complex phase is operationally observable through a basis change.",
    },
    details: {
      "high-school": "Move theta first, then phase. Notice which display changes and which does not.",
      undergraduate: "Connect polar angle theta to magnitudes and azimuth phi to relative phase.",
      masters: "Relate the sphere to expectation values of the Pauli operators and the pure-state density matrix.",
    },
    comparisonTitle: "Probability knob vs state direction",
    comparison: "A classical random generator can match the two bars, but it has no coherent relative phase for a later gate to use.",
    analogyLimit: "matching one probability distribution does not make a classical random bit a qubit.",
    practicalTitle: "Rotate from |0> toward |1>", practicalCopy: "Predict the balanced result of a 90-degree Y rotation.",
    checkpoint: ["A color assigned to a gate", "A complex angle that can change interference", "The number of shots"], correct: "balanced",
  },
  gates: {
    number: "02", section: "Operations", title: "Gates transform states",
    explanations: {
      "high-school": "A gate is an instruction that changes a qubit without reading it. X flips |0> and |1>; H moves a basis state to an even superposition.",
      undergraduate: "Quantum gates are reversible unitary matrices. A circuit is their ordered composition, followed by any measurements.",
      masters: "Circuit evolution composes unitary operators; gate sets are assessed by universality, synthesis cost, connectivity, and hardware-native error rates.",
    },
    details: {
      "high-school": "Compare X with a NOT instruction, then notice that H has no ordinary one-bit equivalent.",
      undergraduate: "Multiply a state vector by X and verify that X squared is the identity.",
      masters: "Distinguish logical gates from transpiled native pulses and account for global phase equivalence.",
    },
    comparisonTitle: "Classical NOT vs quantum X", comparison: "Both swap 0 and 1 in their computational basis. A quantum X also acts linearly on every superposition.",
    analogyLimit: "most quantum gates cannot be understood as truth-table rewrites alone.",
    practicalTitle: "Apply X and measure", practicalCopy: "Begin in |0>, predict the output after one X gate.",
    checkpoint: ["A detector that reads a qubit", "A reversible transformation of quantum state", "A stored measurement count"], correct: "one",
  },
  superposition: {
    number: "03", section: "Measurement", title: "Superposition is not two readable answers",
    explanations: {
      "high-school": "Hadamard prepares a state with equal chances for 0 and 1. Each run still gives one answer, so we repeat the circuit to discover the pattern.",
      undergraduate: "H maps |0> to |+> = (|0> + |1>)/sqrt(2). Measurement applies the Born rule and repeated shots estimate the output distribution.",
      masters: "Projective Z-basis measurement samples the Born probabilities and conditions the post-measurement state on the observed projector.",
    },
    details: {
      "high-school": "A single run cannot reveal a 50/50 pattern; use many identical shots.",
      undergraduate: "Separate the exact statevector from finite-shot sampling uncertainty.",
      masters: "Use confidence intervals when inferring probabilities from finite multinomial samples.",
    },
    comparisonTitle: "Coin toss vs coherent superposition", comparison: "Both can produce 50/50 counts. Only the coherent qubit keeps phase that a later gate can recombine.",
    analogyLimit: "superposition is not simply ignorance about a pre-existing classical face.",
    practicalTitle: "Prepare |+> with H, then measure", practicalCopy: "Make a prediction before sampling the same circuit 1,024 times.",
    checkpoint: ["Both values printed in one shot", "One result per shot; many shots estimate probabilities", "No result because the state is unknown"], correct: "balanced",
  },
  interference: {
    number: "04", section: "Interference", title: "Quantum paths can reinforce or cancel",
    explanations: {
      "high-school": "Like overlapping waves, quantum amplitudes can add or cancel. Two H gates return |0> because the paths to 1 cancel.",
      undergraduate: "Amplitudes, not probabilities, add before squaring. H squared equals the identity because positive and negative path amplitudes recombine.",
      masters: "Interference follows coherent addition in a common measurement basis; decoherence suppresses off-diagonal density-matrix terms and removes the effect.",
    },
    details: {
      "high-school": "Compare one H with two H gates and predict which histogram becomes certain.",
      undergraduate: "Calculate H(H|0>) explicitly and track the signs of both paths.",
      masters: "Express the experiment as basis changes around phase accumulation and contrast it with an incoherent mixture.",
    },
    comparisonTitle: "Water waves vs probability paths", comparison: "Wave peaks can reinforce and a peak can cancel a trough. Ordinary classical percentages never cancel each other.",
    analogyLimit: "the state amplitude is complex-valued, not a literal material wave in the display.",
    practicalTitle: "Run H followed by H", practicalCopy: "Predict whether the second H keeps the distribution balanced or returns to zero.",
    checkpoint: ["Counts are subtracted after measurement", "Amplitudes combine before probabilities are formed", "Two measurements happen together"], correct: "zero",
  },
  entanglement: {
    number: "05", section: "Joint states", title: "Entanglement belongs to the whole system",
    explanations: {
      "high-school": "A Bell pair gives random individual results but matching joint results. The pair has one shared quantum description.",
      undergraduate: "The Bell state (|00> + |11>)/sqrt(2) cannot be factored into separate single-qubit state vectors. Each reduced state is mixed.",
      masters: "Entanglement is nonseparability of the joint density operator. Partial trace produces maximally mixed marginals while joint coherences remain.",
    },
    details: {
      "high-school": "Look at each qubit alone, then compare with the two-bit outcomes.",
      undergraduate: "Try and fail to factor the Bell amplitudes into a tensor product.",
      masters: "Contrast quantum correlation with separable mixtures and avoid implying faster-than-light signaling.",
    },
    comparisonTitle: "Shared classical plan vs entangled state", comparison: "Both can show matching outcomes. Entanglement also has basis-dependent correlations that no local pre-written values reproduce.",
    analogyLimit: "matching socks explain one basis only and do not capture Bell-test correlations.",
    practicalTitle: "Prepare and measure a Bell pair", practicalCopy: "Predict the two joint outcomes after H and CNOT.",
    checkpoint: ["Each qubit always has its own pure arrow", "The joint state cannot be split into independent qubit states", "The two qubits exchange messages when measured"], correct: "balanced",
  },
  algorithms: {
    number: "06", section: "Algorithms and hardware", title: "Algorithms shape interference on a backend",
    explanations: {
      "high-school": "A quantum algorithm arranges gates so useful answers become more likely. A simulator is an exact learning model; hardware also has noise.",
      undergraduate: "An algorithm encodes a problem into unitary evolution and measurement. The backend determines supported gates, connectivity, shots, and noise.",
      masters: "Practical algorithm design couples complexity advantage to compilation, sampling cost, error channels, and the distinction between fault-tolerant and NISQ regimes.",
    },
    details: {
      "high-school": "Choose a simulator to learn the idea, then compare what a real machine can change.",
      undergraduate: "Separate ideal algorithm behavior from transpilation and finite-shot effects.",
      masters: "Require an end-to-end resource argument rather than counting logical oracle calls alone.",
    },
    comparisonTitle: "CPU program vs quantum circuit", comparison: "Both are ordered instructions executed by a backend. Quantum circuits manage amplitudes and measurement rather than ordinary mutable variables.",
    analogyLimit: "a quantum computer does not try every answer and let us read all of them.",
    practicalTitle: "Amplify Grover's target |11>", practicalCopy: "Predict which two-bit result the circuit is designed to amplify.",
    checkpoint: ["Any physical computer with two states", "The simulator or hardware that executes a circuit", "A gate that removes all noise"], correct: "one",
  },
};

const quantumGlossary = {
  "Classical bit": "A recorded binary value, 0 or 1.",
  Qubit: "A two-level quantum system whose state can carry amplitudes and relative phase.",
  State: "The mathematical description used to predict the outcomes of future operations and measurements.",
  Amplitude: "A complex coefficient whose squared magnitude gives a measurement probability.",
  Probability: "A number from 0 to 1 describing how often an outcome is expected over repeated trials.",
  Phase: "The complex angle of an amplitude; relative phase changes later interference.",
  Superposition: "A state with nonzero amplitudes in more than one basis state.",
  Gate: "A reversible unitary operation that transforms quantum state without measuring it.",
  Circuit: "An ordered sequence of gates and measurements on qubit wires.",
  Measurement: "An operation that produces a classical outcome according to the state's probabilities.",
  Interference: "Reinforcement or cancellation when quantum amplitudes combine.",
  Entanglement: "A joint state whose parts cannot be described independently, even though each measurement is local.",
  "Bloch sphere": "A geometric map of pure one-qubit states; it is not a physical sphere.",
  Shots: "Independent repetitions of the same circuit used to estimate an outcome distribution.",
  Noise: "Unwanted interactions or control errors that change the intended quantum state.",
  Backend: "The simulator or quantum hardware that executes a circuit.",
};

const lessonPredictions = {
  foundations: ["Always 0", "About 50/50", "Always 1"],
  qubit: ["Always 0", "About 50/50", "Always 1"],
  gates: ["Always 0", "About 50/50", "Always 1"],
  superposition: ["Always 0", "About 50/50", "Always 1"],
  interference: ["Returns to 0", "Stays 50/50", "Changes to 1"],
  entanglement: ["Only 00", "00 and 11", "01 and 10"],
  algorithms: ["Target 00", "All outcomes equally", "Target 11"],
};

const learnerLabels = { "high-school": "High school", undergraduate: "Undergraduate", masters: "Master's" };
const visualSteps = {
  foundations: {
    prepare: ["Prepare", "One switch stores either 0 or 1. Begin with the known state 0."],
    transform: ["Transform", "Apply H. It changes how likely 0 and 1 will be when we look."],
    measure: ["Measure", "Read one ordinary answer from the qubit: 0 or 1."],
    observation: "one result per run, either 0 or 1. Repeat the run to reveal the pattern.",
  },
  qubit: {
    prepare: ["Prepare", "Begin at |0>, the top of the state map."],
    transform: ["Transform", "Move the state arrow. Tilt changes probabilities; turning changes phase."],
    measure: ["Measure", "The arrow becomes one result while the bars predict many repeats."],
    observation: "state is the prediction before measurement; probability is the repeated pattern after it.",
  },
  gates: {
    prepare: ["Prepare", "Place one qubit in the known state |0>."],
    transform: ["Transform", "Apply X to flip the state, like NOT changes a classical bit."],
    measure: ["Measure", "Read the transformed qubit as the classical result 1."],
    observation: "a gate changes the state first; measurement reads it afterward.",
  },
  superposition: {
    prepare: ["Prepare", "Begin with a qubit that would certainly read 0."],
    transform: ["Transform", "Apply H to create equal chances for 0 and 1."],
    measure: ["Measure", "Run many identical copies and count one answer from each."],
    observation: "one shot gives one answer; many shots reveal the near 50/50 distribution.",
  },
  interference: {
    prepare: ["Prepare", "Start at |0> with a predictable result."],
    transform: ["Transform", "Apply H twice. Quantum paths combine and the paths to 1 cancel."],
    measure: ["Measure", "The final state reads 0 again, not 50/50."],
    observation: "amplitudes combine before measurement, so possibilities can reinforce or cancel.",
  },
  entanglement: {
    prepare: ["Prepare", "Start two separate qubits in |00>."],
    transform: ["Transform", "Use H then CNOT to create one shared two-qubit state."],
    measure: ["Measure", "Read two bits together: the results are 00 or 11."],
    observation: "each qubit looks random alone, but the pair reveals a matching joint pattern.",
  },
  algorithms: {
    prepare: ["Prepare", "Encode candidate answers into a known starting state."],
    transform: ["Transform", "Arrange gates so unwanted paths cancel and the target path grows."],
    measure: ["Measure", "Sample the circuit and inspect which answer became most likely."],
    observation: "an algorithm shapes a probability distribution; it does not expose every answer at once.",
  },
};
let learningState = { level: "high-school", module: "foundations", completed: [] };
try {
  const restoredLearning = JSON.parse(localStorage.getItem(LEARNING_KEY) || "null");
  if (restoredLearning && learningModules[restoredLearning.module]) {
    learningState = {
      level: learnerLabels[restoredLearning.level] ? restoredLearning.level : "high-school",
      module: restoredLearning.module,
      completed: Array.isArray(restoredLearning.completed) ? restoredLearning.completed.filter((key) => learningModules[key]) : [],
    };
  }
} catch (_) {}

function lessonCircuit(module = learningState.module) {
  const common = { version: "1.0", shots: 1024, seed: 42 };
  if (module === "gates") return { ...common, num_qubits: 1, gates: [{ op: "X", targets: [0] }, { op: "measure", targets: [0] }] };
  if (module === "qubit") return { ...common, num_qubits: 1, gates: [{ op: "RY", targets: [0], params: { angle: Math.PI / 2 } }, { op: "measure", targets: [0] }] };
  if (module === "interference") return { ...common, num_qubits: 1, gates: [{ op: "H", targets: [0] }, { op: "H", targets: [0] }, { op: "measure", targets: [0] }] };
  if (module === "entanglement") return bellIR();
  if (module === "algorithms") return localTranslate("Grover search for |11> on 2 qubits.");
  return { ...common, num_qubits: 1, gates: [{ op: "H", targets: [0] }, { op: "measure", targets: [0] }] };
}

function saveLearningState() {
  try { localStorage.setItem(LEARNING_KEY, JSON.stringify(learningState)); } catch (_) {}
}

function renderGlossary(query = "") {
  const normalized = query.trim().toLowerCase();
  const terms = Object.entries(quantumGlossary).filter(([term, definition]) => `${term} ${definition}`.toLowerCase().includes(normalized));
  const results = byId("glossaryResults");
  results.replaceChildren();
  terms.forEach(([term, definition]) => results.append(element("dt", "", term), element("dd", "", definition)));
  if (!terms.length) results.append(element("dd", "", "No term matched that search."));
}

function updateLearningProgress() {
  const completed = new Set(learningState.completed);
  byId("courseProgress").value = completed.size;
  byId("courseProgress").textContent = `${completed.size} of 7`;
  byId("learningProgressLabel").textContent = `${completed.size} of 7 checkpoints complete`;
  document.querySelectorAll(".lesson-tabs button[data-module]").forEach((button) => button.classList.toggle("complete", completed.has(button.dataset.module)));
}

function setLearningAngles(theta, phi) {
  byId("thetaSlider").value = String(theta);
  byId("phiSlider").value = String(phi);
  byId("thetaOutput").textContent = `${theta}°`;
  byId("phiOutput").textContent = `${phi}°`;
  if (tutorialVisuals) tutorialVisuals.update(theta, phi);
}

function updateStateReadout({ theta, phi, p0, p1 }) {
  const alpha = Math.cos(theta * Math.PI / 360);
  const beta = Math.sin(theta * Math.PI / 360);
  const phase = Number(phi) === 0 ? "" : `e^(i${Math.round(phi)}°)`;
  byId("stateReadout").textContent = `|psi> = ${alpha.toFixed(3)}|0> + ${beta.toFixed(3)}${phase}|1> · P(0) ${Math.round(p0 * 100)}% · P(1) ${Math.round(p1 * 100)}%`;
  byId("stateInsight").textContent = Number(phi) === 0
    ? "Change phase next. The arrow can turn while these Z-basis probabilities stay fixed."
    : "Phase moved the arrow around the sphere without changing the Z-basis bars; a later gate can reveal that difference.";
}

function initializeTutorialVisuals() {
  if (tutorialVisuals || !window.QuantumYogTutorialViz?.createTutorialVisuals) return;
  tutorialVisuals = window.QuantumYogTutorialViz.createTutorialVisuals(byId("learningWebgl"), byId("classicalQuantumChart"), updateStateReadout);
  window.__quantumyogTutorialPixelStats = () => tutorialVisuals.pixelStats();
  setLearningAngles(Number(byId("thetaSlider").value), Number(byId("phiSlider").value));
}

function renderLearningModule(module = learningState.module) {
  const lesson = learningModules[module];
  const visual = visualSteps[module];
  learningState.module = module;
  selectedPrediction = null;
  byId("lessonKicker").textContent = `Module ${lesson.number} · ${lesson.section}`;
  byId("lessonTitle").textContent = lesson.title;
  byId("lessonExplanation").textContent = lesson.explanations[learningState.level];
  byId("lessonLevelLabel").textContent = `At ${learnerLabels[learningState.level]} depth`;
  byId("lessonLevelDetail").textContent = lesson.details[learningState.level];
  byId("comparisonTitle").textContent = lesson.comparisonTitle;
  byId("comparisonCopy").textContent = lesson.comparison;
  byId("analogyLimit").textContent = lesson.analogyLimit;
  byId("visualPrepareLabel").textContent = visual.prepare[0];
  byId("visualPrepareCopy").textContent = visual.prepare[1];
  byId("visualTransformLabel").textContent = visual.transform[0];
  byId("visualTransformCopy").textContent = visual.transform[1];
  byId("visualMeasureLabel").textContent = visual.measure[0];
  byId("visualMeasureCopy").textContent = visual.measure[1];
  byId("conceptFlowTitle").textContent = `${lesson.title}: the three-step model`;
  byId("conceptFlowTitle").nextElementSibling.textContent = "No prior quantum vocabulary is required. Read these three blocks from left to right.";
  const observation = byId("conceptFlowTitle").closest(".concept-flow").querySelector(".concept-observation");
  observation.replaceChildren(element("strong", "", "What you see:"), document.createTextNode(` ${visual.observation}`));
  byId("practicalTitle").textContent = lesson.practicalTitle;
  byId("practicalCopy").textContent = lesson.practicalCopy;
  byId("lessonRunSimulation").disabled = true;
  byId("lessonSimulationResult").hidden = true;
  document.querySelectorAll(".prediction-options button").forEach((button, index) => {
    button.classList.remove("selected");
    button.textContent = lessonPredictions[module][index];
  });
  document.querySelectorAll(".lesson-tabs button[data-module]").forEach((button) => button.classList.toggle("active", button.dataset.module === module));
  const answers = byId("checkpointOptions").querySelectorAll("button");
  answers.forEach((button, index) => {
    button.textContent = lesson.checkpoint[index];
    button.classList.remove("correct", "incorrect");
  });
  byId("checkpointQuestion").textContent = module === "foundations" ? "What does a measurement of one qubit return?" : `Check your model: which statement about ${lesson.section.toLowerCase()} is accurate?`;
  byId("checkpointFeedback").textContent = learningState.completed.includes(module) ? "Completed: checkpoint passed. Revisit any answer to review it." : "Choose an answer to check your model.";
  saveLearningState();
  updateLearningProgress();
}

function setLearningLevel(level) {
  learningState.level = level;
  document.querySelectorAll(".learner-level button[data-level]").forEach((button) => {
    const active = button.dataset.level === level;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderClassicalIntroduction(level);
  if (currentCurriculumLesson) {
    byId("courseLessonMeta").textContent = `${currentCurriculumLesson.duration_minutes} min · ${learnerLabels[level]}`;
  }
  renderLearningModule();
}

function formatMediaTime(value) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function resetAudioButton(audio, button) {
  button.querySelector("span").textContent = "▶";
  button.setAttribute("aria-label", "Play narration");
  if (!audio.paused) audio.pause();
  audio.currentTime = 0;
}

function connectAudioPlayer(audio, button, progress, timeLabel) {
  const update = () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const ratio = duration ? audio.currentTime / duration : 0;
    progress.value = String(Math.round(ratio * 1000));
    timeLabel.textContent = `${formatMediaTime(audio.currentTime)} / ${formatMediaTime(duration)}`;
  };
  button.addEventListener("click", async () => {
    if (audio.paused) {
      try {
        await audio.play();
        button.querySelector("span").textContent = "❚❚";
        button.setAttribute("aria-label", "Pause narration");
        const startedAt = audio.currentTime;
        window.setTimeout(async () => {
          if (audio.paused || audio.currentTime > startedAt + .001) return;
          audio.pause();
          if (Number.isFinite(audio.duration) && audio.duration > .1) audio.currentTime = Math.min(.05, audio.duration / 2);
          try { await audio.play(); } catch (_) { button.setAttribute("aria-label", "Narration could not be played"); }
        }, 500);
      } catch (_) {
        button.setAttribute("aria-label", "Narration could not be played");
      }
    } else {
      audio.pause();
    }
  });
  audio.addEventListener("pause", () => {
    button.querySelector("span").textContent = "▶";
    button.setAttribute("aria-label", "Play narration");
  });
  audio.addEventListener("timeupdate", update);
  audio.addEventListener("loadedmetadata", update);
  audio.addEventListener("ended", () => { audio.currentTime = 0; update(); });
  progress.addEventListener("input", () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(progress.value) / 1000 * audio.duration;
  });
}

function curriculumEntries() {
  if (!curriculumData) return [];
  return curriculumData.courses.flatMap((course, courseIndex) => course.lessons.map((lesson, lessonIndex) => ({ course, lesson, courseIndex, lessonIndex })));
}

function renderCourseCatalog() {
  const catalog = byId("courseCatalog");
  catalog.replaceChildren();
  curriculumData.courses.forEach((course) => {
    const button = element("button");
    button.type = "button";
    button.dataset.course = course.id;
    button.dataset.testid = `course-card-${course.id}`;
    button.append(
      element("span", "", `Course ${String(course.number).padStart(2, "0")}`),
      element("strong", "", course.title),
      element("small", "", `${course.lessons.length} lessons`),
    );
    button.addEventListener("click", () => selectCourseLesson(course.lessons[0].id));
    catalog.append(button);
  });
}

function renderCourseLessonTabs(course, activeLessonId) {
  const tabs = byId("lessonTabs");
  const completed = new Set(learningState.completed);
  tabs.replaceChildren(...course.lessons.map((lesson, index) => {
    const button = element("button");
    button.type = "button";
    button.dataset.lessonId = lesson.id;
    button.dataset.module = lesson.legacy_module;
    button.dataset.testid = course.id === "foundations"
      ? `lesson-tab-${lesson.legacy_module}`
      : `course-lesson-tab-${lesson.id}`;
    button.classList.toggle("active", lesson.id === activeLessonId);
    button.classList.toggle("complete", completed.has(lesson.legacy_module));
    button.append(
      element("span", "", `${String(course.number).padStart(2, "0")}.${index + 1}`),
      document.createTextNode(lesson.title),
    );
    return button;
  }));
  tabs.setAttribute("aria-label", `Lessons in ${course.title}`);
}

function renderCourseOutline() {
  const body = byId("courseOutlineBody");
  body.replaceChildren();
  const total = curriculumEntries().length;
  byId("courseOutlineCount").textContent = `${total} short lessons · ${Math.floor(curriculumData.estimated_minutes / 60)} hours ${curriculumData.estimated_minutes % 60} minutes`;
  curriculumData.courses.forEach((course) => {
    const group = element("section", "course-outline-group");
    const header = element("header");
    const headerCopy = element("div");
    headerCopy.append(element("strong", "", course.title), element("p", "", course.description));
    header.append(element("span", "", String(course.number).padStart(2, "0")), headerCopy);
    group.append(header);
    course.lessons.forEach((lesson, index) => {
      const button = element("button");
      button.type = "button";
      button.dataset.lessonId = lesson.id;
      button.dataset.testid = `course-lesson-${lesson.id}`;
      button.append(
        element("span", "", `${course.number}.${index + 1}`),
        element("strong", "", lesson.title),
        element("small", "", `${lesson.duration_minutes} min`),
      );
      button.addEventListener("click", () => selectCourseLesson(lesson.id, true));
      group.append(button);
    });
    body.append(group);
  });
}

function renderCurriculumLesson(entry) {
  const { course, lesson, courseIndex, lessonIndex } = entry;
  currentCurriculumCourse = course;
  currentCurriculumLesson = lesson;
  byId("coursePosition").textContent = `Course ${courseIndex + 1} of ${curriculumData.courses.length} · Lesson ${lessonIndex + 1} of ${course.lessons.length}`;
  byId("courseLessonTitle").textContent = lesson.title;
  byId("courseLessonMeta").textContent = `${lesson.duration_minutes} min · ${learnerLabels[learningState.level]}`;
  byId("courseName").textContent = `Course ${String(course.number).padStart(2, "0")} · ${course.title}`;
  byId("courseMediaTitle").textContent = lesson.title;
  byId("courseMediaSummary").textContent = lesson.summary;
  byId("lessonMedia").dataset.animation = lesson.visual.animation;
  byId("lessonMediaImage").src = lesson.visual.image || course.image;
  byId("lessonMediaImage").alt = lesson.visual.alt;
  const provenance = lesson.visual.provenance || {};
  byId("visualProvenanceTooltip").textContent = `AI-generated visual. Model: ${provenance.model || "local image model"}. Prompt: ${provenance.prompt || lesson.visual.alt}. If the visual is misleading, use Report inaccuracy so the course team can review and recreate it.`;
  byId("lessonFeedbackStatus").textContent = "";
  let liked = false;
  try { liked = JSON.parse(localStorage.getItem(LIKES_KEY) || "[]").includes(lesson.id); } catch (_) {}
  byId("lessonLike").classList.toggle("active", liked);
  byId("lessonLike").setAttribute("aria-pressed", String(liked));
  loadFeedbackSummary(lesson.id);
  trackPageView(`learn:${lesson.id}`);

  const objectives = byId("courseObjectives");
  objectives.replaceChildren(...lesson.objectives.map((objective) => element("li", "", objective)));
  const reading = byId("courseReading");
  reading.replaceChildren(...lesson.sections.map((section) => {
    const article = element("article");
    article.append(element("h4", "", section.heading), element("p", "", section.body));
    return article;
  }));

  const audio = byId("lessonAudioPlayer");
  resetAudioButton(audio, byId("lessonAudioToggle"));
  audio.src = lesson.audio;
  audio.load();
  byId("lessonAudioProgress").value = "0";
  byId("lessonAudioTime").textContent = "0:00 / 0:00";

  document.querySelectorAll("#courseCatalog button[data-course]").forEach((button) => button.classList.toggle("active", button.dataset.course === course.id));
  document.querySelectorAll("#courseOutlineBody button[data-lesson-id]").forEach((button) => button.classList.toggle("active", button.dataset.lessonId === lesson.id));
  document.querySelectorAll("#lessonTabs button[data-lesson-id]").forEach((button) => button.classList.toggle("active", button.dataset.lessonId === lesson.id));
  try { localStorage.setItem(COURSE_KEY, JSON.stringify({ lesson: lesson.id })); } catch (_) {}
}

function selectCourseLesson(lessonId, closeOutline = false, scroll = true) {
  const entry = curriculumEntries().find((candidate) => candidate.lesson.id === lessonId);
  if (!entry) return;
  renderCourseLessonTabs(entry.course, entry.lesson.id);
  renderLearningModule(entry.lesson.legacy_module);
  renderCurriculumLesson(entry);
  if (closeOutline && byId("courseOutlineDialog").open) byId("courseOutlineDialog").close();
  if (scroll) document.querySelector(".course-player").scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectLegacyLearningModule(module) {
  const preferred = curriculumEntries().find(({ lesson }) => lesson.legacy_module === module);
  if (preferred) selectCourseLesson(preferred.lesson.id);
  else renderLearningModule(module);
}

async function loadCurriculum() {
  const lessonAudioToggle = byId("lessonAudioToggle");
  lessonAudioToggle.disabled = true;
  try {
    const response = await fetch("/data/quantum_curriculum.json", { cache: "no-store" });
    if (!response.ok) throw new Error("curriculum unavailable");
    curriculumData = await response.json();
    renderClassicalIntroduction(learningState.level);
    renderCourseCatalog();
    renderCourseOutline();
    let lessonId = "bits-and-qubits";
    try {
      const restored = JSON.parse(localStorage.getItem(COURSE_KEY) || "null");
      if (restored?.lesson) lessonId = restored.lesson;
    } catch (_) {}
    if (!curriculumEntries().some(({ lesson }) => lesson.id === lessonId)) lessonId = "bits-and-qubits";
    selectCourseLesson(lessonId, false, false);
    updateScreenAudioGuide();
  } catch (_) {
    byId("lessonFeedbackStatus").textContent = "Saved curriculum could not be loaded.";
  } finally {
    lessonAudioToggle.disabled = false;
  }
}

function renderClassicalIntroduction(level) {
  const fallbackAudience = level === "masters" ? "executive" : "beginner";
  const introduction = curriculumData?.depth_introductions?.[level]
    || curriculumData?.introductions?.find((item) => item.audience === fallbackAudience);
  if (!introduction) return;
  byId("classicalIntroTitle").textContent = introduction.title;
  byId("classicalIntroSummary").textContent = introduction.summary;
  byId("classicalIntroNarration").textContent = introduction.narration;
}

function screenGuideKey(view = activeWorkspace) {
  return view === "circuits" ? "editor" : view;
}

function updateScreenAudioGuide() {
  const guide = curriculumData?.screen_guides?.[screenGuideKey()] || curriculumData?.workspace_guides?.[screenGuideKey()];
  if (!guide) return;
  byId("audioGuideTitle").textContent = guide.title;
  byId("audioGuideSummary").textContent = guide.summary;
  byId("audioGuideHowto").textContent = guide.how_to;
  byId("audioGuideTranscript").textContent = guide.narration;
  const audio = byId("audioGuidePlayer");
  resetAudioButton(audio, byId("audioGuideToggle"));
  audio.src = guide.audio;
  audio.load();
  byId("audioGuideProgress").value = "0";
  byId("audioGuideTime").textContent = "0:00 / 0:00";
}

async function loadFeedbackSummary(contentId) {
  try {
    const summary = await requestJson(`/feedback/summary/${encodeURIComponent(contentId)}`);
    if (currentCurriculumLesson?.id === contentId) byId("lessonLikeCount").textContent = String(summary.likes || 0);
  } catch (_) {
    if (currentCurriculumLesson?.id === contentId) byId("lessonLikeCount").textContent = "0";
  }
}

async function likeCurrentLesson() {
  if (!currentCurriculumLesson) return;
  const button = byId("lessonLike");
  button.disabled = true;
  try {
    const summary = await requestJson("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...engagementIdentity(), content_id: currentCurriculumLesson.id, kind: "like" }),
    });
    byId("lessonLikeCount").textContent = String(summary.likes || 0);
    button.classList.add("active");
    button.setAttribute("aria-pressed", "true");
    const liked = new Set(JSON.parse(localStorage.getItem(LIKES_KEY) || "[]"));
    liked.add(currentCurriculumLesson.id);
    localStorage.setItem(LIKES_KEY, JSON.stringify([...liked]));
    byId("lessonFeedbackStatus").textContent = "Thank you. This lesson was marked helpful.";
  } catch (error) {
    byId("lessonFeedbackStatus").textContent = error instanceof NetworkUnavailableError ? "Feedback needs the local API." : error.message;
  } finally {
    button.disabled = false;
  }
}

function openFeedbackDialog() {
  byId("feedbackMessage").value = "";
  byId("feedbackError").hidden = true;
  byId("feedbackDialog").showModal();
}

async function submitFeedback(event) {
  event.preventDefault();
  const error = byId("feedbackError");
  error.hidden = true;
  try {
    await requestJson("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...engagementIdentity(),
        content_id: currentCurriculumLesson?.id || activeWorkspace,
        kind: "inaccuracy",
        message: byId("feedbackMessage").value.trim(),
      }),
    });
    byId("feedbackDialog").close();
    byId("lessonFeedbackStatus").textContent = "Report received for editorial review.";
  } catch (submissionError) {
    error.textContent = submissionError instanceof NetworkUnavailableError ? "Feedback needs the local API." : submissionError.message;
    error.hidden = false;
  }
}

function runLessonSimulation() {
  const ir = lessonCircuit();
  const data = localResult(ir, "qiskit");
  const entries = Object.entries(data.counts).sort(([left], [right]) => left.localeCompare(right));
  const rows = byId("lessonSimulationResult").querySelectorAll(".lesson-count");
  rows.forEach((row, index) => {
    const [outcome, count] = entries[index] || ["-", 0];
    row.hidden = index >= entries.length;
    row.querySelector("span").textContent = outcome;
    row.querySelector("strong").textContent = String(count);
    row.querySelector("b").style.width = `${Math.max(1, count / (ir.shots || 1024) * 100)}%`;
  });
  const expected = learningModules[learningState.module].correct;
  const correct = selectedPrediction === expected;
  byId("predictionFeedback").textContent = correct
    ? "Prediction correct: the simulator matches the distribution implied by the final state."
    : `Prediction not quite: inspect the ${entries.map(([outcome]) => outcome).join(" and ")} outcomes, then trace each gate.`;
  byId("lessonSimulationResult").hidden = false;
}

function answerCheckpoint(button) {
  const correct = button.dataset.answer === "correct";
  button.classList.add(correct ? "correct" : "incorrect");
  if (!correct) {
    byId("checkpointFeedback").textContent = `Not quite. Revisit the ${learningModules[learningState.module].title.toLowerCase()} explanation, then test the practical again.`;
    return;
  }
  if (!learningState.completed.includes(learningState.module)) learningState.completed.push(learningState.module);
  byId("checkpointFeedback").textContent = "Correct. The explanation and the simulation now agree with your model.";
  saveLearningState();
  updateLearningProgress();
}

const planDescriptions = {
  explorer: "Explorer · one scheduled review · two iterations per run",
  scholar: "Scholar · ten scheduled reviews · four iterations per run",
  lab: "Lab · fifty scheduled reviews · eight iterations per run"
};

function updateAccount(account) {
  currentAccount = account;
  ["faqAssistantOpen", "sumiVoiceReset", "sumiSystemReset"].forEach((id) => { byId(id).hidden = false; });
  const plan = account.subscription.plan;
  byId("accountStatus").textContent = `${account.display_name} · ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
  byId("signupOpen").hidden = true;
  byId("signinOpen").hidden = true;
  byId("accountLogout").hidden = false;
  byId("docsSignup").hidden = true;
  byId("docsSignin").hidden = true;
  byId("docsLogout").hidden = false;
  byId("paletteAuthNote").hidden = true;
  document.querySelector(".workspace-gates-list").hidden = false;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.remove("auth-locked");
    if (button.title.startsWith("Sign in required")) button.removeAttribute("title");
  });
  try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account)); } catch (_) {}
  if (pendingProtectedView) {
    const destination = pendingProtectedView;
    pendingProtectedView = null;
    showView(destination);
  }
}

function logoutAccount() {
  // Stop microphone capture and audio immediately when the session ends.
  // This keeps Sumi unavailable to guests and prevents a signed-out tab from
  // retaining an active voice stream.
  resetCoTeacherVoice().catch(() => {});
  currentAccount = null;
  ["faqAssistantOpen", "sumiVoiceReset", "sumiSystemReset"].forEach((id) => { byId(id).hidden = true; });
  byId("accountStatus").textContent = "Local guest";
  byId("signupOpen").hidden = false;
  byId("signinOpen").hidden = false;
  byId("accountLogout").hidden = true;
  byId("docsSignup").hidden = false;
  byId("docsSignin").hidden = false;
  byId("docsLogout").hidden = true;
  byId("paletteAuthNote").hidden = false;
  document.querySelector(".workspace-gates-list").hidden = true;
  document.querySelectorAll(".nav-item").forEach((button) => {
    if (button.id !== "navLearn") {
      button.classList.add("auth-locked");
      button.title = `Sign in required to open ${button.textContent.trim()}`;
    }
  });
  try { localStorage.removeItem(ACCOUNT_KEY); } catch (_) {}
  if (PROTECTED_VIEWS.has(activeWorkspace)) showView("learn");
}

function openSignup() {
  byId("signupError").hidden = true;
  const dialog = byId("signupDialog");
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
}

function closeSignup() {
  const dialog = byId("signupDialog");
  if (dialog.close) dialog.close(); else dialog.removeAttribute("open");
}

function openSignin() {
  byId("signinError").hidden = true;
  const dialog = byId("signinDialog");
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
}

function closeSignin() {
  const dialog = byId("signinDialog");
  if (dialog.close) dialog.close(); else dialog.removeAttribute("open");
}

async function submitSignup(event) {
  event.preventDefault();
  const error = byId("signupError");
  error.hidden = true;
  const body = {
    display_name: byId("signupName").value.trim(),
    email: byId("signupEmail").value.trim(),
    plan: byId("signupPlan").value,
    password: byId("signupPassword").value,
    password_hint: byId("signupPasswordHint").value.trim(),
    recovery_question: byId("signupRecoveryQuestion").value,
    recovery_answer: byId("signupRecoveryAnswer").value.trim()
  };
  try {
    let account;
    try {
      account = await requestJson("/accounts/signup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
    } catch (requestError) {
      if (!(requestError instanceof NetworkUnavailableError)) throw requestError;
      if (!body.password || body.password.length < 8) throw new Error("Password is required and must be 8 to 128 characters.");
      account = { id: `local-${Date.now()}`, email: body.email, display_name: body.display_name, subscription: { plan: body.plan, status: "active" } };
    }
    updateAccount(account);
    closeSignup();
  } catch (submissionError) {
    error.textContent = submissionError.message || "The account could not be created.";
    error.hidden = false;
  }
}

function fillDemoAccount() {
  byId("signinEmail").value = "learner@1stopquantum.local";
  byId("signinPassword").value = "LearnQuantum2026!";
  byId("signinError").hidden = true;
  byId("signinPassword").focus();
}

function openRecovery() {
  const email = byId("signinEmail").value.trim();
  closeSignin();
  byId("recoveryForm").reset();
  byId("recoveryEmail").value = email;
  byId("recoveryChallengePanel").hidden = true;
  byId("recoveryError").hidden = true;
  byId("recoveryStatus").textContent = "";
  byId("recoveryDialog").showModal();
}

function closeRecovery() {
  byId("recoveryDialog").close();
}

async function loadRecoveryChallenge() {
  const error = byId("recoveryError");
  error.hidden = true;
  byId("recoveryStatus").textContent = "";
  try {
    const challenge = await requestJson("/accounts/recovery/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: byId("recoveryEmail").value.trim() })
    });
    byId("recoveryHint").textContent = challenge.password_hint || "No hint was saved.";
    byId("recoveryQuestion").textContent = challenge.recovery_question;
    byId("recoveryChallengePanel").hidden = false;
    byId("recoveryAnswer").required = true;
    byId("recoveryNewPassword").required = true;
    byId("recoveryAnswer").focus();
  } catch (challengeError) {
    byId("recoveryChallengePanel").hidden = true;
    error.textContent = challengeError.message || "Recovery is not configured for this account.";
    error.hidden = false;
  }
}

async function submitRecovery(event) {
  event.preventDefault();
  const error = byId("recoveryError");
  error.hidden = true;
  try {
    await requestJson("/accounts/recovery/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: byId("recoveryEmail").value.trim(),
        recovery_answer: byId("recoveryAnswer").value,
        new_password: byId("recoveryNewPassword").value
      })
    });
    byId("signinEmail").value = byId("recoveryEmail").value.trim();
    byId("signinPassword").value = "";
    byId("recoveryStatus").textContent = "Password reset. Return to sign in with your new password.";
    byId("recoveryChallengePanel").hidden = true;
  } catch (resetError) {
    error.textContent = resetError.message || "The password could not be reset.";
    error.hidden = false;
  }
}

function returnToSignin() {
  closeRecovery();
  openSignin();
}

async function submitSignin(event) {
  event.preventDefault();
  const error = byId("signinError");
  error.hidden = true;
  try {
    const account = await requestJson("/accounts/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: byId("signinEmail").value.trim(), password: byId("signinPassword").value })
    });
    updateAccount(account);
    closeSignin();
  } catch (submissionError) {
    error.textContent = submissionError instanceof NetworkUnavailableError
      ? "Sign in requires the local 1StopQuantum API. Start it with ./manage.sh start."
      : submissionError.message || "The account could not be signed in.";
    error.hidden = false;
  }
}

function localImprovementResult(ir, objective, runNow) {
  const gates = ir.gates.filter((gate) => gate.op !== "measure");
  let reduced = gates.length;
  for (let index = 1; index < gates.length; index += 1) {
    if (gates[index].op === gates[index - 1].op && JSON.stringify(gates[index].targets) === JSON.stringify(gates[index - 1].targets)) reduced -= 2;
  }
  return {
    id: `local-job-${Date.now()}`, status: runNow ? "completed" : "scheduled", objective,
    report_url: null,
    result: runNow ? { accepted: reduced < gates.length, before_metrics: { unitary_gates: gates.length }, after_metrics: { unitary_gates: Math.max(0, reduced) } } : null
  };
}

function renderImprovementJob(job) {
  byId("improvementResult").hidden = false;
  if (job.status === "completed" && job.result) {
    const before = job.result.before_metrics.unitary_gates;
    const after = job.result.after_metrics.unitary_gates;
    const decision = job.result.accepted ? "Accepted" : "Unchanged";
    byId("improvementStatus").textContent = `${decision} · ${before} gates → ${after} gates`;
    byId("improvementBefore").textContent = `${before} gates`;
    byId("improvementAfter").textContent = `${after} gates`;
  } else {
    byId("improvementStatus").textContent = `Scheduled · ${new Date(job.schedule_at).toLocaleString()}`;
    byId("improvementBefore").textContent = "pending";
    byId("improvementAfter").textContent = "pending";
  }
  const report = byId("improvementReport");
  report.hidden = !job.report_url;
  if (job.report_url) report.href = job.report_url.startsWith("http") ? job.report_url : `${API}${job.report_url}`;
  const item = element("div", "history-item");
  item.append(element("strong", "", job.status), element("span", "", job.objective));
  byId("improvementHistory").replaceChildren(item);
}

async function submitImprovement(runNow) {
  const error = byId("improvementError");
  error.hidden = true;
  const objective = byId("improvementObjective").value.trim();
  const scheduleValue = byId("improvementSchedule").value;
  const body = {
    user_id: currentAccount?.id || "local-demo",
    circuit: currentIR || bellIR(),
    objective,
    schedule_at: scheduleValue ? new Date(scheduleValue).toISOString() : new Date().toISOString(),
    max_iterations: Number(byId("improvementIterations").value),
    run_now: runNow
  };
  try {
    let job;
    try {
      job = await requestJson("/improvements/jobs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
    } catch (requestError) {
      if (!(requestError instanceof NetworkUnavailableError)) throw requestError;
      job = localImprovementResult(body.circuit, objective, runNow);
      job.schedule_at = body.schedule_at;
    }
    renderImprovementJob(job);
  } catch (submissionError) {
    error.textContent = currentAccount ? submissionError.message : "Create a local account before scheduling a persisted review.";
    error.hidden = false;
  }
}

function claimLabel(value) {
  return value === "evidence-backed" ? "Evidence-backed action" : value.charAt(0).toUpperCase() + value.slice(1);
}

function renderUseCaseDetail(item) {
  activeUseCase = item;
  document.querySelectorAll(".use-case-list button").forEach((button) => button.classList.toggle("active", button.dataset.id === item.id));
  const audience = byId("useCaseAudience").value;
  const detail = byId("useCaseDetail");
  detail.replaceChildren();
  detail.append(element("p", "eyebrow", `${item.domain} · ${claimLabel(item.claim_strength)}`), element("h3", "", item.title));
  detail.append(element("p", "use-case-audience-copy", audience === "executive" ? item.executive_view : item.learner_view));
  const comparison = element("div", "use-case-comparison");
  [["Classical baseline", item.classical_baseline], ["Quantum candidate", item.quantum_candidate], ["Resource assumptions", item.resource_assumptions], ["Current hardware limit", item.hardware_limits]].forEach(([label, copy]) => {
    const section = element("section"); section.append(element("h4", "", label), element("p", "", copy)); comparison.append(section);
  });
  detail.append(comparison);
  const sourceList = element("div", "use-case-sources");
  sourceList.append(element("strong", "", "Primary sources"));
  item.sources.forEach((url, index) => { const link = element("a", "", `Source ${index + 1}`); link.href = url; link.target = "_blank"; link.rel = "noreferrer"; sourceList.append(link); });
  detail.append(sourceList);
  const actions = element("div", "use-case-actions");
  const providerButton = element("button", "", "Compare provider paradigms"); providerButton.type = "button"; providerButton.addEventListener("click", () => showView("providers")); actions.append(providerButton);
  const circuitButton = element("button", "", "Open circuit experiment"); circuitButton.type = "button"; circuitButton.addEventListener("click", () => showView("circuits")); actions.append(circuitButton);
  if (["chemistry", "materials"].includes(item.domain)) { const drugButton = element("button", "", "Open drug discovery lesson"); drugButton.type = "button"; drugButton.addEventListener("click", () => showView("drug")); actions.append(drugButton); }
  detail.append(actions);
  const questions = byId("useCaseQuestions");
  questions.replaceChildren(...item.suitability_questions.map((question, index) => {
    const label = element("label"); const input = element("input"); input.type = "checkbox"; input.dataset.question = String(index); label.append(input, element("span", "", question)); return label;
  }));
  byId("useCaseAssessmentResult").textContent = "Answer every question before selecting a provider or funding a pilot.";
}

function renderUseCases(domain = "all") {
  if (!useCaseData) return;
  const items = useCaseData.use_cases.filter((item) => domain === "all" || item.domain === domain);
  const list = byId("useCaseList"); list.replaceChildren();
  items.forEach((item) => {
    const button = element("button", `use-case-card claim-${item.claim_strength}`);
    button.type = "button"; button.dataset.id = item.id;
    button.append(element("span", "", item.domain), element("strong", "", item.title), element("small", "", claimLabel(item.claim_strength)));
    button.addEventListener("click", () => renderUseCaseDetail(item)); list.append(button);
  });
  if (items.length) renderUseCaseDetail(items[0]);
}

async function loadUseCases() {
  if (useCaseData) return;
  try { useCaseData = await requestJson("/api/v1/use-cases"); }
  catch (_) {
    const response = await fetch("/data/use_cases.json", { cache: "no-store" });
    useCaseData = await response.json();
  }
  const domains = ["all", ...new Set(useCaseData.use_cases.map((item) => item.domain))];
  const filters = byId("useCaseDomainFilters"); filters.replaceChildren();
  domains.forEach((domain, index) => {
    const button = element("button", index === 0 ? "active" : "", domain === "all" ? "All domains" : domain);
    button.type = "button"; button.addEventListener("click", () => {
      filters.querySelectorAll("button").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      renderUseCases(domain);
    }); filters.append(button);
  });
  renderUseCases();
}

function savePodcastPosition() {
  const audio = byId("podcastPlayer");
  try { localStorage.setItem(PODCAST_KEY, JSON.stringify({ index: podcastIndex, time: audio.currentTime || 0, speed: audio.playbackRate || 1 })); } catch (_) {}
}

function updatePodcastMediaSession(episode) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: episode.title, artist: "1StopQuantum", album: "Classical foundations to quantum evidence",
    artwork: [{ src: "/icons/quantumyog-512.png", sizes: "512x512", type: "image/png" }],
  });
}

function renderPodcastEpisode(index, autoplay = false) {
  if (!podcastData?.episodes?.length) return;
  podcastIndex = Math.max(0, Math.min(index, podcastData.episodes.length - 1));
  const episode = podcastData.episodes[podcastIndex];
  const audio = byId("podcastPlayer");
  const sameSource = audio.getAttribute("src") === episode.audio;
  if (!sameSource) { audio.src = episode.audio; audio.load(); }
  byId("podcastNowTitle").textContent = episode.title;
  byId("podcastNowSummary").textContent = episode.summary;
  byId("podcastTranscript").textContent = episode.transcript;
  byId("podcastChapterPosition").textContent = `${episode.chapters.length} chapters · ${formatMediaTime(episode.duration_seconds)}`;
  const chapters = byId("podcastChapters"); chapters.replaceChildren();
  episode.chapters.forEach((chapter) => {
    const button = element("button", "", `${formatMediaTime(chapter.start_seconds)}  ${chapter.title}`);
    button.type = "button"; button.addEventListener("click", async () => { audio.currentTime = chapter.start_seconds; try { await audio.play(); } catch (_) {} }); chapters.append(button);
  });
  document.querySelectorAll(".podcast-episode").forEach((button) => button.classList.toggle("active", Number(button.dataset.index) === podcastIndex));
  updatePodcastMediaSession(episode); savePodcastPosition();
  if (autoplay) audio.play().catch(() => {});
}

function renderPodcastCatalog() {
  const container = byId("podcastEpisodes"); container.replaceChildren();
  podcastData.episodes.forEach((episode, index) => {
    const article = element("article", "podcast-episode"); article.dataset.index = String(index);
    const select = element("button"); select.type = "button"; select.dataset.index = String(index);
    select.append(element("span", "", String(episode.number).padStart(2, "0")), element("strong", "", episode.title), element("small", "", `${formatMediaTime(episode.duration_seconds)} · ${episode.chapters.length} chapters`));
    select.addEventListener("click", () => renderPodcastEpisode(index, true));
    const download = element("a", "", "Download WAV"); download.href = episode.audio; download.download = `${episode.id}.wav`;
    article.append(select, download); container.append(article);
  });
}

async function loadPodcast() {
  if (podcastData) return;
  try { podcastData = await requestJson("/api/v1/podcast/catalog"); }
  catch (_) { const response = await fetch("/data/podcast_catalog.json", { cache: "no-store" }); podcastData = await response.json(); }
  renderPodcastCatalog();
  let restored = { index: 0, time: 0, speed: 1 };
  try { restored = { ...restored, ...JSON.parse(localStorage.getItem(PODCAST_KEY) || "{}") }; } catch (_) {}
  renderPodcastEpisode(Number(restored.index) || 0);
  const audio = byId("podcastPlayer");
  audio.playbackRate = Number(restored.speed) || 1; byId("podcastSpeed").value = String(audio.playbackRate);
  audio.addEventListener("loadedmetadata", () => { if (Number(restored.time) < audio.duration) audio.currentTime = Number(restored.time) || 0; restored.time = 0; });
}

async function submitCommunity(event) {
  event.preventDefault(); const status = byId("communityStatus"); status.textContent = "Sending request...";
  try {
    const result = await requestJson("/api/v1/community/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      kind: byId("communityKind").value, name: byId("communityName").value.trim(), email: byId("communityEmail").value.trim(), consent: byId("communityConsent").checked,
    }) });
    byId("communityForm").reset(); status.textContent = `Request received. Keep reference ${result.id} for a deletion request.`;
  } catch (error) { status.textContent = error.message || "The request could not be sent."; }
}

async function loadCommunityPublications() {
  try {
    const data = await requestJson("/api/v1/community/publications"); const target = byId("communityPublications"); target.replaceChildren();
    if (!data.items.length) { target.textContent = "No approved community publications yet."; return; }
    data.items.forEach((item) => { const article = element("article"); article.append(element("strong", "", item.title), element("span", "", `${item.name} · ${item.license}`), element("p", "", item.summary || "Approved community contribution.")); target.append(article); });
  } catch (_) { byId("communityPublications").textContent = "Approved publications are temporarily unavailable."; }
}

function clearTourTarget() { document.querySelectorAll(".tour-target").forEach((node) => node.classList.remove("tour-target")); }

function renderTourStep() {
  const tour = productTours?.tours?.[screenGuideKey() === "editor" ? "circuits" : activeWorkspace];
  if (!tour) return;
  const step = tour.steps[tourStep]; clearTourTarget();
  const target = document.querySelector(step.target); if (target) { target.classList.add("tour-target"); target.scrollIntoView({ behavior: "smooth", block: "center" }); }
  byId("tourPosition").textContent = `Step ${tourStep + 1} of ${tour.steps.length}`;
  byId("tourTitle").textContent = step.title; byId("tourBody").textContent = step.body;
  byId("tourPrevious").disabled = tourStep === 0; byId("tourNext").textContent = tourStep === tour.steps.length - 1 ? "Try it" : "Next";
}

async function openProductTour() {
  if (!productTours) { const response = await fetch("/data/product_tours.json", { cache: "no-store" }); productTours = await response.json(); }
  tourStep = 0; byId("tourDialog").showModal(); renderTourStep();
}

function closeProductTour() { clearTourTarget(); if (byId("tourDialog").open) byId("tourDialog").close(); }

const fallbackFaq = [
  { question: "Does this run on a real quantum computer?", answer: "No. 1StopQuantum simulates circuits locally for education. Real QPU submission is disabled, so results are not hardware certification." },
  { question: "Do I need quantum physics first?", answer: "No. Start with Bits and qubits at High school depth. The course introduces each term before using equations." },
  { question: "Can AI-generated content be wrong?", answer: "Yes. Visuals and some instructional material are AI-assisted and reviewed, but inaccuracies can remain. Use Report inaccuracy and verify important claims independently." },
  { question: "Is my lesson activity private?", answer: "The local installation records a browser identifier, page views, and voluntary feedback in its own database. It does not require a cloud analytics service." },
];

function renderFaqQuestions() {
  const container = byId("faqAssistantQuestions");
  if (!container) return;
  container.replaceChildren();
  faqData.forEach((entry) => {
    const button = element("button", "", entry.question);
    button.type = "button";
    button.addEventListener("click", () => { byId("faqAssistantAnswer").textContent = entry.answer; });
    container.append(button);
  });
}

async function loadFaq() {
  try {
    const response = await fetch("/data/faq.json", { cache: "no-store" });
    if (!response.ok) throw new Error("FAQ unavailable");
    const payload = await response.json();
    faqData = payload.questions;
  } catch (_) {
    faqData = fallbackFaq;
  }
  renderFaqQuestions();
}

function setFaqOpen(open) {
  if (open) showView("faq");
}

function adminTable(headers, rows) {
  const table = element("table", "admin-table");
  const head = element("thead");
  const headRow = element("tr");
  headers.forEach((header) => headRow.append(element("th", "", header)));
  head.append(headRow);
  const body = element("tbody");
  rows.forEach((values) => {
    const row = element("tr");
    values.forEach((value) => row.append(element("td", "", String(value ?? ""))));
    body.append(row);
  });
  table.append(head, body);
  return table;
}

function renderAdminAnalytics(data) {
  const labels = [
    ["visitors_today", "Visitors today"], ["page_views_today", "Page views today"],
    ["likes", "Helpful reactions"], ["reports", "Accuracy reports"],
  ];
  byId("adminMetrics").replaceChildren(...labels.map(([key, label]) => {
    const card = element("article");
    card.append(element("strong", "", String(data.totals?.[key] || 0)), element("span", "", label));
    return card;
  }));
  byId("adminDaily").replaceChildren(adminTable(["Date", "Visitors", "Views"], (data.daily_visitors || []).map((row) => [row.date, row.visitors, row.page_views])));
  byId("adminPopular").replaceChildren(adminTable(["Page", "Views"], (data.popular_pages || []).map((row) => [row.page, row.views])));
  byId("adminFeedback").replaceChildren(adminTable(["Content", "Type", "Feedback", "Received"], (data.recent_feedback || []).map((row) => [row.content_id, row.kind, row.message || "-", row.created_at])));
}

function renderAdminCommunity(data, token) {
  const target = byId("adminCommunity"); target.replaceChildren();
  if (!data.items?.length) { target.textContent = "No community requests have been submitted."; return; }
  data.items.forEach((item) => {
    const article = element("article", "admin-community-item");
    article.append(element("strong", "", `${item.kind}: ${item.name}`), element("span", "", `${item.email} · ${item.status}`), element("p", "", item.title));
    const actions = element("div");
    [["under_review", "Review"], ["approved", "Approve"], ["rejected", "Reject"]].forEach(([status, label]) => {
      const button = element("button", "", label); button.type = "button"; button.disabled = item.status === status;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await requestJson(`/admin/community/submissions/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ status, note: `Changed to ${status} in the internal moderation dashboard.` }) });
          await loadAdminAnalytics(token);
        } catch (error) { button.disabled = false; article.append(element("p", "admin-action-error", error.message)); }
      }); actions.append(button);
    });
    article.append(actions); target.append(article);
  });
}

async function loadAdminLlmSettings(token) {
  const settings = await requestJson("/admin/llm-settings", { headers: { Authorization: `Bearer ${token}` } });
  byId("adminLlmProvider").value = settings.provider || "local";
  byId("adminLlmUrl").value = settings.base_url || "";
  byId("adminLlmModel").value = settings.model || "";
  byId("adminLlmKey").value = "";
  byId("adminLlmKey").placeholder = settings.api_key_configured ? "Configured; leave blank to keep it" : "Enter an API key";
  byId("adminLlmStatus").textContent = settings.api_key_configured ? "An encrypted API key is configured." : "No API key is configured.";
}

async function loadAdminAnalytics(token) {
  const [data, , community] = await Promise.all([
    requestJson("/admin/analytics", { headers: { Authorization: `Bearer ${token}` } }),
    loadAdminLlmSettings(token),
    requestJson("/admin/community/submissions", { headers: { Authorization: `Bearer ${token}` } })
      .catch(() => ({ items: [] })),
  ]);
  renderAdminAnalytics(data);
  renderAdminCommunity(community, token);
  if (!byId("adminDashboard").open) byId("adminDashboard").showModal();
}

async function saveAdminLlmSettings(event) {
  event.preventDefault();
  const status = byId("adminLlmStatus");
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) {
    status.textContent = "The internal session expired. Sign in again.";
    return;
  }
  status.textContent = "Saving encrypted settings...";
  try {
    const settings = await requestJson("/admin/llm-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        provider: byId("adminLlmProvider").value,
        base_url: byId("adminLlmUrl").value.trim(),
        model: byId("adminLlmModel").value.trim(),
        api_key: byId("adminLlmKey").value,
      }),
    });
    byId("adminLlmKey").value = "";
    byId("adminLlmKey").placeholder = settings.api_key_configured ? "Configured; leave blank to keep it" : "Enter an API key";
    status.textContent = "LLM settings saved. New circuit requests use this provider.";
  } catch (error) {
    status.textContent = error.message || "LLM settings could not be saved.";
  }
}

async function submitAdminLogin(event) {
  event.preventDefault();
  const error = byId("adminLoginError");
  error.hidden = true;
  try {
    const result = await requestJson("/admin/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: byId("adminEmail").value.trim(), password: byId("adminPassword").value }),
    });
    sessionStorage.setItem(ADMIN_TOKEN_KEY, result.token);
    byId("adminLoginDialog").close();
    await loadAdminAnalytics(result.token);
  } catch (submissionError) {
    error.textContent = submissionError.message || "Internal sign in failed.";
    error.hidden = false;
  }
}

async function changeAdminPassword(event) {
  event.preventDefault(); const status = byId("adminPasswordStatus");
  const next = byId("adminNewPassword").value; const confirm = byId("adminConfirmPassword").value;
  if (next !== confirm) { status.textContent = "New passwords do not match."; return; }
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  try {
    await requestJson("/admin/password", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ current_password: byId("adminCurrentPassword").value, new_password: next }) });
    sessionStorage.removeItem(ADMIN_TOKEN_KEY); byId("adminPasswordForm").reset(); status.textContent = "Password changed in PostgreSQL. All admin sessions are signed out; close this panel and sign in again.";
  } catch (error) { status.textContent = error.message || "Password could not be changed."; }
}

function initializeAdminEntry() {
  const isAdminEntry = new URLSearchParams(window.location.search).get("admin") === "1";
  if (!isAdminEntry) return;
  const button = element("button", "utility-icon-button");
  button.id = "adminOpen";
  button.dataset.testid = "admin-open";
  button.type = "button";
  button.title = "Internal analytics";
  button.setAttribute("aria-label", "Open internal analytics");
  button.textContent = "A";
  const openAdmin = async () => {
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (token) {
      try { await loadAdminAnalytics(token); return; } catch (_) { sessionStorage.removeItem(ADMIN_TOKEN_KEY); }
    }
    byId("adminLoginError").hidden = true;
    if (!byId("adminLoginDialog").open) byId("adminLoginDialog").showModal();
  };
  button.addEventListener("click", openAdmin);
  document.querySelector(".app-utility-bar").prepend(button);
  window.setTimeout(async () => {
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (token) { await openAdmin(); return; }
    byId("adminLoginError").hidden = true;
    if (!byId("adminLoginDialog").open) byId("adminLoginDialog").show();
  }, 0);
}

function showView(view) {
  if (PROTECTED_VIEWS.has(view) && !currentAccount) {
    pendingProtectedView = view;
    openSignin();
    byId("signinError").textContent = `Sign in or create an account to open ${view.replace("-", " ")}.`;
    byId("signinError").hidden = false;
    return false;
  }
  const workspaceChanged = activeWorkspace !== view;
  if (workspaceChanged) {
    byId("companionDialog").hidden = true;
    coTeacherTourCancelled = true;
    coTeacherTourRunning = false;
    setCoTeacherIntroSkipVisible(false);
    stopCoTeacherHighlights();
    if (coTeacherDuplexActive) setCoTeacherState("listening", `Sumi is active on ${view.replace("-", " ")}. Speak naturally.`);
  }
  activeWorkspace = view;
  coTeacherGlobalButton.hidden = false;
  learningView.hidden = view !== "learn";
  circuitPage.hidden = view !== "circuits";
  useCasesView.hidden = view !== "use-cases";
  drugView.hidden = view !== "drug";
  providersView.hidden = view !== "providers";
  benchmarkingView.hidden = view !== "benchmarking";
  improvementView.hidden = view !== "improve";
  podcastView.hidden = view !== "podcast";
  communityView.hidden = view !== "community";
  faqView.hidden = view !== "faq";
  guideView.hidden = view !== "guide";
  [["navLearn", "learn"], ["navCircuits", "circuits"], ["navUseCases", "use-cases"], ["navDrug", "drug"], ["navProviders", "providers"], ["navBenchmarking", "benchmarking"], ["navImprove", "improve"], ["navPodcast", "podcast"], ["navCommunity", "community"], ["navFaq", "faq"], ["navGuide", "guide"]].forEach(([id, name]) => {
    const active = name === view;
    byId(id).classList.toggle("active", active);
    if (active) byId(id).setAttribute("aria-current", "page"); else byId(id).removeAttribute("aria-current");
  });
  if (view === "learn") requestAnimationFrame(() => initializeTutorialVisuals());
  if (view === "benchmarking") initializeBenchmarking();
  if (view === "use-cases") loadUseCases();
  if (view === "podcast") loadPodcast();
  if (view === "community") loadCommunityPublications();
  if (workspaceChanged) {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  }
  updateScreenAudioGuide();
  trackPageView(view);
  return true;
}

async function checkHealth() {
  try {
    renderProviders(await requestJson("/providers"));
  } catch (_) {
    renderProviders(fallbackProviders);
  }
}

function manifestFromLocationHash() {
  if (!window.location.hash.startsWith("#manifest=")) return null;
  try {
    const encoded = window.location.hash.slice("#manifest=".length).replaceAll("-", "+").replaceAll("_", "/");
    const padded = encoded + "=".repeat((4 - encoded.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return localCompileManifest(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (_) {
    return null;
  }
}

function workspaceFromLocation() {
  const requested = new URLSearchParams(window.location.search).get("view");
  return ["learn", "circuits", "use-cases", "drug", "providers", "benchmarking", "improve", "podcast", "community", "faq", "guide"].includes(requested) ? requested : "learn";
}

function initializeMonaco() {
  if (!window.require?.config) {
    sourceEditor.hidden = true;
    return;
  }
  window.MonacoEnvironment = { getWorkerUrl: () => "/monaco-worker.js" };
  window.require.config({ paths: { vs: "/vendor/monaco/vs" } });
  window.require(["vs/editor/editor.main"], () => {
    monacoEditor = window.monaco.editor.create(sourceEditor, {
      value: lastSource[sourceKind] || "",
      language: "python",
      theme: "vs",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 21,
      scrollBeyondLastLine: false,
      padding: { top: 12 },
      overviewRulerLanes: 0,
      renderLineHighlight: "line"
    });
    sourcePanel.hidden = true;
  }, () => { sourceEditor.hidden = true; });
}

runBtn.addEventListener("click", runCircuit);
nlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runCircuit();
});
qiskitTab.addEventListener("click", () => setSource("qiskit"));
cirqTab.addEventListener("click", () => setSource("cirq"));
manifestTab.addEventListener("click", () => setSource("manifest"));
byId("navLearn").addEventListener("click", () => showView("learn"));
byId("navCircuits").addEventListener("click", () => showView("circuits"));
byId("navUseCases").addEventListener("click", () => showView("use-cases"));
byId("navDrug").addEventListener("click", () => showView("drug"));
byId("navProviders").addEventListener("click", () => showView("providers"));
byId("navBenchmarking").addEventListener("click", () => showView("benchmarking"));
byId("navImprove").addEventListener("click", () => showView("improve"));
byId("navPodcast").addEventListener("click", () => showView("podcast"));
byId("navCommunity").addEventListener("click", () => showView("community"));
byId("navFaq").addEventListener("click", () => showView("faq"));
byId("navGuide").addEventListener("click", () => showView("guide"));
byId("aboutOpen").addEventListener("click", () => byId("aboutDialog").showModal());
byId("aboutClose").addEventListener("click", () => byId("aboutDialog").close());
byId("audioGuideOpen").addEventListener("click", () => {
  updateScreenAudioGuide();
  byId("audioGuideDialog").showModal();
});
byId("audioGuideClose").addEventListener("click", () => {
  byId("audioGuidePlayer").pause();
  byId("audioGuideDialog").close();
});
byId("courseOutlineToggle").addEventListener("click", () => byId("courseOutlineDialog").showModal());
byId("courseOutlineClose").addEventListener("click", () => byId("courseOutlineDialog").close());
byId("visualProvenance").addEventListener("click", () => byId("visualProvenanceTooltip").classList.toggle("open"));
byId("lessonLike").addEventListener("click", likeCurrentLesson);
byId("lessonReport").addEventListener("click", openFeedbackDialog);
byId("feedbackClose").addEventListener("click", () => byId("feedbackDialog").close());
byId("feedbackForm").addEventListener("submit", submitFeedback);
byId("faqAssistantOpen").addEventListener("click", () => activateCoTeacher());
byId("adminLoginClose").addEventListener("click", () => byId("adminLoginDialog").close());
byId("adminLoginForm").addEventListener("submit", submitAdminLogin);
byId("adminDashboardClose").addEventListener("click", () => byId("adminDashboard").close());
byId("adminLlmForm").addEventListener("submit", saveAdminLlmSettings);
byId("adminPasswordForm").addEventListener("submit", changeAdminPassword);
byId("signupOpen").addEventListener("click", openSignup);
byId("docsSignup").addEventListener("click", openSignup);
byId("signinOpen").addEventListener("click", openSignin);
byId("docsSignin").addEventListener("click", openSignin);
byId("accountLogout").addEventListener("click", logoutAccount);
byId("docsLogout").addEventListener("click", logoutAccount);
byId("signupClose").addEventListener("click", closeSignup);
byId("signupForm").addEventListener("submit", submitSignup);
byId("signinClose").addEventListener("click", closeSignin);
byId("signinForm").addEventListener("submit", submitSignin);
byId("demoAccountFill").addEventListener("click", fillDemoAccount);
byId("recoveryOpen").addEventListener("click", openRecovery);
byId("recoveryClose").addEventListener("click", closeRecovery);
byId("recoveryReturn").addEventListener("click", returnToSignin);
byId("recoveryChallenge").addEventListener("click", loadRecoveryChallenge);
byId("recoveryForm").addEventListener("submit", submitRecovery);
byId("signupPlan").addEventListener("change", (event) => { byId("planNote").textContent = planDescriptions[event.target.value]; });
byId("docsSearch").addEventListener("input", (event) => searchDocs(event.target.value));
document.querySelectorAll(".docs-sidebar button[data-doc]").forEach((button) => button.addEventListener("click", () => renderDoc(button.dataset.doc)));
byId("improvementRun").addEventListener("click", () => submitImprovement(true));
byId("improvementScheduleButton").addEventListener("click", () => submitImprovement(false));
byId("inputModeNatural").addEventListener("click", () => setInputMode("natural"));
byId("inputModeManifest").addEventListener("click", () => setInputMode("manifest"));
byId("manifestRun").addEventListener("click", runManifest);
byId("drugRun").addEventListener("click", runDrug);
byId("annealRun").addEventListener("click", runAnnealer);
byId("routeRun").addEventListener("click", runRouter);
byId("openDrugFromUseCases").addEventListener("click", () => showView("drug"));
byId("useCaseAudience").addEventListener("change", () => { if (activeUseCase) renderUseCaseDetail(activeUseCase); });
byId("useCaseQuestions").addEventListener("change", () => {
  const checks = [...byId("useCaseQuestions").querySelectorAll("input")];
  const answered = checks.filter((input) => input.checked).length;
  byId("useCaseAssessmentResult").textContent = answered === checks.length ? "All evidence questions acknowledged. Continue to Provider Lab only with documented answers and a classical baseline." : `${answered} of ${checks.length} evidence questions acknowledged.`;
});
byId("communityForm").addEventListener("submit", submitCommunity);
byId("classicalIntroPodcast").addEventListener("click", () => { if (showView("podcast")) renderPodcastEpisode(0); });
byId("tourReplay").addEventListener("click", () => openProductTour().catch(() => {}));
const coTeacherButton = byId("companionOpenHeader");
const coTeacherSkipIntroButton = byId("companionSkipIntro");
const coTeacherGlobalButton = byId("faqAssistantOpen");
const coTeacherPanelVoiceButton = byId("sumiTaVoice");
const coTeacherPanelSkipButton = byId("sumiTaSkipIntro");
const coTeacherStatus = byId("coTeacherStatus");
const coTeacherLive = byId("companionDialog");
const coTeacherHighlights = ["nlInput", "samplePromptSelect", "runBtn", "circuitCanvas", "stepNext", "statevector", "qiskitTab"];
let coTeacherActive = false;
let coTeacherManifest = null;
let coTeacherRegistry = null;
let coTeacherTourCancelled = false;
let coTeacherHighlightTimer = null;
let coTeacherDuplexActive = false;
let coTeacherTourRunning = false;
let coTeacherStarting = false;
let coTeacherResumeTimer = null;
let coTeacherSpeechController = null;
let coTeacherTurnController = null;
let coTeacherVoiceSession = null;
const coTeacherExperiments = {
  bell: { label: "Bell pair", prompt: "Entangle two qubits and measure them." },
  ghz: { label: "GHZ", prompt: "Entangle three qubits and measure them." },
  hadamard: { label: "Hadamard superposition", prompt: "Put one qubit in superposition and measure it." },
  rotation: { label: "ninety-degree X rotation", prompt: "Rotate qubit 0 by 90 degrees around X, then measure." },
  grover: { label: "Grover search", prompt: "Grover search for |11> on 2 qubits." },
  deutsch_jozsa: { label: "Deutsch-Jozsa", template: "deutsch_jozsa" },
  qrng: { label: "quantum random number generation", prompt: "Make a quantum random number generator." },
};

function setCoTeacherState(state, message) {
  [coTeacherButton, coTeacherGlobalButton].forEach((button) => { if (button) button.dataset.state = state; });
  coTeacherStatus.dataset.state = state;
  coTeacherStatus.textContent = state === "listening" ? "Listening" : state === "thinking" ? "Thinking" : state === "speaking" ? "Speaking" : state === "error" ? "Voice error" : coTeacherDuplexActive ? "Sumi active" : "Sumi off";
  if (byId("sumiTaStatus")) {
    byId("sumiTaStatus").dataset.state = state;
    byId("sumiTaStatus").textContent = coTeacherStatus.textContent;
  }
  if (coTeacherPanelVoiceButton) coTeacherPanelVoiceButton.textContent = coTeacherDuplexActive ? "Stop voice conversation" : "Start voice conversation";
  const actionLabel = state === "listening" ? "Deactivate Sumi AI Learning Companion" : state === "speaking" ? "Stop Sumi narration" : state === "thinking" ? "Sumi is thinking; speak to interrupt" : state === "error" ? "Sumi AI Learning Companion unavailable; select to retry" : coTeacherDuplexActive ? "Deactivate Sumi AI Learning Companion" : "Activate Sumi AI Learning Companion";
  coTeacherButton.setAttribute("aria-label", actionLabel);
  coTeacherButton.dataset.tooltip = actionLabel;
  coTeacherGlobalButton?.setAttribute("aria-label", actionLabel);
  coTeacherLive.hidden = true;
  byId("companionNote").textContent = message.length > 72 ? `${message.slice(0, 69).trim()}…` : message;
  byId("companionNote").title = message;
  coTeacherVoiceSession?.setAssistantBusy(state === "speaking" || state === "thinking");
}
function setCoTeacherIntroSkipVisible(visible) {
  coTeacherSkipIntroButton.hidden = !visible;
  if (coTeacherPanelSkipButton) coTeacherPanelSkipButton.hidden = !visible;
}
function renderCoTeacherTurn(role, text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return;
  byId("coTeacherTurn").hidden = false;
  byId(role === "learner" ? "coTeacherUserTurn" : "coTeacherSumiTurn").textContent = cleaned;
}
function stopCoTeacherHighlights() {
  if (coTeacherHighlightTimer) window.clearInterval(coTeacherHighlightTimer);
  coTeacherHighlightTimer = null;
  document.querySelectorAll(".co-teacher-highlight").forEach((node) => node.classList.remove("co-teacher-highlight"));
}
function runCoTeacherHighlights() {
  stopCoTeacherHighlights();
  let index = 0;
  const next = () => {
    document.querySelectorAll(".co-teacher-highlight").forEach((node) => node.classList.remove("co-teacher-highlight"));
    const node = byId(coTeacherHighlights[index]);
    if (node) node.classList.add("co-teacher-highlight");
    index += 1;
    if (index >= coTeacherHighlights.length) stopCoTeacherHighlights();
  };
  next();
  coTeacherHighlightTimer = window.setInterval(next, 2200);
}
async function loadCoTeacherManifest() {
  if (!coTeacherManifest) coTeacherManifest = await fetch("/ai-co-teacher-manifest.json").then((response) => response.json());
  return coTeacherManifest;
}
async function loadCoTeacherRegistry() {
  if (!coTeacherRegistry) coTeacherRegistry = await fetch("/sumi-screen-registry.json").then((response) => response.json());
  return coTeacherRegistry;
}
function coTeacherVisibleState() {
  if (activeWorkspace === "learn") return {
    course: currentCurriculumCourse?.title || "Quantum foundations",
    lesson: currentCurriculumLesson?.title || byId("courseLessonTitle")?.textContent || "Bits and qubits",
    level: byId("courseLessonMeta")?.textContent || learningState.level,
    checkpoint: byId("checkpointFeedback")?.textContent || "Not attempted",
  };
  if (activeWorkspace === "circuits") return {
    qubits: currentIR?.num_qubits || 0,
    operations: (currentIR?.gates || []).length,
    engine: backendSelect.value,
    prompt: nlInput.value.slice(0, 180),
  };
  if (activeWorkspace === "improve") return { objective: byId("improvementObjective").value, iterations: byId("improvementIterations").value };
  if (activeWorkspace === "use-cases") return { selected_case: activeUseCase?.title || "Molecular energy and reaction simulation", audience: byId("useCaseAudience").value };
  if (activeWorkspace === "drug") return { molecule: byId("smilesInput")?.value || "Current educational molecule", status: byId("drugError")?.textContent || "Not run" };
  if (activeWorkspace === "providers") return { routing_question: byId("routeInput").value, model: "Local simulation only" };
  if (activeWorkspace === "benchmarking") return { panel: document.querySelector("[data-benchmark-tab].active")?.textContent?.trim() || "Landscape", evidence: byId("benchmarkRecordCount").textContent };
  if (activeWorkspace === "podcast") return { episode: byId("podcastNowTitle").textContent, chapter: byId("podcastChapterPosition").textContent };
  if (activeWorkspace === "community") return { inquiry_type: byId("communityKind").selectedOptions[0]?.textContent || "Research inquiry", submission: "Not submitted by Sumi" };
  if (activeWorkspace === "faq") return { section: "Frequently asked questions", answers: "Saved locally" };
  if (activeWorkspace === "guide") return { article: byId("docsArticle")?.querySelector("h1, h2")?.textContent || "Getting started" };
  return {};
}
async function coTeacherScreenContext() {
  const registry = await loadCoTeacherRegistry();
  const screen = registry.screens?.[activeWorkspace];
  if (!screen) throw new Error(`Sumi screen '${activeWorkspace}' is not registered`);
  return {
    screen_id: activeWorkspace,
    screen: screen.title,
    description: screen.description,
    concepts: screen.concepts || [],
    visible_state: coTeacherVisibleState(),
    qubits: activeWorkspace === "circuits" ? currentIR?.num_qubits || 0 : 0,
    operations: activeWorkspace === "circuits" ? (currentIR?.gates || []).length : 0,
  };
}
async function performRegisteredScreenAction(action, screen, signal) {
  const binding = screen.action_bindings?.[action];
  if (!binding) return "";
  const control = byId(binding.control_id);
  if (!control || control.disabled || control.hidden) return `The registered ${screen.title} control is not available in the current state.`;
  await performCoTeacherAction(binding.control_id, async () => {
    if (binding.activation === "focus") control.focus();
    else control.click();
  }, signal);
  return binding.confirmation;
}
function stopCoTeacherAudio() {
  coTeacherSpeechController?.abort();
  coTeacherSpeechController = null;
  coTeacherVoiceSession?.stopPlayback();
}
function scheduleHandsFreeListening(delay = 350) {
  if (coTeacherResumeTimer) window.clearTimeout(coTeacherResumeTimer);
  if (!coTeacherDuplexActive || coTeacherTourRunning || coTeacherVoiceSession?.isPlaying || coTeacherVoiceSession?.isRecording) return;
  coTeacherResumeTimer = window.setTimeout(() => {
    coTeacherResumeTimer = null;
    if (coTeacherDuplexActive && !coTeacherTourRunning && !coTeacherVoiceSession?.isPlaying && !coTeacherVoiceSession?.isRecording) {
      setCoTeacherState("listening", "Sumi is active. Speak naturally or select Sumi to deactivate.");
    }
  }, delay);
}
async function speakCoTeacher(text, clipId = "", options = {}) {
  const state = options.state || "speaking";
  const resumeHandsFree = options.resumeHandsFree !== false;
  stopCoTeacherAudio();
  setCoTeacherState(state, text);
  if (state !== "thinking") renderCoTeacherTurn("sumi", text);
  const source = clipId ? `/assets/co-teacher/${clipId}.wav` : `${API}/api/v1/co-teacher/speak`;
  const controller = new AbortController();
  coTeacherSpeechController = controller;
  try {
    let audioSource = source;
    if (!clipId) {
      const response = await fetch(source, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: controller.signal });
      if (!response.ok) throw new Error(`Kokoro HTTP ${response.status}`);
      audioSource = await response.blob();
    }
    if (controller.signal.aborted) return;
    const finished = await coTeacherVoiceSession.playAudio(audioSource);
    if (coTeacherSpeechController === controller) coTeacherSpeechController = null;
    if (!finished) {
      if (!controller.signal.aborted) {
        setCoTeacherState("idle", `Ready. ${text}`);
        if (resumeHandsFree) scheduleHandsFreeListening();
      }
      return;
    }
    if (state === "thinking") setCoTeacherState("thinking", text);
    else setCoTeacherState("idle", coTeacherDuplexActive ? "Ready. I’m listening for your next question." : "Ready. Select me to activate Sumi.");
    if (resumeHandsFree) scheduleHandsFreeListening();
  } catch (error) {
    if (controller.signal.aborted) return;
    setCoTeacherState("error", "Kokoro voice is unavailable. Select me to continue with voice input.");
  }
}
async function startCoTeacherTour() {
  if (coTeacherTourRunning) return;
  const [manifest, registry] = await Promise.all([loadCoTeacherManifest(), loadCoTeacherRegistry()]);
  const screen = registry.screens?.[activeWorkspace] || registry.screens?.circuits;
  const graceMs = registry.voice?.intro_barge_in_grace_ms || 1200;
  coTeacherVoiceSession.suppressSpeech(graceMs);
  if (activeWorkspace !== "circuits") {
    coTeacherTourCancelled = false;
    coTeacherTourRunning = true;
    setCoTeacherIntroSkipVisible(true);
    try {
      await speakCoTeacher(`Hi, I’m Sumi, your AI Learning Companion. ${screen.description}`, "", { resumeHandsFree: false });
    } finally {
      coTeacherTourRunning = false;
      setCoTeacherIntroSkipVisible(false);
      if (coTeacherDuplexActive) scheduleHandsFreeListening();
    }
    return;
  }
  const steps = [["screen_intro", "nlInput"], ["natural_language", "nlInput"], ["templates", "samplePromptSelect"], ["run", "runBtn"], ["circuit_ir", "circuitCanvas"], ["step_controls", "stepNext"], ["bloch_sphere", "blochSphere"], ["measurement", "histogram"], ["amplitudes", "statevector"], ["code_exports", "qiskitTab"]];
  coTeacherTourCancelled = false;
  coTeacherTourRunning = true;
  setCoTeacherIntroSkipVisible(true);
  stopCoTeacherHighlights();
  try {
    for (const [clipId, controlId] of steps) {
      if (coTeacherTourCancelled) return;
      document.querySelectorAll(".co-teacher-highlight").forEach((node) => node.classList.remove("co-teacher-highlight"));
      byId(controlId)?.classList.add("co-teacher-highlight");
      const text = clipId === "screen_intro"
        ? `Hi, I’m Sumi, your AI Learning Companion. ${manifest.transcripts[clipId]}`
        : manifest.transcripts[clipId];
      await speakCoTeacher(text, "", { resumeHandsFree: false });
    }
    stopCoTeacherHighlights();
    if (!coTeacherTourCancelled) await speakCoTeacher(manifest.transcripts.ready, "ready", { resumeHandsFree: false });
  } finally {
    coTeacherTourRunning = false;
    setCoTeacherIntroSkipVisible(false);
    if (coTeacherDuplexActive) scheduleHandsFreeListening();
  }
}
async function performCoTeacherAction(controlId, action, signal = coTeacherTurnController?.signal || null) {
  if (signal?.aborted) return;
  const control = byId(controlId);
  document.querySelectorAll(".co-teacher-highlight").forEach((node) => node.classList.remove("co-teacher-highlight"));
  if (control) { control.classList.add("co-teacher-highlight"); control.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  await new Promise((resolve) => window.setTimeout(resolve, 350));
  if (signal?.aborted) return;
  await action();
  window.setTimeout(() => control?.classList.remove("co-teacher-highlight"), 900);
}
function registerSumiUIActions() {
  if (!window.SumiUIActions || window.SumiUIActions.has("set_learning_level")) return;
  const flash = (control) => { control?.classList.add("co-teacher-highlight"); window.setTimeout(() => control?.classList.remove("co-teacher-highlight"), 900); };
  window.SumiUIActions
    .register("set_learning_level", async ({ level }) => {
      const normalized = String(level).toLowerCase().replace(/[’']/g, "");
      const match = normalized.includes("under") ? "undergraduate" : normalized.includes("master") ? "masters" : normalized.includes("high") ? "high-school" : "";
      if (!match) throw new Error("Choose High school, Undergraduate, or Master's.");
      const control = document.querySelector(`.learner-level button[data-level="${match}"]`);
      if (!control) throw new Error("The learning level controls are not visible on this screen.");
      setLearningLevel(match); flash(control);
      return { text: `Learning level is now ${control.textContent.trim()}.`, data: { level: match } };
    }, { type: "object", properties: { level: { type: "string" } }, required: ["level"] })
    .register("open_lesson", async ({ lesson }) => {
      const query = String(lesson).toLowerCase();
      const control = [...document.querySelectorAll("#lessonTabs button[data-lesson-id]")].find((button) => `${button.textContent} ${button.dataset.lessonId}`.toLowerCase().includes(query));
      if (!control) throw new Error(`I could not find the lesson '${lesson}'.`);
      control.click(); flash(control);
      return { text: `Opened ${control.textContent.trim()}.`, data: { lesson: control.dataset.lessonId } };
    }, { type: "object", properties: { lesson: { type: "string" } }, required: ["lesson"] })
    .register("play_lesson", async () => {
      const control = byId("lessonAudioToggle");
      if (!control || control.disabled) throw new Error("Lesson audio is not ready yet.");
      control.click(); flash(control);
      return { text: `${byId("lessonAudioPlayer").paused ? "Paused" : "Playing"} the ${byId("courseLessonTitle").textContent.trim()} lesson audio.` };
    }, { type: "object", properties: {} })
    .register("load_template", async ({ template }) => {
      const normalized = String(template).toLowerCase();
      const match = Object.keys(templateSpecs).find((name) => normalized.includes(name.replaceAll("_", " ")) || normalized.includes(name));
      if (!match) throw new Error("Choose GHZ, Grover, Deutsch-Jozsa, or QRNG.");
      await runTemplate(match);
      const control = document.querySelector(`[data-template="${match}"]`); flash(control);
      return { text: `Loaded and ran the ${match.replaceAll("_", " ")} template.`, data: { template: match, measurement: histogram.textContent.trim() } };
    }, { type: "object", properties: { template: { type: "string" } }, required: ["template"] })
    .register("describe_and_run_circuit", async ({ description }) => {
      if (activeWorkspace !== "circuits") showView("circuits");
      nlInput.value = String(description).slice(0, 500);
      await runCircuit();
      flash(runBtn);
      return { text: "I entered the description and ran the validated local circuit.", data: { measurement: histogram.textContent.trim(), operations: currentIR?.gates?.length || 0 } };
    }, { type: "object", properties: { description: { type: "string" } }, required: ["description"] })
    .register("read_measurement_results", async () => {
      const result = histogram.textContent.trim();
      return { text: result ? `Current measurement result: ${result}` : "There are no measurement results yet.", data: { measurement: result } };
    }, { type: "object", properties: {} })
    .register("show_bloch_qubit", async ({ qubit }) => {
      const control = [...document.querySelectorAll("#qubitTabs button")].find((button) => button.textContent.trim() === `q${qubit}`);
      if (!control) throw new Error(`Qubit q${qubit} is not available in the current circuit.`);
      control.click(); flash(control);
      return { text: `The Bloch sphere is now showing q${qubit}.`, data: { qubit } };
    }, { type: "object", properties: { qubit: { type: "integer", minimum: 0 } }, required: ["qubit"] })
    .register("export_circuit", async ({ format }) => {
      const normalized = String(format).toLowerCase();
      const control = normalized === "svg" ? byId("downloadSvg") : normalized === "png" ? byId("downloadPng") : null;
      if (!control) throw new Error("Choose SVG or PNG.");
      control.click(); flash(control);
      return { text: `Exported the circuit as ${normalized.toUpperCase()}.`, data: { format: normalized } };
    }, { type: "object", properties: { format: { type: "string", enum: ["svg", "png"] } }, required: ["format"] });
}
function registerSumiScreenBindings(screen) {
  if (!window.SumiUIActions) return;
  Object.entries(screen?.action_bindings || {}).forEach(([action, binding]) => {
    if (window.SumiUIActions.has(action)) return;
    window.SumiUIActions.register(action, async (_args, context) => ({
      text: await performRegisteredScreenAction(action, screen, context.signal),
    }), { type: "object", properties: {} });
  });
}
async function executeCoTeacherRequest(request, controller) {
  const signal = controller.signal;
  const normalized = request.toLowerCase();
  const [manifest, registry] = await Promise.all([loadCoTeacherManifest(), loadCoTeacherRegistry()]);
  const screen = registry.screens?.[activeWorkspace];
  if (!screen) throw new Error(`Sumi screen '${activeWorkspace}' is not registered`);
  registerSumiScreenBindings(screen);
  const thinkingText = manifest.transcripts.thinking || "Okay, one moment while I work that out.";
  const thinkingNarration = speakCoTeacher(thinkingText, "thinking", { state: "thinking", resumeHandsFree: false });
  let action = "";
  let experiment = request;
  let actionArgs = {};
  try {
    const routed = await requestJson("/api/v1/co-teacher/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: request, screen_id: activeWorkspace, include_args: true }), signal });
    action = routed.action;
    experiment = routed.experiment || request;
    actionArgs = routed.args && typeof routed.args === "object" ? routed.args : {};
  } catch (_) {
    if (signal.aborted) { stopCoTeacherAudio(); return; }
    if (activeWorkspace !== "circuits") {
      if (/\b(skip|end)\b.*\b(intro|introduction)\b/.test(normalized)) action = "skip_intro";
      else if (/\b(stop sumi|sumi stop|stop conversation|turn sumi off|goodbye sumi)\b/.test(normalized)) action = "stop_conversation";
      else if (/\b(explain|describe|tour)\b.*\b(screen|page|workspace)\b/.test(normalized)) action = "explain_screen";
      else action = "answer_question";
    } else {
      const exactExperiment = {
      bell: "bell", "bell pair": "bell", ghz: "ghz", hadamard: "hadamard", rotation: "rotation",
      grover: "grover", "deutsch-jozsa": "deutsch_jozsa", "deutsch jozsa": "deutsch_jozsa", qrng: "qrng",
      }[normalized.trim()];
      if (exactExperiment) { action = "run_named_experiment"; experiment = exactExperiment; }
      else if (/(explain|how).*(screen|use).*(experiment|show)|(?:experiment|show).*(explain|how).*(screen|use)/.test(normalized)) action = "guided_experiment";
      else if (/(run|show|perform|try|demonstrate).*(grover)|grover.*(run|show|perform|try|demonstrate)/.test(normalized)) { action = "run_named_experiment"; experiment = "grover"; }
      else if (/(run|show|perform|try).*(algorithm|experiment)/.test(normalized) && !/(bell|ghz|hadamard|grover|deutsch|jozsa|qrng|random number|rotation|rotate|current)/.test(normalized)) action = "explain_experiments";
      else if (/run|simulate|generate/.test(normalized)) action = "run_simulation";
      else if (/next|forward/.test(normalized)) action = "step_forward";
      else if (/back|previous/.test(normalized)) action = "step_back";
      else if (/qiskit/.test(normalized)) action = "show_qiskit";
      else if (/cirq/.test(normalized)) action = "show_cirq";
      else if (/tour|explain.*screen/.test(normalized)) action = "explain_screen";
      else if (/explain.*circuit/.test(normalized)) action = "explain_circuit";
      else if (/^(what|why|how|when|where|who|can you|could you|tell me|hello|hi)\b|\?$/.test(normalized)) action = "answer_question";
      else if (/qubit|quantum|circuit|gate|entangle|superposition|measure|ghz|random number/.test(normalized)) action = "build_experiment";
      else action = "unsupported";
    }
  }
  stopCoTeacherAudio();
  await thinkingNarration;
  if (signal.aborted) return;
  let response = "";
  let responseClip = "";
  if (action === "skip_intro") { skipCoTeacherIntro(); response = manifest.transcripts.intro_skipped; responseClip = "intro_skipped"; }
  else if (action === "stop_conversation") {
    coTeacherTourCancelled = true;
    coTeacherTourRunning = false;
    setCoTeacherIntroSkipVisible(false);
    response = manifest.transcripts.goodbye;
    await speakCoTeacher(response, "goodbye", { resumeHandsFree: false });
    await coTeacherVoiceSession.setHandsFree(false);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("sumi:reload-requested"));
      window.location.reload();
    }, 1000);
    return;
  }
  else if (action === "explain_term") {
    const registry = await loadCoTeacherRegistry();
    const term = registry.terms?.find((entry) => entry.id === experiment);
    if (term) {
      if (activeWorkspace === "circuits" && term.control_id) await performCoTeacherAction(term.control_id, async () => {});
      response = term.description;
      responseClip = term.audio_id;
    } else {
      action = "answer_question";
    }
  }
  else if (action === "guided_experiment") { runCoTeacherHighlights(); await performCoTeacherAction("nlInput", async () => { nlInput.value = "Grover search for |11> on 2 qubits."; }); await performCoTeacherAction("runBtn", async () => runBtn.click()); response = "I showed the main controls, selected a two-qubit Grover experiment, and clicked Run. Watch the circuit and verified measurement result update."; }
  else if (action === "demonstrate_grover") { await performCoTeacherAction("nlInput", async () => { nlInput.value = "Grover search for |11> on 2 qubits."; }); await performCoTeacherAction("runBtn", async () => runBtn.click()); response = "I selected the two-qubit Grover experiment and ran the local simulator. Look at the circuit and the measurement result."; }
  else if (action === "explain_experiments") { const manifest = await loadCoTeacherManifest(); byId("nlError").hidden = true; byId("nlError").textContent = ""; await performCoTeacherAction("samplePromptSelect", async () => byId("samplePromptSelect").focus()); await performCoTeacherAction("templateChips", async () => {}); response = manifest.transcripts.experiment_menu; responseClip = "experiment_menu"; }
  else if (action === "run_named_experiment") { const choice = coTeacherExperiments[experiment]; if (!choice) { response = "I could not find that experiment. Choose Bell, GHZ, Hadamard, rotation, Grover, Deutsch-Jozsa, or Q R N G."; } else { byId("nlError").hidden = true; byId("nlError").textContent = ""; if (choice.template) { await performCoTeacherAction("templateDeutschJozsa", async () => runTemplate(choice.template)); } else { await performCoTeacherAction("samplePromptSelect", async () => { byId("samplePromptSelect").value = choice.prompt; byId("samplePromptSelect").dispatchEvent(new Event("change", { bubbles: true })); }); await performCoTeacherAction("runBtn", async () => runBtn.click()); } response = `I selected ${choice.label} and ran the real local experiment. Look at the circuit and result panels.`; } }
  else if (action === "run_simulation") { await performCoTeacherAction("runBtn", async () => runBtn.click()); response = "I ran the current experiment locally. The result panels now show the deterministic simulator output."; }
  else if (action === "step_forward") { await performCoTeacherAction("stepNext", async () => byId("stepNext").click()); response = "I moved the circuit forward one step. Look at the highlighted gate and the state views."; }
  else if (action === "step_back") { await performCoTeacherAction("stepPrev", async () => byId("stepPrev").click()); response = "I moved the circuit back one step so you can compare the state change."; }
  else if (action === "show_qiskit") { await performCoTeacherAction("qiskitTab", async () => byId("qiskitTab").click()); response = "I opened the Qiskit code generated from the validated Circuit IR."; }
  else if (action === "show_cirq") { await performCoTeacherAction("cirqTab", async () => byId("cirqTab").click()); response = "I opened the Cirq code generated from the same validated Circuit IR."; }
  else if (action === "explain_screen") { const registry = await loadCoTeacherRegistry(); const screen = registry.screens?.[activeWorkspace] || registry.screens?.circuits; if (activeWorkspace === "circuits") runCoTeacherHighlights(); response = screen.description; responseClip = screen.audio_id; }
  else if (action === "explain_circuit") { response = currentIR ? `This circuit has ${currentIR.num_qubits || 0} qubits and ${(currentIR.gates || []).length} operations. Step through it to see each deterministic state change.` : "Build or select a circuit first, then I can explain its real operations."; }
  else if (action === "build_experiment") { await performCoTeacherAction("nlInput", async () => { nlInput.value = experiment; }); await performCoTeacherAction("runBtn", async () => runBtn.click()); response = "I entered your experiment through Algorithm Studio’s validated circuit-generation path and clicked Run."; }
  else if (window.SumiUIActions?.has(action)) {
    window.SumiUIActions.allow(screen.allowed_actions || []);
    const result = await window.SumiUIActions.execute(action, { ...actionArgs, ...(action === "run_named_experiment" ? {} : {}) }, { screenId: activeWorkspace, signal });
    response = result.text || "Action completed.";
  }
  else if (screen.action_bindings?.[action]) { response = await performRegisteredScreenAction(action, screen, signal); }
  else if (action === "answer_question" || action === "unsupported") {
    try {
      const answered = await requestJson("/api/v1/co-teacher/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          text: request,
          context: await coTeacherScreenContext(),
        }),
      });
      response = answered.answer;
    } catch (_) {
      response = `I’m not confident I understood that yet. I can explain ${screen.title}, answer a question about its registered concepts, or perform one of this screen’s approved actions.`;
    }
  }
  else { response = `I can only operate controls registered for ${screen.title}. Ask me to explain this screen or choose one of its visible learning actions.`; }
  if (signal.aborted) return;
  await speakCoTeacher(response, responseClip);
}
function cancelCoTeacherTurn() {
  coTeacherTurnController?.abort();
  coTeacherTurnController = null;
  stopCoTeacherAudio();
}
function interruptCoTeacher() {
  coTeacherTourCancelled = true;
  coTeacherTourRunning = false;
  coTeacherSkipIntroButton.hidden = true;
  stopCoTeacherHighlights();
  cancelCoTeacherTurn();
  setCoTeacherState("listening", "I stopped. Keep speaking—I’m listening.");
}
async function handleCoTeacherUtterance(audio, metadata) {
  cancelCoTeacherTurn();
  const controller = new AbortController();
  coTeacherTurnController = controller;
  setCoTeacherState("thinking", "Transcribing your request with local Whisper…");
  try {
    const form = new FormData();
    const extension = metadata?.mimeType?.includes("ogg") ? "ogg" : metadata?.mimeType?.includes("mp4") ? "mp4" : "webm";
    form.append("audio", audio, `co-teacher.${extension}`);
    const response = await fetch("http://127.0.0.1:5152/api/transcribe", { method: "POST", body: form, signal: controller.signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || payload.error || "No transcription returned");
    if (payload.accepted === false) {
      await handleCoTeacherRejected({ text: payload.clarification, clipId: payload.clip_id, silent: payload.silent, reason: payload.reason });
      return;
    }
    if (!payload.transcription) throw new Error(payload.detail || payload.error || "No transcription returned");
    renderCoTeacherTurn("learner", payload.transcription);
    await executeCoTeacherRequest(payload.transcription, controller);
  } catch (error) {
    if (!controller.signal.aborted) setCoTeacherState("error", "Voice transcription failed. Check the local voice service and try again.");
  } finally {
    if (coTeacherTurnController === controller) coTeacherTurnController = null;
  }
}
async function handleCoTeacherRejected(rejection = {}) {
  if (!coTeacherDuplexActive) return;
  if (rejection.silent || !rejection.text) {
    setCoTeacherState("listening", "Listening for a clear question…");
    scheduleHandsFreeListening();
    return;
  }
  await speakCoTeacher(rejection.text, rejection.clipId || "", { resumeHandsFree: true });
}
async function handleCoTeacherTranscript(transcription) {
  cancelCoTeacherTurn();
  const controller = new AbortController();
  coTeacherTurnController = controller;
  renderCoTeacherTurn("learner", transcription);
  setCoTeacherState("thinking", "Local Whisper heard you. Sumi is working that out…");
  try {
    await executeCoTeacherRequest(transcription, controller);
  } catch (error) {
    if (!controller.signal.aborted) setCoTeacherState("error", "Sumi could not process that turn. Please try again.");
  } finally {
    if (coTeacherTurnController === controller) coTeacherTurnController = null;
  }
}
coTeacherVoiceSession = new window.SumiVoiceSession({
  transportUrl: window.QYOG_VOICE_WS_URL || `${location.protocol === "https:" ? "wss" : "ws"}://127.0.0.1:5152/api/duplex`,
  workletUrl: "/sumi-mic-worklet.js",
  silenceMs: 650,
  speechThreshold: 0.035,
  speechFrames: 2,
  onBargeIn: interruptCoTeacher,
  onRecordingStart: () => setCoTeacherState("listening", "Listening… I’ll respond after you pause."),
  onTranscript: (transcription) => handleCoTeacherTranscript(transcription),
  onUtterance: (audio, metadata) => handleCoTeacherUtterance(audio, metadata),
  onRejected: (rejection) => handleCoTeacherRejected(rejection),
  onAction: async (message, transport) => {
    const registry = await loadCoTeacherRegistry();
    registerSumiScreenBindings(registry.screens?.[activeWorkspace]);
    window.SumiUIActions?.allow(registry.screens?.[activeWorkspace]?.allowed_actions || []);
    return window.SumiUIActions?.handleActionMessage(message, transport, { screenId: activeWorkspace });
  },
  onError: () => setCoTeacherState("error", "Sumi’s local voice service is unavailable. Select Sumi to retry."),
});
async function deactivateCoTeacher() {
  coTeacherActive = false;
  coTeacherDuplexActive = false;
  coTeacherTourCancelled = true;
  coTeacherTourRunning = false;
  setCoTeacherIntroSkipVisible(false);
  if (coTeacherResumeTimer) window.clearTimeout(coTeacherResumeTimer);
  coTeacherResumeTimer = null;
  stopCoTeacherHighlights();
  cancelCoTeacherTurn();
  await coTeacherVoiceSession.setHandsFree(false);
  byId("coTeacherTurn").hidden = true;
  setCoTeacherState("idle", "Sumi is off. Select me when you want to talk.");
}
async function resetCoTeacherVoice() {
  coTeacherTourCancelled = true;
  coTeacherTourRunning = false;
  if (coTeacherResumeTimer) window.clearTimeout(coTeacherResumeTimer);
  coTeacherResumeTimer = null;
  stopCoTeacherAudio();
  coTeacherVoiceSession?.stopPlayback();
  cancelCoTeacherTurn();
  coTeacherActive = false;
  coTeacherDuplexActive = false;
  try { await coTeacherVoiceSession?.setHandsFree(false); } catch (_) {}
  setCoTeacherIntroSkipVisible(false);
  stopCoTeacherHighlights();
  byId("coTeacherTurn").hidden = true;
  setCoTeacherState("idle", "Voice reset. Sumi is quiet until you activate her again.");
}
async function resetSumiSystem() {
  if (!window.confirm("Reset Sumi and clear this browser's local app cache and saved learning state?")) return;
  await resetCoTeacherVoice();
  try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    if (navigator.serviceWorker) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch (_) {}
  window.location.reload();
}
async function activateCoTeacher() {
  if (coTeacherStarting) return;
  if (!coTeacherActive) {
    coTeacherActive = true;
    coTeacherDuplexActive = true;
    coTeacherStarting = true;
    try {
      await coTeacherVoiceSession.unlockAudio?.();
      setCoTeacherState("thinking", "Starting Sumi and requesting microphone access…");
      await coTeacherVoiceSession.setHandsFree(true);
    } catch (_) {
      coTeacherActive = false;
      coTeacherDuplexActive = false;
      setCoTeacherState("error", "Microphone access is unavailable. Allow microphone access and try again.");
      return;
    } finally {
      coTeacherStarting = false;
    }
    startCoTeacherTour().catch(() => setCoTeacherState("error", "The guided introduction could not start."));
    return;
  }
  if (coTeacherVoiceSession.isRecording) { coTeacherVoiceSession.stopUtterance(); return; }
  if (coTeacherVoiceSession.isPlaying) {
    if (coTeacherTourRunning) skipCoTeacherIntro();
    else { stopCoTeacherAudio(); setCoTeacherState("listening", "Narration stopped. I’m still listening."); }
    return;
  }
  await deactivateCoTeacher();
}
function skipCoTeacherIntro() {
  coTeacherTourCancelled = true;
  setCoTeacherIntroSkipVisible(false);
  stopCoTeacherHighlights();
  stopCoTeacherAudio();
  setCoTeacherState("listening", "Intro skipped. Sumi is active—just start speaking.");
  scheduleHandsFreeListening();
}
coTeacherButton.addEventListener("click", activateCoTeacher);
byId("sumiVoiceReset")?.addEventListener("click", resetCoTeacherVoice);
byId("sumiSystemReset")?.addEventListener("click", resetSumiSystem);
coTeacherSkipIntroButton.addEventListener("click", skipCoTeacherIntro);
coTeacherPanelVoiceButton?.addEventListener("click", () => activateCoTeacher());
coTeacherPanelSkipButton?.addEventListener("click", skipCoTeacherIntro);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !coTeacherActive) return;
  if (coTeacherVoiceSession.isRecording) coTeacherVoiceSession.stopUtterance();
  else if (coTeacherVoiceSession.isPlaying || coTeacherTourRunning) skipCoTeacherIntro();
  else deactivateCoTeacher();
});
byId("tourSkip").addEventListener("click", closeProductTour);
byId("tourPrevious").addEventListener("click", () => { if (tourStep > 0) { tourStep -= 1; renderTourStep(); } });
byId("tourNext").addEventListener("click", () => {
  const key = screenGuideKey() === "editor" ? "circuits" : activeWorkspace; const tour = productTours?.tours?.[key];
  if (!tour || tourStep >= tour.steps.length - 1) { closeProductTour(); return; }
  tourStep += 1; renderTourStep();
});
byId("podcastPlayAll").addEventListener("click", async () => { await loadPodcast(); renderPodcastEpisode(podcastIndex, true); });
byId("podcastToggle").addEventListener("click", async () => { const audio = byId("podcastPlayer"); if (audio.paused) { try { await audio.play(); } catch (_) {} } else audio.pause(); });
byId("podcastPrev").addEventListener("click", () => renderPodcastEpisode(podcastIndex - 1, true));
byId("podcastNext").addEventListener("click", () => renderPodcastEpisode(podcastIndex + 1, true));
byId("podcastSpeed").addEventListener("change", (event) => { byId("podcastPlayer").playbackRate = Number(event.target.value); savePodcastPosition(); });
byId("podcastProgress").addEventListener("input", (event) => { const audio = byId("podcastPlayer"); if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) / 1000 * audio.duration; });
byId("podcastPlayer").addEventListener("timeupdate", () => { const audio = byId("podcastPlayer"); byId("podcastTime").textContent = `${formatMediaTime(audio.currentTime)} / ${formatMediaTime(audio.duration)}`; byId("podcastProgress").value = String(audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0); savePodcastPosition(); });
byId("podcastPlayer").addEventListener("play", () => { byId("podcastToggle").textContent = "❚❚"; });
byId("podcastPlayer").addEventListener("pause", () => { byId("podcastToggle").textContent = "▶"; });
byId("podcastPlayer").addEventListener("ended", () => { if (podcastIndex < (podcastData?.episodes.length || 1) - 1) renderPodcastEpisode(podcastIndex + 1, true); });
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler?.("play", () => byId("podcastPlayer").play());
  navigator.mediaSession.setActionHandler?.("pause", () => byId("podcastPlayer").pause());
  navigator.mediaSession.setActionHandler?.("previoustrack", () => renderPodcastEpisode(podcastIndex - 1, true));
  navigator.mediaSession.setActionHandler?.("nexttrack", () => renderPodcastEpisode(podcastIndex + 1, true));
}
byId("landscapeBenchmark").addEventListener("change", () => {
  landscapeDates = [];
  renderLandscape();
});
byId("landscapeTime").addEventListener("input", renderLandscape);
byId("landscapePlay").addEventListener("click", toggleLandscapePlayback);
byId("qpuMatchForm").addEventListener("submit", runQpuMatch);
byId("forecastRun").addEventListener("click", runBenchmarkForecast);
byId("claimForm").addEventListener("submit", assessBenchmarkClaim);
document.querySelectorAll("[data-benchmark-tab]").forEach((button) => button.addEventListener("click", () => showBenchmarkTab(button.dataset.benchmarkTab)));
byId("digestRefresh").addEventListener("click", loadBenchmarkDigest);
byId("digestDownload").addEventListener("click", () => {
  if (!currentDigest) return;
  downloadBlob(new Blob([`${JSON.stringify(currentDigest, null, 2)}\n`], { type: "application/json" }), "1stopquantum-benchmark-digest.json");
});
byId("clearCircuit").addEventListener("click", () => runIR({ version: "1.0", num_qubits: 1, gates: [{ op: "measure", targets: [0] }], shots: 1024, seed: 42 }));
byId("stepFirst").addEventListener("click", () => stepTo(0));
byId("stepPrev").addEventListener("click", () => stepTo(currentCursor - 1));
byId("stepNext").addEventListener("click", () => stepTo(currentCursor + 1));
byId("stepLast").addEventListener("click", () => stepTo(currentStepCount));
byId("copySource").addEventListener("click", copySource);
byId("downloadSource").addEventListener("click", () => {
  const manifestDownload = sourceKind === "manifest";
  const filename = manifestDownload ? "1stopquantum-manifest.qyog.yaml" : `1stopquantum-${sourceKind}.py`;
  const type = manifestDownload ? "application/yaml" : "text/x-python";
  downloadBlob(new Blob([lastSource[sourceKind] || ""], { type }), filename);
});
byId("downloadSvg").addEventListener("click", downloadDiagramSvg);
byId("downloadPng").addEventListener("click", downloadDiagramPng);
document.querySelectorAll(".learner-level button[data-level]").forEach((button) => button.addEventListener("click", () => setLearningLevel(button.dataset.level)));
byId("lessonTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-lesson-id]");
  if (button) selectCourseLesson(button.dataset.lessonId);
});
byId("thetaSlider").addEventListener("input", (event) => setLearningAngles(Number(event.target.value), Number(byId("phiSlider").value)));
byId("phiSlider").addEventListener("input", (event) => setLearningAngles(Number(byId("thetaSlider").value), Number(event.target.value)));
document.querySelectorAll(".state-presets button[data-theta]").forEach((button) => button.addEventListener("click", () => setLearningAngles(Number(button.dataset.theta), Number(button.dataset.phi))));
document.querySelectorAll(".prediction-options button[data-prediction]").forEach((button) => button.addEventListener("click", () => {
  selectedPrediction = button.dataset.prediction;
  document.querySelectorAll(".prediction-options button").forEach((option) => option.classList.toggle("selected", option === button));
  byId("lessonRunSimulation").disabled = false;
}));
byId("lessonRunSimulation").addEventListener("click", runLessonSimulation);
byId("openCircuitStudio").addEventListener("click", () => {
  const ir = lessonCircuit();
  nlInput.value = learningModules[learningState.module].practicalTitle;
  renderResult(localResult(ir, backendSelect.value, null, manifestForIR(ir, backendSelect.value, `lesson-${learningState.module}`)));
  showView("circuits");
});
byId("checkpointOptions").querySelectorAll("button[data-answer]").forEach((button) => button.addEventListener("click", () => answerCheckpoint(button)));
byId("glossarySearch").addEventListener("input", (event) => renderGlossary(event.target.value));

connectAudioPlayer(byId("lessonAudioPlayer"), byId("lessonAudioToggle"), byId("lessonAudioProgress"), byId("lessonAudioTime"));
connectAudioPlayer(byId("audioGuidePlayer"), byId("audioGuideToggle"), byId("audioGuideProgress"), byId("audioGuideTime"));
byId("lessonAudioSpeed").addEventListener("click", () => {
  const audio = byId("lessonAudioPlayer");
  const speeds = [1, 1.25, 1.5, .8];
  const next = speeds[(speeds.indexOf(audio.playbackRate) + 1) % speeds.length];
  audio.playbackRate = next;
  byId("lessonAudioSpeed").textContent = `${next}x`;
});

byId("samplePromptSelect").addEventListener("change", (event) => {
  if (event.target.value) {
    nlInput.value = event.target.value;
    nlInput.focus();
  }
});
document.querySelectorAll(".palette-item").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!showView("circuits")) return;
    addGate(button.dataset.op);
    if (coTeacherActive) {
      const clipByGate = { H: "gate_h", X: "gate_x", CNOT: "gate_cnot", RY: "gate_ry", SWAP: "gate_swap", measure: "gate_measure" };
      const clipId = clipByGate[button.dataset.op];
      if (clipId) { const manifest = await loadCoTeacherManifest(); await speakCoTeacher(manifest.transcripts[clipId], clipId); }
    }
  });
  button.addEventListener("dragstart", (event) => {
    if (!currentAccount) { event.preventDefault(); showView("circuits"); return; }
    event.dataTransfer.setData("text/plain", button.dataset.op);
    showView("circuits");
  });
});
document.querySelectorAll(".template-chips button[data-template]").forEach((button) => {
  button.addEventListener("click", () => runTemplate(button.dataset.template).catch((error) => {
    nlError.textContent = error.message;
    nlError.hidden = false;
  }));
});
circuitCanvas.addEventListener("dragover", (event) => event.preventDefault());
circuitCanvas.addEventListener("drop", (event) => {
  event.preventDefault();
  const op = event.dataTransfer.getData("text/plain");
  if (op) addGate(op);
});

byId("quboSource").value = JSON.stringify(triangleQubo, null, 2);
byId("aboutBuild").textContent = window.QYOG_BUILD_ID || "dev";
registerSumiUIActions();
initializeAdminEntry();
renderGlossary();
setLearningLevel(learningState.level);
loadCurriculum();
let initialIR = bellIR();
let initialManifest = null;
try {
  const restored = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  if (restored?.ir?.version === "1.0") initialIR = restored.ir;
  if (restored?.manifest?.apiVersion === "quantumyog.dev/v1") initialManifest = restored.manifest;
  if (typeof restored?.text === "string") nlInput.value = restored.text;
  if (["qiskit", "cirq"].includes(restored?.backend)) backendSelect.value = restored.backend;
} catch (_) {}
let savedAccount = null;
try { savedAccount = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null"); } catch (_) {}
if (!currentAccount) {
  byId("paletteAuthNote").hidden = false;
  document.querySelector(".workspace-gates-list").hidden = true;
  document.querySelectorAll(".nav-item:not(#navLearn):not(#navFaq)").forEach((button) => {
    button.classList.add("auth-locked");
    button.title = `Sign in required to open ${button.textContent.trim()}`;
  });
}
const linkedManifest = manifestFromLocationHash();
if (linkedManifest) {
  initialIR = linkedManifest.ir;
  initialManifest = linkedManifest.manifest;
  backendSelect.value = linkedManifest.backend;
  byId("manifestEditor").value = manifestYaml(linkedManifest.manifest);
}
const initialWorkspace = linkedManifest ? "circuits" : workspaceFromLocation();
async function restoreAccountAndWorkspace() {
  if (savedAccount?.id && savedAccount?.subscription?.plan) {
    try { updateAccount(await requestJson(`/accounts/${encodeURIComponent(savedAccount.id)}`)); }
    catch (_) {
      if (/^(local|user)-[a-z0-9-]+$/i.test(savedAccount.id)) updateAccount(savedAccount);
      else try { localStorage.removeItem(ACCOUNT_KEY); } catch (_) {}
    }
  }
  showView(initialWorkspace);
}
restoreAccountAndWorkspace();
renderResult(localResult(initialIR, backendSelect.value, null, initialManifest));
renderProviders(fallbackProviders);
drawConvergence(scoreFallback("CC(=O)OC1=CC=CC=C1C(=O)O").convergence);
checkHealth();
initializeMonaco();
