const Database = require("better-sqlite3");

const paths = [
  "C:/Users/Chris/Downloads/SWAAT-ADMIN-AUTH-FIX/SWAATPROJECT/swaat.sqlite",
  "C:/Users/Chris/OneDrive/Documents/Daniel's Work Space/swaat-backend/swaat.sqlite",
  "C:/Users/Chris/OneDrive/Documents/Daniel's Work Space/SWAATPROJECT LIVE READY/swaat.sqlite",
  "C:/Users/Chris/OneDrive/Documents/Daniel's Work Space/SWAATPROJECT UDDATED VERSION/swaat.sqlite"
];

for (const path of paths) {
  let db;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all().map(row => row.name);

    const hasUsers = tables.includes("users");
    const columns = hasUsers
      ? db.prepare("PRAGMA table_info(users)").all().map(row => row.name)
      : [];

    const users = hasUsers
      ? db.prepare("SELECT COUNT(*) AS total FROM users").get().total
      : "No users table";

    const admins = hasUsers && columns.includes("is_admin")
      ? db.prepare("SELECT COUNT(*) AS total FROM users WHERE is_admin = 1").get().total
      : "No admin column";

    console.log("\nDATABASE:", path);
    console.log("TABLES:", tables);
    console.log("USERS:", users);
    console.log("ADMINS:", admins);
    console.log("USER COLUMNS:", columns);
  } catch (error) {
    console.log("\nDATABASE:", path);
    console.log("ERROR:", error.message);
  } finally {
    if (db) db.close();
  }
}
