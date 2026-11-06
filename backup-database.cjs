const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

async function main() {
  const source = "C:/Users/Chris/OneDrive/Documents/Daniel's Work Space/swaat-backend/swaat.sqlite";
  const backupDir = path.resolve("./backups");
  const backup = path.join(backupDir, "swaat-before-admin-fix.sqlite");

  fs.mkdirSync(backupDir, { recursive: true });

  if (fs.existsSync(backup)) {
    throw new Error("Backup already exists. Not overwriting it.");
  }

  const db = new Database(source, { readonly: true, fileMustExist: true });

  try {
    await db.backup(backup);
    console.log("Backup created:", backup);
  } finally {
    db.close();
  }

  const check = new Database(backup, { readonly: true });
  console.log("Backup user count:", check.prepare("SELECT COUNT(*) AS n FROM users").get().n);
  console.log("Administrator account found:", !!check.prepare(
    "SELECT id FROM users WHERE lower(email) = lower(?)"
  ).get("225129019@nust.na"));
  console.log("Backup integrity:", check.pragma("integrity_check", { simple: true }));
  check.close();
}

main().catch(error => {
  console.error("BACKUP ERROR:", error.message);
  process.exitCode = 1;
});
