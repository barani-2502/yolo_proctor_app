import { loadModel, runInference, DETECTED_CLASSES } from "./runner.js";
import { getHeapMB, formatMs, getSystemInfo, tickFPS, calculateJitter, getHeapBytes, initPressureObserver } from "./perf.js";
import { drawDetections, getOutcome, badgeHTML, buildSummaryTable } from "./ui.js";
import { matchFiles, createDatasetCategory } from "./dataset.js";


const MODEL_PATH = "models/yolo11n.onnx";

let manifest = [];
let currentCat = null;
let allResults = [];
let modelLoaded = false;
let sessionMeta = {};
let backendPreference = localStorage.getItem("backend-preference") === "cpu" ? "cpu" : "gpu";
let activeBackend = null;

const catList = document.getElementById("cat-list");
const imageGrid = document.getElementById("image-grid");
const resultsSection = document.getElementById("results-section");
const loadBtn = document.getElementById("load-btn");
const runBtn = document.getElementById("run-btn");
const runCatBtn = document.getElementById("run-cat-btn");
const resultsBtn = document.getElementById("results-btn");
const modelBadge = document.getElementById("model-badge");
const loadingEl = document.getElementById("loading");
const pInf = document.getElementById("p-inf");
const pPrep = document.getElementById("p-prep");
const pPost = document.getElementById("p-post");
const pHeap = document.getElementById("p-heap");
const pFPS = document.getElementById("p-fps");
const pCPU = document.getElementById("p-cpu");
const pRAM = document.getElementById("p-ram");
const pPressure = document.getElementById("p-pressure");
const pAppLoad = document.getElementById("p-appload");
const pGPU = document.getElementById("p-gpu");
const gpuToggle = document.getElementById("gpu-toggle");
const cpuToggle = document.getElementById("cpu-toggle");
const reloadWarn = document.getElementById("reload-warn");
const uploadBtn = document.getElementById("upload-btn");
const fileInput = document.getElementById("local-dataset-input");


async function init() {
  manifest = await fetch("manifest.json").then(r => r.json());
  renderSidebar();
  selectCategory(manifest[0]);

  const info = getSystemInfo();
  if (pCPU) pCPU.textContent = info.cpu;
  if (pRAM) pRAM.textContent = info.memory;
  if (pGPU) {
    pGPU.textContent = info.gpu.length > 15 ? info.gpu.substring(0, 15) + "..." : info.gpu;
    document.getElementById("gpu-container").title = info.gpu;
  }

  initPressureObserver(status => {
    if (pPressure) pPressure.textContent = status;
  });

  // Sync UI with backend preference
  if (backendPreference === "cpu") {
    cpuToggle.classList.add("active");
    gpuToggle.classList.remove("active");
  } else {
    gpuToggle.classList.add("active");
    cpuToggle.classList.remove("active");
  }
}

function renderSidebar() {
  catList.innerHTML = "";
  manifest.forEach(cat => {
    const div = document.createElement("div");
    div.className = "cat-item" + (currentCat?.id === cat.id ? " active" : "");
    div.dataset.id = cat.id;
    const res = allResults.find(r => r.id === cat.id);
    const badge = res ? badgeHTML(res.outcome) : `<span class="badge badge-pend">—</span>`;
    div.innerHTML = `
      <div class="cat-label"><span>${cat.id}</span>${badge}</div>
      <div class="cat-id">${cat.label} · ${cat.images.length} img</div>`;
    div.onclick = () => selectCategory(cat);
    catList.appendChild(div);
  });
}

function selectCategory(cat) {
  currentCat = cat;
  resultsSection.style.display = "none";
  imageGrid.style.display = "grid";
  renderSidebar();
  renderImageGrid(cat);
}

function getFolderName(id) {
  const map = {
    T1: "T1_clear-phone", T2: "T2_partial", T3: "T3_hand",
    T4: "T4_no-phone", T5: "T5_hand-face", T6: "T6_low-light",
    T7: "T7_occluded", T8: "T8_multiple", T9: "T9_side",
    T10: "T10_under-table"
  };
  return map[id] || id;
}

function renderImageGrid(cat) {
  imageGrid.innerHTML = "";
  if (!cat.images.length) {
    imageGrid.innerHTML = `<p style="color:#555;padding:20px;font-size:13px">No images in this category yet.</p>`;
    return;
  }
  cat.images.forEach(filename => {
    let src = `test-images/${getFolderName(cat.id)}/${filename}`;
    let expected = cat.expected;

    if (cat.isLocal && cat.imageDetails) {
      const detail = cat.imageDetails.find(d => d.filename === filename);
      if (detail) {
        src = detail.src;
        expected = detail.expected;
      }
    }

    const card = document.createElement("div");

    card.className = "img-card";
    card.innerHTML = `
      <div class="img-card-header">
        <span class="img-name">${filename}</span>
        <span class="badge badge-pend" id="badge-${cat.id}-${filename}">—</span>
      </div>
      <div class="canvas-wrap">
        <canvas id="canvas-${cat.id}-${filename}"></canvas>
      </div>
      <div class="detected-tags" id="tags-${cat.id}-${filename}"></div>`;
    imageGrid.appendChild(card);

    const img = new Image();
    img.onload = () => {
      const canvas = card.querySelector("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
    };
    img.src = src;
  });
}

gpuToggle.onclick = () => {
  if (backendPreference === "gpu") return;
  backendPreference = "gpu";
  localStorage.setItem("backend-preference", "gpu");
  gpuToggle.classList.add("active");
  cpuToggle.classList.remove("active");
  if (modelLoaded) window.location.reload();
};

cpuToggle.onclick = () => {
  if (backendPreference === "cpu") return;
  backendPreference = "cpu";
  localStorage.setItem("backend-preference", "cpu");
  cpuToggle.classList.add("active");
  gpuToggle.classList.remove("active");
  if (modelLoaded) window.location.reload();
};

loadBtn.onclick = async () => {
  loadingEl.style.display = "block";
  loadingEl.textContent = `Initializing ${backendPreference === "cpu" ? "WASM" : "Auto"} Backend…`;
  loadBtn.disabled = true;
  try {
    const activeEP = await loadModel(MODEL_PATH, backendPreference === "cpu");
    activeBackend = activeEP;
    const epDisplay = activeEP === "webgpu" ? "WebGPU" : "WASM";

    modelBadge.textContent = `YOLOv11 Nano · ${epDisplay} Ready`;
    modelBadge.className = activeEP === "webgpu" ? "badge gpu-active" : "badge";

    modelLoaded = true;
    runBtn.disabled = false;
    runCatBtn.disabled = false;
    loadingEl.style.display = "none";
  } catch (e) {
    loadingEl.textContent = "Failed to load model. Check console for details.";
    loadBtn.disabled = false;
    console.error(e);
  }
};

async function runCategory(cat) {
  if (!cat.images.length) return null;

  let totalConf = 0, confCount = 0, totalMs = 0;
  let imgStats = { tp: 0, tn: 0, fp: 0, fn: 0 };
  let allDetections = [];
  let categoryTimes = [];
  let busyMs = 0;
  const startTime = performance.now();

  for (const filename of cat.images) {
    let src = `test-images/${getFolderName(cat.id)}/${filename}`;
    let expected = cat.expected;

    if (cat.isLocal && cat.imageDetails) {
      const detail = cat.imageDetails.find(d => d.filename === filename);
      if (detail) {
        src = detail.src;
        expected = detail.expected;
      }
    }

    const img = await loadImageElement(src);
    const { detections, inferenceMs, perf } = await runInference(img);

    const stepBusy = perf.prep + perf.inference + perf.post;
    busyMs += stepBusy;
    totalMs += inferenceMs;
    categoryTimes.push(inferenceMs);
    allDetections = allDetections.concat(detections);

    const canvas = document.getElementById(`canvas-${cat.id}-${filename}`);
    if (canvas) drawDetections(canvas, img, detections);

    // Per-image outcome badge
    const outcome = getOutcome(detections, expected);
    imgStats[outcome]++;

    const badge = document.getElementById(`badge-${cat.id}-${filename}`);
    if (badge) {
      const isCorrect = (outcome === "tp" || outcome === "tn");
      badge.className = `badge badge-${isCorrect ? "pass" : outcome === "fp" ? "fp" : "fail"}`;
      const badgeData = badgeHTML(outcome);
      badge.textContent = badgeData.replace(/<[^>]*>/g, ""); // strip HTML for simple textContent
    }

    // Per-image detected class tags
    const tagsEl = document.getElementById(`tags-${cat.id}-${filename}`);
    if (tagsEl) {
      const unique = [...new Map(detections.map(d => [d.className, d])).values()];
      tagsEl.innerHTML = unique.length
        ? unique.map(d => `<span class="dtag" style="color:${d.color};border-color:${d.color}33">${d.className} ${(d.confidence * 100).toFixed(0)}%</span>`).join("")
        : `<span style="font-size:11px;color:#444">nothing detected</span>`;
    }

    detections.forEach(d => { totalConf += d.confidence; confCount++; });

    pInf.textContent = formatMs(inferenceMs);
    pPrep.textContent = formatMs(perf.prep);
    pPost.textContent = formatMs(perf.post);
    pHeap.textContent = getHeapMB();
    if (pFPS) pFPS.textContent = tickFPS();

    if (pAppLoad) {
      const elapsed = performance.now() - startTime;
      const load = (busyMs / elapsed) * 100;
      pAppLoad.textContent = load.toFixed(1) + "%";
    }
  }

  // Outcome mapped to standard TP/TN/FP/FN for the summary row
  const correctCount = imgStats.tp + imgStats.tn;
  const finalOutcome = cat.expected ? (imgStats.tp > 0 ? "tp" : "fn") : (correctCount === cat.images.length ? "tn" : "fp");

  const avgConf = confCount ? totalConf / confCount : 0;
  const robustnessScore = (cat.images.length ? correctCount / cat.images.length : 0) * avgConf;

  return {
    id: cat.id, label: cat.label, expected: cat.expected,
    imageCount: cat.images.length,
    allDetections,
    inferenceMs: totalMs / cat.images.length,
    avgConf,
    outcome: finalOutcome,
    robustnessScore,
    imgStats,
    times: categoryTimes
  };
}

runBtn.onclick = async () => {
  runBtn.disabled = true;
  runCatBtn.disabled = true;
  allResults = [];

  const memStart = getHeapBytes();
  let maxLat = 0;
  let peakMem = 0;
  let allTimes = [];

  for (const cat of manifest) {
    selectCategory(cat);
    await new Promise(r => setTimeout(r, 50));
    const result = await runCategory(cat);
    if (result) {
      allResults.push(result);
      allTimes.push(...result.times);
      maxLat = Math.max(maxLat, ...result.times);
      peakMem = Math.max(peakMem, parseFloat(getHeapMB()));
    }
    renderSidebar();
  }

  const memEnd = getHeapBytes();
  sessionMeta = {
    peakMem: peakMem.toFixed(1),
    memDelta: ((memEnd - memStart) / 1048576).toFixed(2),
    maxLatency: maxLat,
    jitter: calculateJitter(allTimes),
    backend: activeBackend === "webgpu" ? "WebGPU" : "WASM"
  };

  runBtn.disabled = false;
  runCatBtn.disabled = false;
  resultsBtn.disabled = false;
  selectCategory(currentCat);
};

runCatBtn.onclick = async () => {
  if (!currentCat) return;
  runCatBtn.disabled = true;
  runBtn.disabled = true;
  const result = await runCategory(currentCat);
  if (result) {
    const idx = allResults.findIndex(r => r.id === currentCat.id);
    if (idx >= 0) allResults[idx] = result; else allResults.push(result);
  }
  renderSidebar();
  runCatBtn.disabled = false;
  runBtn.disabled = false;
  if (allResults.length) resultsBtn.disabled = false;
};

resultsBtn.onclick = () => {
  imageGrid.style.display = "none";
  resultsSection.style.display = "block";
  resultsSection.innerHTML = `<h2>Advanced Summary Report</h2>${buildSummaryTable(allResults, sessionMeta)}`;
};

uploadBtn.onclick = () => fileInput.click();

fileInput.onchange = async () => {
  if (!fileInput.files.length) return;
  
  loadingEl.style.display = "block";
  loadingEl.textContent = "Scanning folder structure...";
  
  try {
    const folderName = fileInput.files[0].webkitRelativePath.split('/')[0] || "Local Dataset";
    const matched = await matchFiles(fileInput.files);
    
    if (matched.length === 0) {
      alert("No images found in the selected folder.");
      return;
    }
    
    const localCat = await createDatasetCategory(folderName, matched);
    manifest.push(localCat);
    renderSidebar();
    selectCategory(localCat);
    
    loadingEl.style.display = "none";
  } catch (e) {
    console.error(e);
    alert("Failed to process dataset: " + e.message);
    loadingEl.style.display = "none";
  }
};

function loadImageElement(src) {

  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

init();
