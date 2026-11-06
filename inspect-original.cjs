const Database = require("better-sqlite3");

const db = new Database(
  "C:/Users/Chris/OneDrive/Documents/Daniel's Work Space/swaat-backend/swaat.sqlite",
  { readonly: true, fileMustExist: true }
);

try {
  console.log("\n--- ADMINISTRATOR ACCOUNT ---");

  console.table(
    db.prepare(
      "SELECT id, name, email, course, created_at FROM users"
    ).all()
  );

  console.log("\n--- UPLOAD TABLE STRUCTURE ---");

  console.table(
    db.prepare("PRAGMA table_info(uploads)").all()
  );

  console.log("\n--- UPLOAD RECORDS ---");

  console.table(
    db.prepare("SELECT * FROM uploads").all()
  );

} finally {
  db.close();
}
