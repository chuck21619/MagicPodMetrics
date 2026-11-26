// Tiny no-dependency static server: `node serve.js` then open http://localhost:8765
const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = process.env.PORT || 8765;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(__dirname, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Magic Pod Metrics at http://localhost:${PORT}`));
