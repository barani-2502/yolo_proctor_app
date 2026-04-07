import { loadModel, runInference, DETECTED_CLASSES } from "./runner.js";
import { getHeapMB, formatMs } from "./perf.js";
import { drawDetections, getOutcome, badgeHTML, buildSummaryTable } from "./ui.js";

const MODEL_PATH = "models/yolo11n.onnx";

let manifest    = [];
let currentCat  = null;
let allResults  = [];
let modelLoaded = false;

const catList        = document.getElementById("cat-list");
const imageGrid      = document.getElementById("image-grid");
const resultsSection = document.getElementById("results-section");
const loadBtn        = document.getElementById("load-btn");
const runBtn         = document.getElementById("run-btn");
const runCatBtn      = document.getElementById("run-cat-btn");
const resultsBtn     = document.getElementById("results-btn");
const modelBadge     = document.getElementById("model-badge");
const loadingEl      = document.getElementById("loading");
const pInf           = document.getElementById("p-inf");
const pHeap          = document.getElementById("p-heap");

async function init() {
  manifest = await fetch("manifest.json").then(r => r.json());
  renderSidebar();
  selectCategory(manifest[0]);
}

function renderSidebar() {
  catList.innerHTML = "";
  manifest.forEach(cat => {
    const div = document.createElement("div");
    div.className = "cat-item" + (currentCat?.id === cat.id ? " active" : "");
    div.dataset.id = cat.id;
    const res   = allResults.find(r => r.id === cat.id);
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
  imageGrid.style.display      = "grid";
  renderSidebar();
  renderImageGrid(cat);
}

function getFolderName(id) {
  const map = {
    T1:"T1_clear-phone", T2:"T2_partial",    T3:"T3_hand",
    T4:"T4_no-phone",    T5:"T5_hand-face",  T6:"T6_low-light",
    T7:"T7_occluded",    T8:"T8_multiple",   T9:"T9_side",
    T10:"T10_under-table"
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
    const src  = `test-images/${getFolderName(cat.id)}/${filename}`;
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
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
    };
    img.src = src;
  });
}

loadBtn.onclick = async () => {
  loadingEl.style.display = "block";
  loadingEl.textContent   = "Loading YOLOv11 Nano…";
  loadBtn.disabled        = true;
  try {
    await loadModel(MODEL_PATH);
    modelBadge.textContent = "YOLOv11 Nano · ready";
    modelLoaded            = true;
    runBtn.disabled        = false;
    runCatBtn.disabled     = false;
    loadingEl.style.display = "none";
  } catch (e) {
    loadingEl.textContent = "Failed to load model. Make sure models/yolo11n.onnx exists.";
    loadBtn.disabled = false;
    console.error(e);
  }
};

async function runCategory(cat) {
  if (!cat.images.length) return null;

  let totalConf = 0, confCount = 0, totalMs = 0;
  let allDetections = [];

  for (const filename of cat.images) {
    const src = `test-images/${getFolderName(cat.id)}/${filename}`;
    const img = await loadImageElement(src);
    const { detections, inferenceMs } = await runInference(img);

    totalMs      += inferenceMs;
    allDetections = allDetections.concat(detections);

    const canvas = document.getElementById(`canvas-${cat.id}-${filename}`);
    if (canvas) drawDetections(canvas, img, detections);

    // Per-image outcome badge
    const outcome = getOutcome(detections, cat.expected);
    const badge   = document.getElementById(`badge-${cat.id}-${filename}`);
    if (badge) {
      badge.className   = `badge badge-${outcome}`;
      badge.textContent = { pass: "✓ Correct", fail: "✗ Missed", fp: "⚠ False +" }[outcome] || "—";
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

    pInf.textContent  = formatMs(inferenceMs);
    pHeap.textContent = getHeapMB();
  }

  // Majority vote across images in this category
  const imageOutcomes = cat.images.map(filename => {
    const badge = document.getElementById(`badge-${cat.id}-${filename}`);
    if (!badge) return "pend";
    if (badge.className.includes("pass")) return "pass";
    if (badge.className.includes("fp"))   return "fp";
    return "fail";
  });
  const counts  = imageOutcomes.reduce((a, b) => { a[b] = (a[b] || 0) + 1; return a; }, {});
  const outcome = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "pend";

  return {
    id: cat.id, label: cat.label, expected: cat.expected,
    imageCount: cat.images.length,
    allDetections,
    inferenceMs: totalMs / cat.images.length,
    avgConf:     confCount ? totalConf / confCount : 0,
    outcome,
  };
}

runBtn.onclick = async () => {
  runBtn.disabled    = true;
  runCatBtn.disabled = true;
  allResults         = [];

  for (const cat of manifest) {
    selectCategory(cat);
    await new Promise(r => setTimeout(r, 50)); // let UI paint
    const result = await runCategory(cat);
    if (result) allResults.push(result);
    else allResults.push({ id: cat.id, label: cat.label, imageCount: 0, outcome: "pend", allDetections: [] });
    renderSidebar();
  }

  runBtn.disabled    = false;
  runCatBtn.disabled = false;
  resultsBtn.disabled = false;
  selectCategory(currentCat);
};

runCatBtn.onclick = async () => {
  if (!currentCat) return;
  runCatBtn.disabled = true;
  runBtn.disabled    = true;
  const result = await runCategory(currentCat);
  if (result) {
    const idx = allResults.findIndex(r => r.id === currentCat.id);
    if (idx >= 0) allResults[idx] = result; else allResults.push(result);
  }
  renderSidebar();
  runCatBtn.disabled = false;
  runBtn.disabled    = false;
  if (allResults.length) resultsBtn.disabled = false;
};

resultsBtn.onclick = () => {
  imageGrid.style.display      = "none";
  resultsSection.style.display = "block";
  resultsSection.innerHTML     = `<h2>Summary report</h2>${buildSummaryTable(allResults)}`;
};

function loadImageElement(src) {
  return new Promise((res, rej) => {
    const img  = new Image();
    img.onload  = () => res(img);
    img.onerror = rej;
    img.src     = src;
  });
}

init();
