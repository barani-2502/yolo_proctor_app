/**
 * Logic for processing and parsing local YOLO datasets.
 * Matches images and labels in a folder structure.
 */

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Scans a list of files (from a folder upload) and matches images with labels.
 */
export async function matchFiles(files) {
  const images = {};
  const labels = {};

  for (const file of Array.from(files)) {
    const path = file.webkitRelativePath.toLowerCase();
    const name = file.name.toLowerCase();
    const base = name.substring(0, name.lastIndexOf('.'));

    if (IMAGE_EXTS.some(ext => name.endsWith(ext))) {
      images[base] = file;
    } else if (name.endsWith('.txt')) {
      labels[base] = file;
    }
  }

  const matched = [];
  for (const base in images) {
    matched.push({
      id: base,
      filename: images[base].name,
      imageFile: images[base],
      labelFile: labels[base] || null
    });
  }

  return matched;
}

/**
 * Parses a YOLO .txt label file.
 * Format: <class_id> <x_center> <y_center> <width> <height>
 */
export async function parseYoloLabel(file) {
  if (!file) return { expected: false, groundTruths: [] };

  const text = await file.text();
  const lines = text.trim().split('\n');
  const groundTruths = [];
  let personCount = 0;
  let hasProhibited = false;

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;

    const classId = parseInt(parts[0]);
    if (classId === 0) personCount++;
    if ([63, 67, 73].includes(classId)) hasProhibited = true;

    groundTruths.push({
      classId,
      cx: parseFloat(parts[1]),
      cy: parseFloat(parts[2]),
      w: parseFloat(parts[3]),
      h: parseFloat(parts[4])
    });
  }

  // Violation check based on app rules:
  // Prohibited object (phone, laptop, book) OR multiple persons
  const expectedViolation = hasProhibited || personCount > 1;

  return {
    expected: expectedViolation,
    groundTruths
  };
}

/**
 * Creates a category object compatible with the app's manifest structure.
 */
export async function createDatasetCategory(name, matchedPairs) {
  const images = [];
  const blobs = {};

  for (const pair of matchedPairs) {
    const labelData = await parseYoloLabel(pair.labelFile);
    const blobUrl = URL.createObjectURL(pair.imageFile);
    
    // Store blob for cleaner cleanup later
    blobs[pair.filename] = blobUrl;
    
    images.push({
      filename: pair.filename,
      src: blobUrl,
      expected: labelData.expected,
      groundTruths: labelData.groundTruths
    });
  }

  return {
    id: 'local-' + Date.now(),
    label: name,
    images: images.map(img => img.filename),
    imageDetails: images, // Custom field to store blob URLs
    isLocal: true
  };
}
