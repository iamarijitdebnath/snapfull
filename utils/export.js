/**
 * SnapFull — Export Utility
 * 
 * Handles exporting the captured/edited image in multiple formats:
 * - PNG
 * - JPEG (with quality control)
 * - PDF (via canvas-to-image embedding)
 * - Clipboard
 * - Auto-download
 */

/**
 * Export canvas/image as PNG Blob
 * @param {HTMLCanvasElement} canvas 
 * @returns {Promise<Blob>}
 */
export function exportAsPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG export failed'));
      },
      'image/png'
    );
  });
}

/**
 * Export canvas/image as JPEG Blob
 * @param {HTMLCanvasElement} canvas 
 * @param {number} quality - 0.0 to 1.0
 * @returns {Promise<Blob>}
 */
export function exportAsJpeg(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('JPEG export failed'));
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Export canvas/image as PDF
 * Uses a simple canvas-to-image approach without jsPDF dependency
 * by leveraging the browser's print capabilities
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 */
export async function exportAsPdf(canvas) {
  // Create a PDF using canvas data
  // We'll create a minimal PDF file manually
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  const imgData = await fetch(dataUrl).then(r => r.arrayBuffer());
  
  const width = canvas.width;
  const height = canvas.height;
  
  // Convert pixels to PDF points (72 dpi)
  // Scale to fit A4-ish proportions or use actual size
  const maxWidth = 595.28; // A4 width in points
  const scale = Math.min(maxWidth / width, 1);
  const pdfWidth = width * scale;
  const pdfHeight = height * scale;
  
  // Build minimal PDF
  const pdf = buildMinimalPdf(imgData, pdfWidth, pdfHeight, width, height);
  return new Blob([pdf], { type: 'application/pdf' });
}

/**
 * Build a minimal valid PDF file containing a single JPEG image
 * This avoids the need for a 300KB jsPDF library
 */
function buildMinimalPdf(jpegData, pageWidth, pageHeight, imgWidth, imgHeight) {
  const jpegBytes = new Uint8Array(jpegData);
  
  let objects = [];
  let offsets = [];
  let output = '';
  
  // Header
  output += '%PDF-1.4\n';
  
  // Object 1: Catalog
  offsets.push(output.length);
  output += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  
  // Object 2: Pages
  offsets.push(output.length);
  output += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  
  // Object 3: Page
  offsets.push(output.length);
  output += `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Contents 4 0 R /Resources << /XObject << /Img 5 0 R >> >> >>\nendobj\n`;
  
  // Object 4: Content stream (draw image)
  const contentStream = `q ${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm /Img Do Q`;
  offsets.push(output.length);
  output += `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;
  
  // Object 5: Image XObject — will be appended as binary
  offsets.push(output.length);
  const imgHeader = `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`;
  const imgFooter = `\nendstream\nendobj\n`;
  
  // Combine text + binary
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(output + imgHeader);
  const footerBytes = encoder.encode(imgFooter);
  
  // Recalculate offset for xref
  const xrefOffset = headerBytes.length + jpegBytes.length + footerBytes.length;
  
  // XRef and trailer
  const numObjects = 5;
  let xref = `xref\n0 ${numObjects + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 0; i < offsets.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  xref += `trailer\n<< /Size ${numObjects + 1} /Root 1 0 R >>\n`;
  xref += `startxref\n${xrefOffset}\n%%EOF\n`;
  
  const xrefBytes = encoder.encode(xref);
  
  // Combine all parts
  const totalLength = headerBytes.length + jpegBytes.length + footerBytes.length + xrefBytes.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  result.set(headerBytes, offset); offset += headerBytes.length;
  result.set(jpegBytes, offset); offset += jpegBytes.length;
  result.set(footerBytes, offset); offset += footerBytes.length;
  result.set(xrefBytes, offset);
  
  return result;
}

/**
 * Copy image to clipboard
 * @param {HTMLCanvasElement} canvas 
 * @returns {Promise<void>}
 */
export async function copyToClipboard(canvas) {
  try {
    const blob = await exportAsPng(canvas);
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    throw err;
  }
}

/**
 * Trigger a file download
 * @param {Blob} blob - The file data
 * @param {string} filename - Desired filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  
  // Try using chrome.downloads API first
  if (typeof chrome !== 'undefined' && chrome.downloads) {
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, () => {
      // Revoke after a delay to let download start
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  } else {
    // Fallback: use <a> element download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

/**
 * Generate a filename with timestamp
 * @param {string} extension - File extension (png, jpg, pdf)
 * @returns {string}
 */
export function generateFilename(extension = 'png') {
  const now = new Date();
  const date = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `SnapFull_${date}.${extension}`;
}
