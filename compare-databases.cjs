const Database = require("better-sqlite3");

const paths = [
  "C:/Users/Chris/OneDrive/Documents/Daniel's Work Space/swaat-backend/swaat.sqlite",
  "C:/Users/Chris/OneDrive/Documents/Daniel's Work Space/SWAATPROJECT UDDATED VERSION/swaat.sqlite"
];

const adminEmail = "225129019@nust.na";

for (const path of paths) {
  const db = new Database(path, { readonly: true, fileMustExist: true });

  const columns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  const emailExists = !!db.prepare(
    "SELECT id FROM users WHERE lower(email) = lower(?)"
  ).get(adminEmail);

  const counts = {};
  for (const table of ["users", "timetable", "notes", "flashcards", "uploads", "partner_requests", "modules"]) {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
    }
  }

  console.log("\nDATABASE:", path);
  console.log("Configured admin account exists:", emailExists);
  console.log("Has admin column:", columns.includes("is_admin"));
  console.log("Record counts:", counts);

  db.close();
}
