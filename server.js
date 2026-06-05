const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { dbInfo, initDb, readDb, writeDb } = require("./database");

const root = __dirname;
const port = Number(process.env.PORT || 4174);
const host = process.env.FLEETDESK_HOST || process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const backupsDir = process.env.FLEETDESK_BACKUP_DIR || path.join(root, "backups");
const storageDriver = (process.env.STORAGE_DRIVER || "local").toLowerCase();
const supabaseStorageBucket = process.env.SUPABASE_STORAGE_BUCKET || "am3-fleet";
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || "";
const serverStartedAt = new Date().toISOString();
const sessions = new Map();
const eventClients = new Set();
const collections = new Set(["vehicles", "drivers", "bookings", "quickExits", "fuel", "maintenance", "checklists", "documents", "users"]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  try {
    setCors(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.url.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Erro interno do servidor." });
  }
});

startServer();

async function startServer() {
  await initDb();
  const info = await dbInfo();

  server.listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    console.log(`AM3 Fleet rodando em http://${displayHost}:${port}`);
    console.log(`Banco de dados (${info.type}): ${info.path || `${info.server}/${info.database}`}`);
  });
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && url.pathname === "/api/health") {
    const info = await dbInfo();
    sendJson(response, 200, {
      ok: true,
      app: "AM3 Fleet",
      startedAt: serverStartedAt,
      database: {
        type: info.type,
        mode: info.mode,
        server: info.server,
        database: info.database,
        records: info.records
      }
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(request);
    const db = await readDb();
    const user = db.users.find((item) => item.email.toLowerCase() === String(body.email || "").toLowerCase());

    if (!user || user.passwordHash !== hashPassword(body.password || "")) {
      sendJson(response, 401, { error: "E-mail ou senha inválidos." });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const session = {
      id: token,
      userId: user.id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
    db.sessions = db.sessions || [];
    db.sessions = db.sessions.filter((item) => new Date(item.expiresAt || 0) > new Date());
    db.sessions.push(session);
    await writeDb(db);
    sessions.set(token, { userId: user.id, createdAt: Date.now(), expiresAt: new Date(session.expiresAt).getTime() });
    sendJson(response, 200, { token, user: publicUser(user) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    const token = getToken(request);
    if (token) sessions.delete(token);
    if (token) {
      const db = await readDb();
      db.sessions = (db.sessions || []).filter((item) => item.id !== token);
      await writeDb(db);
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  const user = await requireAuth(request, response);
  if (!user) return;

  if (request.method === "GET" && url.pathname === "/api/me") {
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/data") {
    const db = await readDb();
    sendJson(response, 200, publicData(db, user));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    openEventStream(request, response, user);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/mobile/checkout") {
    const body = await readJson(request);
    const db = await readDb();
    const driver = userDriver(db, user);
    if (!driver) {
      sendJson(response, 400, { error: "Usuário sem motorista vinculado. Peça para a recepção vincular seu usuário a um motorista." });
      return;
    }

    const activeOwnExit = (db.quickExits || []).find((item) => item.driverId === driver.id && normalizeStatus(item.status) === "aberta");
    if (activeOwnExit) {
      sendJson(response, 409, { error: "Você já possui uma saída aberta. Marque a devolução antes de retirar outro veículo.", activeExit: mobileExitInfo(db, activeOwnExit) });
      return;
    }

    const vehicle = db.vehicles.find((item) => item.id === body.vehicleId);
    if (!vehicle) {
      sendJson(response, 404, { error: "Veículo não encontrado." });
      return;
    }

    const activeVehicleExit = (db.quickExits || []).find((item) => item.vehicleId === vehicle.id && normalizeStatus(item.status) === "aberta");
    if (activeVehicleExit) {
      sendJson(response, 409, {
        error: "Veículo já está em uso.",
        conflict: mobileExitInfo(db, activeVehicleExit)
      });
      return;
    }

    if (["manutencao", "inativo"].includes(normalizeStatus(vehicle.status))) {
      sendJson(response, 409, { error: `Veículo indisponível: ${vehicle.status}.` });
      return;
    }

    const record = normalizeRecord("quickExits", {
      vehicleId: vehicle.id,
      driverId: driver.id,
      departureAt: localDateTimeValue(),
      returnedAt: "",
      destination: body.destination || "Retirada pelo motorista",
      reason: body.reason || "Retirada pelo modo motorista",
      advanceAmount: 0,
      advancePurpose: "",
      fuelExpense: 0,
      foodExpense: 0,
      otherExpense: 0,
      returnedAmount: 0,
      receiptRef: "",
      notes: "Criada pelo modo motorista.",
      status: "Aberta"
    });

    db.quickExits = db.quickExits || [];
    db.quickExits.unshift(record);
    addAuditLog(db, user, "retirou", "quickExits", record.id, `${vehicle.plate} por ${driver.name}`);
    await writeDb(db);
    announceQuickExitCheckout(db, record, user).catch((error) => console.error("Falha ao anunciar retirada no Discord:", error.message));
    notifyDataChanged("quickExits", "checkout", record.id);
    sendJson(response, 201, { quickExit: record });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/mobile/return") {
    const body = await readJson(request);
    const db = await readDb();
    const driver = userDriver(db, user);
    if (!driver) {
      sendJson(response, 400, { error: "Usuário sem motorista vinculado." });
      return;
    }

    const exit = (db.quickExits || []).find((item) => item.id === body.quickExitId && item.driverId === driver.id && normalizeStatus(item.status) === "aberta");
    if (!exit) {
      sendJson(response, 404, { error: "Saída aberta não encontrada para este motorista." });
      return;
    }

    exit.returnedAt = localDateTimeValue();
    exit.status = "Aguardando conferência";
    exit.returnLatitude = normalizeOptionalNumber(body.returnLatitude);
    exit.returnLongitude = normalizeOptionalNumber(body.returnLongitude);
    exit.returnAccuracy = normalizeOptionalNumber(body.returnAccuracy);
    exit.returnLocationAt = body.returnLocationAt || "";
    exit.notes = [exit.notes, body.notes || "Devolução registrada pelo modo motorista."].filter(Boolean).join(" ");
    addAuditLog(db, user, "devolveu", "quickExits", exit.id, summarizeRecord("quickExits", exit));
    await writeDb(db);
    notifyDataChanged("quickExits", "return", exit.id);
    sendJson(response, 200, { quickExit: exit });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/files/")) {
    await serveStoredFile(request, response, url.pathname.slice("/api/files/".length));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/system/status") {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "Apenas administradores podem ver o status do sistema." });
      return;
    }
    sendJson(response, 200, await systemStatus());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/system/backup") {
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "Apenas administradores podem gerar backup." });
      return;
    }

    const db = await readDb();
    addAuditLog(db, user, "gerou backup", "sistema", "backup", "Backup manual gerado");
    await writeDb(db);
    notifyDataChanged("system", "backup", "backup");
    const backup = await createJsonBackup(db);
    sendJson(response, 201, backup);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/upload") {
    const upload = (request.headers["content-type"] || "").includes("application/json")
      ? await readJsonUpload(request)
      : await readUpload(request);
    if (!upload) {
      sendJson(response, 400, { error: "Nenhum arquivo enviado." });
      return;
    }

    const safeName = safeFileName(upload.filename);
    const storedName = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}-${safeName}`;
    const storedFile = await storeUpload(storedName, upload);
    sendJson(response, 201, {
      fileName: safeName,
      url: storedFile.url,
      storage: storedFile.storage
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reset") {
    const fresh = await readDemoDb();
    addAuditLog(fresh, user, "restaurou", "sistema", "demo", "Restaurou dados de demonstração");
    await writeDb(fresh);
    notifyDataChanged("system", "reset", "demo");
    sendJson(response, 200, publicData(fresh, user));
    return;
  }

  if (parts.length === 2 && parts[0] === "api" && collections.has(parts[1]) && request.method === "POST") {
    const collection = parts[1];
    if (user.role === "motorista") {
      sendJson(response, 403, { error: "Use o Modo motorista para registrar retirada e devolução." });
      return;
    }
    if (collection === "users" && user.role !== "admin") {
      sendJson(response, 403, { error: "Apenas administradores podem gerenciar usuários." });
      return;
    }
    const body = await readJson(request);
    const db = await readDb();
    const record = normalizeRecord(collection, body);
    db[collection].unshift(record);
    applySideEffects(db, collection, record);
    addAuditLog(db, user, "criou", collection, record.id, summarizeRecord(collection, record));
    await writeDb(db);
    if (collection === "quickExits" && normalizeStatus(record.status) === "aberta") {
      announceQuickExitCheckout(db, record, user).catch((error) => console.error("Falha ao anunciar retirada no Discord:", error.message));
    }
    notifyDataChanged(collection, "create", record.id);
    sendJson(response, 201, record);
    return;
  }

  if (parts.length === 3 && parts[0] === "api" && collections.has(parts[1]) && request.method === "PUT") {
    const collection = parts[1];
    if (user.role === "motorista") {
      sendJson(response, 403, { error: "Use o Modo motorista para registrar retirada e devolução." });
      return;
    }
    if (collection === "users" && user.role !== "admin") {
      sendJson(response, 403, { error: "Apenas administradores podem gerenciar usuários." });
      return;
    }
    const id = parts[2];
    const body = await readJson(request);
    const db = await readDb();
    const index = db[collection].findIndex((item) => item.id === id);
    if (index === -1) {
      sendJson(response, 404, { error: "Registro não encontrado." });
      return;
    }
    const updated = normalizeRecord(collection, { ...db[collection][index], ...body, id }, true);
    db[collection][index] = updated;
    applySideEffects(db, collection, updated);
    addAuditLog(db, user, "editou", collection, updated.id, summarizeRecord(collection, updated));
    await writeDb(db);
    notifyDataChanged(collection, "update", updated.id);
    sendJson(response, 200, collection === "users" ? publicUser(updated) : updated);
    return;
  }

  if (parts.length === 3 && parts[0] === "api" && collections.has(parts[1]) && request.method === "DELETE") {
    const collection = parts[1];
    if (user.role !== "admin") {
      sendJson(response, 403, { error: "Apenas administradores podem remover registros." });
      return;
    }
    const id = parts[2];
    if (collection === "users" && id === user.id) {
      sendJson(response, 400, { error: "Você não pode remover seu próprio usuário." });
      return;
    }
    const db = await readDb();
    const removed = db[collection].find((item) => item.id === id);
    db[collection] = db[collection].filter((item) => item.id !== id);
    cascadeDelete(db, collection, id);
    addAuditLog(db, user, "removeu", collection, id, summarizeRecord(collection, removed || { id }));
    await writeDb(db);
    notifyDataChanged(collection, "delete", id);
    sendJson(response, 200, publicData(db, user));
    return;
  }

  sendJson(response, 404, { error: "Rota não encontrada." });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const cleanPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(root, cleanPath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Acesso negado.");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Arquivo não encontrado.");
  }
}

async function systemStatus() {
  const info = await dbInfo();
  const lastBackup = await latestBackupInfo();
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf-8"));

  return {
    app: {
      name: "AM3 Fleet",
      version: pkg.version || "0.0.0",
      startedAt: serverStartedAt,
      port,
      host
    },
    database: info,
    backup: {
      directory: backupsDir,
      last: lastBackup
    },
    storage: {
      driver: storageDriver,
      bucket: storageDriver === "supabase" ? supabaseStorageBucket : null
    },
    serverTime: new Date().toISOString()
  };
}

async function storeUpload(storedName, upload) {
  if (storageDriver === "supabase") {
    const objectPath = `receipts/${new Date().toISOString().slice(0, 10)}/${storedName}`;
    await uploadToSupabaseStorage(objectPath, upload);
    return {
      storage: "supabase",
      url: `/api/files/${encodeURIComponent(objectPath)}`
    };
  }

  const uploadsDir = path.join(root, "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });
  const target = path.join(uploadsDir, storedName);
  await fs.writeFile(target, upload.content);
  return {
    storage: "local",
    url: `/uploads/${storedName}`
  };
}

async function serveStoredFile(request, response, encodedPath) {
  const objectPath = decodeURIComponent(encodedPath || "");
  if (!objectPath || objectPath.includes("..")) {
    sendJson(response, 400, { error: "Arquivo inválido." });
    return;
  }

  if (storageDriver === "supabase") {
    await serveSupabaseStorageFile(response, objectPath);
    return;
  }

  const localName = objectPath.startsWith("uploads/") ? objectPath.slice("uploads/".length) : path.basename(objectPath);
  const filePath = path.normalize(path.join(root, "uploads", localName));
  const uploadsRoot = path.join(root, "uploads");
  if (!filePath.startsWith(uploadsRoot)) {
    sendJson(response, 403, { error: "Acesso negado." });
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    response.end(file);
  } catch {
    sendJson(response, 404, { error: "Arquivo não encontrado." });
  }
}

async function uploadToSupabaseStorage(objectPath, upload) {
  const storageConfig = supabaseStorageConfig();
  const response = await fetch(`${storageConfig.url}/storage/v1/object/${storageConfig.bucket}/${encodeObjectPath(objectPath)}`, {
    method: "POST",
    headers: {
      apikey: storageConfig.key,
      Authorization: `Bearer ${storageConfig.key}`,
      "Content-Type": upload.contentType || "application/octet-stream",
      "x-upsert": "false"
    },
    body: upload.content
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Falha ao enviar arquivo para o Supabase Storage. ${details}`.trim());
  }
}

async function serveSupabaseStorageFile(response, objectPath) {
  const storageConfig = supabaseStorageConfig();
  const storageResponse = await fetch(`${storageConfig.url}/storage/v1/object/${storageConfig.bucket}/${encodeObjectPath(objectPath)}`, {
    headers: {
      apikey: storageConfig.key,
      Authorization: `Bearer ${storageConfig.key}`
    }
  });

  if (!storageResponse.ok) {
    sendJson(response, storageResponse.status === 404 ? 404 : 502, { error: "Arquivo não encontrado no Storage." });
    return;
  }

  const contentType = storageResponse.headers.get("content-type") || "application/octet-stream";
  const fileName = objectPath.split("/").pop() || "arquivo";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`
  });
  response.end(Buffer.from(await storageResponse.arrayBuffer()));
}

function supabaseStorageConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_STORAGE_KEY || "";
  if (!url || !key) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para usar Supabase Storage.");
  }

  return {
    url,
    key,
    bucket: supabaseStorageBucket
  };
}

function encodeObjectPath(objectPath) {
  return String(objectPath).split("/").map(encodeURIComponent).join("/");
}

async function createJsonBackup(db) {
  await fs.mkdir(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `am3-fleet-backup-${stamp}.json`;
  const filePath = path.join(backupsDir, fileName);
  const payload = {
    createdAt: new Date().toISOString(),
    app: "AM3 Fleet",
    version: JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf-8")).version || "",
    database: await dbInfo(),
    data: { ...db, sessions: [] }
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  const stat = await fs.stat(filePath);
  return {
    fileName,
    path: filePath,
    size: stat.size,
    createdAt: stat.mtime.toISOString()
  };
}

async function latestBackupInfo() {
  try {
    const entries = await fs.readdir(backupsDir, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const filePath = path.join(backupsDir, entry.name);
        const stat = await fs.stat(filePath);
        return {
          fileName: entry.name,
          path: filePath,
          size: stat.size,
          createdAt: stat.mtime.toISOString()
        };
      }));

    return files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  } catch {
    return null;
  }
}

async function requireAuth(request, response) {
  const token = getToken(request);
  const session = token ? await findSession(token) : undefined;

  if (!session) {
    sendJson(response, 401, { error: "Sessão expirada. Faça login novamente." });
    return null;
  }

  const db = await readDb();
  const user = db.users.find((item) => item.id === session.userId);
  if (!user) {
    sendJson(response, 401, { error: "Usuário não encontrado." });
    return null;
  }

  return user;
}

async function findSession(token) {
  const memorySession = sessions.get(token);
  if (memorySession && (!memorySession.expiresAt || memorySession.expiresAt > Date.now())) return memorySession;
  if (memorySession) sessions.delete(token);

  const db = await readDb();
  const persisted = (db.sessions || []).find((item) => item.id === token);
  if (!persisted) return null;

  const expiresAt = new Date(persisted.expiresAt || 0).getTime();
  if (!expiresAt || expiresAt <= Date.now()) {
    db.sessions = (db.sessions || []).filter((item) => item.id !== token);
    await writeDb(db);
    return null;
  }

  const session = { userId: persisted.userId, createdAt: new Date(persisted.createdAt || Date.now()).getTime(), expiresAt };
  sessions.set(token, session);
  return session;
}

function openEventStream(request, response, user) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ ok: true, userId: user.id })}\n\n`);

  const client = { response };
  eventClients.add(client);
  const keepAlive = setInterval(() => {
    response.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 25000);

  request.on("close", () => {
    clearInterval(keepAlive);
    eventClients.delete(client);
  });
}

function notifyDataChanged(collection, action, id) {
  const payload = JSON.stringify({
    collection,
    action,
    id,
    at: new Date().toISOString()
  });

  for (const client of eventClients) {
    try {
      client.response.write(`event: data-changed\ndata: ${payload}\n\n`);
    } catch {
      eventClients.delete(client);
    }
  }
}

async function announceQuickExitCheckout(db, quickExit, user) {
  if (!discordWebhookUrl) return;

  const vehicle = (db.vehicles || []).find((item) => item.id === quickExit.vehicleId);
  const driver = (db.drivers || []).find((item) => item.id === quickExit.driverId);
  const vehicleText = vehicle ? `${vehicle.plate} - ${vehicle.model}` : quickExit.vehicleId || "Veículo não informado";
  const driverText = driver?.name || quickExit.driverId || "Motorista não informado";
  const destination = quickExit.destination || "Destino não informado";
  const departure = formatDiscordDateTime(quickExit.departureAt || localDateTimeValue());
  const createdBy = user?.name || user?.email || "AM3 Fleet";
  const payload = {
    username: "AM3 Fleet",
    content: [
      "**Saída de veículo registrada**",
      `Motorista: ${driverText}`,
      `Veículo: ${vehicleText}`,
      `Destino: ${destination}`,
      `Saída: ${departure}`,
      `Registrado por: ${createdBy}`
    ].join("\n"),
    allowed_mentions: { parse: [] }
  };

  await postDiscordWebhook(payload);
}

async function postDiscordWebhook(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(discordWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${text ? ` - ${text.slice(0, 160)}` : ""}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function formatDiscordDateTime(value) {
  if (!value) return "";
  const localMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (localMatch) {
    const [, year, month, day, hour, minute] = localMatch;
    return `${day}/${month}/${year}, ${hour}:${minute}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ");
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: process.env.APP_TIME_ZONE || "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getToken(request) {
  const header = request.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  const url = new URL(request.url, `http://${request.headers.host}`);
  return url.searchParams.get("token") || "";
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function readUpload(request) {
  const contentType = request.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) return null;

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 15 * 1024 * 1024) {
      throw new Error("Arquivo maior que 15 MB.");
    }
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks);
  const marker = Buffer.from(`--${boundary}`);
  const partStart = body.indexOf(marker);
  if (partStart === -1) return null;

  const headerStart = partStart + marker.length + 2;
  const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
  if (headerEnd === -1) return null;

  const header = body.slice(headerStart, headerEnd).toString("utf8");
  const filename = header.match(/filename="([^"]*)"/)?.[1] || header.match(/filename\*=UTF-8''([^;\r\n]*)/)?.[1];
  if (!filename) return null;

  const nextBoundary = body.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd + 4);
  if (nextBoundary === -1) return null;

  return {
    filename: decodeURIComponent(filename),
    content: body.slice(headerEnd + 4, nextBoundary),
    contentType: header.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "application/octet-stream"
  };
}

async function readJsonUpload(request) {
  const body = await readJson(request);
  if (!body.fileName || !body.contentBase64) return null;

  return {
    filename: body.fileName,
    content: Buffer.from(String(body.contentBase64), "base64"),
    contentType: body.contentType || "application/octet-stream"
  };
}

function safeFileName(value) {
  return path.basename(String(value || "arquivo"))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "arquivo";
}

async function readDemoDb() {
  const db = await readDb();
  return {
    users: db.users,
    vehicles: [
      { id: "v1", plate: "RTA4C21", model: "Fiat Strada Endurance", year: 2023, odometer: 38200, status: "Disponível", costCenter: "Operações" },
      { id: "v2", plate: "BHZ8F10", model: "Renault Master", year: 2021, odometer: 91450, status: "Em uso", costCenter: "Logística" },
      { id: "v3", plate: "KLM2A87", model: "Toyota Corolla", year: 2022, odometer: 50620, status: "Manutenção", costCenter: "Comercial" }
    ],
    drivers: [
      { id: "d1", name: "Carlos Henrique", phone: "(11) 98888-1122", license: "04938291011", licenseDue: "2026-09-18", status: "Ativo", department: "Operações" },
      { id: "d2", name: "Mariana Lopes", phone: "(11) 97777-3344", license: "06381927455", licenseDue: "2026-06-22", status: "Ativo", department: "Comercial" },
      { id: "d3", name: "Rafael Souza", phone: "(11) 96666-7788", license: "05817264090", licenseDue: "2026-05-30", status: "Ativo", department: "Logística" }
    ],
    bookings: [
      { id: "b1", vehicleId: "v2", driverId: "d3", start: "2026-05-25T08:30", end: "2026-05-25T12:00", destination: "Cliente Zona Leste", purpose: "Entrega técnica" },
      { id: "b2", vehicleId: "v1", driverId: "d1", start: "2026-05-26T09:00", end: "2026-05-26T17:30", destination: "Filial Campinas", purpose: "Coleta de materiais" }
    ],
    fuel: [
      { id: "f1", vehicleId: "v1", date: "2026-05-20", liters: 42.8, total: 259.94, odometer: 37980, station: "Auto Posto Central" },
      { id: "f2", vehicleId: "v2", date: "2026-05-21", liters: 68.2, total: 421.48, odometer: 91210, station: "Rede Avenida" },
      { id: "f3", vehicleId: "v1", date: "2026-05-24", liters: 38.4, total: 232.32, odometer: 38200, station: "Auto Posto Central" }
    ],
    maintenance: [
      { id: "m1", vehicleId: "v3", type: "Corretiva", date: "2026-05-24", cost: 1460, status: "Aberta", nextDue: "2026-06-10", description: "Diagnóstico de suspensão e alinhamento" },
      { id: "m2", vehicleId: "v1", type: "Preventiva", date: "2026-05-12", cost: 720, status: "Concluída", nextDue: "2026-08-12", description: "Troca de óleo e filtros" }
    ],
    checklists: [
      { id: "c1", vehicleId: "v2", driverId: "d3", type: "Retirada", date: "2026-05-25T08:20", odometer: 91210, fuelLevel: "3/4", tires: true, lights: true, documents: true, cleanliness: true, notes: "Sem avarias aparentes.", status: "Concluído" }
    ],
    documents: [
      { id: "doc1", ownerType: "vehicle", ownerId: "v1", type: "CRLV", name: "CRLV RTA4C21", dueDate: "2026-12-31", fileRef: "Arquivo físico", notes: "Documento no financeiro." },
      { id: "doc2", ownerType: "driver", ownerId: "d3", type: "CNH", name: "CNH Rafael Souza", dueDate: "2026-05-30", fileRef: "Digitalizado", notes: "Renovação pendente." }
    ]
  };
}

function normalizeRecord(collection, body, keepId = false) {
  const prefix = collection[0];
  const record = { ...body, id: keepId && body.id ? body.id : uid(prefix) };

  if (collection === "vehicles") {
    record.plate = String(record.plate || "").toUpperCase();
    record.year = Number(record.year);
    record.odometer = record.odometer === null || record.odometer === "" || record.odometer === undefined ? 0 : Number(record.odometer);
  }

  if (collection === "fuel") {
    record.liters = Number(record.liters);
    record.total = Number(record.total);
    record.odometer = record.odometer === null || record.odometer === "" || record.odometer === undefined ? null : Number(record.odometer);
    record.station = String(record.station || "");
  }

  if (collection === "maintenance") {
    record.cost = Number(record.cost);
  }

  if (collection === "checklists") {
    record.odometer = record.odometer === null || record.odometer === "" || record.odometer === undefined ? 0 : Number(record.odometer);
    record.tires = Boolean(record.tires);
    record.lights = Boolean(record.lights);
    record.documents = Boolean(record.documents);
    record.cleanliness = Boolean(record.cleanliness);
  }

  if (collection === "quickExits") {
    record.advanceAmount = record.advanceAmount === null || record.advanceAmount === "" || record.advanceAmount === undefined ? 0 : Number(record.advanceAmount);
    record.fuelExpense = record.fuelExpense === null || record.fuelExpense === "" || record.fuelExpense === undefined ? 0 : Number(record.fuelExpense);
    record.foodExpense = record.foodExpense === null || record.foodExpense === "" || record.foodExpense === undefined ? 0 : Number(record.foodExpense);
    record.otherExpense = record.otherExpense === null || record.otherExpense === "" || record.otherExpense === undefined ? 0 : Number(record.otherExpense);
    record.spentAmount = record.fuelExpense + record.foodExpense + record.otherExpense;
    record.returnedAmount = record.returnedAmount === null || record.returnedAmount === "" || record.returnedAmount === undefined ? 0 : Number(record.returnedAmount);
    record.odometerOut = record.odometerOut === null || record.odometerOut === "" || record.odometerOut === undefined ? null : Number(record.odometerOut);
    record.odometerIn = record.odometerIn === null || record.odometerIn === "" || record.odometerIn === undefined ? null : Number(record.odometerIn);
    record.returnedAt = record.returnedAt || "";
    record.returnLatitude = normalizeOptionalNumber(record.returnLatitude);
    record.returnLongitude = normalizeOptionalNumber(record.returnLongitude);
    record.returnAccuracy = normalizeOptionalNumber(record.returnAccuracy);
    record.returnLocationAt = String(record.returnLocationAt || "");
    record.receiptRef = String(record.receiptRef || "");
    record.notes = String(record.notes || "");
  }

  if (collection === "users") {
    record.email = String(record.email || "").toLowerCase();
    record.driverId = String(record.driverId || "");
    if (record.password) {
      record.passwordHash = hashPassword(record.password);
      delete record.password;
    }
    if (!record.passwordHash) record.passwordHash = hashPassword("123456");
  }

  if (collection === "documents") {
    record.ownerType = String(record.ownerType || "vehicle");
    record.ownerId = String(record.ownerId || "");
    record.type = String(record.type || "");
    record.name = String(record.name || "");
    record.fileRef = String(record.fileRef || "");
    record.notes = String(record.notes || "");
  }

  return record;
}

function applySideEffects(db, collection, record) {
  return;
}

function cascadeDelete(db, collection, id) {
  if (collection === "vehicles") {
    db.bookings = db.bookings.filter((item) => item.vehicleId !== id);
    db.quickExits = (db.quickExits || []).filter((item) => item.vehicleId !== id);
    db.fuel = db.fuel.filter((item) => item.vehicleId !== id);
    db.maintenance = db.maintenance.filter((item) => item.vehicleId !== id);
  }

  if (collection === "drivers") {
    db.bookings = db.bookings.filter((item) => item.driverId !== id);
    db.quickExits = (db.quickExits || []).filter((item) => item.driverId !== id);
  }
}

function addAuditLog(db, user, action, entity, recordId, summary) {
  if (!db.auditLogs) db.auditLogs = [];
  db.auditLogs.unshift({
    id: uid("a"),
    userId: user?.id || null,
    userEmail: user?.email || null,
    action,
    entity,
    recordId,
    summary,
    createdAt: new Date().toISOString()
  });
}

function summarizeRecord(collection, record) {
  if (!record) return "";
  if (collection === "vehicles") return `${record.plate || ""} ${record.model || ""}`.trim();
  if (collection === "drivers") return record.name || record.id;
  if (collection === "bookings") return `${record.destination || ""} ${record.start || ""}`.trim();
  if (collection === "quickExits") return `${record.destination || ""} ${record.departureAt || ""}`.trim();
  if (collection === "fuel") return `${record.date || ""} ${record.total || ""}`.trim();
  if (collection === "maintenance") return `${record.type || ""} ${record.description || ""}`.trim();
  if (collection === "checklists") return `${record.type || ""} ${record.date || ""}`.trim();
  if (collection === "documents") return `${record.type || ""} ${record.name || ""}`.trim();
  if (collection === "users") return record.email || record.id;
  return record.id || "";
}

function publicData(db, user) {
  const payload = {
    vehicles: db.vehicles,
    drivers: db.drivers,
    bookings: db.bookings,
    quickExits: db.quickExits || [],
    fuel: db.fuel,
    maintenance: db.maintenance,
    checklists: db.checklists || [],
    documents: db.documents || []
  };

  if (user && user.role === "admin") {
    payload.users = db.users.map(publicUser);
    payload.auditLogs = db.auditLogs || [];
  }

  return payload;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    driverId: user.driverId || ""
  };
}

function userDriver(db, user) {
  if (user.driverId) {
    const linked = db.drivers.find((driver) => driver.id === user.driverId);
    if (linked) return linked;
  }

  const normalizedUserName = normalizeText(user.name);
  return db.drivers.find((driver) => normalizeText(driver.name) === normalizedUserName) || null;
}

function mobileExitInfo(db, exit) {
  const driver = db.drivers.find((item) => item.id === exit.driverId);
  const vehicle = db.vehicles.find((item) => item.id === exit.vehicleId);
  return {
    id: exit.id,
    vehicle: vehicle ? `${vehicle.plate} - ${vehicle.model}` : exit.vehicleId,
    driver: driver?.name || exit.driverId,
    phone: driver?.phone || "",
    departureAt: exit.departureAt || "",
    destination: exit.destination || "",
    status: exit.status || ""
  };
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeStatus(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function normalizeOptionalNumber(value) {
  if (value === null || value === "" || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function localDateTimeValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIME_ZONE || "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
  });
  response.end(JSON.stringify(payload));
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
}
