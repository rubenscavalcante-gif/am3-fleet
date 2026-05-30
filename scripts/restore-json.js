const fs = require("node:fs");
const path = require("node:path");
const { initDb, writeDb, dbInfo } = require("../database");

const restorePath = process.argv[2];

if (!restorePath) {
  console.error("Uso: node scripts/restore-json.js caminho-do-backup.json");
  process.exit(1);
}

async function main() {
  const fullPath = path.resolve(restorePath);
  const payload = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  const state = payload.data || payload;

  await initDb();
  await writeDb(state);

  console.log(JSON.stringify({
    restored: true,
    database: await dbInfo()
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
