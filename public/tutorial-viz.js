import * as d3 from "d3";
import * as THREE from "three";


const BACKGROUND = new THREE.Color(0xf7f8f7);

function lineMaterial(color, opacity = 1) {
  return new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
}

function circlePoints(axis, radius = 1, segments = 96) {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    if (axis === "xy") return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    if (axis === "xz") return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    return new THREE.Vector3(0, Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}

function addCircle(scene, axis, color, opacity) {
  const geometry = new THREE.BufferGeometry().setFromPoints(circlePoints(axis));
  scene.add(new THREE.Line(geometry, lineMaterial(color, opacity)));
}

function addAxes(scene) {
  const vertices = [
    -1.25, 0, 0, 1.25, 0, 0,
    0, -1.25, 0, 0, 1.25, 0,
    0, 0, -1.25, 0, 0, 1.25,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  scene.add(new THREE.LineSegments(geometry, lineMaterial(0x69736e, 0.72)));
}

function drawComparison(container, thetaDegrees) {
  const theta = thetaDegrees * Math.PI / 180;
  const p0 = Math.cos(theta / 2) ** 2;
  const rows = [
    { group: "Classical bit", value: 0, probability: 1, color: "#14569a" },
    { group: "Classical bit", value: 1, probability: 0, color: "#14569a" },
    { group: "Qubit measurement", value: 0, probability: p0, color: "#006b5f" },
    { group: "Qubit measurement", value: 1, probability: 1 - p0, color: "#825500" },
  ];
  const width = Math.max(340, Math.min(620, container.clientWidth || 620));
  const height = 190;
  const margin = { top: 34, right: 24, bottom: 32, left: 126 };
  const innerWidth = width - margin.left - margin.right;
  const y = d3.scaleBand().domain(rows.map((_, index) => String(index))).range([margin.top, height - margin.bottom]).padding(0.22);
  const x = d3.scaleLinear().domain([0, 1]).range([margin.left, width - margin.right]);

  const root = d3.select(container);
  root.selectAll("*").remove();
  const svg = root.append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Classical bit and qubit measurement probability comparison");

  svg.append("g")
    .attr("class", "comparison-grid")
    .selectAll("line")
    .data([0, 0.25, 0.5, 0.75, 1])
    .join("line")
    .attr("x1", (value) => x(value))
    .attr("x2", (value) => x(value))
    .attr("y1", margin.top - 8)
    .attr("y2", height - margin.bottom + 1)
    .attr("stroke", "#d9ddda");

  svg.append("g").selectAll("rect")
    .data(rows)
    .join("rect")
    .attr("class", "comparison-bar")
    .attr("x", margin.left)
    .attr("y", (_, index) => y(String(index)))
    .attr("width", (item) => Math.max(1, x(item.probability) - margin.left))
    .attr("height", y.bandwidth())
    .attr("rx", 2)
    .attr("fill", (item) => item.color);

  svg.append("g").selectAll("text.value")
    .data(rows)
    .join("text")
    .attr("class", "value")
    .attr("x", margin.left - 12)
    .attr("y", (_, index) => (y(String(index)) || 0) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end")
    .text((item) => `${item.group}  ${item.value}`);

  svg.append("g").selectAll("text.percent")
    .data(rows)
    .join("text")
    .attr("class", "percent")
    .attr("x", (item) => item.probability > 0.85 ? x(item.probability) - 5 : x(item.probability) + 7)
    .attr("text-anchor", (item) => item.probability > 0.85 ? "end" : "start")
    .attr("y", (_, index) => (y(String(index)) || 0) + y.bandwidth() / 2 + 4)
    .text((item) => `${Math.round(item.probability * 100)}%`);

  svg.append("text").attr("class", "axis-label").attr("x", margin.left).attr("y", 18).text("Probability after measurement");
  svg.append("text").attr("class", "axis-label").attr("x", width - margin.right).attr("y", height - 8).attr("text-anchor", "end").text("A qubit is not observed until measurement");
}

function chartFrame(container, ariaLabel, height = 350) {
  const width = Math.max(360, Math.min(1180, container.clientWidth || 900));
  const root = d3.select(container);
  root.selectAll("*").remove();
  const svg = root.append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", ariaLabel);
  return { svg, width, height };
}

export function drawBenchmarkLandscape(container, points, benchmark, dateLabel) {
  const { svg, width, height } = chartFrame(
    container,
    `${benchmark} measured scores available by ${dateLabel}`,
  );
  const usable = points.filter((point) => Number.isFinite(point.value) && Number.isFinite(point.scale));
  if (!usable.length) {
    svg.append("text").attr("class", "chart-empty").attr("x", width / 2).attr("y", height / 2)
      .attr("text-anchor", "middle").text("No comparable scaled measurements are available by this date.");
    return;
  }
  const margin = { top: 24, right: 34, bottom: 52, left: 68 };
  const xExtent = d3.extent(usable, (point) => Number(point.scale));
  const xPadding = Math.max(1, ((xExtent[1] || 1) - (xExtent[0] || 0)) * 0.05);
  const x = d3.scaleLinear()
    .domain([Math.max(0, (xExtent[0] || 0) - xPadding), (xExtent[1] || 1) + xPadding])
    .nice()
    .range([margin.left, width - margin.right]);
  const yMax = d3.max(usable, (point) => Number(point.value)) || 1;
  const yMin = d3.min(usable, (point) => Number(point.value)) || 0;
  const bounded = yMin >= 0 && yMax <= 1.05;
  const y = d3.scaleLinear()
    .domain(bounded ? [0, 1] : [Math.min(0, yMin), yMax * 1.08])
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg.append("g").attr("class", "benchmark-grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(6).tickSize(-(width - margin.left - margin.right)).tickFormat(() => ""));
  svg.append("g").attr("class", "benchmark-axis")
    .attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(7));
  svg.append("g").attr("class", "benchmark-axis")
    .attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(6));
  svg.append("text").attr("class", "chart-axis-title")
    .attr("x", width / 2).attr("y", height - 10).attr("text-anchor", "middle")
    .text("Problem scale (qubits or reported width)");
  svg.append("text").attr("class", "chart-axis-title")
    .attr("transform", "rotate(-90)").attr("x", -height / 2).attr("y", 17).attr("text-anchor", "middle")
    .text("Raw benchmark score");
  const marks = svg.append("g").selectAll("circle").data(usable, (point) => point.id).join("circle")
    .attr("class", (point) => `benchmark-point ${String(point.provider).replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`)
    .attr("cx", (point) => x(point.scale)).attr("cy", (point) => y(point.value))
    .attr("r", 5).attr("opacity", 0.84);
  marks.append("title").text((point) => `${point.device} · scale ${point.scale} · score ${Number(point.value).toFixed(4)} · ${point.timestamp.slice(0, 10)}`);
}

export function drawBenchmarkForecast(container, observed, projected) {
  const { svg, width, height } = chartFrame(container, "Measured benchmark values and exploratory forecast");
  const parseDate = (point) => new Date(point.timestamp);
  const all = [...observed, ...projected];
  if (!all.length) {
    svg.append("text").attr("class", "chart-empty").attr("x", width / 2).attr("y", height / 2)
      .attr("text-anchor", "middle").text("Run a forecast to plot a comparable measured series.");
    return;
  }
  const margin = { top: 24, right: 34, bottom: 52, left: 68 };
  const x = d3.scaleTime().domain(d3.extent(all, parseDate)).range([margin.left, width - margin.right]);
  const values = all.flatMap((point) => [point.value, point.lower, point.upper]).filter(Number.isFinite);
  const yMin = d3.min(values) || 0;
  const yMax = d3.max(values) || 1;
  const bounded = yMin >= 0 && yMax <= 1.05;
  const y = d3.scaleLinear().domain(bounded ? [0, 1] : [Math.min(0, yMin), yMax * 1.08]).nice().range([height - margin.bottom, margin.top]);
  svg.append("g").attr("class", "benchmark-grid").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(6).tickSize(-(width - margin.left - margin.right)).tickFormat(() => ""));
  svg.append("g").attr("class", "benchmark-axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(Math.min(7, all.length)).tickFormat(d3.timeFormat("%b %Y")));
  svg.append("g").attr("class", "benchmark-axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(6));
  const area = d3.area().x((point) => x(parseDate(point))).y0((point) => y(point.lower)).y1((point) => y(point.upper));
  svg.append("path").datum(projected).attr("class", "forecast-band").attr("d", area);
  const line = d3.line().x((point) => x(parseDate(point))).y((point) => y(point.value));
  svg.append("path").datum(observed).attr("class", "observed-line").attr("d", line);
  svg.append("path").datum([observed[observed.length - 1], ...projected].filter(Boolean)).attr("class", "forecast-line").attr("d", line);
  svg.append("g").selectAll("circle").data(observed).join("circle").attr("class", "forecast-observed")
    .attr("cx", (point) => x(parseDate(point))).attr("cy", (point) => y(point.value)).attr("r", 5);
  svg.append("text").attr("class", "chart-axis-title").attr("x", width / 2).attr("y", height - 10)
    .attr("text-anchor", "middle").text("Measurement date and forecast horizon");
  svg.append("text").attr("class", "chart-axis-title").attr("transform", "rotate(-90)")
    .attr("x", -height / 2).attr("y", 17).attr("text-anchor", "middle").text("Raw benchmark score");
}

export function createTutorialVisuals(canvas, chart, onStateChange = () => {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(BACKGROUND, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(3.45, 2.15, 4.25);
  camera.lookAt(0, 0, 0);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 36, 24),
    new THREE.MeshBasicMaterial({ color: 0x2e756c, wireframe: true, transparent: true, opacity: 0.2 }),
  );
  scene.add(sphere);
  addAxes(scene);
  addCircle(scene, "xy", 0x006b5f, 0.58);
  addCircle(scene, "xz", 0x14569a, 0.4);
  addCircle(scene, "yz", 0x825500, 0.34);

  const stateGroup = new THREE.Group();
  scene.add(stateGroup);
  let arrow;
  let thetaDegrees = 90;
  let phiDegrees = 0;

  function resize() {
    const width = Math.max(280, canvas.clientWidth || 540);
    const height = Math.max(260, canvas.clientHeight || 360);
    const pixelRatio = renderer.getPixelRatio();
    if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
      renderer.setSize(width, height, false);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function update(theta = thetaDegrees, phi = phiDegrees) {
    thetaDegrees = Number(theta);
    phiDegrees = Number(phi);
    const polar = thetaDegrees * Math.PI / 180;
    const azimuth = phiDegrees * Math.PI / 180;
    const direction = new THREE.Vector3(
      Math.sin(polar) * Math.cos(azimuth),
      Math.cos(polar),
      Math.sin(polar) * Math.sin(azimuth),
    ).normalize();
    if (arrow) stateGroup.remove(arrow);
    arrow = new THREE.ArrowHelper(direction, new THREE.Vector3(0, 0, 0), 1.18, 0x111312, 0.18, 0.11);
    stateGroup.add(arrow);
    drawComparison(chart, thetaDegrees);
    resize();
    renderer.render(scene, camera);
    canvas.dataset.renderReady = "true";
    const p0 = Math.cos(polar / 2) ** 2;
    onStateChange({ theta: thetaDegrees, phi: phiDegrees, p0, p1: 1 - p0 });
  }

  const resizeObserver = new ResizeObserver(() => update());
  resizeObserver.observe(canvas);
  update();

  function pixelStats() {
    resize();
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBackground = 0;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (Math.abs(red - 247) + Math.abs(green - 248) + Math.abs(blue - 247) > 18) nonBackground += 1;
      if (index % 64 === 0) colors.add(`${red >> 4},${green >> 4},${blue >> 4}`);
    }
    return { nonBackground, distinctColors: colors.size, width, height };
  }

  return {
    update,
    pixelStats,
    dispose() {
      resizeObserver.disconnect();
      renderer.dispose();
    },
  };
}
