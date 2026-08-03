/**
 * ONKA — Control horario e imputación de horas
 * Backend en Node.js puro (sin dependencias que instalar).
 *
 * Almacenamiento de datos, con dos modos:
 *  - Si están definidas las variables de entorno UPSTASH_REDIS_REST_URL y
 *    UPSTASH_REDIS_REST_TOKEN, los datos se guardan en Upstash (Redis
 *    gratuito y persistente en internet) — así sobreviven a los reinicios
 *    del servicio, incluso en el plan gratuito de Render.
 *  - Si no están definidas, se guardan en data/data.json en el propio
 *    disco (válido para probar en tu ordenador, pero se borra si el
 *    servidor se reinicia en un hosting sin disco persistente).
 *
 * Arrancar:  node server.js
 * Puerto:    variable de entorno PORT, o 3000 si no está definida.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
const REDIS_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const USING_REDIS = !!(REDIS_URL && REDIS_TOKEN);
const REDIS_KEY = "onka-data";

function uid() {
  return crypto.randomBytes(6).toString("hex");
}

// -----------------------------------------------------------------
// Datos iniciales (solo se usan la primera vez, si no hay datos guardados)
// -----------------------------------------------------------------
function seedData() {
  return {
    users: [{ id: "u_admin", name: "Administrador", role: "admin", pin: "0000" }],
    projects: [
      { id: uid(), name: "Captación de clientes", fixed: true },
      { id: uid(), name: "Mantenimiento", fixed: true },
      { id: uid(), name: "Administración", fixed: true },
      { id: uid(), name: "Baja médica", fixed: true },
      { id: uid(), name: "Asuntos propios", fixed: true },
    ],
    auxTasks: [],
    fichajes: [],
    imputaciones: [],
    events: [],
    responsablesProyecto: [], // ids de usuarios autorizados a gestionar la familia "proyectos"
    responsablesAuxiliar: [], // ids de usuarios autorizados a gestionar la familia "auxiliares"
    sessions: {},
  };
}

// Migración suave: asegura que los datos cargados (de Redis o del archivo)
// tienen todos los campos de versiones nuevas de la app, sin borrar nada.
function migrate(data) {
  if (!data.responsablesAuxiliar) data.responsablesAuxiliar = [];
  if (!data.responsablesProyecto) data.responsablesProyecto = [];
  data.events = (data.events || []).map((e) => ({
    time: null, description: "", location: "", invitados: "todos",
    alerta: { activa: false, minutosAntes: 60 }, festivoScope: "nacional", festivoLugar: "",
    ...e,
  }));
  ["Baja médica", "Asuntos propios"].forEach((nombre) => {
    if (!data.projects.some((p) => p.name === nombre)) data.projects.push({ id: uid(), name: nombre, fixed: true });
  });
  return data;
}

// -----------------------------------------------------------------
// Upstash Redis (REST API — sin librerías, solo fetch nativo de Node)
// -----------------------------------------------------------------
async function redisGet(key) {
  const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  if (!r.ok) throw new Error("No se pudo leer de Upstash (revisa las variables de entorno)");
  const j = await r.json();
  return j.result; // string guardado, o null si no existe
}
async function redisSet(key, value) {
  const r = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, { method: "POST", headers: { Authorization: `Bearer ${REDIS_TOKEN}` }, body: value });
  if (!r.ok) throw new Error("No se pudo guardar en Upstash (revisa las variables de entorno)");
}

// -----------------------------------------------------------------
// Almacenamiento con caché en memoria + cola de escritura
// -----------------------------------------------------------------
let writeQueue = Promise.resolve();
let cache = null;

async function loadData() {
  if (cache) return cache;
  if (USING_REDIS) {
    const raw = await redisGet(REDIS_KEY);
    if (raw) {
      cache = migrate(JSON.parse(raw));
    } else {
      cache = seedData();
      await redisSet(REDIS_KEY, JSON.stringify(cache));
    }
  } else {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      cache = seedData();
      fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
    } else {
      cache = migrate(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
      fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
    }
  }
  return cache;
}

async function saveData(data) {
  cache = data;
  if (USING_REDIS) {
    await redisSet(REDIS_KEY, JSON.stringify(data));
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

function persist(mutator) {
  writeQueue = writeQueue.then(async () => {
    const data = await loadData();
    const result = mutator(data) || data;
    await saveData(result);
    return result;
  });
  return writeQueue;
}

// -----------------------------------------------------------------
// Sesiones
// -----------------------------------------------------------------
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function createSession(user) {
  const token = crypto.randomBytes(24).toString("hex");
  const session = { userId: user.id, role: user.role, expiresAt: Date.now() + TOKEN_TTL_MS };
  return persist((data) => {
    data.sessions[token] = session;
    return data;
  }).then(() => token);
}
async function getSession(token) {
  const data = await loadData();
  const s = data.sessions[token];
  if (!s) return null;
  if (s.expiresAt < Date.now()) return null;
  return s;
}

// -----------------------------------------------------------------
// Utilidades HTTP
// -----------------------------------------------------------------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = "";
    req.on("data", (c) => (chunks += c));
    req.on("end", () => { if (!chunks) return resolve({}); try { resolve(JSON.parse(chunks)); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
async function auth(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const session = await getSession(token);
  if (!session) return null;
  return { token, ...session };
}
function isAdmin(session) { return !!session && session.role === "admin"; }

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Límite de horas de la jornada principal: L-J 8.5h, V 5h, fin de semana 0h
function dailyCap(dateISO) {
  const d = new Date(dateISO + "T00:00:00");
  const day = d.getDay(); // 0 domingo ... 6 sábado
  if (day >= 1 && day <= 4) return 8.5;
  if (day === 5) return 5;
  return 0;
}

// -----------------------------------------------------------------
// Estáticos
// -----------------------------------------------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("Prohibido"); }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (err2, indexContent) => {
        if (err2) { res.writeHead(404); return res.end("No encontrado"); }
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        res.end(indexContent);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

// -----------------------------------------------------------------
// API
// -----------------------------------------------------------------
async function handleApi(req, res, pathname, query) {
  if (req.method === "OPTIONS") return sendJSON(res, 204, {});

  if (pathname === "/api/public-users" && req.method === "GET") {
    const data = await loadData();
    return sendJSON(res, 200, data.users.map((u) => ({ id: u.id, name: u.name, role: u.role })));
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    const data = await loadData();
    const user = data.users.find((u) => u.id === body.userId);
    if (!user || String(user.pin || "") !== String(body.pin || "")) return sendJSON(res, 401, { error: "Usuario o PIN incorrecto" });
    const token = await createSession(user);
    return sendJSON(res, 200, { token, user: { id: user.id, name: user.name, role: user.role } });
  }

  const session = await auth(req);
  if (!session) return sendJSON(res, 401, { error: "No autenticado" });

  if (pathname === "/api/logout" && req.method === "POST") {
    await persist((data) => { delete data.sessions[session.token]; return data; });
    return sendJSON(res, 200, { ok: true });
  }

  // ---- Configuración de referencia ----
  if (pathname === "/api/config" && req.method === "GET") {
    const data = await loadData();
    return sendJSON(res, 200, {
      projects: data.projects,
      auxTasks: data.auxTasks,
      responsablesProyecto: data.responsablesProyecto,
      responsablesAuxiliar: data.responsablesAuxiliar,
      users: data.users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
      me: session,
    });
  }

  // ---- Familia "Proyectos" (oficina + fábrica) ----
  const puedeProyectos = (data) => isAdmin(session) || data.responsablesProyecto.includes(session.userId);
  if (pathname === "/api/projects" && req.method === "POST") {
    const data = await loadData();
    if (!puedeProyectos(data)) return sendJSON(res, 403, { error: "No autorizado a crear proyectos" });
    const body = await readBody(req);
    if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: "Nombre requerido" });
    const project = { id: uid(), name: body.name.trim(), fixed: !!body.fixed };
    const updated = await persist((d) => { d.projects.push(project); return d; });
    return sendJSON(res, 200, updated.projects);
  }
  if (pathname.match(/^\/api\/projects\/[^/]+$/) && req.method === "PATCH") {
    const data = await loadData();
    if (!puedeProyectos(data)) return sendJSON(res, 403, { error: "No autorizado" });
    const id = pathname.split("/").pop();
    const body = await readBody(req);
    const updated = await persist((d) => { d.projects = d.projects.map((p) => (p.id === id ? { ...p, ...(body.name !== undefined ? { name: body.name } : {}), ...(body.fixed !== undefined ? { fixed: !!body.fixed } : {}) } : p)); return d; });
    return sendJSON(res, 200, updated.projects);
  }
  if (pathname.match(/^\/api\/projects\/[^/]+$/) && req.method === "DELETE") {
    const data = await loadData();
    if (!puedeProyectos(data)) return sendJSON(res, 403, { error: "No autorizado" });
    const id = pathname.split("/").pop();
    const target = data.projects.find((p) => p.id === id);
    if (target && target.fixed) return sendJSON(res, 400, { error: "Este proyecto es fijo — desmárcalo antes de borrarlo" });
    const updated = await persist((d) => { d.projects = d.projects.filter((p) => p.id !== id); return d; });
    return sendJSON(res, 200, updated.projects);
  }

  // ---- Familia "Auxiliares" (solo fábrica) ----
  const puedeAuxiliar = (data) => isAdmin(session) || data.responsablesAuxiliar.includes(session.userId);
  if (pathname === "/api/aux-tasks" && req.method === "POST") {
    const data = await loadData();
    if (!puedeAuxiliar(data)) return sendJSON(res, 403, { error: "No autorizado a crear trabajos auxiliares" });
    const body = await readBody(req);
    if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: "Nombre requerido" });
    const task = { id: uid(), name: body.name.trim(), fixed: !!body.fixed };
    const updated = await persist((d) => { d.auxTasks.push(task); return d; });
    return sendJSON(res, 200, updated.auxTasks);
  }
  if (pathname.match(/^\/api\/aux-tasks\/[^/]+$/) && req.method === "PATCH") {
    const data = await loadData();
    if (!puedeAuxiliar(data)) return sendJSON(res, 403, { error: "No autorizado" });
    const id = pathname.split("/").pop();
    const body = await readBody(req);
    const updated = await persist((d) => { d.auxTasks = d.auxTasks.map((t) => (t.id === id ? { ...t, ...(body.name !== undefined ? { name: body.name } : {}), ...(body.fixed !== undefined ? { fixed: !!body.fixed } : {}) } : t)); return d; });
    return sendJSON(res, 200, updated.auxTasks);
  }
  if (pathname.match(/^\/api\/aux-tasks\/[^/]+$/) && req.method === "DELETE") {
    const data = await loadData();
    if (!puedeAuxiliar(data)) return sendJSON(res, 403, { error: "No autorizado" });
    const id = pathname.split("/").pop();
    const target = data.auxTasks.find((t) => t.id === id);
    if (target && target.fixed) return sendJSON(res, 400, { error: "Este trabajo es fijo — desmárcalo antes de borrarlo" });
    const updated = await persist((d) => { d.auxTasks = d.auxTasks.filter((t) => t.id !== id); return d; });
    return sendJSON(res, 200, updated.auxTasks);
  }

  // ---- Usuarios (solo admin) ----
  if (pathname === "/api/users" && req.method === "GET") {
    if (!isAdmin(session)) return sendJSON(res, 403, { error: "Solo el administrador" });
    return sendJSON(res, 200, (await loadData()).users);
  }
  if (pathname === "/api/users" && req.method === "POST") {
    if (!isAdmin(session)) return sendJSON(res, 403, { error: "Solo el administrador" });
    const body = await readBody(req);
    if (!body.name || !body.name.trim()) return sendJSON(res, 400, { error: "Nombre requerido" });
    const role = ["oficina", "fabrica", "admin"].includes(body.role) ? body.role : "oficina";
    const user = { id: uid(), name: body.name.trim(), role, pin: String(body.pin || "1234") };
    const updated = await persist((d) => { d.users.push(user); return d; });
    return sendJSON(res, 200, updated.users);
  }
  if (pathname.match(/^\/api\/users\/[^/]+$/) && req.method === "PATCH") {
    if (!isAdmin(session)) return sendJSON(res, 403, { error: "Solo el administrador" });
    const id = pathname.split("/").pop();
    const body = await readBody(req);
    const updated = await persist((d) => { d.users = d.users.map((u) => (u.id === id ? { ...u, ...body, id: u.id } : u)); return d; });
    return sendJSON(res, 200, updated.users);
  }
  if (pathname.match(/^\/api\/users\/[^/]+$/) && req.method === "DELETE") {
    if (!isAdmin(session)) return sendJSON(res, 403, { error: "Solo el administrador" });
    const id = pathname.split("/").pop();
    if (id === "u_admin") return sendJSON(res, 400, { error: "No se puede borrar al administrador" });
    const updated = await persist((d) => {
      d.users = d.users.filter((u) => u.id !== id);
      d.responsablesProyecto = d.responsablesProyecto.filter((x) => x !== id);
      d.responsablesAuxiliar = d.responsablesAuxiliar.filter((x) => x !== id);
      return d;
    });
    return sendJSON(res, 200, updated.users);
  }
  if (pathname.match(/^\/api\/users\/[^/]+\/responsable-proyecto$/) && req.method === "PATCH") {
    if (!isAdmin(session)) return sendJSON(res, 403, { error: "Solo el administrador" });
    const id = pathname.split("/")[3];
    const updated = await persist((d) => { d.responsablesProyecto = d.responsablesProyecto.includes(id) ? d.responsablesProyecto.filter((x) => x !== id) : [...d.responsablesProyecto, id]; return d; });
    return sendJSON(res, 200, { responsablesProyecto: updated.responsablesProyecto });
  }
  if (pathname.match(/^\/api\/users\/[^/]+\/responsable-auxiliar$/) && req.method === "PATCH") {
    if (!isAdmin(session)) return sendJSON(res, 403, { error: "Solo el administrador" });
    const id = pathname.split("/")[3];
    const updated = await persist((d) => { d.responsablesAuxiliar = d.responsablesAuxiliar.includes(id) ? d.responsablesAuxiliar.filter((x) => x !== id) : [...d.responsablesAuxiliar, id]; return d; });
    return sendJSON(res, 200, { responsablesAuxiliar: updated.responsablesAuxiliar });
  }

  // ---- Fichajes ----
  if (pathname === "/api/fichajes" && req.method === "POST") {
    const data = await loadData();
    const me = data.users.find((u) => u.id === session.userId);
    const body = await readBody(req);
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const record = {
      id: uid(), userId: session.userId, userName: me ? me.name : "—",
      type: body.type === "salida" ? "salida" : "entrada",
      date: todayISO(), time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`,
      timestamp: now.toISOString(),
      lat: typeof body.lat === "number" ? body.lat : null,
      lng: typeof body.lng === "number" ? body.lng : null,
      accuracy: typeof body.accuracy === "number" ? body.accuracy : null,
      locationLabel: body.locationLabel || null,
    };
    await persist((d) => { d.fichajes.push(record); return d; });
    return sendJSON(res, 200, record);
  }
  if (pathname === "/api/fichajes" && req.method === "GET") {
    const data = await loadData();
    let rows = isAdmin(session) ? data.fichajes : data.fichajes.filter((f) => f.userId === session.userId);
    if (query.get("desde")) rows = rows.filter((f) => f.date >= query.get("desde"));
    if (query.get("hasta")) rows = rows.filter((f) => f.date <= query.get("hasta"));
    return sendJSON(res, 200, rows);
  }

  // ---- Imputaciones ----
  if (pathname === "/api/imputaciones" && req.method === "GET") {
    const data = await loadData();
    const date = query.get("date");
    let rows = data.imputaciones.filter((i) => i.userId === session.userId);
    if (date) rows = rows.filter((i) => i.date === date);
    else rows = rows.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);
    return sendJSON(res, 200, rows);
  }
  if (pathname === "/api/imputaciones/day" && req.method === "PUT") {
    const body = await readBody(req);
    if (!body.date) return sendJSON(res, 400, { error: "Fecha requerida" });
    const cap = dailyCap(body.date);
    const data = await loadData();
    const me = data.users.find((u) => u.id === session.userId);
    const entries = Array.isArray(body.entries) ? body.entries.filter((e) => e.projectId && parseFloat(e.hours) > 0) : [];
    const principal = entries.filter((e) => !e.excedente);
    const totalPrincipal = principal.reduce((s, e) => s + parseFloat(e.hours), 0);
    if (totalPrincipal > cap + 0.001) {
      return sendJSON(res, 400, { error: `Las horas de la jornada principal no pueden superar ${cap}h ese día. El resto va en "Horas excedentes".` });
    }
    const nuevas = entries.map((e) => ({
      id: uid(), userId: session.userId, userName: me ? me.name : "—", date: body.date,
      projectId: e.projectId, projectName: e.projectName || "—", hours: parseFloat(e.hours), excedente: !!e.excedente,
    }));
    await persist((d) => { d.imputaciones = d.imputaciones.filter((i) => !(i.userId === session.userId && i.date === body.date)); d.imputaciones.push(...nuevas); return d; });
    return sendJSON(res, 200, nuevas);
  }
  if (pathname === "/api/imputaciones/report" && req.method === "GET") {
    if (!isAdmin(session)) return sendJSON(res, 403, { error: "Solo el administrador" });
    const data = await loadData();
    let rows = data.imputaciones;
    if (query.get("desde")) rows = rows.filter((i) => i.date >= query.get("desde"));
    if (query.get("hasta")) rows = rows.filter((i) => i.date <= query.get("hasta"));
    return sendJSON(res, 200, rows);
  }

  // ---- Calendario ----
  if (pathname === "/api/events" && req.method === "GET") return sendJSON(res, 200, (await loadData()).events);
  if (pathname === "/api/events" && req.method === "POST") {
    if (!isAdmin(session)) return sendJSON(res, 403, { error: "Solo el administrador" });
    const body = await readBody(req);
    if (!body.date || !body.type) return sendJSON(res, 400, { error: "Fecha y tipo requeridos" });
    const ev = {
      id: uid(), date: body.date, type: body.type, title: body.title || "",
      time: body.time || null, description: body.description || "", location: body.location || "",
      invitados: body.invitados === "todos" || !Array.isArray(body.invitados) ? "todos" : body.invitados,
      alerta: body.alerta && typeof body.alerta === "object" ? { activa: !!body.alerta.activa, minutosAntes: Number(body.alerta.minutosAntes) || 60 } : { activa: false, minutosAntes: 60 },
      festivoScope: body.festivoScope || "nacional",
      festivoLugar: body.festivoLugar || "",
    };
    const updated = await persist((d) => { d.events.push(ev); return d; });
    return sendJSON(res, 200, updated.events);
  }
  if (pathname.match(/^\/api\/events\/[^/]+$/) && req.method === "DELETE") {
    if (!isAdmin(session)) return sendJSON(res, 403, { error: "Solo el administrador" });
    const id = pathname.split("/").pop();
    const updated = await persist((d) => { d.events = d.events.filter((e) => e.id !== id); return d; });
    return sendJSON(res, 200, updated.events);
  }

  return sendJSON(res, 404, { error: "Ruta no encontrada" });
}

// -----------------------------------------------------------------
// Servidor
// -----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  if (pathname.startsWith("/api/")) {
    try { await handleApi(req, res, pathname, url.searchParams); }
    catch (e) { console.error(e); sendJSON(res, 500, { error: "Error interno del servidor" }); }
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`ONKA escuchando en http://localhost:${PORT}`);
  if (USING_REDIS) {
    console.log(`Almacenamiento: Upstash (${REDIS_URL}) — token de ${REDIS_TOKEN.length} caracteres, empieza por "${REDIS_TOKEN.slice(0, 4)}..."`);
  } else {
    console.log("Almacenamiento: archivo local (data/data.json) — Upstash NO detectado. Revisa las variables de entorno UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN si esto es producción.");
  }
});
