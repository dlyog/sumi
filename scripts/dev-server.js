const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "public");
const monacoRoot = path.join(__dirname, "..", "node_modules", "monaco-editor", "min", "vs");
const port = Number(process.env.PORT || 8080);
const buildId = process.env.QYOG_BUILD_ID || `dev-${Date.now().toString(36)}`;
const types = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".wav": "audio/wav", ".webm": "video/webm" };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/build-version.js") {
    const payload = `window.QYOG_BUILD_ID = ${JSON.stringify(buildId)};\n`;
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
    res.end(payload);
    return;
  }
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const isMonaco = safePath.startsWith("/vendor/monaco/vs/");
  const relativePath = isMonaco ? safePath.slice("/vendor/monaco/vs/".length) : safePath;
  const selectedRoot = isMonaco ? monacoRoot : root;
  let file = path.join(selectedRoot, relativePath === "/" ? "index.html" : relativePath);
  if (!file.startsWith(selectedRoot)) file = path.join(root, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) {
      if (isMonaco) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      fs.readFile(path.join(root, "index.html"), (fallbackErr, fallback) => {
        if (fallbackErr) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
        res.end(fallback);
      });
      return;
    }
    const critical = ["/", "/index.html", "/service-worker.js"].includes(urlPath);
    const headers = {
      "content-type": types[path.extname(file)] || "application/octet-stream",
      "cache-control": critical ? "no-store" : "no-cache",
      "content-length": String(data.length),
    };
    if (urlPath === "/service-worker.js") headers["service-worker-allowed"] = "/";
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [startText, endText] = range.slice(6).split("-");
      const suffixLength = !startText && endText ? Number(endText) : 0;
      const start = startText ? Number(startText) : Math.max(0, data.length - suffixLength);
      const end = endText && startText ? Math.min(Number(endText), data.length - 1) : data.length - 1;
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && start < data.length) {
        const chunk = data.subarray(start, end + 1);
        res.writeHead(206, { ...headers, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${data.length}`, "content-length": String(chunk.length) });
        res.end(chunk);
        return;
      }
      res.writeHead(416, { "content-range": `bytes */${data.length}` });
      res.end();
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}).listen(port, () => {
  console.log(`1StopQuantum frontend listening at http://localhost:${port}`);
});
