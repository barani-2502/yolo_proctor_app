import { DETECTED_CLASSES } from "./runner.js";

export function drawDetections(canvas, image, detections) {
  canvas.width  = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);

  for (const d of detections) {
    ctx.strokeStyle = d.color;
    ctx.lineWidth   = 2;
    ctx.strokeRect(d.x, d.y, d.w, d.h);

    const label = `${d.className} ${(d.confidence * 100).toFixed(0)}%`;
    ctx.font = "bold 13px system-ui";
    const tw = ctx.measureText(label).width;

    ctx.fillStyle = d.color;
    ctx.fillRect(d.x, d.y - 22, tw + 10, 22);
    ctx.fillStyle = "#000";
    ctx.fillText(label, d.x + 5, d.y - 6);
  }
}

// Returns the violation reason, or null if clean
export function getViolationReason(detections) {
  const phoneCount  = detections.filter(d => d.classId === 67).length;
  const laptopCount = detections.filter(d => d.classId === 63).length;
  const bookCount   = detections.filter(d => d.classId === 73).length;
  const personCount = detections.filter(d => d.classId === 0).length;

  const reasons = [];
  if (phoneCount  > 0) reasons.push("cell phone");
  if (laptopCount > 0) reasons.push("laptop");
  if (bookCount   > 0) reasons.push("book");
  if (personCount > 1) reasons.push("multiple persons");
  return reasons.length ? reasons : null;
}

export function getOutcome(detections, expected) {
  const violated = !!getViolationReason(detections);

  if (expected  &&  violated) return "tp"; // Phone expected & detected
  if (!expected && !violated) return "tn"; // No phone expected & none detected
  if (!expected &&  violated) return "fp"; // No phone expected but flagged
  return "fn";                             // Phone expected but missed
}

export function badgeHTML(outcome, reasons) {
  const map = {
    tp:   ["badge-pass", "✓ TP"],
    tn:   ["badge-pass", "✓ TN"],
    fp:   ["badge-fp",   "⚠ FP"],
    fn:   ["badge-fail", "✗ FN"],
    pend: ["badge-pend", "—"],
  };
  const [cls, txt] = map[outcome] || map.pend;
  const tip = reasons?.length ? ` title="Flagged: ${reasons.join(', ')}"` : "";
  return `<span class="badge ${cls}"${tip}>${txt}</span>`;
}

export function buildSummaryTable(results, sessionMeta = {}) {
  let tp = 0, tn = 0, fp = 0, fn = 0, times = [];
  const classCounts = Object.fromEntries(
    Object.values(DETECTED_CLASSES).map(c => [c.name, 0])
  );

  results.forEach(r => {
    if (r.imgStats) {
      tp += r.imgStats.tp;
      tn += r.imgStats.tn;
      fp += r.imgStats.fp;
      fn += r.imgStats.fn;
    }
    if (r.inferenceMs) times.push(r.inferenceMs);
    (r.allDetections || []).forEach(d => {
      if (d.className in classCounts) classCounts[d.className]++;
    });
  });

  const total = tp + tn + fp + fn;
  const totalCorrect = tp + tn;
  const totalIncorrect = fp + fn;
  const accuracy = total ? ((totalCorrect / total) * 100).toFixed(1) : 0;
  const precision = (tp + fp) > 0 ? (tp / (tp + fp) * 100).toFixed(1) : 0;
  const recall = (tp + fn) > 0 ? (tp / (tp + fn) * 100).toFixed(1) : 0;
  const f1 = (parseFloat(precision) + parseFloat(recall)) > 0 
    ? (2 * (precision * recall) / (parseFloat(precision) + parseFloat(recall))).toFixed(1) 
    : 0;

  const avgMs = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : "—";

  const classColors = Object.fromEntries(
    Object.values(DETECTED_CLASSES).map(c => [c.name, c.color])
  );

  const violationRules = `
<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:14px 16px;margin-bottom:24px;font-size:13px">
  <div style="font-size:11px;color:#555;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Violation rules</div>
  <div style="display:flex;gap:20px;flex-wrap:wrap">
    <span style="color:#f87171">● Cell phone detected</span>
    <span style="color:#a78bfa">● Laptop detected</span>
    <span style="color:#34d399">● Book detected</span>
    <span style="color:#60a5fa">● More than 1 person</span>
  </div>
</div>`;

  const classPills = Object.entries(classCounts).map(([name, count]) =>
    `<div class="scard">
      <div class="scard-label" style="display:flex;align-items:center;gap:6px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${classColors[name]};display:inline-block;"></span>
        ${name}
      </div>
      <div class="scard-val">${count}</div>
    </div>`
  ).join("");

  const systemHealth = `
<h3 style="font-size:13px;color:#666;margin:30px 0 10px;text-transform:uppercase;letter-spacing:.06em">System Health & Stability</h3>
<div class="summary-cards">
  <div class="scard"><div class="scard-label">Memory Delta</div><div class="scard-val" style="color:${parseFloat(sessionMeta.memDelta) > 5 ? '#f87171' : '#3dd68c'}">${sessionMeta.memDelta || "—"} MB</div></div>
  <div class="scard"><div class="scard-label">Max Latency</div><div class="scard-val">${sessionMeta.maxLatency ? sessionMeta.maxLatency.toFixed(1) : "—"} ms</div></div>
  <div class="scard"><div class="scard-label">Inference Jitter</div><div class="scard-val">${sessionMeta.jitter ? sessionMeta.jitter.toFixed(2) : "—"} ms</div></div>
  <div class="scard"><div class="scard-label">Backend Provider</div><div class="scard-val" style="font-size:16px;color:#60a5fa">${sessionMeta.backend || "Auto"}</div></div>
</div>`;

  return `
${violationRules}
<h3 style="font-size:13px;color:#666;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em">Session Performance & Correctness</h3>
<div class="summary-cards">
  <div class="scard"><div class="scard-label">Correct Samples</div><div class="scard-val" style="color:#3dd68c">${totalCorrect} / ${total}</div></div>
  <div class="scard"><div class="scard-label">Incorrect Samples</div><div class="scard-val" style="color:#f87171">${totalIncorrect} / ${total}</div></div>
  <div class="scard"><div class="scard-label">Total Accuracy</div><div class="scard-val">${accuracy}%</div></div>
  <div class="scard"><div class="scard-label">F1-Score</div><div class="scard-val">${f1}</div></div>
</div>

<div class="summary-cards" style="margin-top:-10px">
  <div class="scard"><div class="scard-label">Precision (FP Rate)</div><div class="scard-val" style="color:#60a5fa">${precision}%</div></div>
  <div class="scard"><div class="scard-label">Recall (Catch Rate)</div><div class="scard-val" style="color:#a78bfa">${recall}%</div></div>
  <div class="scard"><div class="scard-label">Avg Inference</div><div class="scard-val">${avgMs} ms</div></div>
  <div class="scard"><div class="scard-label">Peak Memory</div><div class="scard-val">${sessionMeta.peakMem || "—"} MB</div></div>
</div>

<h3 style="font-size:13px;color:#666;margin:20px 0 10px;text-transform:uppercase;letter-spacing:.06em">Classification Matrix</h3>
<div class="summary-cards">
  <div class="scard"><div class="scard-label">True Positives</div><div class="scard-val" style="color:#3dd68c">${tp}</div></div>
  <div class="scard"><div class="scard-label">True Negatives</div><div class="scard-val" style="color:#3dd68c">${tn}</div></div>
  <div class="scard"><div class="scard-label">False Positives</div><div class="scard-val" style="color:#f87171">${fp}</div></div>
  <div class="scard"><div class="scard-label">False Negatives</div><div class="scard-val" style="color:#f87171">${fn}</div></div>
</div>

${systemHealth}

<h3 style="font-size:13px;color:#666;margin:20px 0 10px;text-transform:uppercase;letter-spacing:.06em">Total detections by class</h3>
<div class="summary-cards">${classPills}</div>

<h3 style="font-size:13px;color:#666;margin:20px 0 10px;text-transform:uppercase;letter-spacing:.06em">Dataset Analysis</h3>
<table>
  <thead>
    <tr>
      <th>Category</th>
      <th>Outcome</th>
      <th>Reliability (Robustness)</th>
      <th>Avg Conf</th>
      <th>Avg Inf</th>
    </tr>
  </thead>
  <tbody>
    ${results.map(r => {
      const robustness = (r.robustnessScore * 100).toFixed(1);
      const scoreColor = robustness > 80 ? '#3dd68c' : robustness > 50 ? '#ffb74d' : '#f87171';
      
      return `<tr>
        <td><b>${r.id}</b> — ${r.label}</td>
        <td>${badgeHTML(r.outcome)}</td>
        <td><div style="font-weight:600;color:${scoreColor}">${robustness}%</div></td>
        <td>${(r.avgConf * 100).toFixed(1)}%</td>
        <td>${r.inferenceMs.toFixed(1)} ms</td>
      </tr>`;
    }).join("")}
  </tbody>
</table>`;
}
