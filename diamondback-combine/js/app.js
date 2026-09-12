import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc,
  onSnapshot, query, where, getDocs, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
const athletesCol = collection(db, "athletes");

const DRILLS = {
  twentyyd:  { key: "twentyyd",  label: "20 Yard Dash",       lowerBetter: true,  suffix: "s",   decimals: 2 },
  medball:   { key: "medball",   label: "Med Ball Throw",     lowerBetter: false, suffix: "'",   decimals: 1 },
  shuttle:   { key: "shuttle",   label: "5-10-5 Shuttle",     lowerBetter: true,  suffix: "s",   decimals: 2 },
  pitchvelo: { key: "pitchvelo", label: "Pitching Velocity",  lowerBetter: false, suffix: " mph", decimals: 1 },
  exitvelo:  { key: "exitvelo",  label: "Exit Velocity",      lowerBetter: false, suffix: " mph", decimals: 1 }
};
const DRILL_ORDER = ["twentyyd", "medball", "shuttle", "pitchvelo", "exitvelo"];
const DEFAULT_AGE_GROUPS = ["Farm", "Minors", "Majors"];
function getAgeGroups() {
  const set = new Set(DEFAULT_AGE_GROUPS);
  state.athletes.forEach(a => { if (a.ageGroup) set.add(a.ageGroup); });
  const known = DEFAULT_AGE_GROUPS.filter(g => set.has(g));
  const other = [...set].filter(g => !DEFAULT_AGE_GROUPS.includes(g)).sort();
  return [...known, ...other];
}

let state = {
  loaded: false,
  athletes: [],
  view: "leaderboard", // leaderboard | profile | coach
  selectedDrill: "twentyyd",
  ageFilter: "all",
  searchQuery: "",
  selectedAthleteId: null,
  authUser: null,
  authError: "",
  coachFormMsg: "",
  importParsed: null,   // { rows, mapping, fileName }
  importBusy: false,
  importMsg: ""
};

// ---------- Firestore live sync ----------
onSnapshot(athletesCol, (snap) => {
  state.athletes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.loaded = true;
  render();
}, (err) => {
  console.error("Firestore sync error", err);
  state.loaded = true;
  render();
});

onAuthStateChanged(auth, (user) => {
  state.authUser = user;
  if (!user && state.view === "coach") {
    // stay on coach view to show the login form
  }
  render();
});

// ---------- Helpers ----------
function fmtVal(drillKey, val) {
  const d = DRILLS[drillKey];
  return Number(val).toFixed(d.decimals) + d.suffix;
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function prFor(athlete, drillKey) {
  const results = (athlete.results || []).filter(r => r.drill === drillKey);
  if (!results.length) return null;
  return DRILLS[drillKey].lowerBetter
    ? results.reduce((a, b) => (b.value < a.value ? b : a))
    : results.reduce((a, b) => (b.value > a.value ? b : a));
}
function rankedList(drillKey, ageFilter) {
  const pool = state.athletes.filter(a => ageFilter === "all" || a.ageGroup === ageFilter);
  const withPR = pool.map(a => ({ athlete: a, pr: prFor(a, drillKey) })).filter(x => x.pr !== null);
  withPR.sort((a, b) => DRILLS[drillKey].lowerBetter ? a.pr.value - b.pr.value : b.pr.value - a.pr.value);
  return withPR;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

// ---------- Event handlers ----------
window.daSetView = function (v) { state.view = v; state.authError = ""; render(); };
window.daSelectDrill = function (k) { state.selectedDrill = k; render(); };
window.daSetAgeFilter = function (g) { state.ageFilter = g; render(); };
window.daSearchInput = function (v) { state.searchQuery = v; render(); };
window.daSelectAthlete = function (id) {
  state.selectedAthleteId = id;
  state.view = "profile";
  state.searchQuery = "";
  render();
};
window.daBackToBoard = function () { state.view = "leaderboard"; state.selectedAthleteId = null; render(); };
window.daToggleCoach = function () { state.view = state.view === "coach" ? "leaderboard" : "coach"; render(); };

window.daSignIn = async function (e) {
  e.preventDefault();
  const email = document.getElementById("da-auth-email").value.trim();
  const password = document.getElementById("da-auth-password").value;
  state.authError = "";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    state.authError = "Couldn't sign in — check the email and password.";
    render();
  }
};
window.daSignOut = async function () {
  await signOut(auth);
  state.view = "leaderboard";
  render();
};

window.daAddAthlete = async function (e) {
  e.preventDefault();
  const name = document.getElementById("da-new-name").value.trim();
  const ageGroup = document.getElementById("da-new-age").value;
  const position = document.getElementById("da-new-pos").value.trim();
  if (!name) return;
  await addDoc(athletesCol, { name, ageGroup, position, results: [] });
  state.coachFormMsg = name + " added to the roster.";
  document.getElementById("da-new-name").value = "";
  document.getElementById("da-new-pos").value = "";
  render();
};

window.daAddResult = async function (e) {
  e.preventDefault();
  const athleteId = document.getElementById("da-res-athlete").value;
  const drill = document.getElementById("da-res-drill").value;
  const value = parseFloat(document.getElementById("da-res-value").value);
  const date = document.getElementById("da-res-date").value || todayISO();
  if (!athleteId || !drill || isNaN(value)) return;
  const athlete = state.athletes.find(a => a.id === athleteId);
  await updateDoc(doc(db, "athletes", athleteId), { results: arrayUnion({ drill, value, date }) });
  state.coachFormMsg = "Result logged for " + athlete.name + ".";
  document.getElementById("da-res-value").value = "";
  render();
};

// ---------- Excel import ----------
function detectField(header) {
  const h = header.toLowerCase().trim();
  if (h.includes("first")) return "firstName";
  if (h.includes("last")) return "lastName";
  if (h.includes("name")) return "name";
  if (h.includes("age") || h.includes("division") || h.includes("group")) return "ageGroup";
  if (h === "pos" || h.includes("position")) return "position";
  if (h.includes("20")) return "twentyyd";
  if (h.includes("med")) return "medball";
  if (h.includes("shuttle") || h.includes("510") || h.includes("5-10-5") || h.includes("5 10 5")) return "shuttle";
  if (h.includes("pitch")) return "pitchvelo";
  if (h.includes("exit")) return "exitvelo";
  if (h.includes("date")) return "date";
  return null;
}
function parseNumeric(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const cleaned = v.replace(/[^0-9.\-]/g, "");
  return cleaned === "" ? NaN : parseFloat(cleaned);
}
// Med Ball Throw is sometimes recorded as feet/inches, e.g. 12' 6", 14' 21/2"
function parseFeetInches(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return NaN;
  if (!s.includes("'")) return parseNumeric(s);
  const parts = s.split("'");
  const feet = parseInt(parts[0].trim(), 10) || 0;
  const rest = (parts[1] || "").replace(/"/g, "").trim();
  let inches = 0;
  if (!rest) {
    inches = 0;
  } else if (rest.includes("/")) {
    let wholePart = "0", fracPart = rest;
    if (rest.includes(" ")) {
      const sp = rest.split(" ").filter(Boolean);
      wholePart = sp[0] || "0";
      fracPart = sp[1] || "";
    } else {
      const m = rest.match(/^(\d*)(\d)\/(\d+)$/);
      if (m) { wholePart = m[1] || "0"; fracPart = m[2] + "/" + m[3]; }
    }
    const whole = parseInt(wholePart, 10) || 0;
    const fm = fracPart.match(/(\d+)\/(\d+)/);
    const frac = fm ? parseInt(fm[1], 10) / parseInt(fm[2], 10) : 0;
    inches = whole + frac;
  } else {
    inches = parseFloat(rest) || 0;
  }
  return feet + inches / 12;
}
function normalizeAgeGroup(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s || s.toLowerCase() === "nan") return "Unassigned";
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

window.daHandleFile = function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const wb = XLSX.read(evt.target.result, { type: "array" });
      const dateFallback = todayISO();
      const merged = new Map(); // key: name|ageGroup -> record
      let mapping = {};

      wb.SheetNames.forEach(sheetName => {
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (!rows.length) return;
        const headers = Object.keys(rows[0]);
        headers.forEach(h => { const f = detectField(h); if (f) mapping[h] = f; });

        rows.forEach(row => {
          const rec = { firstName: "", lastName: "", name: "", ageGroup: "", position: "", date: "", results: [] };
          headers.forEach(h => {
            const field = mapping[h];
            if (!field) return;
            const raw = row[h];
            if (field === "firstName") rec.firstName = String(raw).trim();
            else if (field === "lastName") rec.lastName = String(raw).trim();
            else if (field === "name") rec.name = String(raw).trim();
            else if (field === "ageGroup") rec.ageGroup = normalizeAgeGroup(raw);
            else if (field === "position") rec.position = String(raw).trim();
            else if (field === "date") {
              if (raw instanceof Date) rec.date = raw.toISOString().slice(0, 10);
              else if (typeof raw === "number") rec.date = XLSX.SSF.format("yyyy-mm-dd", raw);
              else rec.date = String(raw).trim();
            } else {
              const num = field === "medball" ? parseFeetInches(raw) : parseNumeric(raw);
              if (!isNaN(num)) rec.results.push({ drill: field, value: num });
            }
          });
          if (!rec.name) rec.name = `${rec.firstName} ${rec.lastName}`.trim();
          if (!rec.name) return;
          if (!rec.ageGroup) rec.ageGroup = "Unassigned";
          const d = rec.date || dateFallback;
          rec.results.forEach(res => { res.date = d; });

          const key = rec.name.toLowerCase() + "|" + rec.ageGroup;
          if (merged.has(key)) {
            const existing = merged.get(key);
            rec.results.forEach(res => {
              const dup = existing.results.some(r => r.drill === res.drill && r.value === res.value && r.date === res.date);
              if (!dup) existing.results.push(res);
            });
            if (!existing.position && rec.position) existing.position = rec.position;
          } else {
            merged.set(key, rec);
          }
        });
      });

      if (!merged.size) {
        state.importMsg = "That file didn't have any rows we could read.";
        render();
        return;
      }

      state.importParsed = { rows: [...merged.values()], mapping, fileName: file.name };
      state.importMsg = "";
      render();
    } catch (err) {
      console.error(err);
      state.importMsg = "Couldn't read that file. Make sure it's a .xlsx or .csv export.";
      render();
    }
  };
  reader.readAsArrayBuffer(file);
};

window.daCancelImport = function () {
  state.importParsed = null;
  state.importMsg = "";
  render();
};

window.daConfirmImport = async function () {
  if (!state.importParsed) return;
  state.importBusy = true;
  render();
  let created = 0, updated = 0;

  for (const rec of state.importParsed.rows) {
    const q = query(athletesCol, where("name", "==", rec.name), where("ageGroup", "==", rec.ageGroup));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const existing = snap.docs[0];
      if (rec.results.length) {
        await updateDoc(doc(db, "athletes", existing.id), { results: arrayUnion(...rec.results) });
      }
      updated++;
    } else {
      await addDoc(athletesCol, {
        name: rec.name,
        ageGroup: rec.ageGroup,
        position: rec.position || "",
        results: rec.results
      });
      created++;
    }
  }

  state.importBusy = false;
  state.importParsed = null;
  state.importMsg = `Import complete — ${created} new athlete${created === 1 ? "" : "s"} added, ${updated} updated.`;
  render();
};

// ---------- Render ----------
function render() {
  const root = document.getElementById("app");
  if (!state.loaded) {
    root.innerHTML = `<div class="loading-note">Loading combine data&hellip;</div>`;
    return;
  }
  root.innerHTML = header() + searchBlock() + body();
}

function header() {
  return `
    <div class="header">
      <div class="brand">
        <img class="brand-mark" src="assets/diamondback-logo.png" alt="Diamondback Little League logo" />
        <div class="brand-text">
          <div class="brand-title display">Diamondback Little League</div>
          <div class="sub">Youth Combine &middot; Performance Testing</div>
        </div>
      </div>
      <div class="header-right">
        <div class="partner-block">
          <span class="partner-label">Testing<br/>Partner</span>
          <img src="assets/redline-logo.png" alt="Redline Athletics North Phoenix logo" />
        </div>
      </div>
    </div>
    <div class="partnership-banner">
      <span>Combine testing powered by &nbsp;&mdash;&nbsp; Redline Athletics North Phoenix</span>
      <button class="coach-btn ${state.view === 'coach' || state.authUser ? 'active' : ''}" onclick="daToggleCoach()">
        ${state.authUser ? '✓ Coach' : 'Coach'}
      </button>
    </div>
  `;
}

function searchBlock() {
  const q = state.searchQuery.trim().toLowerCase();
  const matches = q ? state.athletes.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8) : [];
  return `
    <div class="search-row">
      <input class="search-input" type="text" placeholder="Search for an athlete by name&hellip;"
        value="${escapeHtml(state.searchQuery)}" oninput="daSearchInput(this.value)" />
      ${matches.length ? `
        <div class="search-results">
          ${matches.map(a => `
            <div class="search-result-item" onclick="daSelectAthlete('${a.id}')">
              <span>${escapeHtml(a.name)}</span>
              <span class="age-tag">${a.ageGroup}${a.position ? " &middot; " + escapeHtml(a.position) : ""}</span>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function body() {
  if (state.view === "coach") return coachView();
  if (state.view === "profile" && state.selectedAthleteId) return profileView();
  return leaderboardView();
}

function leaderboardView() {
  const rows = rankedList(state.selectedDrill, state.ageFilter);
  return `
    <div class="tabs"><button class="tab active">Leaderboard</button></div>
    <div class="chip-row">
      ${DRILL_ORDER.map(k => `<button class="chip ${state.selectedDrill === k ? "active" : ""}" onclick="daSelectDrill('${k}')">${DRILLS[k].label}</button>`).join("")}
    </div>
    <div class="chip-row">
      <button class="chip ${state.ageFilter === "all" ? "active" : ""}" onclick="daSetAgeFilter('all')">All Divisions</button>
      ${getAgeGroups().map(g => `<button class="chip ${state.ageFilter === g ? "active" : ""}" onclick="daSetAgeFilter('${g}')">${g}</button>`).join("")}
    </div>
    <div class="board">
      <div class="board-head"><div>Rank</div><div>Athlete</div><div style="text-align:right">Best</div><div style="text-align:right">Date</div></div>
      ${rows.length ? rows.map((r, i) => boardRow(r, i)).join("") : `
        <div class="empty-state">
          <div class="display">No Results Yet</div>
          <div>No one in this age group has logged a ${DRILLS[state.selectedDrill].label} time yet.</div>
        </div>
      `}
    </div>
  `;
}

function boardRow(r, i) {
  const rank = i + 1;
  const badgeClass = rank === 1 ? "r1" : rank === 2 ? "r2" : rank === 3 ? "r3" : "";
  return `
    <div class="board-row" onclick="daSelectAthlete('${r.athlete.id}')">
      <div><span class="rank-badge ${badgeClass}">${rank}</span></div>
      <div class="board-name">${escapeHtml(r.athlete.name)}<span class="age-tag">${r.athlete.ageGroup}${r.athlete.position ? " &middot; " + escapeHtml(r.athlete.position) : ""}</span></div>
      <div class="board-val mono">${fmtVal(state.selectedDrill, r.pr.value)}</div>
      <div class="board-date">${fmtDate(r.pr.date)}</div>
    </div>
  `;
}

function profileView() {
  const athlete = state.athletes.find(a => a.id === state.selectedAthleteId);
  if (!athlete) { state.view = "leaderboard"; return leaderboardView(); }
  const tiles = DRILL_ORDER.map(k => {
    const pr = prFor(athlete, k);
    let rankLabel = "";
    if (pr) {
      const list = rankedList(k, "all");
      const idx = list.findIndex(x => x.athlete.id === athlete.id);
      if (idx >= 0) rankLabel = "#" + (idx + 1) + " overall";
    }
    return `
      <div class="score-tile">
        <div class="drill-label">${DRILLS[k].label}</div>
        <div class="score-val mono ${pr ? "" : "empty"}">${pr ? fmtVal(k, pr.value) : "No data"}</div>
        ${pr ? `<div class="score-rank">${rankLabel}</div>` : ""}
      </div>
    `;
  }).join("");
  const allResults = (athlete.results || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const historyRows = allResults.length ? allResults.map(r => `
    <div class="hist-row"><div>${DRILLS[r.drill].label}</div><div class="h-val mono">${fmtVal(r.drill, r.value)}</div><div class="h-date">${fmtDate(r.date)}</div></div>
  `).join("") : `<div class="hist-row"><div>No results logged yet.</div><div></div><div></div></div>`;

  return `
    <button class="back-link" onclick="daBackToBoard()">&larr; Back to leaderboard</button>
    <div class="profile-head">
      <div>
        <div class="display">${escapeHtml(athlete.name)}</div>
        <div class="profile-meta">${athlete.ageGroup}${athlete.position ? " &middot; " + escapeHtml(athlete.position) : ""}</div>
      </div>
    </div>
    <div class="scoreboard-grid">${tiles}</div>
    <div class="history-table"><div class="history-title">Full History</div>${historyRows}</div>
  `;
}

function coachView() {
  if (!state.authUser) {
    return `
      <div class="coach-gate">
        <div class="display">Coach Sign In</div>
        <p>Sign in with your coach account to add athletes and log combine results.</p>
        <form onsubmit="daSignIn(event)">
          <div class="field"><label>Email</label><input id="da-auth-email" type="email" required /></div>
          <div class="field"><label>Password</label><input id="da-auth-password" type="password" required /></div>
          <button class="btn-primary" type="submit">Sign In</button>
          ${state.authError ? `<div class="error-text">${state.authError}</div>` : ""}
        </form>
      </div>
    `;
  }

  const athleteOptions = state.athletes.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${a.ageGroup})</option>`).join("");
  const drillOptions = DRILL_ORDER.map(k => `<option value="${k}">${DRILLS[k].label}</option>`).join("");

  return `
    <div class="tabs"><button class="tab active">Coach Entry</button></div>
    <div class="auth-signed-in" style="margin-top:14px">
      Signed in as ${escapeHtml(state.authUser.email)}
      <button onclick="daSignOut()">Sign out</button>
    </div>
    ${state.coachFormMsg ? `<div class="success-text" style="margin-top:10px">${escapeHtml(state.coachFormMsg)}</div>` : ""}

    <div class="coach-panel-inner">
      <div class="panel-card">
        <div class="display">Add Athlete</div>
        <form onsubmit="daAddAthlete(event)">
          <div class="field"><label>Name</label><input id="da-new-name" type="text" required placeholder="Full name" /></div>
          <div class="field"><label>Division</label><select id="da-new-age">${getAgeGroups().map(g => `<option value="${g}">${g}</option>`).join("")}</select></div>
          <div class="field"><label>Position (optional)</label><input id="da-new-pos" type="text" placeholder="e.g. SS, P, OF" /></div>
          <button class="btn-primary" type="submit">Add to Roster</button>
        </form>
        <div class="roster-list">
          ${state.athletes.length ? state.athletes.slice().sort((a, b) => a.name.localeCompare(b.name)).map(a => `
            <div class="roster-item"><span>${escapeHtml(a.name)}</span><span class="age-tag">${a.ageGroup}</span></div>
          `).join("") : '<div class="age-tag">No athletes on the roster yet.</div>'}
        </div>
      </div>

      <div class="panel-card">
        <div class="display">Log a Result</div>
        ${state.athletes.length ? `
          <form onsubmit="daAddResult(event)">
            <div class="field"><label>Athlete</label><select id="da-res-athlete">${athleteOptions}</select></div>
            <div class="field"><label>Drill</label><select id="da-res-drill">${drillOptions}</select></div>
            <div class="field"><label>Result</label><input id="da-res-value" type="number" step="0.01" required placeholder="e.g. 3.15" /></div>
            <div class="field"><label>Date</label><input id="da-res-date" type="date" value="${todayISO()}" /></div>
            <button class="btn-primary" type="submit">Save Result</button>
          </form>
        ` : `<p style="color:var(--text-muted); font-size:13px;">Add an athlete first, then you can log results for them.</p>`}
      </div>
    </div>

    <div class="panel-card" style="margin-top:18px">
      <div class="display">Import From Spreadsheet</div>
      <p style="color:var(--text-muted); font-size:12.5px; margin-top:-6px; margin-bottom:14px;">
        Upload an .xlsx export. Columns are matched automatically by header name (Name, Division, 20 Yard, Med Ball, Shuttle, Pitching Velo, Exit Velo, Date).
      </p>
      ${importSection()}
    </div>
  `;
}

function importSection() {
  if (state.importBusy) {
    return `<div class="import-preview-head">Importing&hellip; please don't close this tab.</div>`;
  }
  if (state.importParsed) {
    const { rows, mapping, fileName } = state.importParsed;
    const mappedFields = Object.entries(mapping).map(([h, f]) => `<b>${escapeHtml(h)}</b> &rarr; ${f}`).join(", ");
    return `
      <div class="import-preview">
        <div class="import-preview-head">${escapeHtml(fileName)} &mdash; ${rows.length} row${rows.length === 1 ? "" : "s"} found</div>
        ${rows.slice(0, 6).map(r => `
          <div class="import-preview-row"><span>${escapeHtml(r.name)} <span class="age-tag">${r.ageGroup}</span></span><span>${r.results.length} result${r.results.length === 1 ? "" : "s"}</span></div>
        `).join("")}
        ${rows.length > 6 ? `<div class="import-preview-row"><span>&hellip; and ${rows.length - 6} more</span><span></span></div>` : ""}
      </div>
      <div class="import-mapping">Detected columns: ${mappedFields || "none matched — check your headers"}</div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button class="btn-primary" onclick="daConfirmImport()" ${Object.keys(mapping).length ? "" : "disabled"}>Confirm Import</button>
        <button class="reset-link" onclick="daCancelImport()">Cancel</button>
      </div>
    `;
  }
  return `
    <label class="import-drop">
      <input type="file" accept=".xlsx,.xls,.csv" onchange="daHandleFile(event)" />
      <div class="import-label"><strong>Click to choose a file</strong><br/>.xlsx, .xls, or .csv</div>
    </label>
    ${state.importMsg ? `<div class="${state.importMsg.startsWith('Import complete') ? 'success-text' : 'error-text'}" style="margin-top:10px">${escapeHtml(state.importMsg)}</div>` : ""}
  `;
}
