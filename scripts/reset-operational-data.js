const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..");
const backupDir = process.env.FLEETDESK_BACKUP_DIR || path.join(root, "backups");

loadEnvFile(path.join(root, ".env"));

const { dbInfo, initDb, readDb, writeDb } = require("../database");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || "true"];
  })
);

const dryRun = args.has("dry-run");
const force = args.has("force");
const adminEmail = String(args.get("admin-email") || process.env.RESET_ADMIN_EMAIL || "").trim().toLowerCase();

async function main() {
  await initDb();
  const state = await readDb();
  const admins = (state.users || []).filter((user) => user.role === "admin");
  const adminToKeep = chooseAdmin(admins);

  const nextState = emptyOperationalState(state, adminToKeep);
  const backupPath = await writeBackup(state);

  if (!dryRun && !force) {
    throw new Error("Use --force para confirmar a limpeza. Um backup ja foi criado antes de parar.");
  }

  if (!dryRun) {
    await writeDb(nextState);
  }

  console.log(JSON.stringify({
    reset: !dryRun,
    dryRun,
    backupPath,
    keptUsers: nextState.users.map((user) => ({
      email: user.email,
      role: user.role
    })),
    removedCounts: removedCounts(state, nextState),
    database: await dbInfo()
  }, null, 2));
}

function chooseAdmin(admins) {
  if (admins.length === 0) {
    throw new Error("Nenhum usuario admin encontrado. Crie ou informe um admin antes de limpar.");
  }

  if (adminEmail) {
    const match = admins.find((user) => String(user.email || "").toLowerCase() === adminEmail);
    if (!match) {
      throw new Error(`Admin informado nao encontrado: ${adminEmail}`);
    }
    return match;
  }

  if (admins.length > 1) {
    const emails = admins.map((user) => user.email).filter(Boolean).join(", ");
    throw new Error(`Existe mais de um admin. Rode novamente com --admin-email=email@empresa.com. Admins encontrados: ${emails}`);
  }

  return admins[0];
}

function emptyOperationalState(state, adminUser) {
  return {
    ...state,
    users: [{ ...adminUser, role: "admin" }],
    vehicles: [],
    drivers: [],
    bookings: [],
    quickExits: [],
    fuel: [],
    maintenance: [],
    checklists: [],
    documents: [],
    auditLogs: [],
    sessions: []
  };
}

function removedCounts(before, after) {
  const collections = ["users", "vehicles", "drivers", "bookings", "quickExits", "fuel", "maintenance", "checklists", "documents", "auditLogs", "sessions"];
  return Object.fromEntries(collections.map((collection) => [
    collection,
    Math.max(0, (before[collection] || []).length - (after[collection] || []).length)
  ]));
}

async function writeBackup(state) {
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(backupDir, `am3-fleet-pre-producao-${stamp}.json`);
  await fs.writeFile(filePath, JSON.stringify({
    createdAt: new Date().toISOString(),
    app: "AM3 Fleet",
    reason: "Backup antes da limpeza para producao",
    database: await dbInfo(),
    data: state
  }, null, 2), "utf-8");
  return filePath;
}

function loadEnvFile(filePath) {
  if (!require("node:fs").existsSync(filePath)) return;

  const content = require("node:fs").readFileSync(filePath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...parts] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = parts.join("=").replace(/^"|"$/g, "");
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
