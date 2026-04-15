/**
 * SnapFull — Image Stitcher Utility
 * 
 * Takes an array of screenshot tiles (base64 data URLs) captured at
 * different scroll positions and stitches them into a single full-page
 * image using OffscreenCanvas for performance.
 * 
 * Handles:
 * - Partial tiles at page boundaries (last row/column)
 * - Device pixel ratio scaling
 * - Memory-efficient bitmap processing
 */

/**
 * Stitch tiles into a single full-page image
 * 
 * @param {Array<Object>} tiles - Array of tile objects:
 *   { dataUrl: string, x: number, y: number, width: number, height: number }
 * @param {Object} pageInfo - Full page dimensions:
 *   { scrollWidth, scrollHeight, viewportWidth, viewportHeight, devicePixelRatio }
 * @returns {Promise<Blob>} - Stitched image as PNG Blob
 */
export async function stitchTiles(tiles, pageInfo) {
  const {
    scrollWidth,
    scrollHeight,
    viewportWidth,
    viewportHeight,
    devicePixelRatio = 1
  } = pageInfo;

  // Physical pixel dimensions for the final canvas
  const canvasWidth = Math.round(scrollWidth * devicePixelRatio);
  const canvasHeight = Math.round(scrollHeight * devicePixelRatio);

  // Safety check: limit canvas size to prevent memory issues
  const MAX_CANVAS_AREA = 256 * 1024 * 1024; // ~256 megapixels
  if (canvasWidth * canvasHeight > MAX_CANVAS_AREA) {
    throw new Error(
      `Page is too large to capture: ${canvasWidth}x${canvasHeight} pixels. ` +
      `Maximum supported area is ${MAX_CANVAS_AREA} pixels.`
    );
  }

  // Create the output canvas
  let canvas, ctx;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    ctx = canvas.getContext('2d');
  } else {
    canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    ctx = canvas.getContext('2d');
  }

  // Process tiles in sequence to manage memory
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];

    try {
      // Convert data URL to ImageBitmap for efficient rendering
      const response = await fetch(tile.dataUrl);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);

      // Calculate draw position in physical pixels
      const drawX = Math.round(tile.x * devicePixelRatio);
      const drawY = Math.round(tile.y * devicePixelRatio);

      // Calculate how much of this tile to draw
      // (last row/column may extend beyond page bounds)
      const availableWidth = canvasWidth - drawX;
      const availableHeight = canvasHeight - drawY;
      const drawWidth = Math.min(bitmap.width, availableWidth);
      const drawHeight = Math.min(bitmap.height, availableHeight);

      // Draw the tile - clip to available area
      ctx.drawImage(
        bitmap,
        0, 0, drawWidth, drawHeight,  // source rect
        drawX, drawY, drawWidth, drawHeight // dest rect
      );

      // Release bitmap memory
      bitmap.close();

      // Release the data URL to free memory
      tile.dataUrl = null;
    } catch (err) {
      console.error(`Failed to process tile ${i} at (${tile.x}, ${tile.y}):`, err);
      // Continue with remaining tiles
    }
  }

  // Convert to blob
  if (canvas.convertToBlob) {
    return await canvas.convertToBlob({ type: 'image/png' });
  } else {
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
}

/**
 * Convert a Blob to a data URL
 * @param {Blob} blob 
 * @returns {Promise<string>}
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert a data URL to a Blob
 * @param {string} dataUrl 
 * @returns {Promise<Blob>}
 */
export async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}
