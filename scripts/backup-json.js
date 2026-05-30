const fs = require("node:fs/promises");
const path = require("node:path");
const { dbInfo, initDb, readDb } = require("../database");

const backupDir = process.env.FLEETDESK_BACKUP_DIR || path.join(__dirname, "..", "backups");

async function main() {
  await initDb();
  const state = await readDb();
  await fs.mkdir(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `am3-fleet-backup-${stamp}.json`;
  const filePath = path.join(backupDir, fileName);
  const payload = {
    createdAt: new Date().toISOString(),
    app: "AM3 Fleet",
    database: await dbInfo(),
    data: state
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(filePath);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
