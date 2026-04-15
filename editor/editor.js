/**
 * SnapFull — Editor Script
 * 
 * Canvas-based image editor built on Fabric.js.
 * Provides: crop, text, arrow, rectangle, circle, line, freehand draw,
 * blur region, highlight, color/stroke controls, undo/redo, zoom, and export.
 */

(() => {
  'use strict';

  // ── DOM Elements ────────────────────────────────────────────────────
  const canvasEl = document.getElementById('editor-canvas');
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const loadingOverlay = document.getElementById('loading-overlay');
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');
  const cropOverlay = document.getElementById('crop-overlay');
  const zoomLevelEl = document.getElementById('zoom-level');
  const colorInput = document.getElementById('tool-color');
  const colorSwatch = document.getElementById('color-swatch');
  const strokeWidthInput = document.getElementById('tool-stroke-width');
  const strokeValueEl = document.getElementById('stroke-value');
  const fontSizeInput = document.getElementById('tool-font-size');
  const fontSizeValueEl = document.getElementById('font-size-value');
  const fontControl = document.getElementById('font-control');

  // ── State ───────────────────────────────────────────────────────────
  let fabricCanvas = null;
  let backgroundImage = null;
  let currentTool = 'select';
  let currentColor = '#ef4444';
  let currentStrokeWidth = 3;
  let currentFontSize = 24;
  let zoomLevel = 1;
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let isDrawingShape = false;
  let shapeStart = { x: 0, y: 0 };
  let activeShape = null;
  let cropRect = null;
  let undoStack = [];
  let redoStack = [];
  let isUndoRedoAction = false;
  let imageWidth = 0;
  let imageHeight = 0;

  // ── Initialize ──────────────────────────────────────────────────────
  async function init() {
    await loadImage();
    setupTools();
    setupKeyboard();
    setupZoom();
    setupExport();
    setupUndoRedo();
  }

  // ── Load Image from Storage ─────────────────────────────────────────
  async function loadImage() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('editorImage', (data) => {
        if (!data.editorImage) {
          showToast('No image found. Capture a screenshot first.', 'error');
          loadingOverlay.classList.add('fade-out');
          reject(new Error('No image'));
          return;
        }

        const img = new Image();
        img.onload = () => {
          imageWidth = img.width;
          imageHeight = img.height;

          // Initialize Fabric canvas at image dimensions
          fabricCanvas = new fabric.Canvas('editor-canvas', {
            width: imageWidth,
            height: imageHeight,
            backgroundColor: '#000',
            selection: true,
            preserveObjectStacking: true
          });

          // Set background image
          const fabricImg = new fabric.Image(img, {
            left: 0,
            top: 0,
            selectable: false,
            evented: false,
            objectCaching: false
          });

          fabricCanvas.setBackgroundImage(fabricImg, fabricCanvas.renderAll.bind(fabricCanvas));
          backgroundImage = fabricImg;

          // Fit to window
          fitToWindow();

          // Hide loading
          setTimeout(() => {
            loadingOverlay.classList.add('fade-out');
            setTimeout(() => loadingOverlay.classList.add('hidden'), 500);
          }, 200);

          // Save initial state
          saveState();

          // Listen for object modifications
          fabricCanvas.on('object:modified', () => {
            if (!isUndoRedoAction) saveState();
          });
          fabricCanvas.on('object:added', () => {
            if (!isUndoRedoAction) saveState();
          });

          resolve();
        };

        img.onerror = () => {
          showToast('Failed to load image', 'error');
          loadingOverlay.classList.add('fade-out');
          reject(new Error('Image load failed'));
        };

        img.src = data.editorImage;
      });
    });
  }

  // ── Zoom ────────────────────────────────────────────────────────────
  function fitToWindow() {
    const wrapper = canvasWrapper;
    const wrapperWidth = wrapper.clientWidth;
    const wrapperHeight = wrapper.clientHeight;

    const scaleX = wrapperWidth / imageWidth;
    const scaleY = wrapperHeight / imageHeight;
    zoomLevel = Math.min(scaleX, scaleY) * 0.9; // 90% with padding

    applyZoom();
    centerCanvas();
  }

  function applyZoom() {
    const container = document.getElementById('canvas-container');
    container.style.transform = `scale(${zoomLevel})`;
    zoomLevelEl.textContent = Math.round(zoomLevel * 100) + '%';
  }

  function centerCanvas() {
    const wrapper = canvasWrapper;
    const container = document.getElementById('canvas-container');
    const scaledWidth = imageWidth * zoomLevel;
    const scaledHeight = imageHeight * zoomLevel;

    const left = Math.max(0, (wrapper.clientWidth - scaledWidth) / 2);
    const top = Math.max(0, (wrapper.clientHeight - scaledHeight) / 2);

    container.style.left = left + 'px';
    container.style.top = top + 'px';
  }

  function setupZoom() {
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      zoomLevel = Math.min(zoomLevel * 1.25, 5);
      applyZoom();
      centerCanvas();
    });

    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      zoomLevel = Math.max(zoomLevel / 1.25, 0.1);
      applyZoom();
      centerCanvas();
    });

    document.getElementById('btn-zoom-fit').addEventListener('click', fitToWindow);

    document.getElementById('btn-zoom-100').addEventListener('click', () => {
      zoomLevel = 1;
      applyZoom();
      centerCanvas();
    });

    // Mouse wheel zoom
    canvasWrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomLevel = Math.min(zoomLevel * 1.1, 5);
      } else {
        zoomLevel = Math.max(zoomLevel / 1.1, 0.1);
      }
      applyZoom();
      centerCanvas();
    }, { passive: false });

    // Pan with middle mouse or space+drag is handled in keyboard/mouse events
  }

  // ── Tools ───────────────────────────────────────────────────────────
  function setupTools() {
    // Tool buttons
    const toolButtons = document.querySelectorAll('[data-tool]');
    toolButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        selectTool(btn.dataset.tool);
      });
    });

    // Color
    colorInput.addEventListener('input', (e) => {
      currentColor = e.target.value;
      colorSwatch.style.background = currentColor;
      updateSelectedObjectColor();
    });
    colorSwatch.style.background = currentColor;

    // Stroke width
    strokeWidthInput.addEventListener('input', (e) => {
      currentStrokeWidth = parseInt(e.target.value);
      strokeValueEl.textContent = currentStrokeWidth + 'px';
      updateSelectedObjectStroke();
    });

    // Font size
    fontSizeInput.addEventListener('input', (e) => {
      currentFontSize = parseInt(e.target.value);
      fontSizeValueEl.textContent = currentFontSize + 'px';
      updateSelectedObjectFontSize();
    });

    // Delete selected
    document.getElementById('btn-delete').addEventListener('click', deleteSelected);

    // Crop actions
    document.getElementById('btn-crop-confirm').addEventListener('click', applyCrop);
    document.getElementById('btn-crop-cancel').addEventListener('click', cancelCrop);

    // Setup canvas mouse events for shape drawing
    setupCanvasMouseEvents();
  }

  function selectTool(tool) {
    currentTool = tool;

    // Update button states
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.classList.toggle('tool-active', btn.dataset.tool === tool);
    });

    // Show/hide font control
    fontControl.classList.toggle('hidden', tool !== 'text');

    // Configure canvas based on tool
    if (!fabricCanvas) return;

    // Reset drawing mode
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = true;
    fabricCanvas.defaultCursor = 'default';
    fabricCanvas.hoverCursor = 'move';

    // Cancel any active crop
    if (tool !== 'crop') {
      cancelCrop();
    }

    switch (tool) {
      case 'select':
        fabricCanvas.forEachObject(o => { o.selectable = true; o.evented = true; });
        break;

      case 'crop':
        fabricCanvas.discardActiveObject();
        fabricCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
        fabricCanvas.defaultCursor = 'crosshair';
        cropOverlay.classList.remove('hidden');
        break;

      case 'text':
        fabricCanvas.discardActiveObject();
        fabricCanvas.defaultCursor = 'text';
        fabricCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
        break;

      case 'draw':
        fabricCanvas.isDrawingMode = true;
        fabricCanvas.freeDrawingBrush.color = currentColor;
        fabricCanvas.freeDrawingBrush.width = currentStrokeWidth;
        break;

      case 'arrow':
      case 'rect':
      case 'circle':
      case 'line':
      case 'blur':
      case 'highlight':
        fabricCanvas.discardActiveObject();
        fabricCanvas.defaultCursor = 'crosshair';
        fabricCanvas.forEachObject(o => { o.selectable = false; o.evented = false; });
        break;
    }

    fabricCanvas.renderAll();
  }

  // ── Canvas Mouse Events (Shape Drawing) ─────────────────────────────
  function setupCanvasMouseEvents() {
    if (!fabricCanvas) {
      // Will be called again after canvas init from loadImage
      setTimeout(() => {
        if (fabricCanvas) setupCanvasMouseEvents();
      }, 500);
      return;
    }

    fabricCanvas.on('mouse:down', (opt) => {
      const pointer = fabricCanvas.getPointer(opt.e);
      const shapeTool = ['arrow', 'rect', 'circle', 'line', 'blur', 'highlight', 'crop'];

      if (currentTool === 'text') {
        addTextAtPoint(pointer);
        return;
      }

      if (shapeTool.includes(currentTool)) {
        isDrawingShape = true;
        shapeStart = { x: pointer.x, y: pointer.y };
        activeShape = createShapeStart(pointer);
      }
    });

    fabricCanvas.on('mouse:move', (opt) => {
      if (!isDrawingShape || !activeShape) return;

      const pointer = fabricCanvas.getPointer(opt.e);
      updateShapeDraw(pointer);
      fabricCanvas.renderAll();
    });

    fabricCanvas.on('mouse:up', () => {
      if (isDrawingShape && activeShape) {
        finalizeShape();
      }
      isDrawingShape = false;
      activeShape = null;
    });
  }

  function createShapeStart(pointer) {
    let shape = null;

    switch (currentTool) {
      case 'rect':
        shape = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: 'transparent',
          stroke: currentColor,
          strokeWidth: currentStrokeWidth,
          strokeUniform: true,
          noScaleCache: false
        });
        fabricCanvas.add(shape);
        break;

      case 'circle':
        shape = new fabric.Ellipse({
          left: pointer.x,
          top: pointer.y,
          rx: 0,
          ry: 0,
          fill: 'transparent',
          stroke: currentColor,
          strokeWidth: currentStrokeWidth,
          strokeUniform: true
        });
        fabricCanvas.add(shape);
        break;

      case 'line':
        shape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
          stroke: currentColor,
          strokeWidth: currentStrokeWidth,
          strokeUniform: true
        });
        fabricCanvas.add(shape);
        break;

      case 'arrow':
        // Arrow = line + triangle head
        shape = {
          type: 'arrow',
          line: new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
            stroke: currentColor,
            strokeWidth: currentStrokeWidth,
            strokeUniform: true,
            selectable: false,
            evented: false
          }),
          head: new fabric.Triangle({
            left: pointer.x,
            top: pointer.y,
            width: currentStrokeWidth * 4,
            height: currentStrokeWidth * 4,
            fill: currentColor,
            selectable: false,
            evented: false,
            originX: 'center',
            originY: 'center'
          })
        };
        fabricCanvas.add(shape.line);
        fabricCanvas.add(shape.head);
        break;

      case 'blur':
      case 'highlight':
      case 'crop':
        shape = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: currentTool === 'highlight'
            ? hexToRgba(currentColor, 0.3)
            : currentTool === 'crop'
              ? 'rgba(99, 102, 241, 0.15)'
              : 'rgba(0, 0, 0, 0.01)',
          stroke: currentTool === 'crop'
            ? '#6366f1'
            : currentTool === 'blur'
              ? 'rgba(255,255,255,0.3)'
              : 'transparent',
          strokeWidth: currentTool === 'crop' ? 2 : 1,
          strokeDashArray: currentTool === 'crop' ? [6, 4] : null,
          strokeUniform: true,
          selectable: false,
          evented: false
        });
        fabricCanvas.add(shape);
        break;
    }

    return shape;
  }

  function updateShapeDraw(pointer) {
    const dx = pointer.x - shapeStart.x;
    const dy = pointer.y - shapeStart.y;

    switch (currentTool) {
      case 'rect':
      case 'blur':
      case 'highlight':
      case 'crop':
        activeShape.set({
          left: dx > 0 ? shapeStart.x : pointer.x,
          top: dy > 0 ? shapeStart.y : pointer.y,
          width: Math.abs(dx),
          height: Math.abs(dy)
        });
        break;

      case 'circle':
        activeShape.set({
          left: dx > 0 ? shapeStart.x : pointer.x,
          top: dy > 0 ? shapeStart.y : pointer.y,
          rx: Math.abs(dx) / 2,
          ry: Math.abs(dy) / 2
        });
        break;

      case 'line':
        activeShape.set({ x2: pointer.x, y2: pointer.y });
        break;

      case 'arrow':
        activeShape.line.set({ x2: pointer.x, y2: pointer.y });
        // Position arrow head
        const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
        activeShape.head.set({
          left: pointer.x,
          top: pointer.y,
          angle: angle
        });
        break;
    }
  }

  function finalizeShape() {
    if (currentTool === 'arrow' && activeShape && activeShape.type === 'arrow') {
      // Group the arrow components
      const group = new fabric.Group([activeShape.line, activeShape.head], {
        selectable: currentTool === 'select',
        evented: currentTool === 'select'
      });
      fabricCanvas.remove(activeShape.line);
      fabricCanvas.remove(activeShape.head);
      fabricCanvas.add(group);
      fabricCanvas.renderAll();
    }

    if (currentTool === 'blur' && activeShape) {
      applyBlurToRegion(activeShape);
    }

    if (currentTool === 'crop' && activeShape) {
      if (cropRect) fabricCanvas.remove(cropRect);
      cropRect = activeShape;
      cropRect.set({
        selectable: true,
        evented: true,
        hasRotatingPoint: false,
        lockRotation: true,
        cornerColor: '#6366f1',
        cornerStrokeColor: '#fff',
        borderColor: '#6366f1',
        cornerSize: 8,
        transparentCorners: false
      });
      fabricCanvas.setActiveObject(cropRect);
      fabricCanvas.renderAll();
    }

    if (currentTool !== 'crop' && currentTool !== 'blur') {
      saveState();
    }
  }

  // ── Blur ────────────────────────────────────────────────────────────
  function applyBlurToRegion(rect) {
    const left = Math.round(rect.left);
    const top = Math.round(rect.top);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (width < 4 || height < 4) {
      fabricCanvas.remove(rect);
      return;
    }

    // Create a temporary canvas to get the region and blur it
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imageWidth;
    tempCanvas.height = imageHeight;
    const tempCtx = tempCanvas.getContext('2d');

    // Draw the background image to temp canvas
    if (backgroundImage && backgroundImage._element) {
      tempCtx.drawImage(backgroundImage._element, 0, 0);
    }

    // Get the pixel data for the region
    try {
      const regionCanvas = document.createElement('canvas');
      regionCanvas.width = width;
      regionCanvas.height = height;
      const regionCtx = regionCanvas.getContext('2d');

      regionCtx.drawImage(tempCanvas, left, top, width, height, 0, 0, width, height);

      // Apply blur with a downscale/upscale technique (fast approximation)
      const blurAmount = 10;
      const smallWidth = Math.max(1, Math.round(width / blurAmount));
      const smallHeight = Math.max(1, Math.round(height / blurAmount));

      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = smallWidth;
      blurCanvas.height = smallHeight;
      const blurCtx = blurCanvas.getContext('2d');

      // Downscale
      blurCtx.drawImage(regionCanvas, 0, 0, smallWidth, smallHeight);

      // Upscale back (this creates the blur effect)
      regionCtx.clearRect(0, 0, width, height);
      regionCtx.imageSmoothingEnabled = true;
      regionCtx.imageSmoothingQuality = 'low';
      regionCtx.drawImage(blurCanvas, 0, 0, width, height);

      // Create a Fabric image from the blurred region
      const blurredDataUrl = regionCanvas.toDataURL('image/png');
      
      // Remove the selection rectangle
      fabricCanvas.remove(rect);

      fabric.Image.fromURL(blurredDataUrl, (blurredImg) => {
        blurredImg.set({
          left: left,
          top: top,
          selectable: true,
          evented: true,
          _isBlur: true
        });
        fabricCanvas.add(blurredImg);
        fabricCanvas.renderAll();
        saveState();
      });
    } catch (err) {
      console.error('Blur failed:', err);
      fabricCanvas.remove(rect);
      showToast('Blur failed', 'error');
    }
  }

  // ── Crop ────────────────────────────────────────────────────────────
  function applyCrop() {
    if (!cropRect) return;

    const left = Math.round(Math.max(0, cropRect.left));
    const top = Math.round(Math.max(0, cropRect.top));
    const width = Math.round(Math.min(cropRect.width * cropRect.scaleX, imageWidth - left));
    const height = Math.round(Math.min(cropRect.height * cropRect.scaleY, imageHeight - top));

    if (width < 10 || height < 10) {
      showToast('Crop area too small', 'error');
      return;
    }

    // Create a new canvas with cropped dimensions
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = imageWidth;
    exportCanvas.height = imageHeight;
    const exportCtx = exportCanvas.getContext('2d');

    // Remove crop rect before exporting
    fabricCanvas.remove(cropRect);
    cropRect = null;
    fabricCanvas.renderAll();

    // Export current state to canvas
    const currentDataUrl = fabricCanvas.toDataURL({
      format: 'png',
      left: left,
      top: top,
      width: width,
      height: height
    });

    // Reload with cropped image
    const img = new Image();
    img.onload = () => {
      imageWidth = width;
      imageHeight = height;

      fabricCanvas.setDimensions({ width, height });
      fabricCanvas.clear();

      const fabricImg = new fabric.Image(img, {
        left: 0,
        top: 0,
        selectable: false,
        evented: false,
        objectCaching: false
      });

      fabricCanvas.setBackgroundImage(fabricImg, fabricCanvas.renderAll.bind(fabricCanvas));
      backgroundImage = fabricImg;

      fitToWindow();
      cropOverlay.classList.add('hidden');
      selectTool('select');
      saveState();
      showToast('Cropped successfully!', 'success');
    };
    img.src = currentDataUrl;
  }

  function cancelCrop() {
    if (cropRect) {
      fabricCanvas.remove(cropRect);
      cropRect = null;
      fabricCanvas.renderAll();
    }
    cropOverlay.classList.add('hidden');
  }

  // ── Text ────────────────────────────────────────────────────────────
  function addTextAtPoint(pointer) {
    const text = new fabric.IText('Type here', {
      left: pointer.x,
      top: pointer.y,
      fontFamily: 'Inter, sans-serif',
      fontSize: currentFontSize,
      fill: currentColor,
      fontWeight: '600',
      editable: true,
      cursorColor: currentColor,
      padding: 5
    });

    fabricCanvas.add(text);
    fabricCanvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    fabricCanvas.renderAll();
    saveState();

    // Switch to select tool after placing
    selectTool('select');
  }

  // ── Update Selected Object Properties ───────────────────────────────
  function updateSelectedObjectColor() {
    const obj = fabricCanvas?.getActiveObject();
    if (!obj) return;

    if (obj.type === 'i-text' || obj.type === 'text') {
      obj.set('fill', currentColor);
    } else if (obj.type === 'group') {
      obj.getObjects().forEach(o => {
        if (o.type === 'triangle') o.set('fill', currentColor);
        else o.set('stroke', currentColor);
      });
    } else {
      obj.set('stroke', currentColor);
    }
    fabricCanvas.renderAll();
  }

  function updateSelectedObjectStroke() {
    const obj = fabricCanvas?.getActiveObject();
    if (!obj) return;

    if (obj.type !== 'i-text' && obj.type !== 'text') {
      obj.set('strokeWidth', currentStrokeWidth);
      fabricCanvas.renderAll();
    }

    // Update freehand brush if in draw mode
    if (fabricCanvas.isDrawingMode) {
      fabricCanvas.freeDrawingBrush.width = currentStrokeWidth;
    }
  }

  function updateSelectedObjectFontSize() {
    const obj = fabricCanvas?.getActiveObject();
    if (!obj) return;

    if (obj.type === 'i-text' || obj.type === 'text') {
      obj.set('fontSize', currentFontSize);
      fabricCanvas.renderAll();
    }
  }

  function deleteSelected() {
    const active = fabricCanvas?.getActiveObject();
    if (active) {
      if (active.type === 'activeSelection') {
        active.forEachObject(o => fabricCanvas.remove(o));
        fabricCanvas.discardActiveObject();
      } else {
        fabricCanvas.remove(active);
      }
      fabricCanvas.renderAll();
      saveState();
    }
  }

  // ── Undo / Redo ─────────────────────────────────────────────────────
  function saveState() {
    if (isUndoRedoAction) return;
    const json = JSON.stringify(fabricCanvas.toJSON());
    undoStack.push(json);
    redoStack = []; // Clear redo on new action

    // Limit stack size
    if (undoStack.length > 50) undoStack.shift();

    updateUndoRedoButtons();
  }

  function undo() {
    if (undoStack.length <= 1) return; // Keep initial state

    isUndoRedoAction = true;
    redoStack.push(undoStack.pop());
    const state = undoStack[undoStack.length - 1];

    fabricCanvas.loadFromJSON(state, () => {
      fabricCanvas.renderAll();
      isUndoRedoAction = false;
      updateUndoRedoButtons();

      // Re-cache background reference
      const objects = fabricCanvas.getObjects();
      backgroundImage = fabricCanvas.backgroundImage;
    });
  }

  function redo() {
    if (redoStack.length === 0) return;

    isUndoRedoAction = true;
    const state = redoStack.pop();
    undoStack.push(state);

    fabricCanvas.loadFromJSON(state, () => {
      fabricCanvas.renderAll();
      isUndoRedoAction = false;
      updateUndoRedoButtons();

      backgroundImage = fabricCanvas.backgroundImage;
    });
  }

  function setupUndoRedo() {
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
  }

  function updateUndoRedoButtons() {
    document.getElementById('btn-undo').disabled = undoStack.length <= 1;
    document.getElementById('btn-redo').disabled = redoStack.length === 0;
  }

  // ── Export ──────────────────────────────────────────────────────────
  function setupExport() {
    document.getElementById('btn-save-png').addEventListener('click', () => exportImage('png'));
    document.getElementById('btn-save-jpeg').addEventListener('click', () => exportImage('jpeg'));
    document.getElementById('btn-save-pdf').addEventListener('click', () => exportImage('pdf'));
    document.getElementById('btn-copy-clipboard').addEventListener('click', copyToClipboard);
  }

  function getExportCanvas() {
    // Deselect everything first
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();

    // Export at full resolution
    const dataUrl = fabricCanvas.toDataURL({
      format: 'png',
      multiplier: 1,
      left: 0,
      top: 0,
      width: imageWidth,
      height: imageHeight
    });

    return dataUrl;
  }

  async function exportImage(format) {
    try {
      const dataUrl = getExportCanvas();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      let filename, blob;

      if (format === 'png') {
        blob = await (await fetch(dataUrl)).blob();
        filename = `SnapFull_${timestamp}.png`;
      } else if (format === 'jpeg') {
        // Re-export as JPEG
        const jpegDataUrl = fabricCanvas.toDataURL({
          format: 'jpeg',
          quality: 0.92,
          multiplier: 1
        });
        blob = await (await fetch(jpegDataUrl)).blob();
        filename = `SnapFull_${timestamp}.jpg`;
      } else if (format === 'pdf') {
        blob = await generatePdf(dataUrl);
        filename = `SnapFull_${timestamp}.pdf`;
      }

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      showToast(`Saved as ${filename}`, 'success');
    } catch (err) {
      console.error('Export failed:', err);
      showToast('Export failed: ' + err.message, 'error');
    }
  }

  async function generatePdf(dataUrl) {
    // Minimal PDF generation (same approach as export.js)
    const imgData = await fetch(dataUrl).then(r => r.arrayBuffer());
    
    // Convert PNG to JPEG for PDF embedding
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = await createImageBitmapFromUrl(dataUrl);
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    
    const jpegBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
    const jpegData = await jpegBlob.arrayBuffer();
    const jpegBytes = new Uint8Array(jpegData);

    const width = img.width;
    const height = img.height;
    const maxWidth = 595.28;
    const scale = Math.min(maxWidth / width, 1);
    const pdfWidth = width * scale;
    const pdfHeight = height * scale;

    // Build a minimal PDF
    let offsets = [];
    let output = '%PDF-1.4\n';

    offsets.push(output.length);
    output += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';

    offsets.push(output.length);
    output += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';

    offsets.push(output.length);
    output += `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfWidth.toFixed(2)} ${pdfHeight.toFixed(2)}] /Contents 4 0 R /Resources << /XObject << /Img 5 0 R >> >> >>\nendobj\n`;

    const contentStream = `q ${pdfWidth.toFixed(2)} 0 0 ${pdfHeight.toFixed(2)} 0 0 cm /Img Do Q`;
    offsets.push(output.length);
    output += `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;

    offsets.push(output.length);
    const imgHeader = `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`;
    const imgFooter = `\nendstream\nendobj\n`;

    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(output + imgHeader);
    const footerBytes = encoder.encode(imgFooter);

    const xrefOffset = headerBytes.length + jpegBytes.length + footerBytes.length;
    let xref = `xref\n0 6\n`;
    xref += '0000000000 65535 f \n';
    for (const offset of offsets) {
      xref += String(offset).padStart(10, '0') + ' 00000 n \n';
    }
    xref += `trailer\n<< /Size 6 /Root 1 0 R >>\n`;
    xref += `startxref\n${xrefOffset}\n%%EOF\n`;

    const xrefBytes = encoder.encode(xref);

    const totalLength = headerBytes.length + jpegBytes.length + footerBytes.length + xrefBytes.length;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    result.set(headerBytes, offset); offset += headerBytes.length;
    result.set(jpegBytes, offset); offset += jpegBytes.length;
    result.set(footerBytes, offset); offset += footerBytes.length;
    result.set(xrefBytes, offset);

    return new Blob([result], { type: 'application/pdf' });
  }

  function createImageBitmapFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async function copyToClipboard() {
    try {
      const dataUrl = getExportCanvas();
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      showToast('Copied to clipboard!', 'success');
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      showToast('Failed to copy: ' + err.message, 'error');
    }
  }

  // ── Keyboard Shortcuts ──────────────────────────────────────────────
  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't capture when editing text
      if (fabricCanvas?.getActiveObject()?.isEditing) return;

      const key = e.key.toLowerCase();

      // Ctrl/Cmd shortcuts
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          redo();
        } else if (key === 'c') {
          // Don't override copy if there's a text selection
        }
        return;
      }

      // Tool shortcuts
      switch (key) {
        case 'v': selectTool('select'); break;
        case 'c': selectTool('crop'); break;
        case 't': selectTool('text'); break;
        case 'a': selectTool('arrow'); break;
        case 'r': selectTool('rect'); break;
        case 'o': selectTool('circle'); break;
        case 'l': selectTool('line'); break;
        case 'd': selectTool('draw'); break;
        case 'b': selectTool('blur'); break;
        case 'h': selectTool('highlight'); break;
        case 'delete':
        case 'backspace':
          deleteSelected();
          break;
        case 'escape':
          fabricCanvas?.discardActiveObject();
          cancelCrop();
          fabricCanvas?.renderAll();
          break;
      }
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function showToast(message, type = '') {
    toastText.textContent = message;
    toast.className = 'toast';
    if (type) toast.classList.add(`toast-${type}`);
    toast.classList.remove('hidden');

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.style.animation = 'toastOut 300ms ease-out forwards';
      setTimeout(() => {
        toast.classList.add('hidden');
        toast.style.animation = '';
      }, 300);
    }, 2500);
  }

  // ── Boot ────────────────────────────────────────────────────────────
  // Wait for Fabric.js to be available
  function waitForFabric() {
    if (typeof fabric !== 'undefined') {
      init();
    } else {
      setTimeout(waitForFabric, 50);
    }
  }

  document.addEventListener('DOMContentLoaded', waitForFabric);
})();
