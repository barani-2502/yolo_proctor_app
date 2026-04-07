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

export function getHeapMB() {
  if (performance.memory) {
    return (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + " MB";
  }
  return "N/A";
}

export function formatMs(ms) {
  return ms.toFixed(1) + " ms";
}
