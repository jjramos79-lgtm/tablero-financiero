// Recolector del Tablero Financiero. Sin dependencias (Node 18+).
// Uso: node collector.mjs   -> escribe data/latest.json y data/latest.js
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const UA = "Mozilla/5.0 (TableroFinanciero)";
const cfg = JSON.parse(await readFile(path.join(DIR, "config.json"), "utf8"));
const errores = [];

// Con --programado solo corre lun-vie 09:00-20:59 (hora Argentina); manual siempre corre.
if (process.argv.includes("--programado")) {
  const ar = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  if (ar.getDay() === 0 || ar.getDay() === 6 || ar.getHours() < 9 || ar.getHours() > 20) { console.log("Fuera de horario, no se actualiza."); process.exit(0); }
}

const num = (s) => (typeof s === "number" ? s : parseFloat(String(s).replace(/\./g, "").replace(",", ".")));

async function getJSON(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
  }
  throw last;
}

// ---------- Adaptadores de fuente ----------
const yahooCache = new Map();
function yahoo(symbol) {
  if (!yahooCache.has(symbol)) {
    yahooCache.set(symbol, (async () => {
      const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`);
      const res = j?.chart?.result?.[0];
      if (!res) throw new Error(j?.chart?.error?.description || "sin datos");
      const m = res.meta;
      const ts = res.timestamp || [];
      const cl = res.indicators?.quote?.[0]?.close || [];
      const serie = [];
      ts.forEach((t, i) => { if (cl[i] != null) serie.push({ t, c: cl[i] }); });
      const off = m.gmtoffset || 0;
      const diaMercado = Math.floor((m.regularMarketTime + off) / 86400);
      const ult = serie[serie.length - 1];
      const hoyEnSerie = ult && Math.floor((ult.t + off) / 86400) === diaMercado;
      const prev = hoyEnSerie ? serie[serie.length - 2]?.c : ult?.c;
      return {
        precio: m.regularMarketPrice, previo: prev ?? m.chartPreviousClose,
        volumen: m.regularMarketVolume ?? null, moneda: m.currency, hora: m.regularMarketTime,
        max52: m.fiftyTwoWeekHigh ?? null, min52: m.fiftyTwoWeekLow ?? null,
        serie: serie.map((p) => p.c),
      };
    })());
  }
  return yahooCache.get(symbol);
}

async function ambito(slug) {
  const j = await getJSON(`https://mercados.ambito.com/dolar/${slug}/variacion`);
  const compra = num(j.compra), venta = num(j.venta);
  return { compra: isNaN(compra) ? null : compra, venta: isNaN(venta) ? null : venta, previo: num(j.valor_cierre_ant), variacion: num(String(j.variacion).replace("%", "")), fecha: j.fecha };
}

let data912Cache;
const data912 = () => (data912Cache ??= getJSON("https://data912.com/live/arg_bonds"));

// Adaptadores reservados (no disponibles sin licencia o sin API publica).
const reservados = { investing: "Investing.com", bloomberg: "Bloomberg", infobae: "Infobae Profesional", cronista: "Cronista Comercial" };
for (const k of Object.keys(reservados)) if (cfg.fuentes[k]?.habilitada) errores.push(`${reservados[k]}: adaptador no implementado (sin API publica). Deshabilitar en config.json.`);

// ---------- Utilidades ----------
const safe = async (nombre, fn) => { try { return await fn(); } catch (e) { errores.push(`${nombre}: ${e.message}`); return null; } };
const pct = (p, q) => (p != null && q ? ((p - q) / q) * 100 : null);

async function pool(items, fn, n = 6) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

function cotizacion(y, div = 1) {
  const f = (v) => (v == null ? null : v / div);
  return { precio: f(y.precio), previo: f(y.previo), var_pct: pct(y.precio, y.previo), volumen: y.volumen, max52: f(y.max52), min52: f(y.min52), serie: y.serie.map((v) => v / div), hora: y.hora };
}

// ---------- Recoleccion ----------
const salida = { generado: new Date().toISOString(), errores };

// Monedas: USD por 1 unidad
const fxExtra = [{ id: "CAD", nombre: "Dolar canadiense", yahoo: "USDCAD=X", invertir: true, oculta: true }];
salida.monedas = (await pool([...cfg.monedas, ...fxExtra], async (m) => {
  if (!m.yahoo) return { id: m.id, nombre: m.nombre, usd_por_unidad: 1, var_pct: 0, serie: [] };
  const y = await safe(`Moneda ${m.id}`, () => yahoo(m.yahoo));
  if (!y) return { id: m.id, nombre: m.nombre, usd_por_unidad: null, error: true };
  const cv = (v) => (v == null ? null : m.invertir ? 1 / v : v);
  return { id: m.id, nombre: m.nombre, oculta: !!m.oculta, usd_por_unidad: cv(y.precio), previo: cv(y.previo), var_pct: pct(cv(y.precio), cv(y.previo)), serie: y.serie.map(cv), hora: y.hora };
}));

const bonosRaw = await safe("Bonos (data912)", data912);
const bmap = new Map((bonosRaw || []).map((b) => [b.symbol, b]));
const dolares = [];
let dolarapi = null;
try { dolarapi = await getJSON("https://dolarapi.com/v1/dolares"); } catch (e) { errores.push("DolarApi: " + e.message); }
const fechaISO = (d) => d.toISOString().slice(0, 10);
async function cierreAnterior(casa, desdeFecha) {
  // Busca hacia atras (hasta 6 dias) el ultimo dato anterior a la fecha actual.
  for (let i = 1; i <= 6; i++) {
    const d = new Date(desdeFecha); d.setUTCDate(d.getUTCDate() - i);
    const [y, m, dd] = fechaISO(d).split("-");
    try { return await getJSON(`https://api.argentinadatos.com/v1/cotizaciones/dolares/${casa}/${y}/${m}/${dd}`, 1); } catch {}
  }
  return null;
}
await Promise.all(cfg.dolar_ar.map(async (d) => {
  const hoy = dolarapi?.find((x) => x.casa === d.casa);
  let r = null;
  if (hoy) {
    const prev = await cierreAnterior(d.casa, hoy.fechaActualizacion);
    r = { id: d.id, nombre: d.nombre, fuente: "DolarApi.com", compra: hoy.compra, venta: hoy.venta, previo: prev?.venta ?? null, variacion: prev ? pct(hoy.venta, prev.venta) : null, fecha: new Date(hoy.fechaActualizacion).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false }) };
  } else if (d.ambito) {
    const a = await safe(`Dolar ${d.id} (Ambito)`, () => ambito(d.ambito));
    if (a) r = { id: d.id, nombre: d.nombre, fuente: "Ambito (respaldo)", ...a };
  }
  dolares.push(r || { id: d.id, nombre: d.nombre, error: true });
}));
salida.dolar_ar = cfg.dolar_ar.map((d) => dolares.find((x) => x.id === d.id));

const MESES = "FGHJKMNQUVXZ", NOMBRES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
function contratoFrontal(f, extra = 0) {
  const hoy = new Date();
  let d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + f.meses_adelante, 1));
  if (f.vence_dias_habiles_antes_1ro) {
    // Aproxima el vencimiento: N dias habiles (lun-vie, sin feriados) antes del 1ro del mes de entrega.
    const venc = new Date(d); let n = 0;
    while (n < f.vence_dias_habiles_antes_1ro) { venc.setUTCDate(venc.getUTCDate() - 1); if (![0, 6].includes(venc.getUTCDay())) n++; }
    if (hoy.getTime() > venc.getTime() + 86400000) d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + extra, 1));
  return { simbolo: `${f.raiz}${MESES[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}${f.sufijo}`, etiqueta: `${NOMBRES[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}` };
}
salida.commodities = await pool(cfg.commodities, async (c) => {
  let y = null, contrato = null;
  if (c.frontal) {
    for (const extra of [0, 1]) {
      const f = contratoFrontal(c.frontal, extra);
      const r = await safe(`Commodity ${c.id} ${f.simbolo}`, () => yahoo(f.simbolo));
      // Un contrato vencido deja de actualizarse: si su ultimo dato tiene mas de 5 dias, se usa el siguiente.
      if (r && Date.now() / 1000 - r.hora < 5 * 86400) { y = r; contrato = f.etiqueta; break; }
    }
  }
  if (!y) y = await safe(`Commodity ${c.id}`, () => yahoo(c.yahoo));
  return { id: c.id, nombre: c.nombre, contrato, unidad: c.unidad, fuente: "Yahoo Finance", ...(y ? cotizacion(y, c.divisor || 1) : { error: true }) };
});

salida.indices = await pool(cfg.indices, async (c) => {
  const y = await safe(`Indice ${c.id}`, () => yahoo(c.yahoo));
  return { id: c.id, nombre: c.nombre, fuente: "Yahoo Finance", ...(y ? cotizacion(y) : { error: true }) };
});

async function acciones(lista) {
  return pool(lista, async (a) => {
    const cots = await Promise.all((a.cotizaciones || []).map(async (q) => {
      const y = await safe(`Accion ${a.id} ${q.mercado}`, () => yahoo(q.yahoo));
      return { mercado: q.mercado, moneda: q.moneda, simbolo: q.yahoo, fuente: "Yahoo Finance", ...(y ? cotizacion(y, q.divisor || 1) : { error: true }) };
    }));
    return { id: a.id, nombre: a.nombre, nota: a.nota || null, cotizaciones: cots };
  });
}
salida.acciones_argentinas = await acciones(cfg.acciones_argentinas);
salida.acciones_extranjeras = await acciones(cfg.acciones_extranjeras);

// Bonos
const mapa = new Map((bonosRaw || []).map((b) => [b.symbol, b]));
salida.bonos = cfg.bonos.lista.map((s) => {
  const ars = mapa.get(s), usd = mapa.get(s + "D");
  if (!ars && !usd) return { id: s, nombre: s, error: true };
  return {
    id: s, nombre: s, fuente: "data912 (BYMA)",
    precio_ars: ars?.c ?? null, var_ars: ars?.pct_change ?? null, volumen_ars: ars?.v ?? null,
    precio_usd: usd?.c ?? null, var_usd: usd?.pct_change ?? null, volumen_usd: usd?.v ?? null,
  };
});

salida.fuentes = cfg.fuentes;
salida.nota_config = "Los componentes se definen en config.json";

await mkdir(path.join(DIR, "data"), { recursive: true });
const json = JSON.stringify(salida);
await writeFile(path.join(DIR, "data", "latest.json"), json);
await writeFile(path.join(DIR, "data", "latest.js"), "window.TABLERO=" + json + ";");
await appendFile(path.join(DIR, "data", "corridas.log"), `${salida.generado} errores=${errores.length}\n`);
console.log(`OK ${salida.generado} | errores: ${errores.length}`);
errores.forEach((e) => console.log(" - " + e));
