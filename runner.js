export const DETECTED_CLASSES = {
  0: { name: "person", color: "#3b82f6" },
  63: { name: "laptop", color: "#8b5cf6" },
  67: { name: "cell phone", color: "#ef4444" },
  73: { name: "book", color: "#10b981" },
};

export const CONF_THRESHOLD = 0.3;
export const INPUT_SIZE = 640;

let session = null;

export async function loadModel(path, forceCPU = false) {
  // 1. Configure Global WASM environment for peak 1.18-style speed
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
  ort.env.wasm.numThreads = 4; // Target sweet-spot for YOLO Nano
  ort.env.wasm.simd = true; 
  ort.env.wasm.proxy = false; // Direct execution avoids worker overhead

  if (!forceCPU) {
    try {
      // 2. Attempt WebGPU first for maximum speed
      session = await ort.InferenceSession.create(path, { 
        executionProviders: ["webgpu"],
        executionMode: 'parallel' 
      });
      return "webgpu";
    } catch (e) {
      console.warn("WebGPU not available, falling back to optimized WASM:", e);
    }
  }

  // 3. Force/Fallback to highly-tuned WASM
  session = await ort.InferenceSession.create(path, { 
    executionProviders: ["wasm"],
    executionMode: 'parallel' 
  });
  return "wasm";
}

export async function runInference(imageElement) {
  if (!session) throw new Error("Model not loaded");

  const tPrepStart = performance.now();
  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE; canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageElement, 0, 0, INPUT_SIZE, INPUT_SIZE);

  const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const float32 = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);

  // Pre-process: Normalize and handle Planar (RGBRGB -> RRR...GGG...BBB...)
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    float32[i] = imageData[i * 4] / 255.0;
    float32[i + INPUT_SIZE * INPUT_SIZE] = imageData[i * 4 + 1] / 255.0;
    float32[i + 2 * INPUT_SIZE * INPUT_SIZE] = imageData[i * 4 + 2] / 255.0;
  }

  const tensor = new ort.Tensor("float32", float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const prepMs = performance.now() - tPrepStart;

  const tInfStart = performance.now();
  const results = await session.run({ images: tensor });
  const inferenceMs = performance.now() - tInfStart;

  const tPostStart = performance.now();
  const output = results[session.outputNames[0]];
  const detections = parseDetections(output, imageElement.naturalWidth, imageElement.naturalHeight);
  const postMs = performance.now() - tPostStart;

  return {
    detections,
    inferenceMs,
    perf: {
      prep: prepMs,
      inference: inferenceMs,
      post: postMs,
      total: prepMs + inferenceMs + postMs
    }
  };
}

function parseDetections(output, origW, origH) {
  const data = output.data;
  const dims = output.dims; // [1, 84, 8400]

  const detections = [];
  const numClasses = 80;
  const numBoxes = dims[2]; // 8400

  const scaleX = origW / INPUT_SIZE;
  const scaleY = origH / INPUT_SIZE;

  for (let i = 0; i < numBoxes; i++) {
    let maxScore = 0;
    let classId = -1;

    // YOLOv11 format: [x, y, w, h, class0, class1, ... class79]
    // The data is transposed: box coordinates are at the start of the 8400 block
    for (let c = 0; c < numClasses; c++) {
      const score = data[numBoxes * (c + 4) + i];
      if (score > maxScore) {
        maxScore = score;
        classId = c;
      }
    }

    if (maxScore > CONF_THRESHOLD && classId in DETECTED_CLASSES) {
      const cx = data[i] * scaleX;
      const cy = data[numBoxes + i] * scaleY;
      const w = data[numBoxes * 2 + i] * scaleX;
      const h = data[numBoxes * 3 + i] * scaleY;

      detections.push({
        x: cx - w / 2,
        y: cy - h / 2,
        w: w,
        h: h,
        confidence: maxScore,
        classId: classId,
        className: DETECTED_CLASSES[classId].name,
        color: DETECTED_CLASSES[classId].color
      });
    }
  }

  // Non-Maximum Suppression (NMS) to remove overlapping boxes
  return nms(detections, 0.45);
}

function nms(boxes, iouThreshold) {
  boxes.sort((a, b) => b.confidence - a.confidence);
  const result = [];
  while (boxes.length > 0) {
    const chosen = boxes.shift();
    result.push(chosen);
    boxes = boxes.filter(box => {
      return calculateIou(chosen, box) < iouThreshold;
    });
  }
  return result;
}

function calculateIou(box1, box2) {
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.w, box2.x + box2.w);
  const y2 = Math.min(box1.y + box1.h, box2.y + box2.h);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = box1.w * box1.h + box2.w * box2.h - intersection;
  return intersection / union;
}
