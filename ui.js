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

  if (expected  &&  violated) return "pass";   // expected violation, caught it
  if (!expected && !violated) return "pass";   // expected clean, confirmed clean
  if (!expected &&  violated) return "fp";     // expected clean, wrongly flagged
  return "fail";                               // expected violation, missed it
}

export function badgeHTML(outcome, reasons) {
  const map = {
    pass: ["badge-pass", "✓ Correct"],
    fail: ["badge-fail", "✗ Missed"],
    fp:   ["badge-fp",   "⚠ False +"],
    pend: ["badge-pend", "—"],
  };
  const [cls, txt] = map[outcome] || map.pend;
  const tip = reasons?.length ? ` title="Flagged: ${reasons.join(', ')}"` : "";
  return `<span class="badge ${cls}"${tip}>${txt}</span>`;
}

export function buildSummaryTable(results) {
  let pass = 0, fp = 0, fn = 0, times = [];
  const classCounts = Object.fromEntries(
    Object.values(DETECTED_CLASSES).map(c => [c.name, 0])
  );

  results.forEach(r => {
    if (r.outcome === "pass") pass++;
    if (r.outcome === "fp")   fp++;
    if (r.outcome === "fail") fn++;
    if (r.inferenceMs) times.push(r.inferenceMs);
    (r.allDetections || []).forEach(d => {
      if (d.className in classCounts) classCounts[d.className]++;
    });
  });

  const total = results.length;
  const acc   = total ? ((pass / total) * 100).toFixed(0) : 0;
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

  return `
${violationRules}
<div class="summary-cards">
  <div class="scard"><div class="scard-label">Accuracy</div><div class="scard-val" style="color:#3dd68c">${acc}%</div></div>
  <div class="scard"><div class="scard-label">False positives</div><div class="scard-val" style="color:#ffb74d">${fp}</div></div>
  <div class="scard"><div class="scard-label">Missed detections</div><div class="scard-val" style="color:#f28b82">${fn}</div></div>
  <div class="scard"><div class="scard-label">Avg inference</div><div class="scard-val">${avgMs} ms</div></div>
</div>

<h3 style="font-size:13px;color:#666;margin:20px 0 10px;text-transform:uppercase;letter-spacing:.06em">Total detections by class</h3>
<div class="summary-cards">${classPills}</div>

<h3 style="font-size:13px;color:#666;margin:20px 0 10px;text-transform:uppercase;letter-spacing:.06em">Per-category results</h3>
<table>
  <thead>
    <tr>
      <th>Category</th>
      <th>Images</th>
      <th>Outcome</th>
      <th>Violation reasons</th>
      <th>Detected classes</th>
      <th>Inference</th>
    </tr>
  </thead>
  <tbody>
    ${results.map(r => {
      const reasons     = getViolationReason(r.allDetections || []);
      const foundClasses = [...new Set((r.allDetections || []).map(d => d.className))];
      const classTags   = foundClasses.map(name =>
        `<span style="font-size:11px;padding:2px 7px;border-radius:10px;background:#1a1a1a;border:1px solid #333;color:${classColors[name] || '#aaa'}">${name}</span>`
      ).join(" ");
      const reasonTags  = reasons
        ? reasons.map(reason => {
            const color = reason === "cell phone" ? "#f87171"
                        : reason === "laptop"     ? "#a78bfa"
                        : reason === "book"        ? "#34d399"
                        : "#60a5fa";
            return `<span style="font-size:11px;padding:2px 7px;border-radius:10px;background:#1a1a1a;border:1px solid ${color}44;color:${color}">${reason}</span>`;
          }).join(" ")
        : `<span style="color:#555;font-size:12px">none</span>`;

      return `<tr>
        <td><b>${r.id}</b> — ${r.label}</td>
        <td>${r.imageCount}</td>
        <td>${badgeHTML(r.outcome, reasons)}</td>
        <td style="padding:8px 12px">${reasonTags}</td>
        <td style="padding:8px 12px">${classTags || '<span style="color:#555">—</span>'}</td>
        <td>${r.inferenceMs ? r.inferenceMs.toFixed(1) + " ms" : "—"}</td>
      </tr>`;
    }).join("")}
  </tbody>
</table>`;
}
