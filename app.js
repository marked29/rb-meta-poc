"use strict";

var CONFIG = {
  dataSource: "local-json",
  localDataUrl: "data/sample-instructions.json",
  serverUrl: "",
  fetchTimeoutMs: 3500,
  defaultUnit: "m",
  persistProgress: true,
  embeddedFallback: true,
  mockSensors: false,
  mockFetchFail: false,
  debug: false,
  speechRate: 1,
  speechPitch: 1,
  inputDebounceMs: 120,
  compassPixelsPerDegree: 2.2,
  smoothingFactor: 0.16,
  geolocation: {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 15000
  }
};

var SAMPLE_INSTRUCTIONS = {
  version: "2026.06.001",
  title: "Equipment Pre-Operation Inspection",
  unit: "m",
  instructions: [
    {
      id: "step-01",
      title: "Verify power source is disconnected",
      details:
        "Confirm the main breaker is in the OFF position and the lockout tag is applied before proceeding. Do not rely on indicator lights alone."
    },
    {
      id: "step-02",
      title: "Inspect housing for visible damage",
      details:
        "Check the outer casing for cracks, deformation, or impact marks. Pay attention to seams and mounting points."
    },
    {
      id: "step-03",
      title: "Confirm all fasteners are present",
      details: null,
      image: {
        src: "public/fasteners.png",
        alt: "Fasteners inspection reference"
      }
    },
    {
      id: "step-04",
      title: "Check fluid levels against the gauge",
      details:
        "Reading must sit between the MIN and MAX marks with the unit level. Top up with approved fluid only if below MIN."
    },
    {
      id: "step-05",
      title: "Test emergency stop button"
    },
    {
      id: "step-06",
      title: "Record inspection in the logbook",
      details:
        "Enter date, time, operator ID, and any anomalies observed. Sign and store the entry."
    }
  ]
};

var STATES = {
  LOADING: "LOADING",
  EMPTY: "EMPTY",
  CHECKLIST: "CHECKLIST",
  DETAIL: "DETAIL",
  COMPLETION: "COMPLETION"
};

var STORAGE_KEYS = {
  cache: "mrbd_checklist_cache",
  progressPrefix: "mrbd_checklist_progress_"
};

var state = {
  view: STATES.LOADING,
  checklist: null,
  currentIndex: 0,
  checkedById: {},
  dataSource: "none",
  error: null,
  lastInputAt: 0,
  sensors: {
    heading: null,
    smoothedHeading: null,
    headingStatus: "unavailable",
    compassPermissionRequested: false,
    compassListening: false,
    altitude: null,
    altitudeAccuracy: null,
    altitudeStatus: "unavailable",
    locationWatchId: null,
    compassRaf: null,
    mockTimer: null
  },
  speech: {
    activated: false,
    ttsStatus: "unavailable",
    voiceStatus: "unavailable",
    recognition: null,
    restartingRecognition: false
  }
};

var elements = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  elements = collectElements();
  applyQueryFlags();
  registerServiceWorker();
  bindInput();
  if (CONFIG.debug) {
    elements.debugPanel.classList.remove("hidden");
  }
  render();
  startSensors();
  loadInstructions().then(function (result) {
    if (!result) {
      state.view = STATES.EMPTY;
      state.dataSource = "none";
      render();
      return;
    }

    state.checklist = result.checklist;
    state.dataSource = result.source;
    state.checkedById = loadProgress(state.checklist.version);
    state.currentIndex = getFirstOpenIndex();
    state.view = STATES.CHECKLIST;
    render();
    activateSpeechFeatures(false);
  });
}

function registerServiceWorker() {
  if (
    !("serviceWorker" in navigator) ||
    (window.location.protocol !== "http:" && window.location.protocol !== "https:")
  ) {
    return;
  }

  navigator.serviceWorker.register("sw.js").catch(function (error) {
    state.error = "Service worker registration failed: " + error.message;
  });
}

function collectElements() {
  return {
    screens: {
      loading: document.getElementById("screen-loading"),
      empty: document.getElementById("screen-empty"),
      checklist: document.getElementById("screen-checklist"),
      detail: document.getElementById("screen-detail"),
      completion: document.getElementById("screen-completion")
    },
    compassStatus: document.getElementById("compass-status"),
    compassTape: document.getElementById("compass-tape"),
    altitudeValue: document.getElementById("altitude-value"),
    altitudeAccuracy: document.getElementById("altitude-accuracy"),
    checklistTitle: document.getElementById("checklist-title"),
    checklistPosition: document.getElementById("checklist-position"),
    stepStatus: document.getElementById("step-status"),
    stepTitle: document.getElementById("step-title"),
    progressFill: document.getElementById("progress-fill"),
    detailPosition: document.getElementById("detail-position"),
    detailTitle: document.getElementById("detail-title"),
    detailCopy: document.getElementById("detail-copy"),
    debugPanel: document.getElementById("debug-panel"),
    debugState: document.getElementById("debug-state"),
    debugIndex: document.getElementById("debug-index"),
    debugChecked: document.getElementById("debug-checked"),
    debugDataSource: document.getElementById("debug-data-source"),
    debugHeading: document.getElementById("debug-heading"),
    debugAltitude: document.getElementById("debug-altitude"),
    debugTts: document.getElementById("debug-tts"),
    debugVoice: document.getElementById("debug-voice")
  };
}

function applyQueryFlags() {
  var params = new URLSearchParams(window.location.search);

  CONFIG.debug = params.get("debug") === "1";
  CONFIG.mockSensors =
    params.get("mockSensors") === "1" || params.get("mocksensors") === "1";

  if (params.get("source")) {
    CONFIG.dataSource = params.get("source");
  }
  if (params.get("localUrl")) {
    CONFIG.localDataUrl = params.get("localUrl");
  }
  if (params.get("serverUrl")) {
    CONFIG.serverUrl = params.get("serverUrl");
  }
  CONFIG.mockFetchFail = params.get("mockFetchFail") === "1";
  CONFIG.embeddedFallback = params.get("disableEmbeddedFallback") !== "1";
  if (params.get("reset") === "1") {
    resetAllStorage();
  }
}

function bindInput() {
  window.addEventListener("keydown", function (event) {
    var key = event.key;
    var isHandledKey =
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === "Enter";

    if (!isHandledKey) {
      return;
    }

    event.preventDefault();

    var now = Date.now();
    if (event.repeat || now - state.lastInputAt < CONFIG.inputDebounceMs) {
      return;
    }
    state.lastInputAt = now;

    requestCompassPermissionIfNeeded();
    activateSpeechFeatures();

    if (state.view === STATES.LOADING) {
      return;
    }

    routeInput(key);
  });
}

function routeInput(key) {
  if (state.view === STATES.EMPTY) {
    return;
  }

  if (state.view === STATES.COMPLETION) {
    if (key === "Enter") {
      restartChecklist();
    }
    return;
  }

  if (state.view === STATES.DETAIL) {
    if (key === "ArrowDown") {
      state.view = STATES.CHECKLIST;
      render();
    }
    return;
  }

  if (state.view !== STATES.CHECKLIST) {
    return;
  }

  if (key === "ArrowLeft") {
    moveStep(-1);
  } else if (key === "ArrowRight") {
    moveStep(1);
  } else if (key === "ArrowUp") {
    state.view = STATES.DETAIL;
    render();
  } else if (key === "Enter") {
    toggleCurrentStep();
  }
}

function moveStep(delta) {
  if (!state.checklist) {
    return;
  }

  var max = state.checklist.instructions.length - 1;
  var nextIndex = clamp(state.currentIndex + delta, 0, max);
  var didMove = nextIndex !== state.currentIndex;
  state.currentIndex = nextIndex;
  render();
  if (didMove) {
    speakCurrentStep();
  }
}

function toggleCurrentStep() {
  var item = getCurrentItem();
  if (!item) {
    return;
  }

  state.checkedById[item.id] = !state.checkedById[item.id];
  saveProgress();

  if (isChecklistComplete()) {
    state.view = STATES.COMPLETION;
    speakText("All steps complete.");
  } else {
    speakCurrentStep();
  }

  render();
}

function restartChecklist() {
  state.checkedById = {};
  state.currentIndex = 0;
  clearProgress();
  state.view = STATES.CHECKLIST;
  render();
  speakCurrentStep();
}

function getCurrentItem() {
  if (!state.checklist || !state.checklist.instructions.length) {
    return null;
  }
  return state.checklist.instructions[state.currentIndex];
}

function getFirstOpenIndex() {
  if (!state.checklist) {
    return 0;
  }
  var items = state.checklist.instructions;
  for (var i = 0; i < items.length; i += 1) {
    if (!state.checkedById[items[i].id]) {
      return i;
    }
  }
  return 0;
}

function isChecklistComplete() {
  if (!state.checklist) {
    return false;
  }
  return state.checklist.instructions.every(function (item) {
    return Boolean(state.checkedById[item.id]);
  });
}

function render() {
  showOnlyScreen(state.view);
  renderHud();

  if (state.view === STATES.CHECKLIST) {
    renderChecklist();
  } else if (state.view === STATES.DETAIL) {
    renderDetail();
  }

  renderDebug();
}

function showOnlyScreen(view) {
  var map = {
    LOADING: elements.screens.loading,
    EMPTY: elements.screens.empty,
    CHECKLIST: elements.screens.checklist,
    DETAIL: elements.screens.detail,
    COMPLETION: elements.screens.completion
  };

  Object.keys(map).forEach(function (key) {
    map[key].classList.toggle("hidden", key !== view);
  });
}

function renderChecklist() {
  var item = getCurrentItem();
  if (!item || !state.checklist) {
    return;
  }

  var total = state.checklist.instructions.length;
  var checked = getCheckedCount();
  var isDone = Boolean(state.checkedById[item.id]);

  elements.checklistTitle.textContent = state.checklist.title;
  elements.checklistPosition.textContent = state.currentIndex + 1 + " / " + total;
  elements.stepStatus.textContent = isDone ? "DONE" : "PENDING";
  elements.stepStatus.classList.toggle("done", isDone);
  elements.stepTitle.textContent = item.title;
  elements.progressFill.style.width = Math.round((checked / total) * 100) + "%";
}

function renderDetail() {
  var item = getCurrentItem();
  if (!item || !state.checklist) {
    return;
  }

  var total = state.checklist.instructions.length;
  var details = typeof item.details === "string" ? item.details.trim() : "";
  var image = item.image && item.image.src ? item.image : null;

  elements.detailPosition.textContent = state.currentIndex + 1 + " / " + total;
  elements.detailTitle.textContent = item.title;
  elements.detailCopy.classList.toggle("image-detail", Boolean(image));
  elements.detailCopy.classList.toggle("no-detail", !details && !image);

  if (image) {
    var imageElement = document.createElement("img");
    imageElement.src = image.src;
    imageElement.alt = image.alt || item.title;
    elements.detailCopy.replaceChildren(imageElement);
  } else {
    elements.detailCopy.textContent =
      details || "No additional details for this step.";
  }
}

function renderHud() {
  renderCompass();
  renderAltitude();
}

function renderCompass() {
  var heading = state.sensors.smoothedHeading;

  if (typeof heading !== "number") {
    elements.compassStatus.textContent = "COMPASS --";
    elements.compassTape.style.setProperty("--heading-offset", "0px");
    return;
  }

  var rounded = Math.round(normalizeDegrees(heading));
  var offset = -normalizeSignedDegrees(heading) * CONFIG.compassPixelsPerDegree;

  elements.compassStatus.textContent = "COMPASS " + rounded + "\u00B0";
  elements.compassTape.style.setProperty("--heading-offset", offset + "px");
}

function renderAltitude() {
  var unit = getAltitudeUnit();
  var altitude = state.sensors.altitude;
  var accuracy = state.sensors.altitudeAccuracy;

  if (typeof altitude !== "number") {
    elements.altitudeValue.textContent = "ALT --";
    elements.altitudeAccuracy.textContent = state.sensors.altitudeStatus;
    return;
  }

  var displayAltitude = unit === "ft" ? altitude * 3.28084 : altitude;
  var displayAccuracy =
    typeof accuracy === "number"
      ? unit === "ft"
        ? accuracy * 3.28084
        : accuracy
      : null;

  elements.altitudeValue.textContent =
    "ALT " + Math.round(displayAltitude) + " " + unit;
  elements.altitudeAccuracy.textContent =
    displayAccuracy === null ? "" : "+/- " + Math.round(displayAccuracy) + " " + unit;
}

function renderDebug() {
  if (!CONFIG.debug) {
    return;
  }

  elements.debugState.textContent = state.view;
  elements.debugIndex.textContent = String(state.currentIndex);
  elements.debugChecked.textContent =
    state.checklist === null
      ? "-"
      : getCheckedCount() + "/" + state.checklist.instructions.length;
  elements.debugDataSource.textContent = state.dataSource;
  elements.debugHeading.textContent =
    typeof state.sensors.smoothedHeading === "number"
      ? Math.round(state.sensors.smoothedHeading) + " deg"
      : state.sensors.headingStatus;
  elements.debugAltitude.textContent =
    typeof state.sensors.altitude === "number"
      ? Math.round(state.sensors.altitude) + " m"
      : state.sensors.altitudeStatus;
  elements.debugTts.textContent = state.speech.ttsStatus;
  elements.debugVoice.textContent = state.speech.voiceStatus;
}

function activateSpeechFeatures(speakOnStart) {
  if (state.speech.activated) {
    return;
  }

  state.speech.activated = true;
  initSpeechOutput();
  initVoiceInput();
  if (speakOnStart !== false) {
    speakCurrentStep();
  }
  renderDebug();
}

function initSpeechOutput() {
  state.speech.ttsStatus =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window
      ? "available"
      : "unavailable";
}

function speakCurrentStep() {
  var item = getCurrentItem();
  if (!item) {
    return;
  }
  speakText(item.title);
}

function speakText(text) {
  if (!state.speech.activated || state.speech.ttsStatus !== "available") {
    return;
  }

  window.speechSynthesis.cancel();
  var utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = CONFIG.speechRate;
  utterance.pitch = CONFIG.speechPitch;
  utterance.onstart = function () {
    state.speech.ttsStatus = "speaking";
    renderDebug();
  };
  utterance.onend = function () {
    state.speech.ttsStatus = "available";
    renderDebug();
  };
  utterance.onerror = function (event) {
    state.speech.ttsStatus = event.error || "tts error";
    renderDebug();
  };
  state.speech.ttsStatus = "queued";
  renderDebug();
  window.speechSynthesis.speak(utterance);
}

function initVoiceInput() {
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    state.speech.voiceStatus = "unsupported";
    return;
  }

  var recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = function () {
    state.speech.voiceStatus = "listening";
    renderDebug();
  };

  recognition.onerror = function (event) {
    state.speech.voiceStatus = event.error || "error";
    renderDebug();
  };

  recognition.onend = function () {
    if (
      !state.speech.activated ||
      state.speech.restartingRecognition ||
      state.speech.voiceStatus === "not-allowed" ||
      state.speech.voiceStatus === "service-not-allowed"
    ) {
      return;
    }

    state.speech.voiceStatus = "restarting";
    state.speech.restartingRecognition = true;
    window.setTimeout(function () {
      state.speech.restartingRecognition = false;
      startVoiceRecognition();
    }, 300);
    renderDebug();
  };

  recognition.onresult = function (event) {
    var result = event.results[event.results.length - 1];
    if (!result || !result[0]) {
      return;
    }

    handleVoiceCommand(result[0].transcript);
  };

  state.speech.recognition = recognition;
  startVoiceRecognition();
}

function startVoiceRecognition() {
  if (!state.speech.recognition) {
    return;
  }

  try {
    state.speech.recognition.start();
  } catch (error) {
    state.speech.voiceStatus = "start failed";
    renderDebug();
  }
}

function handleVoiceCommand(transcript) {
  var command = normalizeVoiceCommand(transcript);

  if (command === "next" || command === "next step") {
    if (state.view === STATES.CHECKLIST) {
      moveStep(1);
    }
  } else if (
    command === "previous" ||
    command === "previous step" ||
    command === "prev"
  ) {
    if (state.view === STATES.CHECKLIST) {
      moveStep(-1);
    }
  } else if (
    command === "mark done" ||
    command === "done" ||
    command === "check"
  ) {
    if (state.view === STATES.CHECKLIST) {
      toggleCurrentStep();
    } else if (state.view === STATES.COMPLETION) {
      restartChecklist();
    }
  } else if (command === "show details" || command === "details") {
    if (state.view === STATES.CHECKLIST) {
      state.view = STATES.DETAIL;
      render();
    }
  } else if (command === "hide details" || command === "close details") {
    if (state.view === STATES.DETAIL) {
      state.view = STATES.CHECKLIST;
      render();
    }
  }
}

function normalizeVoiceCommand(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCheckedCount() {
  if (!state.checklist) {
    return 0;
  }
  return state.checklist.instructions.reduce(function (count, item) {
    return count + (state.checkedById[item.id] ? 1 : 0);
  }, 0);
}

function getAltitudeUnit() {
  if (state.checklist && state.checklist.unit) {
    return state.checklist.unit;
  }
  return CONFIG.defaultUnit;
}

async function loadInstructions() {
  if (CONFIG.dataSource === "mock") {
    return loadEmbeddedInstructions("mock");
  }

  if (CONFIG.dataSource === "local" || CONFIG.dataSource === "local-json") {
    var localResult = await loadInstructionsFromUrl(
      CONFIG.localDataUrl,
      "local-json"
    );
    if (localResult) {
      return localResult;
    }

    var cachedAfterLocalFailure = loadCachedInstructions();
    if (cachedAfterLocalFailure) {
      return cachedAfterLocalFailure;
    }

    if (CONFIG.embeddedFallback) {
      return loadEmbeddedInstructions("embedded-fallback");
    }

    return null;
  }

  if (CONFIG.dataSource === "server" && CONFIG.serverUrl) {
    var serverResult = await loadInstructionsFromUrl(CONFIG.serverUrl, "server");
    if (serverResult) {
      return serverResult;
    }
  }

  return loadCachedInstructions();
}

async function loadInstructionsFromUrl(url, sourceName) {
  if (!url) {
    return null;
  }

  try {
    var remoteData = await fetchJsonWithTimeout(url, CONFIG.fetchTimeoutMs);
    var remoteChecklist = validateInstructions(remoteData);
    if (remoteChecklist.valid) {
      saveCachedInstructions(remoteChecklist.data);
      return {
        checklist: remoteChecklist.data,
        source: sourceName
      };
    }
    state.error = remoteChecklist.reason;
  } catch (error) {
    state.error = error.message;
  }

  return null;
}

function loadEmbeddedInstructions(sourceName) {
  var mockChecklist = validateInstructions(SAMPLE_INSTRUCTIONS);
  if (mockChecklist.valid) {
    saveCachedInstructions(mockChecklist.data);
    return {
      checklist: mockChecklist.data,
      source: sourceName
    };
  }
  return loadCachedInstructions();
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  if (CONFIG.mockFetchFail) {
    throw new Error("Mock fetch failure");
  }

  var controller = new AbortController();
  var timeoutId = window.setTimeout(function () {
    controller.abort();
  }, timeoutMs);

  try {
    var response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("Fetch failed: " + response.status);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function validateInstructions(raw) {
  if (!raw || typeof raw !== "object") {
    return invalid("Root must be an object");
  }

  if (!isNonEmptyString(raw.version)) {
    return invalid("Missing version");
  }

  if (!isNonEmptyString(raw.title)) {
    return invalid("Missing title");
  }

  if (!Array.isArray(raw.instructions) || raw.instructions.length === 0) {
    return invalid("Instructions must be a non-empty array");
  }

  var ids = {};
  var cleanInstructions = [];

  for (var i = 0; i < raw.instructions.length; i += 1) {
    var item = raw.instructions[i];
    if (!item || typeof item !== "object") {
      return invalid("Instruction must be an object");
    }
    if (!isNonEmptyString(item.id)) {
      return invalid("Instruction id is required");
    }
    if (ids[item.id]) {
      return invalid("Instruction id must be unique");
    }
    if (!isNonEmptyString(item.title)) {
      return invalid("Instruction title is required");
    }

    ids[item.id] = true;
    cleanInstructions.push({
      id: item.id.trim(),
      title: item.title.trim(),
      details:
        typeof item.details === "string"
          ? item.details
          : item.details === null
            ? null
            : undefined,
      image: normalizeInstructionImage(item.image)
    });
  }

  return {
    valid: true,
    data: {
      version: raw.version.trim(),
      title: raw.title.trim(),
      unit: raw.unit === "ft" ? "ft" : raw.unit === "m" ? "m" : CONFIG.defaultUnit,
      instructions: cleanInstructions
    }
  };
}

function invalid(reason) {
  return {
    valid: false,
    reason: reason
  };
}

function normalizeInstructionImage(image) {
  if (!image || typeof image !== "object" || !isNonEmptyString(image.src)) {
    return undefined;
  }

  return {
    src: image.src.trim(),
    alt: isNonEmptyString(image.alt) ? image.alt.trim() : ""
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function saveCachedInstructions(checklist) {
  safeSetItem(STORAGE_KEYS.cache, checklist);
}

function loadCachedInstructions() {
  var cached = safeGetItem(STORAGE_KEYS.cache);
  var validated = validateInstructions(cached);

  if (!validated.valid) {
    return null;
  }

  return {
    checklist: validated.data,
    source: "cache"
  };
}

function progressKey(version) {
  return STORAGE_KEYS.progressPrefix + version;
}

function loadProgress(version) {
  if (!CONFIG.persistProgress) {
    return {};
  }

  var saved = safeGetItem(progressKey(version));
  if (!saved || typeof saved !== "object") {
    return {};
  }

  var clean = {};
  if (!state.checklist) {
    return clean;
  }

  state.checklist.instructions.forEach(function (item) {
    clean[item.id] = Boolean(saved[item.id]);
  });

  return clean;
}

function saveProgress() {
  if (!CONFIG.persistProgress || !state.checklist) {
    return;
  }
  safeSetItem(progressKey(state.checklist.version), state.checkedById);
}

function clearProgress() {
  if (!state.checklist) {
    return;
  }
  safeRemoveItem(progressKey(state.checklist.version));
}

function resetAllStorage() {
  safeRemoveItem(STORAGE_KEYS.cache);
  Object.keys(localStorage).forEach(function (key) {
    if (key.indexOf(STORAGE_KEYS.progressPrefix) === 0) {
      safeRemoveItem(key);
    }
  });
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    state.error = error.message;
  }
}

function safeGetItem(key) {
  try {
    var value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    state.error = error.message;
    return null;
  }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    state.error = error.message;
  }
}

function startSensors() {
  if (CONFIG.mockSensors) {
    startMockSensors();
    return;
  }

  startCompass();
  startAltitudeWatch();
}

function startCompass() {
  if (!("DeviceOrientationEvent" in window)) {
    state.sensors.headingStatus = "unavailable";
    renderHud();
    return;
  }

  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      state.sensors.headingStatus = "permission needed";
      renderHud();
    } else {
      addCompassListener();
    }
  } catch (error) {
    state.sensors.headingStatus = "error";
    renderHud();
  }
}

function requestCompassPermissionIfNeeded() {
  if (
    !("DeviceOrientationEvent" in window) ||
    typeof DeviceOrientationEvent.requestPermission !== "function" ||
    state.sensors.compassPermissionRequested ||
    state.sensors.compassListening
  ) {
    return;
  }

  state.sensors.compassPermissionRequested = true;
  DeviceOrientationEvent.requestPermission()
    .then(function (permission) {
      if (permission === "granted") {
        addCompassListener();
      } else {
        state.sensors.headingStatus = "denied";
        renderHud();
      }
    })
    .catch(function () {
      state.sensors.headingStatus = "denied";
      renderHud();
    });
}

function addCompassListener() {
  if (state.sensors.compassListening) {
    return;
  }
  window.addEventListener("deviceorientation", handleOrientation, true);
  state.sensors.compassListening = true;
  state.sensors.headingStatus = "listening";
  renderHud();
}

function handleOrientation(event) {
  var heading = getHeadingFromOrientation(event);
  if (typeof heading !== "number" || Number.isNaN(heading)) {
    state.sensors.headingStatus = "unavailable";
    scheduleHudRender();
    return;
  }

  updateHeading(heading);
}

function getHeadingFromOrientation(event) {
  if (typeof event.webkitCompassHeading === "number") {
    return normalizeDegrees(event.webkitCompassHeading);
  }

  if (typeof event.alpha === "number") {
    return normalizeDegrees(event.alpha);
  }

  return null;
}

function updateHeading(nextHeading) {
  state.sensors.heading = nextHeading;
  state.sensors.headingStatus = "available";

  if (state.sensors.smoothedHeading === null) {
    state.sensors.smoothedHeading = nextHeading;
  } else {
    var delta = shortestAngleDelta(state.sensors.smoothedHeading, nextHeading);
    state.sensors.smoothedHeading = normalizeDegrees(
      state.sensors.smoothedHeading + delta * CONFIG.smoothingFactor
    );
  }

  scheduleHudRender();
}

function startAltitudeWatch() {
  if (!("geolocation" in navigator)) {
    state.sensors.altitudeStatus = "unavailable";
    renderHud();
    return;
  }

  try {
    state.sensors.altitudeStatus = "requesting";
    state.sensors.locationWatchId = navigator.geolocation.watchPosition(
      function (position) {
        var coords = position.coords;
        if (typeof coords.altitude === "number") {
          state.sensors.altitude = coords.altitude;
          state.sensors.altitudeAccuracy =
            typeof coords.altitudeAccuracy === "number"
              ? coords.altitudeAccuracy
              : null;
          state.sensors.altitudeStatus = "available";
        } else {
          state.sensors.altitude = null;
          state.sensors.altitudeAccuracy = null;
          state.sensors.altitudeStatus = "no altitude";
        }
        scheduleHudRender();
      },
      function (error) {
        state.sensors.altitude = null;
        state.sensors.altitudeAccuracy = null;
        state.sensors.altitudeStatus =
          error.code === error.PERMISSION_DENIED
            ? "denied"
            : error.code === error.TIMEOUT
              ? "timeout"
              : "unavailable";
        scheduleHudRender();
      },
      CONFIG.geolocation
    );
  } catch (error) {
    state.sensors.altitudeStatus = "error";
    renderHud();
  }
}

function startMockSensors() {
  var startTime = null;
  var baseHeading = 142;
  var baseAltitude = 318;
  state.sensors.headingStatus = "mock";
  state.sensors.altitudeStatus = "mock";

  var tick = function (now) {
    if (startTime === null) {
      startTime = now;
    }

    var elapsedSeconds = (now - startTime) / 1000;
    var heading = normalizeDegrees(baseHeading + elapsedSeconds * 18);
    var altitude = baseAltitude + Math.sin(elapsedSeconds * 1.4) * 8;

    updateHeading(heading);
    state.sensors.altitude = altitude;
    state.sensors.altitudeAccuracy = 6;
    scheduleHudRender();
    state.sensors.mockTimer = window.requestAnimationFrame(tick);
  };

  state.sensors.mockTimer = window.requestAnimationFrame(tick);
}

function scheduleHudRender() {
  if (state.sensors.compassRaf !== null) {
    return;
  }

  state.sensors.compassRaf = window.requestAnimationFrame(function () {
    state.sensors.compassRaf = null;
    renderHud();
    renderDebug();
  });
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function normalizeSignedDegrees(value) {
  var normalized = normalizeDegrees(value);
  return normalized > 180 ? normalized - 360 : normalized;
}

function shortestAngleDelta(from, to) {
  return normalizeSignedDegrees(to - from);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

window.addEventListener("pagehide", function () {
  if (state.sensors.compassListening) {
    window.removeEventListener("deviceorientation", handleOrientation, true);
  }
  if (state.sensors.locationWatchId !== null) {
    navigator.geolocation.clearWatch(state.sensors.locationWatchId);
  }
  if (state.sensors.mockTimer !== null) {
    window.cancelAnimationFrame(state.sensors.mockTimer);
  }
  if (state.speech.recognition) {
    state.speech.activated = false;
    state.speech.recognition.stop();
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
});
