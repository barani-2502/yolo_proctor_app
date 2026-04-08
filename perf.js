let lastFrame = performance.now();
let fps = 0;
let frameCount = 0;

export function tickFPS() {
  frameCount++;
  const now = performance.now();
  if (now - lastFrame >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastFrame = now;
  }
  return fps;
}

export function getSystemInfo() {
  const info = {
    cpu: navigator.hardwareConcurrency || "N/A",
    memory: navigator.deviceMemory ? navigator.deviceMemory + " GB" : "N/A",
    gpu: "Unknown"
  };

  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        info.gpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      }
    }
  } catch (e) {
    console.error("Failed to get GPU info", e);
  }

  return info;
}

export function getHeapStats() {
  if (performance.memory) {
    const mem = performance.memory;
    return {
      used: (mem.usedJSHeapSize / 1048576).toFixed(1),
      total: (mem.totalJSHeapSize / 1048576).toFixed(1),
      limit: (mem.jsHeapLimit / 1048576).toFixed(1)
    };
  }
  return null;
}

export function getHeapMB() {
  const stats = getHeapStats();
  if (stats) return stats.used + " MB";
  return "N/A";
}

export function calculateJitter(times) {
  if (times.length < 2) return 0;
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const squareDiffs = times.map(t => Math.pow(t - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / times.length;
  return Math.sqrt(avgSquareDiff);
}

export function getHeapBytes() {
  if (performance.memory) return performance.memory.usedJSHeapSize;
  return 0;
}

export function formatMs(ms) {
  return ms.toFixed(1) + " ms";
}

/**
 * Initializes the Compute Pressure API to monitor system load.
 * @param {Function} callback - Called when pressure state changes.
 */
export function initPressureObserver(callback) {
  if (!('PressureObserver' in window)) {
    console.warn("Compute Pressure API not supported in this browser.");
    callback("N/A");
    return;
  }

  try {
    const observer = new PressureObserver((records) => {
      // Get the latest record (usually includes 'cpu' and 'gpu' in modern versions)
      const lastRecord = records[records.length - 1];
      const state = lastRecord.state; // 'nominal', 'fair', 'serious', 'critical'
      
      // Map states to user-friendly status
      const statusMap = {
        'nominal': "🟢 Nom",
        'fair': "🟡 Fair",
        'serious': "🟠 High",
        'critical': "🔴 Crit"
      };
      
      callback(statusMap[state] || state);
    });

    // Start observing 'cpu' and 'gpu' (if supported)
    observer.observe('cpu');
    // Some browsers also support 'gpu' as a separate source
    try { observer.observe('gpu'); } catch(e) {}

  } catch (e) {
    console.error("Failed to initialize PressureObserver", e);
    callback("Err");
  }
}
