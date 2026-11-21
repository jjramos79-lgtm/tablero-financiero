// Servidor local del tablero: node server.mjs  ->  http://localhost:8080
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json" };
const PUERTO = process.env.PORT || 8080;

http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const permitido = p === "/index.html" || p.startsWith("/data/latest.");
  const f = path.join(DIR, p);
  if (!permitido || !f.startsWith(DIR)) { res.writeHead(404); return res.end("No encontrado"); }
  try {
    const b = await readFile(f);
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(f)] || "text/plain", "Cache-Control": "no-store" });
    res.end(b);
  } catch { res.writeHead(404); res.end("No encontrado"); }
}).listen(PUERTO, "127.0.0.1", () => console.log("Tablero en http://localhost:" + PUERTO));
