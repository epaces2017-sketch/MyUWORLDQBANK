let QUESTIONS = [];
async function loadQuestions() {
  const res = await fetch("./questions.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load questions.json: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("questions.json must be an array of questions");
  QUESTIONS = data;
  console.log("Loaded questions:", QUESTIONS.length);
}
/** ===========================
 *  1) STORAGE + STATE
 *  =========================== */
const LS_KEY = "step1_qbank_progress_v2";
const LS_UI  = "step1_qbank_ui_v2";
const LS_BLOCK = "step1_qbank_block_v2";

function loadJSON(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, val){
  localStorage.setItem(key, JSON.stringify(val));
}

let progress = loadJSON(LS_KEY, {}); // per qid
function ensureProgress(qid){
  if(!progress[qid]){
    progress[qid] = {
      flagged:false,
      status:"UNSEEN", // UNSEEN|CORRECT|INCORRECT|SKIPPED
      timeSpentSec:0,
      lastAnswerIndex:null, // display index
      attempts:0,
      _optionOrder:null
    };
  }
  return progress[qid];
}
function saveProgress(){ saveJSON(LS_KEY, progress); }

let ui = loadJSON(LS_UI, {});
function saveUI(){ saveJSON(LS_UI, ui); }

let session = {
  block: loadJSON(LS_BLOCK, []), // array of qids in current block
  index: 0,
  mode: "TUTOR",
  timeLimitSec: 90,
  order: "SHUFFLE",
  blockSize: 40,
  includeCompleted: "NO",
  filters: { system:"ALL", topic:"ALL", status:"ALL", flag:"ALL", excluded:new Set() },
  startedAtMs: null,
  elapsedThisQSec: 0,
  intervalId: null,
  locked: false,
  revealed: false
};

/** ===========================
 *  2) HELPERS
 *  =========================== */
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._id);
  toast._id = setTimeout(()=> t.style.display="none", 1700);
}

function getQById(qid){ return QUESTIONS.find(q => q.qid === qid); }

function formatTime(sec){
  const m = Math.floor(sec/60).toString().padStart(2,"0");
  const s = Math.floor(sec%60).toString().padStart(2,"0");
  return `${m}:${s}`;
}

function parseQidList(raw){
  const tokens = (raw || "")
    .split(/[\s,]+/g)
    .map(t => t.trim())
    .filter(Boolean);
  return new Set(tokens.map(t => t.toUpperCase()));
}

function unique(arr){ return Array.from(new Set(arr)); }

function sortByQid(a,b){
  const na = parseInt(a.replace(/[^\d]/g,"") , 10) || 0;
  const nb = parseInt(b.replace(/[^\d]/g,"") , 10) || 0;
  return na - nb;
}

function shuffle(arr){
  for(let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function setActiveTab(tab){
  const tP = document.getElementById("tabPractice");
  const tR = document.getElementById("tabReview");
  const tA = document.getElementById("tabAnalytics");
  [tP,tR,tA].forEach(x=>x.classList.remove("active"));

  document.getElementById("viewPractice").style.display = "none";
  document.getElementById("viewReview").style.display = "none";
  document.getElementById("viewAnalytics").style.display = "none";

  if(tab === "P"){
    tP.classList.add("active");
    document.getElementById("viewPractice").style.display = "block";
    renderCurrentQuestion();
  } else if(tab === "R"){
    tR.classList.add("active");
    document.getElementById("viewReview").style.display = "block";
    renderReview();
  } else {
    tA.classList.add("active");
    document.getElementById("viewAnalytics").style.display = "block";
    renderAnalytics();
  }
}

function updateHeaderCounts(){
  let correct=0, incorrect=0, flagged=0;
  for(const q of QUESTIONS){
    const p = ensureProgress(q.qid);
    if(p.status === "CORRECT") correct++;
    if(p.status === "INCORRECT") incorrect++;
    if(p.flagged) flagged++;
  }
  document.getElementById("totalCount").textContent = QUESTIONS.length;
  document.getElementById("blockCount").textContent = session.block.length;
  document.getElementById("correctCount").textContent = correct;
  document.getElementById("incorrectCount").textContent = incorrect;
  document.getElementById("flaggedCount").textContent = flagged;
}

/** ===========================
 *  3) FILTER OPTIONS + UI RESTORE
 *  =========================== */
function initFilters(){
  const systems = unique(QUESTIONS.map(q=>q.system).filter(Boolean)).sort();
  const topics  = unique(QUESTIONS.map(q=>q.topic).filter(Boolean)).sort();

  const sysSel = document.getElementById("systemSelect");
  const topSel = document.getElementById("topicSelect");

  sysSel.innerHTML = `<option value="ALL">All systems</option>` + systems.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  topSel.innerHTML = `<option value="ALL">All topics</option>` + topics.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  // restore UI
  if(ui.system) sysSel.value = ui.system;
  if(ui.topic) topSel.value = ui.topic;
  if(ui.status) document.getElementById("statusSelect").value = ui.status;
  if(ui.flag) document.getElementById("flagOnly").value = ui.flag;
  if(ui.mode) document.getElementById("modeSelect").value = ui.mode;
  if(ui.timeLimitSec) document.getElementById("timeLimitSec").value = ui.timeLimitSec;
  if(ui.order) document.getElementById("orderSelect").value = ui.order;
  if(ui.blockSize) document.getElementById("blockSize").value = ui.blockSize;
  if(ui.includeCompleted) document.getElementById("includeCompleted").value = ui.includeCompleted;
  if(ui.excludeRaw) document.getElementById("excludeBox").value = ui.excludeRaw;

  updateModeLabel();
}

function updateModeLabel(){
  const mode = document.getElementById("modeSelect").value;
  document.getElementById("modeLabel").textContent = (mode === "TIMED") ? "Timed" : "Tutor";
}

/** ===========================
 *  4) BUILD POOL + BUILD BLOCK
 *  =========================== */
function buildEligiblePoolFromUI(){
  const system = document.getElementById("systemSelect").value;
  const topic  = document.getElementById("topicSelect").value;
  const status = document.getElementById("statusSelect").value;
  const flag   = document.getElementById("flagOnly").value;
  const mode   = document.getElementById("modeSelect").value;
  const timeLimitSec = Math.max(10, parseInt(document.getElementById("timeLimitSec").value || "90", 10));
  const order  = document.getElementById("orderSelect").value;
  const blockSize = Math.max(1, parseInt(document.getElementById("blockSize").value || "40", 10));
  const includeCompleted = document.getElementById("includeCompleted").value;
  const excludeRaw = document.getElementById("excludeBox").value;
  const excluded = parseQidList(excludeRaw);

  // save UI prefs
  ui = { system, topic, status, flag, mode, timeLimitSec, order, blockSize, includeCompleted, excludeRaw };
  saveUI();

  // store in session
  session.mode = mode;
  session.timeLimitSec = timeLimitSec;
  session.order = order;
  session.blockSize = blockSize;
  session.includeCompleted = includeCompleted;
  session.filters = { system, topic, status, flag, excluded };

  updateModeLabel();

  // pool logic
  let pool = QUESTIONS
    .map(q => q.qid)
    .filter(qid => !excluded.has(qid.toUpperCase()))
    .filter(qid => {
      const q = getQById(qid);
      if(!q) return false;

      if(system !== "ALL" && q.system !== system) return false;
      if(topic !== "ALL" && q.topic !== topic) return false;

      const p = ensureProgress(qid);

      // If includeCompleted = NO and status filter is ALL, silently exclude answered questions
      if(includeCompleted === "NO" && status === "ALL"){
        if(p.status === "CORRECT" || p.status === "INCORRECT") return false;
      }

      if(status !== "ALL" && p.status !== status) return false;

      if(flag === "FLAGGED" && !p.flagged) return false;
      if(flag === "UNFLAGGED" && p.flagged) return false;

      return true;
    });

  if(order === "INORDER") pool.sort(sortByQid);
  else pool = shuffle([...pool]);

  return pool;
}

function buildBlock(){
  const pool = buildEligiblePoolFromUI();
  const blockSize = session.blockSize;

  if(pool.length === 0){
    session.block = [];
    session.index = 0;
    saveJSON(LS_BLOCK, session.block);
    updateHeaderCounts();
    renderEmptyState("No questions match your settings. Adjust filters/exclusions.");
    toast("No questions in pool.");
    return;
  }

  session.block = pool.slice(0, Math.min(blockSize, pool.length));
  session.index = 0;

  // reset timers
  stopTimer();
  session.locked = false;
  session.revealed = false;

  saveJSON(LS_BLOCK, session.block);
  updateHeaderCounts();
  renderCurrentQuestion();
  toast(`Block built: ${session.block.length} questions`);
  setActiveTab("P");
}

function newBlockReshuffle(){
  // just rebuild block using same UI settings; if shuffle, it will reshuffle pool
  buildBlock();
}

/** ===========================
 *  5) TIMER
 *  =========================== */
function startTimer(){
  stopTimer();
  session.startedAtMs = Date.now();
  session.intervalId = setInterval(()=>{
    const elapsed = Math.floor((Date.now() - session.startedAtMs)/1000);
    session.elapsedThisQSec = elapsed;
    document.getElementById("timerLabel").textContent = formatTime(elapsed);

    if(session.mode === "TIMED"){
      if(elapsed >= session.timeLimitSec && !session.locked){
        session.locked = true;
        document.getElementById("submitBtn").disabled = true;
        document.querySelectorAll('input[name="opt"]').forEach(x => x.disabled = true);
        toast("Time! Locked.");

        // mark as SKIPPED if no answer
        const qid = session.block[session.index];
        const p = ensureProgress(qid);
        if(p.lastAnswerIndex == null && (p.status === "UNSEEN" || p.status === "SKIPPED")){
          p.status = "SKIPPED";
          saveProgress();
          updateMeta();
          updateHeaderCounts();
        }
        document.getElementById("revealBtn").style.display = "inline-block";
      }
    }
  }, 250);
}

function stopTimer(){
  if(session.intervalId){
    clearInterval(session.intervalId);
    session.intervalId = null;
  }
  session.startedAtMs = null;
  session.elapsedThisQSec = 0;
  document.getElementById("timerLabel").textContent = "00:00";
}

function commitTimeSpentForCurrent(){
  const qid = session.block[session.index];
  if(!qid) return;
  const p = ensureProgress(qid);
  p.timeSpentSec += session.elapsedThisQSec;
  saveProgress();
}

/** ===========================
 *  6) PRACTICE RENDER
 *  =========================== */
function renderEmptyState(msg){
  document.getElementById("qidLabel").textContent = "—";
  document.getElementById("stemText").textContent = msg || "Build a block to start.";
  document.getElementById("optionsBox").innerHTML = "";
  document.getElementById("imgBox").style.display = "none";
  document.getElementById("explainBox").style.display = "none";
  document.getElementById("submitBtn").disabled = true;
  document.getElementById("revealBtn").style.display = "none";
  document.getElementById("sysLabel").textContent = "-";
  document.getElementById("topLabel").textContent = "-";
  document.getElementById("posLabel").textContent = `0/0`;
  updateMeta();
}

function renderCurrentQuestion(){
  updateHeaderCounts();

  if(session.block.length === 0){
    renderEmptyState("Build a block to start.");
    return;
  }
  const qid = session.block[session.index];
  const q = getQById(qid);
  if(!q){
    renderEmptyState("Question not found.");
    return;
  }

  session.locked = false;
  session.revealed = false;

  document.getElementById("submitBtn").disabled = false;
  document.getElementById("revealBtn").style.display = "none";

  document.getElementById("qidLabel").textContent = q.qid;
  document.getElementById("stemText").textContent = q.stem;
  document.getElementById("sysLabel").textContent = q.system || "-";
  document.getElementById("topLabel").textContent = q.topic || "-";
  document.getElementById("posLabel").textContent = `${session.index+1}/${session.block.length}`;

  if(q.image){
    document.getElementById("imgBox").style.display = "block";
    document.getElementById("qImg").src = q.image;
  } else {
    document.getElementById("imgBox").style.display = "none";
  }

  // build option order (stable per question)
  const p = ensureProgress(qid);
  const optionOrder = (p._optionOrder && Array.isArray(p._optionOrder) && p._optionOrder.length === q.options.length)
    ? p._optionOrder
    : shuffle([...Array(q.options.length).keys()]);
  p._optionOrder = optionOrder;
  saveProgress();

  const optionsBox = document.getElementById("optionsBox");
  optionsBox.innerHTML = "";
  optionOrder.forEach((origIdx, displayIdx) => {
    const id = `opt_${displayIdx}`;
    const optText = q.options[origIdx];
    const div = document.createElement("label");
    div.className = "opt";
    div.setAttribute("for", id);
    div.innerHTML = `
      <span class="letter">${letters[displayIdx]}</span>
      <input type="radio" name="opt" id="${id}" value="${displayIdx}">
      <div style="flex:1"><div>${escapeHtml(optText)}</div></div>
    `;
    optionsBox.appendChild(div);
  });

  // restore last selection if exists
  if(p.lastAnswerIndex != null){
    const radio = document.getElementById(`opt_${p.lastAnswerIndex}`);
    if(radio) radio.checked = true;
  }

  document.getElementById("explainBox").style.display = "none";

  document.getElementById("prevBtn").disabled = (session.index === 0);
  document.getElementById("nextBtn").disabled = (session.index === session.block.length - 1);

  startTimer();
  updateMeta();
}

function updateMeta(){
  const qid = session.block[session.index];
  if(!qid){
    document.getElementById("spentLabel").textContent = "0s";
    document.getElementById("statusLabel").textContent = "—";
    document.getElementById("flagLabel").textContent = "—";
    return;
  }
  const p = ensureProgress(qid);
  document.getElementById("spentLabel").textContent = `${p.timeSpentSec}s`;
  document.getElementById("statusLabel").textContent = p.status;
  document.getElementById("flagLabel").textContent = p.flagged ? "Yes" : "No";
}

function getSelectedDisplayIndex(){
  const checked = document.querySelector('input[name="opt"]:checked');
  if(!checked) return null;
  return parseInt(checked.value, 10);
}

function lockOptions(){
  document.querySelectorAll('input[name="opt"]').forEach(x => x.disabled = true);
}

function highlightOptions({chosenDisplayIdx, showCorrect}){
  const qid = session.block[session.index];
  const q = getQById(qid);
  const p = ensureProgress(qid);
  const order = p._optionOrder;
  const correctDisplayIdx = order.findIndex(origIdx => origIdx === q.correctIndex);

  document.querySelectorAll(".opt").forEach((el, displayIdx) => {
    el.classList.remove("correct","wrong","chosen");
    if(displayIdx === chosenDisplayIdx) el.classList.add("chosen");
    if(showCorrect){
      if(displayIdx === correctDisplayIdx) el.classList.add("correct");
      else if(displayIdx === chosenDisplayIdx && chosenDisplayIdx !== correctDisplayIdx) el.classList.add("wrong");
    }
  });

  return { correctDisplayIdx };
}

function showExplanationUI({chosenDisplayIdx}){
  const qid = session.block[session.index];
  const q = getQById(qid);
  const p = ensureProgress(qid);
  const order = p._optionOrder;
  const correctDisplayIdx = order.findIndex(origIdx => origIdx === q.correctIndex);

  const your = (chosenDisplayIdx == null)
    ? "—"
    : `${letters[chosenDisplayIdx]}) ${q.options[order[chosenDisplayIdx]]}`;
  const corr = `${letters[correctDisplayIdx]}) ${q.options[q.correctIndex]}`;

  document.getElementById("explainText").textContent = q.explanation || "";
  document.getElementById("objText").textContent = q.objective || "";
  document.getElementById("correctText").textContent = corr;
  document.getElementById("yourText").textContent = your;
  document.getElementById("timeText").textContent = `${ensureProgress(qid).timeSpentSec}s (total)`;

  document.getElementById("explainBox").style.display = "block";
}

function submitAnswer(){
  if(session.block.length === 0) return;

  const qid = session.block[session.index];
  const q = getQById(qid);
  const p = ensureProgress(qid);

  const chosen = getSelectedDisplayIndex();
  if(chosen == null){
    toast("Pick an answer first 🙂");
    return;
  }

  commitTimeSpentForCurrent();
  stopTimer();

  p.lastAnswerIndex = chosen;
  p.attempts = (p.attempts || 0) + 1;

  const order = p._optionOrder;
  const chosenOrigIdx = order[chosen];
  const isCorrect = (chosenOrigIdx === q.correctIndex);

  p.status = isCorrect ? "CORRECT" : "INCORRECT";
  saveProgress();

  highlightOptions({ chosenDisplayIdx: chosen, showCorrect: true });
  lockOptions();
  session.locked = true;

  updateMeta();
  updateHeaderCounts();

  if(session.mode === "TUTOR"){
    session.revealed = true;
    showExplanationUI({ chosenDisplayIdx: chosen });
  } else {
    document.getElementById("revealBtn").style.display = "inline-block";
  }

  toast(isCorrect ? "Correct ✅" : "Incorrect ❌");
}

function revealExplanation(){
  if(session.revealed) return;
  const chosen = getSelectedDisplayIndex();
  session.revealed = true;
  showExplanationUI({ chosenDisplayIdx: chosen });
  toast("Explanation shown.");
}

function skipQuestion(){
  if(session.block.length === 0) return;

  const qid = session.block[session.index];
  const p = ensureProgress(qid);

  commitTimeSpentForCurrent();
  stopTimer();

  if(p.status === "UNSEEN") p.status = "SKIPPED";
  p.lastAnswerIndex = null;
  saveProgress();

  updateMeta();
  updateHeaderCounts();
  toast("Skipped.");

  if(session.index < session.block.length - 1){
    session.index++;
    renderCurrentQuestion();
  } else {
    renderCurrentQuestion();
  }
}

function go(delta){
  if(session.block.length === 0) return;

  commitTimeSpentForCurrent();
  stopTimer();

  const nextIndex = session.index + delta;
  if(nextIndex < 0 || nextIndex >= session.block.length) return;
  session.index = nextIndex;
  renderCurrentQuestion();
}

function toggleFlag(){
  if(session.block.length === 0) return;
  const qid = session.block[session.index];
  const p = ensureProgress(qid);
  p.flagged = !p.flagged;
  saveProgress();
  updateMeta();
  updateHeaderCounts();
  toast(p.flagged ? "Flagged 🚩" : "Unflagged");
}

function resetProgress(){
  if(!confirm("Reset ALL progress? Clears flags, status, time spent.")) return;
  progress = {};
  saveProgress();
  toast("Progress reset.");
  updateHeaderCounts();
  renderCurrentQuestion();
  renderReview();
  renderAnalytics();
}

/** ===========================
 *  7) REVIEW SCREEN
 *  =========================== */
function statusBadge(status){
  if(status === "CORRECT") return `<span class="badge good">CORRECT</span>`;
  if(status === "INCORRECT") return `<span class="badge bad">INCORRECT</span>`;
  if(status === "SKIPPED") return `<span class="badge warn">SKIPPED</span>`;
  return `<span class="badge neutral">UNSEEN</span>`;
}

function renderReview(){
  updateHeaderCounts();

  const tbody = document.getElementById("reviewTbody");
  tbody.innerHTML = "";

  if(session.block.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No block loaded. Build a block first.</td></tr>`;
    document.getElementById("answeredInBlock").textContent = "0";
    document.getElementById("unseenInBlock").textContent = "0";
    document.getElementById("flaggedInBlock").textContent = "0";
    return;
  }

  let answered=0, unseen=0, flagged=0;

  session.block.forEach((qid, idx) => {
    const q = getQById(qid);
    const p = ensureProgress(qid);

    if(p.flagged) flagged++;
    if(p.status === "UNSEEN") unseen++;
    else answered++;

    const sysTop = `${escapeHtml(q.system || "-")} / ${escapeHtml(q.topic || "-")}`;
    const flagTxt = p.flagged ? `<span class="badge warn">FLAGGED</span>` : `<span class="badge neutral">—</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="nowrap">${idx+1}</td>
      <td class="nowrap"><button class="linkbtn" data-jump="${idx}">${escapeHtml(qid)}</button></td>
      <td>${sysTop}</td>
      <td class="nowrap">${statusBadge(p.status)}</td>
      <td class="nowrap">${flagTxt}</td>
      <td class="nowrap">${p.timeSpentSec}s</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById("answeredInBlock").textContent = answered;
  document.getElementById("unseenInBlock").textContent = unseen;
  document.getElementById("flaggedInBlock").textContent = flagged;

  tbody.querySelectorAll("button[data-jump]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-jump"), 10);
      session.index = idx;
      saveJSON(LS_BLOCK, session.block);
      setActiveTab("P");
      toast(`Jumped to ${session.block[idx]}`);
    });
  });
}

function markAllUnseen(){
  if(session.block.length === 0) return;
  if(!confirm("Mark ALL questions in this block as UNSEEN?")) return;
  for(const qid of session.block){
    const p = ensureProgress(qid);
    p.status = "UNSEEN";
    p.lastAnswerIndex = null;
    // keep time spent (you can change this behavior if you want)
  }
  saveProgress();
  toast("Block set to UNSEEN.");
  renderReview();
  renderCurrentQuestion();
  renderAnalytics();
  updateHeaderCounts();
}

function clearFlagsInBlock(){
  if(session.block.length === 0) return;
  for(const qid of session.block){
    ensureProgress(qid).flagged = false;
  }
  saveProgress();
  toast("Flags cleared (block).");
  renderReview();
  renderCurrentQuestion();
  renderAnalytics();
  updateHeaderCounts();
}

/** ===========================
 *  8) ANALYTICS
 *  =========================== */
function computeOverall(){
  let total = QUESTIONS.length;
  let correct=0, incorrect=0, unseen=0, skipped=0, flagged=0;
  let attempted=0;
  let timeSum=0;
  for(const q of QUESTIONS){
    const p = ensureProgress(q.qid);
    if(p.flagged) flagged++;
    if(p.status === "CORRECT") { correct++; attempted++; }
    else if(p.status === "INCORRECT") { incorrect++; attempted++; }
    else if(p.status === "SKIPPED") { skipped++; attempted++; }
    else unseen++;
    timeSum += (p.timeSpentSec || 0);
  }
  const acc = attempted ? Math.round((correct/attempted)*100) : 0;
  const avgTime = attempted ? Math.round(timeSum / attempted) : 0;
  const flagRate = total ? Math.round((flagged/total)*100) : 0;

  return { total, correct, incorrect, unseen, skipped, flagged, attempted, acc, avgTime, flagRate };
}

function groupStats(groupBy){
  // groupBy: "SYSTEM" | "TOPIC"
  const map = new Map();
  for(const q of QUESTIONS){
    const key = groupBy === "SYSTEM" ? (q.system || "—") : (q.topic || "—");
    const p = ensureProgress(q.qid);

    if(!map.has(key)){
      map.set(key, { key, correct:0, incorrect:0, skipped:0, unseen:0, attempts:0, timeSum:0, flagged:0, total:0 });
    }
    const g = map.get(key);
    g.total++;

    if(p.flagged) g.flagged++;
    g.timeSum += (p.timeSpentSec || 0);

    if(p.status === "CORRECT"){ g.correct++; g.attempts++; }
    else if(p.status === "INCORRECT"){ g.incorrect++; g.attempts++; }
    else if(p.status === "SKIPPED"){ g.skipped++; g.attempts++; }
    else g.unseen++;
  }

  const arr = Array.from(map.values()).map(g => {
    const acc = g.attempts ? (g.correct / g.attempts) : 0;
    const avgTime = g.attempts ? (g.timeSum / g.attempts) : 0;
    return { ...g, acc, avgTime };
  });

  return arr;
}

function renderAnalytics(){
  updateHeaderCounts();

  const overall = computeOverall();
  document.getElementById("anTotal").textContent = overall.total;
  document.getElementById("anAcc").textContent = `${overall.acc}%`;
  document.getElementById("anAvgTime").textContent = `${overall.avgTime}s`;
  document.getElementById("anFlagRate").textContent = `${overall.flagRate}%`;

  document.getElementById("anCorrect").textContent = overall.correct;
  document.getElementById("anIncorrect").textContent = overall.incorrect;
  document.getElementById("anUnseen").textContent = overall.unseen;
  document.getElementById("anSkipped").textContent = overall.skipped;

  const groupBy = document.getElementById("analyticsGroupBy").value;
  const sortBy = document.getElementById("analyticsSort").value;

  let groups = groupStats(groupBy);

  // weakest lists (only if attempts > 0)
  const attemptedGroups = groups.filter(g => g.attempts > 0);
  const weakSystems = groupStats("SYSTEM").filter(g=>g.attempts>0).sort((a,b)=>a.acc-b.acc).slice(0,5);
  const weakTopics  = groupStats("TOPIC").filter(g=>g.attempts>0).sort((a,b)=>a.acc-b.acc).slice(0,5);

  document.getElementById("weakSystems").textContent =
    weakSystems.length ? weakSystems.map(g => `${g.key} (${Math.round(g.acc*100)}%)`).join(" • ") : "—";
  document.getElementById("weakTopics").textContent =
    weakTopics.length ? weakTopics.map(g => `${g.key} (${Math.round(g.acc*100)}%)`).join(" • ") : "—";

  // sorting
  if(sortBy === "ACC_ASC") groups.sort((a,b)=>a.acc-b.acc);
  if(sortBy === "ACC_DESC") groups.sort((a,b)=>b.acc-a.acc);
  if(sortBy === "ATTEMPTS_DESC") groups.sort((a,b)=>b.attempts-a.attempts);
  if(sortBy === "TIME_DESC") groups.sort((a,b)=>b.avgTime-a.avgTime);

  const tbody = document.getElementById("analyticsTbody");
  tbody.innerHTML = "";

  groups.forEach(g => {
    const accPct = g.attempts ? `${Math.round(g.acc*100)}%` : "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(g.key)}</td>
      <td class="nowrap">${accPct}</td>
      <td class="nowrap">${g.correct}</td>
      <td class="nowrap">${g.incorrect}</td>
      <td class="nowrap">${g.skipped}</td>
      <td class="nowrap">${g.unseen}</td>
      <td class="nowrap">${g.attempts}</td>
      <td class="nowrap">${g.attempts ? Math.round(g.avgTime) + "s" : "—"}</td>
      <td class="nowrap">${g.flagged}</td>
    `;
    tbody.appendChild(tr);
  });
}

function exportProgress(){
  const data = {
    exportedAt: new Date().toISOString(),
    progress,
    currentBlock: session.block
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "step1_progress_export.json";
  a.click();
  URL.revokeObjectURL(url);
  toast("Exported progress JSON.");
}

/** ===========================
 *  9) EVENTS
 *  =========================== */
document.getElementById("tabPractice").addEventListener("click", ()=>setActiveTab("P"));
document.getElementById("tabReview").addEventListener("click", ()=>setActiveTab("R"));
document.getElementById("tabAnalytics").addEventListener("click", ()=>setActiveTab("A"));

document.getElementById("buildBlockBtn").addEventListener("click", buildBlock);
document.getElementById("newBlockBtn").addEventListener("click", newBlockReshuffle);
document.getElementById("resetProgressBtn").addEventListener("click", resetProgress);

document.getElementById("modeSelect").addEventListener("change", updateModeLabel);
document.getElementById("toReviewBtn").addEventListener("click", ()=>setActiveTab("R"));
document.getElementById("backToPracticeBtn").addEventListener("click", ()=>setActiveTab("P"));
document.getElementById("backToPracticeBtn2").addEventListener("click", ()=>setActiveTab("P"));

document.getElementById("markUnseenBtn").addEventListener("click", markAllUnseen);
document.getElementById("clearFlagsBtn").addEventListener("click", clearFlagsInBlock);

document.getElementById("prevBtn").addEventListener("click", ()=>go(-1));
document.getElementById("nextBtn").addEventListener("click", ()=>go(1));
document.getElementById("skipBtn").addEventListener("click", skipQuestion);
document.getElementById("flagBtn").addEventListener("click", toggleFlag);

document.getElementById("submitBtn").addEventListener("click", submitAnswer);
document.getElementById("revealBtn").addEventListener("click", revealExplanation);

document.getElementById("analyticsGroupBy").addEventListener("change", renderAnalytics);
document.getElementById("analyticsSort").addEventListener("change", renderAnalytics);
document.getElementById("exportProgressBtn").addEventListener("click", exportProgress);

// keyboard shortcuts
window.addEventListener("keydown", (e)=>{
  if(e.target && ["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;

  if(e.key === "ArrowLeft") go(-1);
  if(e.key === "ArrowRight") go(1);
  if(e.key === "Enter") submitAnswer();
  if(e.key.toLowerCase() === "f") toggleFlag();
  if(e.key.toLowerCase() === "s") skipQuestion();
  if(e.key.toLowerCase() === "r") setActiveTab("R");
  if(e.key.toLowerCase() === "a") setActiveTab("A");
});

/** ===========================
 *  10) INIT
 *  =========================== */
(async function initApp(){
  try {
    await loadQuestions();
    initFilters();
    updateHeaderCounts();
    if(session.block.length > 0){
      // ensure index safe
      if(session.index >= session.block.length) session.index = 0;
      renderCurrentQuestion();
    } else {
      renderEmptyState("Build a block to start.");
    }
    toast(`Loaded ${QUESTIONS.length} questions.`);
  } catch (err) {
    console.error(err);
    renderEmptyState("Could not load questions.json");
  }
})();
