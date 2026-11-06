const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let token = localStorage.getItem("swaat_token");
let currentUser = null;
let schedules = { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] };
let selectedDay = "Monday";
let cards = [];
let cardIndex = 0;
let revealed = false;
let currentMode = "cards";
let modules = [];
let editingModuleId = null;
let editingCardId = null;
let editingNoteId = null;
let quizQuestions = [];
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;

function toast(message) {
    const box = $("#toast");
    if (!box) return;
    box.textContent = message;
    box.classList.add("show");
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => box.classList.remove("show"), 2800);
}
function openModal(id) { $(id)?.classList.remove("hidden"); }
function closeModal(id) { $(id)?.classList.add("hidden"); }

async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(`/api${path}`, { ...options, headers });
    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401 && !["/auth/login", "/auth/register"].includes(path)) signOut(false);
        throw new Error(data.error || "The request could not be completed.");
    }
    return data;
}
function showApp() { $("#loginPage").classList.add("hidden"); $("#appPage").classList.remove("hidden"); }
function showLogin() { $("#appPage").classList.add("hidden"); $("#loginPage").classList.remove("hidden"); }
function setUser(user) {
    currentUser = user;
    const name = user.name || "Student";
    const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
    if ($("#sidebarUserName")) $("#sidebarUserName").textContent = name;
    if ($("#sidebarUserCourse")) $("#sidebarUserCourse").textContent = user.course || "Student";
    if ($("#sidebarAvatar")) $("#sidebarAvatar").textContent = initials;
    if ($("#topAvatar")) $("#topAvatar").textContent = initials;
}
function signOut(showMessage = true) {
    token = null; currentUser = null;
    localStorage.removeItem("swaat_token");
    showLogin();
    if (showMessage) toast("You have been signed out.");
}
async function loadApplication() {
    const me = await api("/auth/me");
    setUser(me.user);
    showApp();
    const results = await Promise.allSettled([
        loadTimetable(), loadNotes(), loadCards(), loadUploads(),
        loadPartners(), loadRequests(), loadModules(), loadDashboard()
    ]);
    const failed = results.filter(result => result.status === "rejected");
    await loadDashboard().catch(() => {});
    if (failed.length) toast("Some sections could not load. Check your connection and refresh.");
}

// Authentication
$("#signInBtn").addEventListener("click", async () => {
    const email = $("#email").value.trim(), password = $("#password").value;
    if (!email || !password) return toast("Please enter your email and password.");
    try {
        const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
        token = data.token; localStorage.setItem("swaat_token", token);
        await loadApplication();
        toast(`Welcome back, ${data.user.name}.`);
    } catch (error) { toast(error.message); }
});
$("#password").addEventListener("keydown", e => { if (e.key === "Enter") $("#signInBtn").click(); });
$("#email").addEventListener("keydown", e => { if (e.key === "Enter") $("#password").focus(); });
$("#createAccount").addEventListener("click", () => openModal("#registerModal"));
$("#closeRegister").addEventListener("click", () => closeModal("#registerModal"));
$("#submitRegister").addEventListener("click", async () => {
    const name = $("#registerName").value.trim();
    const email = $("#registerEmail").value.trim();
    const password = $("#registerPassword").value;
    const course = $("#registerCourse").value.trim() || "Student";
    if (!name || !email || !password) return toast("Complete your name, email and password.");
    try {
        const data = await api("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password, course }) });
        token = data.token; localStorage.setItem("swaat_token", token);
        closeModal("#registerModal");
        await loadApplication();
        toast("Your SWAAT account has been created.");
    } catch (error) { toast(error.message); }
});
$("#signOut").addEventListener("click", () => signOut());
$("#togglePassword").addEventListener("click", () => {
    const field = $("#password"); field.type = field.type === "password" ? "text" : "password";
});

function navigate(page) {
    $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.page === page));
    $$(".page").forEach(section => section.classList.toggle("active", section.id === page));
    window.scrollTo({ top: 0, behavior: "smooth" });
}
$$(".nav-item").forEach(button => button.addEventListener("click", () => navigate(button.dataset.page)));
$$("[data-page-link]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.pageLink)));

// Timetable
function renderSchedule() {
    const list = $("#scheduleList"), items = schedules[selectedDay] || [];
    list.replaceChildren();
    if (!items.length) {
        const empty = document.createElement("div"); empty.className = "panel empty-state";
        empty.textContent = `No classes scheduled for ${selectedDay}.`; list.append(empty); return;
    }
    items.forEach(item => {
        const row = document.createElement("div"); row.className = "schedule-item";
        const color = document.createElement("div"); color.className = `schedule-color ${item.color === "green" ? "green-line" : ""}`;
        const info = document.createElement("div"); info.className = "schedule-info";
        const title = document.createElement("strong"); title.textContent = item.name;
        const detail = document.createElement("small"); detail.textContent = item.lecturer;
        info.append(title, detail);
        const time = document.createElement("span"); time.className = "time"; time.textContent = item.time;
        const edit = document.createElement("button"); edit.className = "delete"; edit.textContent = "Edit"; edit.setAttribute("aria-label", "Edit class");
        edit.addEventListener("click", async () => {
            const name = prompt("Class name:", item.name); if (name === null) return;
            const lecturer = prompt("Lecturer or room:", item.lecturer); if (lecturer === null) return;
            const timeValue = prompt("Time (HH:MM):", item.time); if (timeValue === null) return;
            try {
                await api(`/timetable/${item.id}`, { method: "PUT", body: JSON.stringify({ day: selectedDay, name, lecturer, time: timeValue }) });
                await loadTimetable(); await loadDashboard(); toast("Class updated.");
            } catch (error) { toast(error.message); }
        });
        const del = document.createElement("button"); del.className = "delete"; del.textContent = "Delete";
        del.addEventListener("click", async () => {
            if (!confirm(`Delete ${item.name}?`)) return;
            try { await api(`/timetable/${item.id}`, { method: "DELETE" }); await loadTimetable(); await loadDashboard(); toast("Class removed."); }
            catch (error) { toast(error.message); }
        });
        row.append(color, info, time, edit, del); list.append(row);
    });
}
async function loadTimetable() {
    const data = await api("/timetable");
    schedules = { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] };
    data.classes.forEach(item => schedules[item.day]?.push(item));
    renderSchedule();
}
$$(".day").forEach(button => button.addEventListener("click", () => {
    selectedDay = button.dataset.day;
    $$(".day").forEach(day => day.classList.toggle("active", day === button));
    renderSchedule();
}));
$("#addClassBtn").addEventListener("click", () => openModal("#classModal"));
$("#closeModal").addEventListener("click", () => closeModal("#classModal"));
$("#saveClass").addEventListener("click", async () => {
    const name = $("#className").value.trim(), lecturer = $("#classLecturer").value.trim(), time = $("#classTime").value;
    if (!name || !lecturer || !time) return toast("Please complete all fields.");
    try {
        await api("/timetable", { method: "POST", body: JSON.stringify({ day: selectedDay, name, lecturer, time }) });
        closeModal("#classModal"); $("#className").value = ""; $("#classLecturer").value = "";
        await loadTimetable(); await loadDashboard(); toast(`Class added to ${selectedDay}.`);
    } catch (error) { toast(error.message); }
});

// Uploaded documents
function formatSize(bytes) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function renderUploads(files) {
    const list = $("#fileList"); list.replaceChildren();
    if (!files.length) {
        const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No documents uploaded yet."; list.append(empty); return;
    }
    files.forEach(file => {
        const row = document.createElement("div"); row.className = "file-row";
        const icon = document.createElement("div"); icon.className = "file-icon"; icon.textContent = "▤";
        const info = document.createElement("div"); info.className = "file-info";
        const name = document.createElement("strong"); name.textContent = file.name;
        const size = document.createElement("small"); size.textContent = formatSize(file.size);
        info.append(name, size);
        const status = document.createElement("span"); status.className = "ready"; status.textContent = "Stored";
        const download = document.createElement("button"); download.className = "round download"; download.textContent = "↓"; download.title = "Download file";
        download.addEventListener("click", async () => {
            try {
                const response = await fetch(`/api/uploads/${file.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
                if (!response.ok) throw new Error("Could not download this file.");
                const blob = await response.blob(), url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (error) { toast(error.message); }
        });
        const remove = document.createElement("button"); remove.className = "delete"; remove.textContent = "Delete";
        remove.addEventListener("click", async () => {
            if (!confirm(`Delete ${file.name}?`)) return;
            try { await api(`/uploads/${file.id}`, { method: "DELETE" }); await loadUploads(); await loadDashboard(); toast("Document deleted."); }
            catch (error) { toast(error.message); }
        });
        row.append(icon, info, status, download, remove); list.append(row);
    });
}
async function loadUploads() { const data = await api("/uploads"); renderUploads(data.files); }
$("#browseBtn").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", async event => {
    const file = event.target.files[0]; if (!file) return;
    const allowed = [".pdf", ".doc", ".docx", ".txt"];
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!allowed.includes(ext)) { toast("Choose a PDF, DOC, DOCX or TXT file."); event.target.value = ""; return; }
    if (file.size > 50 * 1024 * 1024) { toast("The maximum file size is 50 MB."); event.target.value = ""; return; }
    const form = new FormData(); form.append("file", file);
    try { await api("/uploads", { method: "POST", body: form }); await loadUploads(); await loadDashboard(); toast(`${file.name} uploaded.`); }
    catch (error) { toast(error.message); }
    event.target.value = "";
});

// Flashcards and quiz
function renderCards() {
    const question = $("#cardQuestion"), answer = $("#cardAnswer"), hint = $("#cardAnswerHint");
    if (!cards.length) {
        question.textContent = "No flashcards yet"; answer.textContent = "Create a flashcard to begin studying.";
        hint.classList.add("hidden"); answer.classList.remove("hidden"); $("#cardCount").textContent = "0 / 0";
        $("#masteredText").textContent = "0/0 mastered"; $("#cardList").replaceChildren(); return;
    }
    cardIndex = (cardIndex + cards.length) % cards.length;
    const card = cards[cardIndex];
    question.textContent = card.question; answer.textContent = card.answer;
    answer.classList.toggle("hidden", !revealed); hint.classList.toggle("hidden", revealed);
    $("#cardCount").textContent = `${cardIndex + 1} / ${cards.length}`;
    $("#masteredText").textContent = `${cards.filter(c => c.mastered).length}/${cards.length} mastered`;
    const list = $("#cardList"); list.replaceChildren();
    cards.forEach((item, index) => {
        const wrap = document.createElement("div"); wrap.className = "flashcard-list-item";
        const button = document.createElement("button"); button.className = item.mastered ? "done" : "";
        button.textContent = `${item.mastered ? "✓" : "●"} ${item.question}`;
        button.addEventListener("click", () => { cardIndex = index; revealed = false; renderCards(); });
        const edit = document.createElement("button"); edit.textContent = "Edit"; edit.className = "delete";
        edit.addEventListener("click", () => openCardEditor(item));
        const del = document.createElement("button"); del.textContent = "Delete"; del.className = "delete";
        del.addEventListener("click", async () => {
            if (!confirm("Delete this flashcard?")) return;
            try { await api(`/flashcards/${item.id}`, { method: "DELETE" }); await loadCards(); await loadDashboard(); toast("Flashcard deleted."); }
            catch (error) { toast(error.message); }
        });
        wrap.append(button, edit, del); list.append(wrap);
    });
}
async function loadCards() { const data = await api("/flashcards"); cards = data.cards; cardIndex = 0; revealed = false; renderCards(); }
$("#flashcard").addEventListener("click", () => { if (!cards.length || currentMode !== "cards") return; revealed = !revealed; renderCards(); });
$("#nextCard").addEventListener("click", () => { if (cards.length) { cardIndex = (cardIndex + 1) % cards.length; revealed = false; renderCards(); } });
$("#prevCard").addEventListener("click", () => { if (cards.length) { cardIndex = (cardIndex - 1 + cards.length) % cards.length; revealed = false; renderCards(); } });
$("#gotIt").addEventListener("click", async () => {
    if (!cards.length) return;
    try { const card = cards[cardIndex]; await api(`/flashcards/${card.id}/mastered`, { method: "PATCH", body: JSON.stringify({ mastered: true }) }); card.mastered = 1; renderCards(); await loadDashboard(); toast("Card marked as mastered."); }
    catch (error) { toast(error.message); }
});
$("#shuffle").addEventListener("click", () => { cards.sort(() => Math.random() - 0.5); cardIndex = 0; revealed = false; renderCards(); });
function openCardEditor(card = null) {
    editingCardId = card?.id || null;
    $("#cardModalTitle").textContent = card ? "Edit Flashcard" : "New Flashcard";
    $("#editCardQuestion").value = card?.question || "";
    $("#editCardAnswer").value = card?.answer || "";
    openModal("#cardModal");
}
$("#newCardBtn").addEventListener("click", () => openCardEditor());
$("#closeCard").addEventListener("click", () => closeModal("#cardModal"));
$("#saveCard").addEventListener("click", async () => {
    const question = $("#editCardQuestion").value.trim(), answer = $("#editCardAnswer").value.trim();
    if (!question || !answer) return toast("Enter both a question and an answer.");
    try {
        const method = editingCardId ? "PUT" : "POST";
        const path = editingCardId ? `/flashcards/${editingCardId}` : "/flashcards";
        await api(path, { method, body: JSON.stringify({ question, answer }) });
        closeModal("#cardModal"); await loadCards(); await loadDashboard(); toast("Flashcard saved.");
    } catch (error) { toast(error.message); }
});
$$(".tab").forEach(tab => tab.addEventListener("click", () => {
    $$(".tab").forEach(item => item.classList.toggle("active", item === tab));
    currentMode = tab.dataset.mode;
    $("#flashcard").classList.toggle("hidden", currentMode === "quiz");
    $$(".flash-controls, #cardList").forEach(el => el.classList.toggle("hidden", currentMode === "quiz"));
    $("#quizPanel").classList.toggle("hidden", currentMode !== "quiz");
    if (currentMode === "quiz") startQuiz();
}));
function startQuiz() {
    if (cards.length < 2) { $("#quizQuestion").textContent = "Add at least two flashcards to start a quiz."; $("#quizOptions").replaceChildren(); $("#quizFeedback").textContent = ""; $("#quizNext").disabled = true; return; }
    quizQuestions = [...cards].sort(() => Math.random() - .5);
    quizIndex = 0; quizScore = 0; quizAnswered = false; renderQuizQuestion();
}
function renderQuizQuestion() {
    if (quizIndex >= quizQuestions.length) {
        $("#quizProgress").textContent = "Quiz complete";
        $("#quizScore").textContent = `Final score: ${quizScore}/${quizQuestions.length}`;
        $("#quizQuestion").textContent = "You have completed this quiz.";
        $("#quizOptions").replaceChildren();
        $("#quizFeedback").textContent = `You answered ${quizScore} out of ${quizQuestions.length} correctly.`;
        $("#quizNext").textContent = "Finish"; $("#quizNext").disabled = false; return;
    }
    const card = quizQuestions[quizIndex];
    $("#quizProgress").textContent = `Question ${quizIndex + 1} of ${quizQuestions.length}`;
    $("#quizScore").textContent = `Score: ${quizScore}`;
    $("#quizQuestion").textContent = card.question;
    $("#quizFeedback").textContent = "";
    $("#quizNext").textContent = "Next question"; $("#quizNext").disabled = true; quizAnswered = false;
    const wrong = cards.filter(c => c.id !== card.id).sort(() => Math.random() - .5).slice(0, 3).map(c => c.answer);
    const options = [...new Set([card.answer, ...wrong])].sort(() => Math.random() - .5);
    const holder = $("#quizOptions"); holder.replaceChildren();
    options.forEach(option => {
        const button = document.createElement("button"); button.className = "quiz-option"; button.textContent = option;
        button.addEventListener("click", () => {
            if (quizAnswered) return;
            quizAnswered = true;
            const correct = option === card.answer;
            if (correct) quizScore++;
            button.classList.add(correct ? "correct" : "incorrect");
            [...holder.children].forEach(btn => { if (btn.textContent === card.answer) btn.classList.add("correct"); btn.disabled = true; });
            $("#quizFeedback").textContent = correct ? "Correct!" : `Not quite. Correct answer: ${card.answer}`;
            $("#quizScore").textContent = `Score: ${quizScore}`;
            $("#quizNext").disabled = false;
        });
        holder.append(button);
    });
}
$("#quizNext").addEventListener("click", () => {
    if (quizIndex >= quizQuestions.length) { startQuiz(); return; }
    if (!quizAnswered) return;
    quizIndex++; renderQuizQuestion();
});
$("#quizRestart").addEventListener("click", startQuiz);

// Notes
function renderNotes(notes) {
    const list = $("#savedNotes"); list.replaceChildren();
    if (!notes.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "Your saved notes will appear here."; list.append(empty); return; }
    notes.forEach(note => {
        const card = document.createElement("div"); card.className = "saved-note";
        const title = document.createElement("strong"); title.textContent = note.title;
        const body = document.createElement("p"); body.textContent = note.body;
        const date = document.createElement("small"); date.textContent = `Updated ${new Date(note.updatedAt || note.createdAt).toLocaleString()}`;
        const edit = document.createElement("button"); edit.className = "delete"; edit.textContent = "Edit";
        edit.addEventListener("click", () => {
            editingNoteId = note.id; $("#noteTitle").value = note.title; $("#noteBody").value = note.body;
            $("#saveNote").textContent = "Update Note"; $("#noteTitle").focus();
        });
        const remove = document.createElement("button"); remove.className = "delete"; remove.textContent = "Delete";
        remove.addEventListener("click", async () => {
            if (!confirm("Delete this note?")) return;
            try { await api(`/notes/${note.id}`, { method: "DELETE" }); if (editingNoteId === note.id) resetNoteEditor(); await loadNotes(); toast("Note deleted."); }
            catch (error) { toast(error.message); }
        });
        card.append(title, body, date, edit, remove); list.append(card);
    });
}
function resetNoteEditor() { editingNoteId = null; $("#noteTitle").value = ""; $("#noteBody").value = ""; $("#saveNote").textContent = "Save Note"; }
async function loadNotes() { const data = await api("/notes"); renderNotes(data.notes); }
$("#saveNote").addEventListener("click", async () => {
    const title = $("#noteTitle").value.trim(), body = $("#noteBody").value.trim();
    if (!body) return toast("Write something before saving.");
    try {
        const wasEditing = Boolean(editingNoteId);
        const method = wasEditing ? "PUT" : "POST";
        const path = wasEditing ? `/notes/${editingNoteId}` : "/notes";
        await api(path, { method, body: JSON.stringify({ title, body }) });
        resetNoteEditor(); await loadNotes(); await loadDashboard(); toast(wasEditing ? "Note updated." : "Note saved.");
    } catch (error) { toast(error.message); }
});

// Modules
function renderModules() {
    const grid = $("#moduleGrid"); grid.replaceChildren();
    if (!modules.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No modules added yet. Add your first module to get started."; grid.append(empty); return; }
    modules.forEach(module => {
        const card = document.createElement("article"); card.className = "module-card";
        const code = document.createElement("span"); code.textContent = module.code;
        const title = document.createElement("h3"); title.textContent = module.name;
        const programme = document.createElement("p"); programme.textContent = module.programme || "No programme specified";
        const progress = document.createElement("div"); progress.className = "module-progress";
        const bar = document.createElement("b"); bar.style.width = `${module.progress}%`; progress.append(bar);
        const value = document.createElement("strong"); value.textContent = `${module.progress}%`;
        const edit = document.createElement("button"); edit.className = "delete"; edit.textContent = "Edit"; edit.addEventListener("click", () => openModuleEditor(module));
        const del = document.createElement("button"); del.className = "delete"; del.textContent = "Delete";
        del.addEventListener("click", async () => {
            if (!confirm(`Delete ${module.code}?`)) return;
            try { await api(`/modules/${module.id}`, { method: "DELETE" }); await loadModules(); await loadDashboard(); toast("Module deleted."); }
            catch (error) { toast(error.message); }
        });
        card.append(code,title,programme,progress,value,edit,del); grid.append(card);
    });
}
async function loadModules() { const data = await api("/modules"); modules = data.modules; renderModules(); }
function openModuleEditor(module = null) {
    editingModuleId = module?.id || null;
    $("#moduleModalTitle").textContent = module ? "Edit Module" : "Add Module";
    $("#moduleCode").value = module?.code || ""; $("#moduleName").value = module?.name || "";
    $("#moduleProgramme").value = module?.programme || ""; $("#moduleProgress").value = module?.progress ?? 0;
    openModal("#moduleModal");
}
$("#addModuleBtn").addEventListener("click", () => openModuleEditor());
$("#closeModule").addEventListener("click", () => closeModal("#moduleModal"));
$("#saveModule").addEventListener("click", async () => {
    const payload = { code: $("#moduleCode").value.trim(), name: $("#moduleName").value.trim(), programme: $("#moduleProgramme").value.trim(), progress: Number($("#moduleProgress").value) };
    try {
        const method = editingModuleId ? "PUT" : "POST";
        const path = editingModuleId ? `/modules/${editingModuleId}` : "/modules";
        await api(path, { method, body: JSON.stringify(payload) });
        closeModal("#moduleModal"); await loadModules(); await loadDashboard(); toast("Module saved.");
    } catch (error) { toast(error.message); }
});

// Study partners and requests
async function loadPartners() {
    const data = await api("/partners"), grid = $("#partnerGrid"); grid.replaceChildren();
    if (!data.partners.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No other students have registered yet. Invite a classmate to create an account."; grid.append(empty); return; }
    data.partners.forEach(partner => {
        const article = document.createElement("article"); article.className = "partner-card";
        const avatar = document.createElement("div"); avatar.className = "avatar large"; avatar.textContent = partner.name.split(/\s+/).slice(0,2).map(p=>p[0]).join("").toUpperCase();
        const name = document.createElement("h3"); name.textContent = partner.name;
        const course = document.createElement("p"); course.textContent = partner.course || "Student";
        const button = document.createElement("button"); button.className = "primary-btn connect";
        button.textContent = partner.requestStatus === "accepted" || partner.incomingStatus === "accepted" ? "Connected" : partner.requestStatus ? `Request ${partner.requestStatus}` : partner.incomingStatus === "pending" ? "Respond to request below" : "Connect";
        button.disabled = Boolean(partner.requestStatus || partner.incomingStatus);
        button.addEventListener("click", async () => {
            try { await api(`/partners/${partner.id}/connect`, { method: "POST" }); await loadPartners(); await loadRequests(); toast("Connection request sent."); }
            catch (error) { toast(error.message); }
        });
        article.append(avatar,name,course,button); grid.append(article);
    });
}
async function loadRequests() {
    const data = await api("/partner-requests"), grid = $("#requestGrid"); grid.replaceChildren();
    const all = [...data.incoming.map(r=>({...r,direction:"Incoming"})), ...data.outgoing.map(r=>({...r,direction:"Outgoing"}))];
    if (!all.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No connection requests yet."; grid.append(empty); return; }
    all.forEach(request => {
        const card = document.createElement("div"); card.className = "saved-note";
        const title = document.createElement("strong"); title.textContent = `${request.direction}: ${request.name}`;
        const detail = document.createElement("p"); detail.textContent = `${request.course || "Student"} · ${request.status}`;
        card.append(title,detail);
        if (request.direction === "Incoming" && request.status === "pending") {
            ["accepted","rejected"].forEach(status => {
                const button = document.createElement("button"); button.className = "delete"; button.textContent = status === "accepted" ? "Accept" : "Reject";
                button.addEventListener("click", async () => {
                    try { await api(`/partner-requests/${request.id}`, { method: "PATCH", body: JSON.stringify({status}) }); await loadRequests(); await loadPartners(); toast(`Request ${status}.`); }
                    catch (error) { toast(error.message); }
                });
                card.append(button);
            });
        }
        grid.append(card);
    });
}

// Dashboard
async function loadDashboard() {
    const data = await api("/dashboard");
    const values = $$(".stats-grid .stat-card strong");
    if (values[0]) values[0].textContent = data.classesToday;
    if (values[1]) values[1].textContent = data.moduleCount;
    if (values[2]) values[2].textContent = data.flashcards;
    const uploadStat = values[3]; if (uploadStat) uploadStat.textContent = data.uploads;
    const today = new Intl.DateTimeFormat("en", { weekday: "long" }).format(new Date());
    const todaysClasses = (schedules[today] || []).slice().sort((a,b) => a.time.localeCompare(b.time));
    const scheduleBox = $("#dashboardSchedule");
    if (scheduleBox) {
        scheduleBox.replaceChildren();
        if (!todaysClasses.length) {
            const empty = document.createElement("p"); empty.textContent = "No classes scheduled for today."; scheduleBox.append(empty);
        } else {
            todaysClasses.forEach(item => {
                const row = document.createElement("div"); row.className = "schedule-item";
                const name = document.createElement("strong"); name.textContent = item.name;
                const time = document.createElement("span"); time.className = "time"; time.textContent = item.time;
                row.append(name,time); scheduleBox.append(row);
            });
        }
    }
    const progressBox = $("#dashboardProgress");
    if (progressBox) {
        progressBox.replaceChildren();
        if (!modules.length) {
            const empty = document.createElement("p"); empty.textContent = "Add modules to track your progress."; progressBox.append(empty);
        } else {
            modules.slice(0,4).forEach(module => {
                const row = document.createElement("div");
                const line = document.createElement("div");
                const label = document.createElement("span"); label.textContent = module.code;
                const value = document.createElement("span"); value.textContent = `${module.progress}%`;
                line.append(label,value);
                const track = document.createElement("div"); track.className = "module-progress";
                const bar = document.createElement("b"); bar.style.width = `${module.progress}%`; track.append(bar);
                row.append(line,track); progressBox.append(row);
            });
        }
    }
}
$("#notifications").addEventListener("click", async () => {
    try {
        const data = await api("/partner-requests");
        const pending = data.incoming.filter(r => r.status === "pending").length;
        toast(pending ? `You have ${pending} pending study partner request(s).` : "You are all caught up.");
    } catch { toast("Notifications are unavailable right now."); }
});

// Initial boot
(async function boot() {
    if (!token) return showLogin();
    try { await loadApplication(); }
    catch { signOut(false); toast("Please sign in to continue."); }
})();
