require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "";
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const DATABASE_PATH = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, "swaat.sqlite"));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "uploads"));

if (JWT_SECRET.length < 32) {
  console.error("Set JWT_SECRET in the hosting environment (at least 32 characters).");
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error("PORT must be a valid TCP port number.");
  process.exit(1);
}

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (process.env.NODE_ENV === "production" && req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

const db = new Database(DATABASE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = FULL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  course TEXT NOT NULL DEFAULT 'Student',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL CHECK(day IN ('Monday','Tuesday','Wednesday','Thursday','Friday')),
  name TEXT NOT NULL, lecturer TEXT NOT NULL, time TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'purple',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS flashcards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL, answer TEXT NOT NULL,
  mastered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL, size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS partner_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(from_user_id, to_user_id),
  CHECK(from_user_id != to_user_id)
);
CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL, name TEXT NOT NULL, programme TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, code)
);
`);
try { db.exec("ALTER TABLE notes ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"); } catch {}
try { db.exec("ALTER TABLE partner_requests ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"); } catch {}
if (ADMIN_EMAIL) {
  const promote = db.prepare("UPDATE users SET is_admin = CASE WHEN email = ? THEN 1 ELSE 0 END").run(ADMIN_EMAIL);
  if (promote.changes) console.log(`Administrator role synchronized for ${ADMIN_EMAIL}`);
}

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const defaultCards = [
  ["What is Big O notation?", "Big O notation describes how an algorithm's time or space requirements grow as the input size increases."],
  ["Define the Second Law of Thermodynamics", "The entropy of an isolated system tends to increase over time."],
  ["What is a derivative?", "A derivative represents the rate at which a function changes with respect to its input."],
  ["What does RAM stand for?", "RAM stands for Random Access Memory."]
];

function seedUserData(userId) {
  const tx = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM flashcards WHERE user_id = ? LIMIT 1").get(userId)) {
      const insert = db.prepare("INSERT INTO flashcards (user_id, question, answer, mastered) VALUES (?, ?, ?, ?)");
      defaultCards.forEach((card, i) => insert.run(userId, card[0], card[1], i === 2 ? 1 : 0));
    }
  });
  tx();
}
function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, course: user.course, isAdmin: user.is_admin === 1 || user.isAdmin === true };
}
function makeToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "7d", issuer: "swaat" });
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please sign in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { issuer: "swaat" });
    const user = db.prepare("SELECT id, name, email, course, is_admin FROM users WHERE id = ?").get(payload.sub);
    if (!user) return res.status(401).json({ error: "Account not found." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}
function adminAuth(req, res, next) {
  auth(req, res, () => {
    const account = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    if (!account || account.is_admin !== 1) return res.status(403).json({ error: "Administrator access is required." });
    next();
  });
}

function idParam(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
const authAttempts = new Map();
function authRateLimit(req, res, next) {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const recent = (authAttempts.get(key) || []).filter(t => now - t < 15 * 60 * 1000);
  if (authAttempts.size > 5000) authAttempts.clear();
  if (recent.length >= 12) return res.status(429).json({ error: "Too many attempts. Please wait and try again." });
  recent.push(now);
  authAttempts.set(key, recent);
  next();
}

app.get("/api/health", (req, res) => res.json({ status: "ok", app: "SWAAT API" }));

// Administrator API. Every endpoint is protected on the server, not just hidden in the UI.
app.get("/api/admin/overview", adminAuth, (req, res) => {
  const totalStudents = db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 0").get().count;
  const totalAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1").get().count;
  const newThisWeek = db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 0 AND datetime(created_at) >= datetime('now','-7 days')").get().count;
  const courses = db.prepare("SELECT COALESCE(NULLIF(TRIM(course),''),'Unspecified') AS course, COUNT(*) AS count FROM users WHERE is_admin = 0 GROUP BY COALESCE(NULLIF(TRIM(course),''),'Unspecified') ORDER BY count DESC, course COLLATE NOCASE").all();
  const recent = db.prepare("SELECT id,name,email,course,created_at AS createdAt FROM users WHERE is_admin = 0 ORDER BY datetime(created_at) DESC,id DESC LIMIT 6").all();
  res.json({ stats: { totalStudents, totalAdmins, newThisWeek }, courses, recent });
});

app.get("/api/admin/students", adminAuth, (req, res) => {
  const q = cleanText(req.query.q, 100);
  const course = cleanText(req.query.course, 80);
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 10));
  const where = ["is_admin = 0"];
  const args = [];
  if (q) {
    where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')");
    const escaped = q.replace(/[\\%_]/g, ch => "\\" + ch);
    args.push(`%${escaped}%`, `%${escaped}%`);
  }
  if (course) { where.push("course = ?"); args.push(course); }
  const whereSql = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE ${whereSql}`).get(...args).count;
  const students = db.prepare(`SELECT id,name,email,course,created_at AS createdAt FROM users WHERE ${whereSql} ORDER BY datetime(created_at) DESC,id DESC LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit);
  const courses = db.prepare("SELECT DISTINCT COALESCE(NULLIF(TRIM(course),''),'Unspecified') AS course FROM users WHERE is_admin = 0 ORDER BY course COLLATE NOCASE").all().map(row => row.course);
  res.json({ students, courses, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit });
});

app.get("/api/admin/students/:id", adminAuth, (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid student ID." });
  const student = db.prepare("SELECT id,name,email,course,created_at AS createdAt FROM users WHERE id = ? AND is_admin = 0").get(id);
  if (!student) return res.status(404).json({ error: "Student not found." });
  student.moduleCount = db.prepare("SELECT COUNT(*) AS count FROM modules WHERE user_id = ?").get(id).count;
  student.noteCount = db.prepare("SELECT COUNT(*) AS count FROM notes WHERE user_id = ?").get(id).count;
  student.flashcardCount = db.prepare("SELECT COUNT(*) AS count FROM flashcards WHERE user_id = ?").get(id).count;
  student.uploadCount = db.prepare("SELECT COUNT(*) AS count FROM uploads WHERE user_id = ?").get(id).count;
  res.json({ student });
});

app.post("/api/auth/register", authRateLimit, (req, res) => {
  const name = cleanText(req.body.name, 100);
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const course = cleanText(req.body.course || "Student", 80) || "Student";
  if (name.length < 2) return res.status(400).json({ error: "Enter your full name (at least 2 characters)." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Password must contain 8 to 128 characters." });
  try {
    const create = db.transaction(() => {
      const hash = bcrypt.hashSync(password, 12);
      const isAdmin = ADMIN_EMAIL && email === ADMIN_EMAIL ? 1 : 0;
      const result = db.prepare("INSERT INTO users (name,email,password_hash,course,is_admin) VALUES (?,?,?,?,?)").run(name,email,hash,course,isAdmin);
      seedUserData(result.lastInsertRowid);
      return db.prepare("SELECT id,name,email,course,is_admin FROM users WHERE id = ?").get(result.lastInsertRowid);
    });
    const user = create();
    res.status(201).json({ token: makeToken(user), user: safeUser(user) });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "An account with that email already exists." });
    console.error(error);
    res.status(500).json({ error: "Could not create your account." });
  }
});
app.post("/api/auth/login", authRateLimit, (req, res) => {
  const email = cleanText(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: "Incorrect email or password." });

  // Promote only after the configured account proves ownership with its password.
  if (ADMIN_EMAIL && email === ADMIN_EMAIL) {
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(user.id);
    user.is_admin = 1;
  }

  seedUserData(user.id);
  res.json({ token: makeToken(user), user: safeUser(user) });
});
app.get("/api/auth/me", auth, (req, res) => res.json({ user: safeUser(req.user) }));
app.get("/api/auth/admin-status", auth, (req, res) => {
  const row = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
  res.json({ isAdmin: !!row && row.is_admin === 1, configuredAdminEmail: !!ADMIN_EMAIL && req.user.email.toLowerCase() === ADMIN_EMAIL });
});

app.get("/api/dashboard", auth, (req, res) => {
  const today = new Intl.DateTimeFormat("en", { weekday: "long" }).format(new Date());
  const classesToday = days.includes(today) ? db.prepare("SELECT COUNT(*) count FROM timetable WHERE user_id=? AND day=?").get(req.user.id,today).count : 0;
  const moduleCount = db.prepare("SELECT COUNT(*) count FROM modules WHERE user_id=?").get(req.user.id).count;
  const flashcards = db.prepare("SELECT COUNT(*) count FROM flashcards WHERE user_id=?").get(req.user.id).count;
  const uploads = db.prepare("SELECT COUNT(*) count FROM uploads WHERE user_id=?").get(req.user.id).count;
  const notes = db.prepare("SELECT COUNT(*) count FROM notes WHERE user_id=?").get(req.user.id).count;
  const mastered = db.prepare("SELECT COUNT(*) count FROM flashcards WHERE user_id=? AND mastered=1").get(req.user.id).count;
  res.json({ classesToday, moduleCount, flashcards, uploads, notes, mastered });
});

// Timetable
app.get("/api/timetable", auth, (req,res) => res.json({ classes: db.prepare("SELECT id,day,name,lecturer,time,color FROM timetable WHERE user_id=? ORDER BY day,time").all(req.user.id) }));
app.post("/api/timetable", auth, (req,res) => {
  const day = req.body.day, name = cleanText(req.body.name,120), lecturer = cleanText(req.body.lecturer,160), time = req.body.time;
  if (!days.includes(day) || !name || !lecturer || typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return res.status(400).json({error:"Provide a valid day, class name, lecturer/room and time."});
  const result = db.prepare("INSERT INTO timetable(user_id,day,name,lecturer,time) VALUES(?,?,?,?,?)").run(req.user.id,day,name,lecturer,time);
  res.status(201).json({class:db.prepare("SELECT id,day,name,lecturer,time,color FROM timetable WHERE id=?").get(result.lastInsertRowid)});
});
app.put("/api/timetable/:id", auth, (req,res) => {
  const id = idParam(req.params.id), day=req.body.day, name=cleanText(req.body.name,120), lecturer=cleanText(req.body.lecturer,160), time=req.body.time;
  if (!id || !days.includes(day) || !name || !lecturer || typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return res.status(400).json({error:"Provide valid class details."});
  const result=db.prepare("UPDATE timetable SET day=?,name=?,lecturer=?,time=? WHERE id=? AND user_id=?").run(day,name,lecturer,time,id,req.user.id);
  if(!result.changes) return res.status(404).json({error:"Class not found."});
  res.json({success:true});
});
app.delete("/api/timetable/:id", auth, (req,res) => {
  const id=idParam(req.params.id); if(!id) return res.status(400).json({error:"Invalid class ID."});
  const result=db.prepare("DELETE FROM timetable WHERE id=? AND user_id=?").run(id,req.user.id);
  if(!result.changes) return res.status(404).json({error:"Class not found."});
  res.json({success:true});
});

// Notes
app.get("/api/notes", auth, (req,res) => res.json({notes:db.prepare("SELECT id,title,body,created_at AS createdAt,updated_at AS updatedAt FROM notes WHERE user_id=? ORDER BY updated_at DESC,id DESC").all(req.user.id)}));
app.post("/api/notes", auth, (req,res) => {
  const title=cleanText(req.body.title,160)||"Untitled note", body=cleanText(req.body.body,50000);
  if(!body) return res.status(400).json({error:"Write something before saving."});
  const result=db.prepare("INSERT INTO notes(user_id,title,body) VALUES(?,?,?)").run(req.user.id,title,body);
  res.status(201).json({note:db.prepare("SELECT id,title,body,created_at AS createdAt,updated_at AS updatedAt FROM notes WHERE id=?").get(result.lastInsertRowid)});
});
app.put("/api/notes/:id", auth, (req,res) => {
  const id=idParam(req.params.id), title=cleanText(req.body.title,160)||"Untitled note", body=cleanText(req.body.body,50000);
  if(!id) return res.status(400).json({error:"Invalid note ID."});
  if(!body) return res.status(400).json({error:"A note cannot be empty."});
  const result=db.prepare("UPDATE notes SET title=?,body=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(title,body,id,req.user.id);
  if(!result.changes) return res.status(404).json({error:"Note not found."});
  res.json({success:true});
});
app.delete("/api/notes/:id", auth, (req,res) => {
  const id=idParam(req.params.id); if(!id) return res.status(400).json({error:"Invalid note ID."});
  const result=db.prepare("DELETE FROM notes WHERE id=? AND user_id=?").run(id,req.user.id);
  if(!result.changes) return res.status(404).json({error:"Note not found."});
  res.json({success:true});
});

// Flashcards
app.get("/api/flashcards", auth, (req,res) => res.json({cards:db.prepare("SELECT id,question,answer,mastered FROM flashcards WHERE user_id=? ORDER BY id").all(req.user.id)}));
app.post("/api/flashcards", auth, (req,res) => {
  const question=cleanText(req.body.question,500), answer=cleanText(req.body.answer,5000);
  if(!question||!answer) return res.status(400).json({error:"Both question and answer are required."});
  const result=db.prepare("INSERT INTO flashcards(user_id,question,answer) VALUES(?,?,?)").run(req.user.id,question,answer);
  res.status(201).json({card:db.prepare("SELECT id,question,answer,mastered FROM flashcards WHERE id=?").get(result.lastInsertRowid)});
});
app.put("/api/flashcards/:id", auth, (req,res) => {
  const id=idParam(req.params.id), question=cleanText(req.body.question,500), answer=cleanText(req.body.answer,5000);
  if(!id||!question||!answer) return res.status(400).json({error:"Provide a valid question and answer."});
  const result=db.prepare("UPDATE flashcards SET question=?,answer=? WHERE id=? AND user_id=?").run(question,answer,id,req.user.id);
  if(!result.changes) return res.status(404).json({error:"Flashcard not found."});
  res.json({success:true});
});
app.patch("/api/flashcards/:id/mastered", auth, (req,res) => {
  const id=idParam(req.params.id); if(!id || typeof req.body.mastered!=="boolean") return res.status(400).json({error:"Provide a valid mastered value."});
  const result=db.prepare("UPDATE flashcards SET mastered=? WHERE id=? AND user_id=?").run(req.body.mastered?1:0,id,req.user.id);
  if(!result.changes) return res.status(404).json({error:"Flashcard not found."});
  res.json({success:true});
});
app.delete("/api/flashcards/:id", auth, (req,res) => {
  const id=idParam(req.params.id); if(!id) return res.status(400).json({error:"Invalid flashcard ID."});
  const result=db.prepare("DELETE FROM flashcards WHERE id=? AND user_id=?").run(id,req.user.id);
  if(!result.changes) return res.status(404).json({error:"Flashcard not found."});
  res.json({success:true});
});

// Modules
app.get("/api/modules", auth, (req,res) => res.json({modules:db.prepare("SELECT id,code,name,programme,progress FROM modules WHERE user_id=? ORDER BY code").all(req.user.id)}));
app.post("/api/modules", auth, (req,res) => {
  const code=cleanText(req.body.code,30).toUpperCase(), name=cleanText(req.body.name,120), programme=cleanText(req.body.programme,120), progress=Number(req.body.progress??0);
  if(!code||!name||!Number.isInteger(progress)||progress<0||progress>100) return res.status(400).json({error:"Enter a module code, name and progress from 0 to 100."});
  try {
    const result=db.prepare("INSERT INTO modules(user_id,code,name,programme,progress) VALUES(?,?,?,?,?)").run(req.user.id,code,name,programme,progress);
    res.status(201).json({module:db.prepare("SELECT id,code,name,programme,progress FROM modules WHERE id=?").get(result.lastInsertRowid)});
  } catch(e) { if(String(e.message).includes("UNIQUE")) return res.status(409).json({error:"That module code already exists."}); throw e; }
});
app.put("/api/modules/:id", auth, (req,res) => {
  const id=idParam(req.params.id), code=cleanText(req.body.code,30).toUpperCase(), name=cleanText(req.body.name,120), programme=cleanText(req.body.programme,120), progress=Number(req.body.progress);
  if(!id||!code||!name||!Number.isInteger(progress)||progress<0||progress>100) return res.status(400).json({error:"Provide valid module details."});
  try {
    const result=db.prepare("UPDATE modules SET code=?,name=?,programme=?,progress=? WHERE id=? AND user_id=?").run(code,name,programme,progress,id,req.user.id);
    if(!result.changes) return res.status(404).json({error:"Module not found."});
    res.json({success:true});
  } catch(e) { if(String(e.message).includes("UNIQUE")) return res.status(409).json({error:"That module code already exists."}); throw e; }
});
app.delete("/api/modules/:id", auth, (req,res) => {
  const id=idParam(req.params.id); if(!id) return res.status(400).json({error:"Invalid module ID."});
  const result=db.prepare("DELETE FROM modules WHERE id=? AND user_id=?").run(id,req.user.id);
  if(!result.changes) return res.status(404).json({error:"Module not found."});
  res.json({success:true});
});

// Uploads: documents are stored for download; audio transcription is not provided.
const allowedExtensions = new Set([".pdf",".doc",".docx",".txt"]);
const storage=multer.diskStorage({
  destination:(req,file,cb)=>cb(null,UPLOAD_DIR),
  filename:(req,file,cb)=>cb(null,crypto.randomUUID()+path.extname(file.originalname).toLowerCase())
});
const upload=multer({
  storage,
  limits:{fileSize:50*1024*1024,files:1},
  fileFilter:(req,file,cb)=>allowedExtensions.has(path.extname(file.originalname).toLowerCase())?cb(null,true):cb(new Error("Only PDF, DOC, DOCX and TXT files are allowed."))
});
function validFileSignature(filePath, ext) {
  const fd=fs.openSync(filePath,"r");
  try {
    const buffer=Buffer.alloc(8); const bytes=fs.readSync(fd,buffer,0,8,0); const b=buffer.subarray(0,bytes);
    if(ext===".pdf") return b.subarray(0,5).toString()==="%PDF-";
    if(ext===".doc") return b.length>=8 && b.subarray(0,8).equals(Buffer.from("D0CF11E0A1B11AE1","hex"));
    if(ext===".docx") return b.length>=4 && b[0]===0x50 && b[1]===0x4b;
    if(ext===".txt") return !b.includes(0);
    return false;
  } finally { fs.closeSync(fd); }
}
app.get("/api/uploads", auth, (req,res) => res.json({files:db.prepare("SELECT id,original_name AS name,size,mime_type AS mimeType,created_at AS createdAt FROM uploads WHERE user_id=? ORDER BY id DESC").all(req.user.id)}));
app.post("/api/uploads", auth, (req,res) => {
  upload.single("file")(req,res,err=>{
    if(err) return res.status(400).json({error:err.message||"Upload failed."});
    if(!req.file) return res.status(400).json({error:"Choose a file to upload."});
    const ext=path.extname(req.file.originalname).toLowerCase();
    if(!validFileSignature(req.file.path,ext)) {
      fs.unlink(req.file.path,()=>{});
      return res.status(400).json({error:"The file content does not match its extension or is not a supported document."});
    }
    const safeOriginalName = path.basename(req.file.originalname.replace(/\\/g, "/")).slice(0,255);
    try {
      const result=db.prepare("INSERT INTO uploads(user_id,original_name,stored_name,mime_type,size) VALUES(?,?,?,?,?)").run(req.user.id,safeOriginalName,req.file.filename,req.file.mimetype,req.file.size);
      res.status(201).json({file:{id:result.lastInsertRowid,name:safeOriginalName,size:req.file.size,mimeType:req.file.mimetype}});
    } catch(e) {
      fs.unlink(req.file.path,()=>{});
      console.error(e);
      res.status(500).json({error:"The uploaded file could not be saved."});
    }
  });
});
app.get("/api/uploads/:id/download", auth, (req,res) => {
  const id=idParam(req.params.id); if(!id) return res.status(400).json({error:"Invalid file ID."});
  const file=db.prepare("SELECT original_name,stored_name FROM uploads WHERE id=? AND user_id=?").get(id,req.user.id);
  if(!file) return res.status(404).json({error:"File not found."});
  const filePath=path.join(UPLOAD_DIR,path.basename(file.stored_name));
  if(!fs.existsSync(filePath)) return res.status(404).json({error:"The stored file is missing."});
  res.download(filePath,file.original_name);
});
app.delete("/api/uploads/:id", auth, (req,res) => {
  const id=idParam(req.params.id); if(!id) return res.status(400).json({error:"Invalid file ID."});
  const file=db.prepare("SELECT stored_name FROM uploads WHERE id=? AND user_id=?").get(id,req.user.id);
  if(!file) return res.status(404).json({error:"File not found."});
  db.prepare("DELETE FROM uploads WHERE id=? AND user_id=?").run(id,req.user.id);
  fs.unlink(path.join(UPLOAD_DIR,path.basename(file.stored_name)),()=>{});
  res.json({success:true});
});

// Study partners and connection requests
app.get("/api/partners", auth, (req,res) => {
  const partners=db.prepare(`
    SELECT u.id,u.name,u.course,
      (SELECT status FROM partner_requests WHERE from_user_id=? AND to_user_id=u.id ORDER BY id DESC LIMIT 1) AS requestStatus,
      (SELECT status FROM partner_requests WHERE from_user_id=u.id AND to_user_id=? ORDER BY id DESC LIMIT 1) AS incomingStatus
    FROM users u WHERE u.id != ? ORDER BY u.name LIMIT 100
  `).all(req.user.id,req.user.id,req.user.id);
  res.json({partners});
});
app.get("/api/partner-requests", auth, (req,res) => {
  const incoming=db.prepare(`SELECT r.id,r.status,r.created_at AS createdAt,u.id AS userId,u.name,u.course FROM partner_requests r JOIN users u ON u.id=r.from_user_id WHERE r.to_user_id=? ORDER BY r.created_at DESC`).all(req.user.id);
  const outgoing=db.prepare(`SELECT r.id,r.status,r.created_at AS createdAt,u.id AS userId,u.name,u.course FROM partner_requests r JOIN users u ON u.id=r.to_user_id WHERE r.from_user_id=? ORDER BY r.created_at DESC`).all(req.user.id);
  res.json({incoming,outgoing});
});
app.post("/api/partners/:id/connect", auth, (req,res) => {
  const targetId=idParam(req.params.id);
  if(!targetId||targetId===req.user.id) return res.status(400).json({error:"Invalid study partner."});
  if(!db.prepare("SELECT id FROM users WHERE id=?").get(targetId)) return res.status(404).json({error:"Student not found."});
  const existing=db.prepare("SELECT id,status FROM partner_requests WHERE from_user_id=? AND to_user_id=?").get(req.user.id,targetId);
  if(existing) return res.status(409).json({error:`Request already ${existing.status}.`});
  const reverse=db.prepare("SELECT id,status FROM partner_requests WHERE from_user_id=? AND to_user_id=?").get(targetId,req.user.id);
  if(reverse && reverse.status==="pending") return res.status(409).json({error:"This student has already sent you a request. Check incoming requests."});
  const result=db.prepare("INSERT INTO partner_requests(from_user_id,to_user_id) VALUES(?,?)").run(req.user.id,targetId);
  res.status(201).json({success:true,id:result.lastInsertRowid,status:"pending"});
});
app.patch("/api/partner-requests/:id", auth, (req,res) => {
  const id=idParam(req.params.id), status=req.body.status;
  if(!id||!["accepted","rejected"].includes(status)) return res.status(400).json({error:"Choose accept or reject."});
  const result=db.prepare("UPDATE partner_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND to_user_id=? AND status='pending'").run(status,id,req.user.id);
  if(!result.changes) return res.status(404).json({error:"Pending request not found."});
  res.json({success:true,status});
});

app.use("/api", (req,res)=>res.status(404).json({error:"API endpoint not found."}));
app.use(express.static(PUBLIC_DIR,{extensions:["html"]}));
app.get("*",(req,res)=>res.sendFile(path.join(PUBLIC_DIR,"index.html")));
app.use((err,req,res,next)=>{
  console.error(err);
  if(res.headersSent) return next(err);
  if(err instanceof SyntaxError && err.status===400) return res.status(400).json({error:"Invalid JSON request."});
  res.status(500).json({error:"An unexpected server error occurred."});
});

const server=app.listen(PORT,"0.0.0.0",()=>console.log(`SWAAT is running on port ${PORT}`));
function shutdown() {
  server.close(()=>{db.close();process.exit(0);});
}
process.on("SIGINT",shutdown);
process.on("SIGTERM",shutdown);
