const BUILD_ID = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_PREFIX = "quantumyog-cache-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const APP_SHELL = [
  "/",
  "/styles.css",
  "/info.css",
  "/app.js",
  "/sumi-voice-sdk.js?v=voice-2",
  "/sumi-framework.js",
  "/sumi-mic-worklet.js",
  "/sumi-screen-registry.json",
  "/sumi-ui-actions.js",
  "/tutorial-viz.bundle.js",
  "/manifest.webmanifest",
  "/assets/1stopquantum-logo.png",
  "/assets/ai-co-teacher.png",
  "/assets/sumi-companion.png",
  "/privacy.html",
  "/assets/co-teacher/noise_clarify_1.wav",
  "/assets/co-teacher/noise_clarify_2.wav",
  "/assets/course/foundations.png",
  "/assets/course/effects.png",
  "/assets/course/algorithms.png",
  "/assets/course/hardware-evidence.png",
  "/data/quantum_curriculum.json",
  "/data/use_cases.json",
  "/data/product_tours.json",
  "/data/podcast_catalog.json",
  "/data/faq.json",
  "/faq.html",
  "/ai-use.html",
  "/credits.html",
  "/assets/course/lessons/bits-and-qubits.png",
  "/assets/course/lessons/state-and-bloch-sphere.png",
  "/assets/course/lessons/gates-and-circuits.png",
  "/assets/course/lessons/measurement-and-shots.png",
  "/assets/course/lessons/interference.png",
  "/assets/course/lessons/entanglement.png",
  "/assets/course/lessons/noise-and-decoherence.png",
  "/assets/course/lessons/error-correction-intuition.png",
  "/assets/course/lessons/algorithm-thinking.png",
  "/assets/course/lessons/deutsch-jozsa.png",
  "/assets/course/lessons/grover-search.png",
  "/assets/course/lessons/ghz-and-teleportation.png",
  "/assets/course/lessons/computing-paradigms.png",
  "/assets/course/lessons/hardware-modalities.png",
  "/assets/course/lessons/compilation-and-qpu-fit.png",
  "/assets/course/lessons/benchmarks-and-claims.png",
  "/icons/quantumyog-192.png",
  "/icons/quantumyog-512.png",
  "/audio/screens/use-cases.wav",
  "/audio/screens/podcast.wav",
  "/audio/screens/community.wav",
  "/audio/podcast/classical-to-quantum.wav",
  "/audio/podcast/security-shor-and-readiness.wav",
  "/audio/podcast/optimization-science-use-cases.wav",
  "/audio/podcast/hardware-benchmarks-and-claims.wav",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok && response.status === 200 && !request.headers.has("range")) {
      try { await cache.put(request, response.clone()); } catch (_) {}
    }
    return response;
  } catch (_) {
    const cached = await cache.match(request) || await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match("/");
    return new Response("1StopQuantum is offline and this resource is not cached.", { status: 503 });
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event.request));
});
