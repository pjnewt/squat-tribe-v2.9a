const PROFILE_KEY = "squatTribe_v29a_profile";
const HISTORY_KEY = "squatTribe_v29a_history";
const ROTATION_KEY = "squatTribe_v29a_rotation";

const EXERCISES = [
  { key: "back", name: "Back Squat", type: "bilateral", coeff: 0.70, image: "SS Back squat.png" },
  { key: "bulgarian", name: "Bulgarian Squat", type: "unilateral", coeff: 0.85, image: "SS Bulgarian squat.png" },
  { key: "front", name: "Front Squat", type: "bilateral", coeff: 0.70, image: "SS Front squat.png" },
  { key: "sidestep", name: "Side Step", type: "unilateral", coeff: 0.85, image: "SS Side step.png" },
  { key: "sumo", name: "Sumo Squat", type: "bilateral", coeff: 0.70, image: "SS Sumo squat.png" }
];

const HISTORY_FILTERS = [
  { key: "all", label: "All exercises" },
  ...EXERCISES.map(ex => ({ key: ex.key, label: ex.name }))
];

let reps = 0;
let running = false;
let timer = 0;
let tInt = null;

let anchorReps = 0;
let anchorTime = 0;
let myoTarget = 0;
let totalReps = 0;
let totalTime = 0;
let myoLog = [];
let currentPhase = "anchor";

let buffer = [];
let lastState = "up";
let lastTime = 0;

let currentExerciseIndex = 0;

let unilateralMode = false;
let weakerSide = "left";
let activeSide = "both";
let sideStage = "first";
let sideResults = { left: null, right: null };
let mirroredPlan = null;

let anchorRestTimeout = null;
let myoRestTimeout = null;
let restCountdownInterval = null;
let restRemaining = null;

let pendingSession = null;
let historyFilter = "all";

let deferredInstallPrompt = null;
let swRegistration = null;
let refreshingForUpdate = false;
let installPromptReceived = false;

const el = id => document.getElementById(id);

document.addEventListener("DOMContentLoaded", init);

async function init() {
  loadProfileIntoForm();
  loadRotation();
  bindUI();
  populateHistoryFilter();
  await setupPWA();
  updateInstallUI();
  updateOfflineStatus();
  renderHome();
}

function bindUI() {
  el("btnInfo").addEventListener("click", () => showScreen("screen-info"));
  el("btnProfile").addEventListener("click", () => {
    loadProfileIntoForm();
    showScreen("screen-profile");
  });
  el("btnHistory").addEventListener("click", showHistory);

  document.querySelectorAll("[data-back='home']").forEach(btn => {
    btn.addEventListener("click", renderHome);
  });

  el("btnSaveProfile").addEventListener("click", saveProfile);

  el("btnStartExercise").addEventListener("click", startSelectedExercise);

  el("btnStartAnchor").addEventListener("click", startAnchorSet);
  el("btnStopSet").addEventListener("click", stopSet);
  el("btnSaveSet").addEventListener("click", saveSet);
  el("btnStartMyo").addEventListener("click", startMyo);
  el("btnFinishSession").addEventListener("click", finishSession);

  el("btnSaveSessionChoice").addEventListener("click", commitPendingSession);
  el("btnDeleteSessionChoice").addEventListener("click", discardPendingSession);

  el("historyFilter").addEventListener("change", e => {
    historyFilter = e.target.value;
    renderHistoryList();
  });
  el("btnExportHistory").addEventListener("click", exportHistoryJson);
  el("btnDeleteExerciseHistory").addEventListener("click", deleteFilteredHistory);
  el("btnClearHistory").addEventListener("click", clearHistory);

  el("btnInstallApp").addEventListener("click", promptInstall);
  el("btnRefreshApp").addEventListener("click", refreshAppToUpdate);

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installPromptReceived = true;
    updateInstallUI();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallUI(true);
  });

  window.addEventListener("online", updateOfflineStatus);
  window.addEventListener("offline", updateOfflineStatus);
}

async function setupPWA() {
  if (!("serviceWorker" in navigator)) return;

  try {
    swRegistration = await navigator.serviceWorker.register("./service-worker.js");

    if (swRegistration.waiting) {
      showUpdateCard(true);
    }

    swRegistration.addEventListener("updatefound", () => {
      const newWorker = swRegistration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateCard(true);
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshingForUpdate) return;
      refreshingForUpdate = true;
      window.location.reload();
    });
  } catch (err) {
    console.error("Service worker registration failed:", err);
  }
}

function updateOfflineStatus() {
  const offlineText = el("offlineStatusText");
  if (!offlineText) return;

  const online = navigator.onLine;
  const swReady = !!navigator.serviceWorker;

  if (online && swReady) {
    offlineText.textContent = "Online. App cache available for offline use once installed and loaded.";
  } else if (!online) {
    offlineText.textContent = "Offline. Cached app content should still work if previously loaded.";
  } else {
    offlineText.textContent = "Online. Service worker unavailable.";
  }
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function updateInstallUI(forceInstalled = false) {
  const installed = forceInstalled || isStandaloneMode();

  const installCard = el("installCard");
  const helpCard = el("installHelpCard");
  const installStatus = el("installStatus");
  const helpStatus = el("installHelpStatus");

  if (installed) {
    installCard.style.display = "block";
    helpCard.style.display = "none";
    installStatus.textContent = "Installed";
    el("btnInstallApp").style.display = "none";
    return;
  }

  if (deferredInstallPrompt) {
    installCard.style.display = "block";
    helpCard.style.display = "none";
    installStatus.textContent = "Install prompt available";
    el("btnInstallApp").style.display = "block";
    return;
  }

  installCard.style.display = "none";
  helpCard.style.display = "block";

  const ua = navigator.userAgent || "";
  const isAndroidChrome = /Android/i.test(ua) && /Chrome/i.test(ua);
  const isDesktopChrome = !/Android|iPhone|iPad/i.test(ua) && /Chrome/i.test(ua);

  if (isAndroidChrome) {
    el("installHelpText").innerHTML =
      `Open the browser menu and choose <strong>Add to Home screen</strong> or <strong>Install app</strong>.`;
  } else if (isDesktopChrome) {
    el("installHelpText").innerHTML =
      `Use the install icon in the address bar or the browser menu to install the app.`;
  } else {
    el("installHelpText").innerHTML =
      `Use your browser’s menu to add this app to your home screen if supported.`;
  }

  helpStatus.textContent = installPromptReceived
    ? "Install prompt not currently available"
    : "Waiting for browser install availability";
}

function showUpdateCard(show) {
  const card = el("updateCard");
  if (card) card.style.display = show ? "block" : "none";
}

async function promptInstall() {
  if (!deferredInstallPrompt) {
    updateInstallUI();
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  updateInstallUI();
}

function refreshAppToUpdate() {
  if (swRegistration && swRegistration.waiting) {
    swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
  } else {
    window.location.reload();
  }
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
  el(id).classList.add("active");
}

function getProfile() {
  return JSON.parse(localStorage.getItem(PROFILE_KEY) || JSON.stringify({
    bodyweight: 70,
    sensitivity: "high",
    coach: "off"
  }));
}

function saveProfile() {
  const profile = {
    bodyweight: parseFloat(el("profileBodyweight").value || "70"),
    sensitivity: el("profileSensitivity").value,
    coach: el("profileCoach").value
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  renderHome();
}

function loadProfileIntoForm() {
  const profile = getProfile();
  el("profileBodyweight").value = profile.bodyweight;
  el("profileSensitivity").value = profile.sensitivity;
  el("profileCoach").value = profile.coach || "off";
}

function coach(message) {
  const profile = getProfile();
  const box = el("coachBox");
  const text = el("coachText");

  if (!box || !text) return;

  if (profile.coach !== "on") {
    box.style.display = "none";
    text.innerHTML = "";
    return;
  }

  box.style.display = "block";
  text.innerHTML = message;
}

function loadRotation() {
  currentExerciseIndex = parseInt(localStorage.getItem(ROTATION_KEY) || "0", 10);
  if (Number.isNaN(currentExerciseIndex) || currentExerciseIndex < 0 || currentExerciseIndex > 4) {
    currentExerciseIndex = 0;
  }
}

function saveRotation() {
  localStorage.setItem(ROTATION_KEY, String(currentExerciseIndex));
}

function getCurrentExercise() {
  return EXERCISES[currentExerciseIndex];
}

function getHistory() {
  return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
}

function setHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function populateHistoryFilter() {
  const select = el("historyFilter");
  if (!select) return;
  select.innerHTML = HISTORY_FILTERS.map(opt => (
    `<option value="${opt.key}">${opt.label}</option>`
  )).join("");
  select.value = historyFilter;
}

function renderHome() {
  loadRotation();
  renderCycleProgress();
  renderPentagon();
  renderSelectedExercise();
  updateInstallUI();
  updateOfflineStatus();
  showScreen("screen-home");
}

function renderCycleProgress() {
  const completed = currentExerciseIndex;
  const percent = (completed / EXERCISES.length) * 100;
  el("cycleProgressText").textContent = `${completed} / ${EXERCISES.length} complete`;
  el("cycleBadge").textContent = `Day ${currentExerciseIndex + 1}`;
  el("cycleFill").style.width = `${percent}%`;
}

function renderPentagon() {
  const svgGroup = el("pentagonPoints");
  if (!svgGroup) return;
  svgGroup.innerHTML = "";

  const positions = [
    { x: 160, y: 35, tx: 160, ty: 20 },
    { x: 275, y: 118, tx: 296, ty: 122 },
    { x: 230, y: 255, tx: 248, ty: 276 },
    { x: 90, y: 255, tx: 72, ty: 276 },
    { x: 45, y: 118, tx: 24, ty: 122 }
  ];

  EXERCISES.forEach((exercise, i) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "pentagon-point");
    g.addEventListener("click", () => {
      currentExerciseIndex = i;
      saveRotation();
      renderHome();
    });

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", positions[i].x);
    circle.setAttribute("cy", positions[i].y);
    circle.setAttribute("r", 16);

    let cls = "pentagon-dot";
    if (i < currentExerciseIndex) cls += " complete";
    else cls += " upcoming";
    if (i === currentExerciseIndex) cls += " active";
    circle.setAttribute("class", cls);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", positions[i].tx);
    label.setAttribute("y", positions[i].ty);
    label.setAttribute("class", "pentagon-label");
    label.textContent = String(i + 1);

    g.appendChild(circle);
    g.appendChild(label);
    svgGroup.appendChild(g);
  });

  const currentExercise = getCurrentExercise();
  el("avgTrdsValue").textContent = getAverageTRDSForExercise(currentExercise.key).toFixed(2);
}

function renderSelectedExercise() {
  const exercise = getCurrentExercise();
  el("selectedExerciseName").textContent = exercise.name;
  el("selectedExerciseStatus").textContent =
    exercise.type === "unilateral" ? "Weaker side first" : "Ready to train";

  el("selectedExerciseImage").innerHTML = getExerciseArt(exercise);
  el("selectedExerciseTrend").textContent = getExerciseTrendText(exercise.key);

  const last = getLastSessionForExercise(exercise.key);
  if (!last) {
    el("lastSessionSummary").textContent = "No sessions yet.";
    return;
  }

  if (exercise.type === "bilateral") {
    const myoPattern = last.myoSets?.length ? last.myoSets.map(set => set.reps).join(", ") : "none";
    el("lastSessionSummary").innerHTML =
      `Anchor: ${last.anchorReps} reps<br>Myo sets: ${last.myoSets.length}<br>Myo reps: ${myoPattern}<br>Total TRDS: ${last.TRDS}`;
  } else {
    el("lastSessionSummary").innerHTML =
      `${renderSideSummary("Left", last.left)}<br>${renderSideSummary("Right", last.right)}<br>Difference: ${last.diffPct || "0.00"}%<br>Total TRDS: ${last.TRDS}`;
  }
}

function getExerciseTrendText(exerciseKey) {
  const sessions = getHistory().filter(item => item.exerciseKey === exerciseKey);
  if (sessions.length < 2) return "Trend: build more data";

  const latest = parseFloat(sessions[0].TRDS);
  const previous = parseFloat(sessions[1].TRDS);
  const delta = latest - previous;

  if (delta > 0.5) return `Trend: improving (+${delta.toFixed(2)} TRDS)`;
  if (delta < -0.5) return `Trend: down (${delta.toFixed(2)} TRDS)`;
  return "Trend: stable";
}

function renderSideSummary(label, side) {
  if (!side) return `${label}: no data`;
  const myoPattern = side.myoSets?.length ? side.myoSets.map(set => set.reps).join(", ") : "none";
  return `${label} — Anchor: ${side.anchorReps}, Myo: ${myoPattern}, TRDS: ${side.TRDS}`;
}

function startSelectedExercise() {
  const exercise = getCurrentExercise();
  const profile = getProfile();

  el("sessionExerciseName").textContent = exercise.name;
  el("sessionExerciseImage").innerHTML = getExerciseArt(exercise);
  el("sessionBodyweight").value = profile.bodyweight;
  el("sessionExternalWeight").value = 0;

  unilateralMode = exercise.type === "unilateral";
  el("weakerSideWrap").style.display = unilateralMode ? "grid" : "none";

  weakerSide = unilateralMode ? el("weakerSide").value : "both";
  activeSide = weakerSide;

  el("sessionSupportText").textContent =
    unilateralMode ? `Unilateral session (${activeSide.toUpperCase()} first)` : "Bilateral session";

  renderPreviousExerciseSummary(exercise);
  resetSessionState();

  const externalWeight = parseFloat(el("sessionExternalWeight").value || "0");
  const effectiveLoad = externalWeight + (profile.bodyweight * exercise.coeff);

  coach(
    `Effective Load: ${effectiveLoad.toFixed(1)} kg<br>` +
    `Calculation: ${externalWeight.toFixed(1)} + (${profile.bodyweight.toFixed(1)} × ${exercise.coeff.toFixed(2)})`
  );

  showScreen("screen-session");
}

function renderPreviousExerciseSummary(exercise) {
  const last = getLastSessionForExercise(exercise.key);
  const target = el("previousExerciseSummary");
  if (!target) return;

  if (!last) {
    target.textContent = "No previous data.";
    return;
  }

  if (exercise.type === "bilateral") {
    const myoPattern = last.myoSets?.length
      ? last.myoSets.map(set => set.reps).join(", ")
      : "none";

    target.innerHTML =
      `External Load: ${(last.externalWeight ?? 0).toFixed(1)} kg<br>` +
      `Anchor: ${last.anchorReps} reps<br>` +
      `Myo sets: ${last.myoSets.length}<br>` +
      `Myo reps: ${myoPattern}<br>` +
      `Total TRDS: ${last.TRDS}`;
  } else {
    const leftSets = last.left?.myoSets?.map(set => set.reps).join(", ") || "none";
    const rightSets = last.right?.myoSets?.map(set => set.reps).join(", ") || "none";

    target.innerHTML =
      `External Load: ${(last.externalWeight ?? 0).toFixed(1)} kg<br>` +
      `Left Anchor: ${last.left?.anchorReps ?? "-"} | Myo: ${leftSets}<br>` +
      `Right Anchor: ${last.right?.anchorReps ?? "-"} | Myo: ${rightSets}<br>` +
      `Total TRDS: ${last.TRDS}`;
  }
}

function clearPhaseTimeouts() {
  if (anchorRestTimeout) {
    clearTimeout(anchorRestTimeout);
    anchorRestTimeout = null;
  }
  if (myoRestTimeout) {
    clearTimeout(myoRestTimeout);
    myoRestTimeout = null;
  }
  clearRestCountdown();
}

function startRestCountdown(seconds) {
  clearRestCountdown();
  restRemaining = seconds;
  el("rest").innerText = String(restRemaining);

  restCountdownInterval = setInterval(() => {
    restRemaining -= 1;
    el("rest").innerText = restRemaining > 0 ? String(restRemaining) : "0";

    if (restRemaining <= 0) {
      clearRestCountdown();
    }
  }, 1000);
}

function clearRestCountdown() {
  if (restCountdownInterval) {
    clearInterval(restCountdownInterval);
    restCountdownInterval = null;
  }
  restRemaining = null;
  if (el("rest")) el("rest").innerText = "-";
}

function resetSessionState() {
  clearPhaseTimeouts();

  reps = 0;
  running = false;
  timer = 0;
  anchorReps = 0;
  anchorTime = 0;
  myoTarget = 0;
  totalReps = 0;
  totalTime = 0;
  myoLog = [];
  currentPhase = "anchor";
  buffer = [];
  lastState = "up";
  lastTime = 0;
  clearInterval(tInt);

  sideStage = "first";
  mirroredPlan = null;
  sideResults = { left: null, right: null };
  weakerSide = unilateralMode ? el("weakerSide").value : "both";
  activeSide = weakerSide;

  pendingSession = null;

  el("phase").innerText = unilateralMode ? `READY (${activeSide.toUpperCase()})` : "READY";
  el("reps").innerText = "0";
  el("time").innerText = "0";
  el("target").innerText = "-";
  el("rest").innerText = "-";

  updateButtons("pre-anchor");
}

function updateButtons(state) {
  el("btnStartAnchor").style.display = "none";
  el("btnStartMyo").style.display = "none";
  el("btnStopSet").style.display = "none";
  el("btnSaveSet").style.display = "none";
  el("btnFinishSession").style.display = "block";

  if (state === "pre-anchor") {
    el("btnStartAnchor").style.display = "block";
  }

  if (state === "anchor-running") {
    el("btnStopSet").style.display = "block";
    el("btnSaveSet").style.display = "block";
  }

  if (state === "myo-ready") {
    el("btnStartMyo").style.display = "block";
  }

  if (state === "myo-running") {
    el("btnStopSet").style.display = "block";
    el("btnSaveSet").style.display = "block";
  }
}

function resetSetReadout() {
  reps = 0;
  timer = 0;
  buffer = [];
  lastState = "up";
  lastTime = 0;
  el("reps").innerText = "0";
  el("time").innerText = "0";
}

function startAnchorSet() {
  if (running) return;

  if (unilateralMode) {
    weakerSide = el("weakerSide").value;
    if (sideStage === "first") {
      activeSide = weakerSide;
    }
  }

  clearRestCountdown();
  resetSetReadout();
  running = true;
  currentPhase = "anchor";

  el("phase").innerText = unilateralMode ? `ANCHOR (${activeSide.toUpperCase()})` : "ANCHOR";
  el("target").innerText =
    unilateralMode && sideStage === "second" && mirroredPlan
      ? String(mirroredPlan.anchorReps)
      : "-";

  updateButtons("anchor-running");

  tInt = setInterval(() => {
    timer++;
    el("time").innerText = String(timer);
  }, 1000);

  window.addEventListener("devicemotion", detect);
}

function stopSet() {
  running = false;
  clearInterval(tInt);
  window.removeEventListener("devicemotion", detect);

  if (currentPhase === "anchor" || currentPhase === "myo") {
    el("btnStopSet").style.display = "block";
    el("btnSaveSet").style.display = "block";
    el("btnStartAnchor").style.display = "none";
    el("btnStartMyo").style.display = "none";
  }
}

function saveSet() {
  const profileBodyweight = parseFloat(el("sessionBodyweight").value || "70");
  const externalWeight = parseFloat(el("sessionExternalWeight").value || "0");
  const exercise = getCurrentExercise();
  const load = externalWeight + (profileBodyweight * exercise.coeff);

  if (currentPhase === "anchor") {
    if (reps <= 0) {
      el("phase").innerText = "NO REPS";
      return;
    }

    if (unilateralMode && sideStage === "second" && mirroredPlan && reps !== mirroredPlan.anchorReps) {
      el("phase").innerText = `MATCH ${mirroredPlan.anchorReps} REPS`;
      return;
    }

    anchorReps = reps;
    anchorTime = timer;
    totalReps += reps;
    totalTime += timer;
    myoTarget = Math.max(1, Math.round(anchorReps * 0.2));
    currentPhase = "myo";

    coach(
      `Anchor complete<br>` +
      `${anchorReps} reps in ${anchorTime}s<br>` +
      `Mechanical Load Score (MLS): ${(load * anchorReps).toFixed(0)}<br>` +
      `Total Reps Density Score (TRDS): ${((load * anchorReps) / Math.max(1, anchorTime)).toFixed(2)}<br><br>` +
      `Next Myo target: ${myoTarget}<br>` +
      `(20% of Anchor reps)`
    );

    el("phase").innerText = unilateralMode ? `ANCHOR REST (${activeSide.toUpperCase()})` : "ANCHOR REST";
    el("target").innerText = String(myoTarget);

    updateButtons("anchor-rest");
    clearPhaseTimeouts();
    startRestCountdown(anchorTime);

    coach(
      `Resting ${anchorTime}s<br>` +
      `Rest matches Anchor duration`
    );

    anchorRestTimeout = setTimeout(() => {
      el("phase").innerText = unilateralMode
        ? `READY FOR MYO (${activeSide.toUpperCase()})`
        : "READY FOR MYO";
      updateButtons("myo-ready");
      anchorRestTimeout = null;
      clearRestCountdown();
    }, anchorTime * 1000);

    resetSetReadout();
    return;
  }

  if (currentPhase === "myo") {
    if (reps <= 0) {
      el("phase").innerText = "NO REPS";
      return;
    }

    let expectedTarget = myoTarget;

    if (unilateralMode && sideStage === "second" && mirroredPlan) {
      const expected = mirroredPlan.myoSets[myoLog.length]?.reps;
      if (typeof expected === "number") expectedTarget = expected;

      if (reps !== expectedTarget) {
        el("phase").innerText = `MATCH ${expectedTarget} REPS`;
        return;
      }
    }

    const savedReps = reps;
    const savedTime = timer;
    const myoMLS = load * savedReps;
    const myoTRDS = myoMLS / Math.max(1, savedTime);

    myoLog.push({
      reps: savedReps,
      time: savedTime,
      TRDS: myoTRDS.toFixed(2)
    });

    totalReps += savedReps;
    totalTime += savedTime;

    const anchorTRDS = (load * anchorReps) / Math.max(1, anchorTime);

    coach(
      `Myo set complete<br>` +
      `${savedReps} reps in ${savedTime}s<br>` +
      `TRDS: ${myoTRDS.toFixed(2)}<br>` +
      `${myoTRDS > anchorTRDS ? "Denser than Anchor" : "Below Anchor density"}`
    );

    el("phase").innerText = unilateralMode ? `MYO REST (${activeSide.toUpperCase()})` : "MYO REST";

    clearPhaseTimeouts();
    startRestCountdown(10);

    coach(
      `10s Myo rest<br>` +
      `Short rest maintains density`
    );

    myoRestTimeout = setTimeout(() => {
      el("phase").innerText = unilateralMode
        ? `READY FOR NEXT MYO (${activeSide.toUpperCase()})`
        : "READY FOR NEXT MYO";
      updateButtons("myo-ready");
      myoRestTimeout = null;
      clearRestCountdown();
    }, 10000);

    resetSetReadout();
  }
}

function startMyo() {
  if (currentPhase !== "myo") {
    el("phase").innerText = "COMPLETE ANCHOR FIRST";
    return;
  }

  if (running) return;

  clearRestCountdown();
  resetSetReadout();
  running = true;

  let target = myoTarget;
  if (unilateralMode && sideStage === "second" && mirroredPlan) {
    const matchedSet = mirroredPlan.myoSets[myoLog.length];
    if (!matchedSet) {
      el("phase").innerText = "NO MORE MYO SETS";
      return;
    }
    target = matchedSet.reps;
  }

  el("phase").innerText = unilateralMode ? `MYO (${activeSide.toUpperCase()})` : "MYO";
  el("target").innerText = String(target);
  updateButtons("myo-running");
}

function finishSession() {
  stopSet();

  const profileBodyweight = parseFloat(el("sessionBodyweight").value || "70");
  const externalWeight = parseFloat(el("sessionExternalWeight").value || "0");
  const exercise = getCurrentExercise();

  const profile = getProfile();
  profile.bodyweight = profileBodyweight;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));

  if (!unilateralMode) {
    const load = externalWeight + (profileBodyweight * exercise.coeff);
    const MLS = load * totalReps;
    const TRDS = MLS / Math.max(1, totalTime);
    const anchorTRDS = ((load * anchorReps) / Math.max(1, anchorTime)).toFixed(2);

    pendingSession = {
      exerciseKey: exercise.key,
      exerciseName: exercise.name,
      image: exercise.image,
      date: new Date().toLocaleString(),
      bodyweight: profileBodyweight,
      externalWeight,
      anchorReps,
      anchorTime,
      anchorTRDS,
      myoSets: myoLog.slice(),
      totalReps,
      totalTime,
      MLS: MLS.toFixed(1),
      TRDS: TRDS.toFixed(2)
    };

    showSummary();
    return;
  }

  const sideData = buildSideResult(profileBodyweight, externalWeight, exercise);
  sideResults[activeSide] = sideData;

  if (sideStage === "first") {
    clearPhaseTimeouts();

    mirroredPlan = {
      anchorReps: sideData.anchorReps,
      myoSets: sideData.myoSets.map(set => ({ reps: set.reps }))
    };

    activeSide = weakerSide === "left" ? "right" : "left";
    sideStage = "second";

    reps = 0;
    running = false;
    timer = 0;
    anchorReps = 0;
    anchorTime = 0;
    myoTarget = Math.max(1, Math.round(mirroredPlan.anchorReps * 0.2));
    totalReps = 0;
    totalTime = 0;
    myoLog = [];
    currentPhase = "anchor";
    buffer = [];
    lastState = "up";
    lastTime = 0;
    clearInterval(tInt);

    el("phase").innerText = `SWITCH TO ${activeSide.toUpperCase()}`;
    el("reps").innerText = "0";
    el("time").innerText = "0";
    el("target").innerText = String(mirroredPlan.anchorReps);
    el("rest").innerText = "-";

    updateButtons("pre-anchor");
    return;
  }

  const left = sideResults.left;
  const right = sideResults.right;
  const totalCombinedTRDS = ((parseFloat(left.TRDS) + parseFloat(right.TRDS)) / 2).toFixed(2);
  const diffPct = percentDifference(parseFloat(left.TRDS), parseFloat(right.TRDS)).toFixed(2);

  pendingSession = {
    exerciseKey: exercise.key,
    exerciseName: exercise.name,
    image: exercise.image,
    date: new Date().toLocaleString(),
    bodyweight: profileBodyweight,
    externalWeight,
    weakerSide,
    left,
    right,
    TRDS: totalCombinedTRDS,
    diffPct
  };

  showSummary();
}

function buildSideResult(bodyweight, externalWeight, exercise) {
  const load = externalWeight + (bodyweight * exercise.coeff);
  const MLS = load * totalReps;
  const TRDS = MLS / Math.max(1, totalTime);
  const anchorTRDS = ((load * anchorReps) / Math.max(1, anchorTime)).toFixed(2);

  return {
    anchorReps,
    anchorTime,
    anchorTRDS,
    myoSets: myoLog.slice(),
    totalReps,
    totalTime,
    MLS: MLS.toFixed(1),
    TRDS: TRDS.toFixed(2)
  };
}

function showSummary() {
  if (!pendingSession) return;

  const s = pendingSession;
  let html = `
    <div class="summary-art-wrap">
      ${getExerciseArt({ name: s.exerciseName, image: s.image })}
    </div>
    <div class="summary-section">
      <div class="summary-heading">${s.exerciseName}</div>
      ${s.date}
    </div>
  `;

  if (s.left && s.right) {
    html += `
      <div class="summary-section">
        External Load: ${(s.externalWeight ?? 0).toFixed(1)} kg<br><br>
        <strong>Left</strong><br>
        Anchor: ${s.left.anchorReps} reps (${s.left.anchorTime}s) | TRDS: ${s.left.anchorTRDS}<br>
        ${renderMyoHistory(s.left.myoSets)}
      </div>
      <div class="summary-section">
        <strong>Right</strong><br>
        Anchor: ${s.right.anchorReps} reps (${s.right.anchorTime}s) | TRDS: ${s.right.anchorTRDS}<br>
        ${renderMyoHistory(s.right.myoSets)}
      </div>
      <div class="summary-section">
        <div class="symmetry-label">Balance</div>
        ${renderSymmetryBar(parseFloat(s.left.TRDS), parseFloat(s.right.TRDS))}
        Total TRDS: ${s.TRDS}<br>
        Difference: ${s.diffPct}%<br>
        ${interpretAsymmetry(parseFloat(s.diffPct))}
      </div>
    `;
  } else {
    const bestMyo = getBestMyoTRDS(s.myoSets);
    html += `
      <div class="summary-section">
        External Load: ${(s.externalWeight ?? 0).toFixed(1)} kg<br><br>
        Anchor: ${s.anchorReps} reps (${s.anchorTime}s) | TRDS: ${s.anchorTRDS}<br><br>
        ${renderMyoHistory(s.myoSets)}<br><br>
        Total Reps: ${s.totalReps}<br>
        Total TRDS: ${s.TRDS}<br>
        Best Myo TRDS: ${bestMyo}
      </div>
    `;
  }

  el("summaryContent").innerHTML = html;
  el("sessionInsightBox").innerHTML = generateSessionInsight(s);
  showScreen("screen-summary");
}

function generateSessionInsight(session) {
  if (session.left && session.right) {
    const diff = parseFloat(session.diffPct);
    if (diff < 5) return "Insight: Excellent side-to-side balance.";
    if (diff < 12) return "Insight: Mild asymmetry. Keep matching both sides carefully.";
    return "Insight: Marked asymmetry. Prioritise control and quality on the weaker side.";
  }

  const anchor = parseFloat(session.anchorTRDS);
  const bestMyo = parseFloat(getBestMyoTRDS(session.myoSets) || "0");
  if (bestMyo > anchor) return "Insight: Your Myo work was denser than the Anchor set.";
  if (anchor > bestMyo + 1) return "Insight: Your Anchor set carried most of the density.";
  return "Insight: Anchor and Myo density were well matched.";
}

function getBestMyoTRDS(myoSets) {
  if (!myoSets || !myoSets.length) return "N/A";
  return Math.max(...myoSets.map(set => parseFloat(set.TRDS))).toFixed(2);
}

function interpretAsymmetry(diffPct) {
  if (diffPct < 5) return "Balanced";
  if (diffPct < 12) return "Mild asymmetry";
  return "Marked asymmetry";
}

function commitPendingSession() {
  if (!pendingSession) {
    renderHome();
    return;
  }

  saveHistorySession(pendingSession);
  pendingSession = null;

  currentExerciseIndex = (currentExerciseIndex + 1) % EXERCISES.length;
  saveRotation();

  renderHome();
}

function discardPendingSession() {
  pendingSession = null;
  renderHome();
}

function saveHistorySession(session) {
  const history = getHistory();
  history.unshift(session);
  setHistory(history);
}

function getFilteredHistory() {
  const history = getHistory();
  if (historyFilter === "all") return history;
  return history.filter(item => item.exerciseKey === historyFilter);
}

function renderHistoryList() {
  const history = getFilteredHistory();
  const list = el("historyList");
  if (!history.length) {
    list.innerHTML = `<div class="history-card">No history for this selection.</div>`;
    return;
  }

  list.innerHTML = history.map(h => {
    const previousAvg = getAverageTRDSForExercise(h.exerciseKey).toFixed(2);
    const loadDisplay = (h.externalWeight ?? 0).toFixed(1);

    if (h.left && h.right) {
      return `
        <div class="history-card">
          <div class="history-title">${h.exerciseName}</div>
          <div class="history-sub">${h.date}</div>
          External Load: ${loadDisplay} kg<br><br>
          <strong>Left</strong><br>
          Anchor: ${h.left.anchorReps} reps (${h.left.anchorTime}s) | TRDS: ${h.left.anchorTRDS}<br>
          ${renderMyoHistory(h.left.myoSets)}<br><br>
          <strong>Right</strong><br>
          Anchor: ${h.right.anchorReps} reps (${h.right.anchorTime}s) | TRDS: ${h.right.anchorTRDS}<br>
          ${renderMyoHistory(h.right.myoSets)}<br>
          <div class="symmetry-wrap">
            <div class="symmetry-label">Balance</div>
            ${renderSymmetryBar(parseFloat(h.left.TRDS), parseFloat(h.right.TRDS))}
          </div>
          Total TRDS: ${h.TRDS} (${previousAvg})<br>
          Difference: ${h.diffPct}%<br><br>
          <button class="pill secondary" onclick="deleteSingleSession('${h.date}', '${h.exerciseKey}')">Delete Session</button>
        </div>
      `;
    }

    return `
      <div class="history-card">
        <div class="history-title">${h.exerciseName}</div>
        <div class="history-sub">${h.date}</div>
        External Load: ${loadDisplay} kg<br><br>
        Anchor: ${h.anchorReps} reps (${h.anchorTime}s) | TRDS: ${h.anchorTRDS}<br><br>
        ${renderMyoHistory(h.myoSets)}<br><br>
        Total Reps: ${h.totalReps}<br>
        TRDS: ${h.TRDS} (${previousAvg})<br><br>
        <button class="pill secondary" onclick="deleteSingleSession('${h.date}', '${h.exerciseKey}')">Delete Session</button>
      </div>
    `;
  }).join("");
}

function showHistory() {
  populateHistoryFilter();
  renderHistoryList();
  showScreen("screen-history");
}

function deleteSingleSession(date, exerciseKey) {
  if (!confirm("Delete this session?")) return;
  const history = getHistory().filter(item => !(item.date === date && item.exerciseKey === exerciseKey));
  setHistory(history);
  renderHistoryList();
  renderHome();
}
window.deleteSingleSession = deleteSingleSession;

function deleteFilteredHistory() {
  if (historyFilter === "all") {
    if (!confirm("Delete all sessions?")) return;
    setHistory([]);
  } else {
    if (!confirm("Delete all sessions for this exercise?")) return;
    const history = getHistory().filter(item => item.exerciseKey !== historyFilter);
    setHistory(history);
  }
  renderHistoryList();
  renderHome();
}

function exportHistoryJson() {
  const history = getFilteredHistory();
  const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  const suffix = historyFilter === "all" ? "all" : historyFilter;
  a.href = url;
  a.download = `squat-tribe-history-${suffix}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function renderMyoHistory(myoSets) {
  if (!myoSets || !myoSets.length) return "No Myo sets logged";
  return myoSets.map((set, i) =>
    `Myo ${i + 1}: ${set.reps} reps (${set.time}s) | TRDS: ${set.TRDS}`
  ).join("<br>");
}

function renderSymmetryBar(leftVal, rightVal) {
  const total = leftVal + rightVal || 1;
  const leftPct = (leftVal / total) * 100;
  const rightPct = 100 - leftPct;

  return `
    <div class="symmetry-bar">
      <div class="symmetry-left" style="width:${leftPct}%"></div>
      <div class="symmetry-right" style="width:${rightPct}%"></div>
      <div class="symmetry-mid"></div>
    </div>
    <div class="symmetry-values">L ${leftVal.toFixed(2)} | R ${rightVal.toFixed(2)}</div>
  `;
}

function percentDifference(a, b) {
  const avg = (a + b) / 2 || 1;
  return Math.abs(a - b) / avg * 100;
}

function clearHistory() {
  if (!confirm("Clear all history?")) return;
  setHistory([]);
  renderHistoryList();
  renderHome();
}

function getAverageTRDSForExercise(exerciseKey) {
  const history = getHistory().filter(item => item.exerciseKey === exerciseKey);
  if (!history.length) return 0;
  const sum = history.reduce((acc, item) => acc + parseFloat(item.TRDS), 0);
  return sum / history.length;
}

function getLastSessionForExercise(exerciseKey) {
  return getHistory().find(item => item.exerciseKey === exerciseKey) || null;
}

function getSensitivityThresholds() {
  const sensitivity = getProfile().sensitivity || "high";

  if (sensitivity === "low") {
    return { down: 9.3, up: 11.7, debounce: 550 };
  }
  if (sensitivity === "medium") {
    return { down: 9.4, up: 11.6, debounce: 525 };
  }
  return { down: 9.5, up: 11.5, debounce: 500 };
}

function detect(e) {
  if (!running) return;

  const acc = e.accelerationIncludingGravity || { x: 0, y: 0, z: 0 };
  const mag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);

  buffer.push(mag);
  if (buffer.length > 5) buffer.shift();

  const avg = buffer.reduce((a, b) => a + b, 0) / buffer.length;
  const thresholds = getSensitivityThresholds();

  if (avg < thresholds.down && lastState === "up") {
    lastState = "down";
  }

  if (avg > thresholds.up && lastState === "down") {
    const now = Date.now();
    if (now - lastTime > thresholds.debounce) {
      reps++;
      el("reps").innerText = String(reps);
      lastTime = now;

      if (currentPhase === "myo") {
        const target = unilateralMode && sideStage === "second" && mirroredPlan
          ? (mirroredPlan.myoSets[myoLog.length]?.reps ?? myoTarget)
          : myoTarget;

        if (reps >= target) stopSet();
      }

      if (currentPhase === "anchor" && unilateralMode && sideStage === "second" && mirroredPlan) {
        if (reps >= mirroredPlan.anchorReps) stopSet();
      }
    }
    lastState = "up";
  }
}

function getExerciseArt(exercise) {
  const alt = exercise.name || "Exercise";
  const src = exercise.image || "";
  return `
    <img
      src="${src}"
      alt="${alt}"
      class="exercise-art-img"
      loading="eager"
      onerror="this.style.display='none'; this.insertAdjacentHTML('afterend','<div>${alt}</div>');"
    />
  `;
}
