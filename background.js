/**
 * SnapFull — Background Service Worker
 * 
 * Central orchestrator for the full-page screenshot extension.
 * Handles:
 * - Capture coordination (inject content script → scroll → capture → stitch)
 * - Communication between popup, content script, and editor
 * - Keyboard shortcut commands
 * - Screenshot history management
 */

import { stitchTiles, blobToDataUrl } from './utils/stitcher.js';

// ── State ────────────────────────────────────────────────────────────
let captureInProgress = false;

// ── Default Settings ─────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  format: 'png',
  jpegQuality: 0.92,
  captureDelay: 150,
  autoDownload: false,
  maxHistory: 10
};

/**
 * Get user settings, merged with defaults
 */
async function getSettings() {
  try {
    const stored = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Send a message to the content script in a specific tab
 */
function sendToContentScript(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || 'Unknown content script error'));
      }
    });
  });
}

/**
 * Inject the content script into a tab
 */
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (err) {
    throw new Error(`Cannot capture this page: ${err.message}`);
  }
}

/**
 * Capture the visible area of a tab as a data URL
 * Enforces rate limiting (max 2 calls per second) to prevent quota errors
 */
let lastCaptureTime = 0;

function captureVisibleTab(windowId) {
  return new Promise(async (resolve, reject) => {
    const timeSinceLast = Date.now() - lastCaptureTime;
    if (timeSinceLast < 550) {
      await sleep(550 - timeSinceLast);
    }
    lastCaptureTime = Date.now();

    chrome.tabs.captureVisibleTab(
      windowId,
      { format: 'png', quality: 100 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(dataUrl);
        }
      }
    );
  });
}

/**
 * Capture just the visible viewport
 */
async function captureVisible(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await captureVisibleTab(tab.windowId);
    return dataUrl;
  } catch (err) {
    throw new Error(`Capture failed: ${err.message}`);
  }
}

/**
 * Main full-page capture pipeline
 * 
 * 1. Inject content script
 * 2. Prepare page (get dimensions, hide sticky elements)
 * 3. Scroll + capture tiles
 * 4. Restore page state
 * 5. Stitch tiles
 * 6. Open editor
 */
async function captureFullPage(tabId, progressCallback = null) {
  if (captureInProgress) {
    throw new Error('A capture is already in progress');
  }

  captureInProgress = true;
  const settings = await getSettings();

  try {
    // Get tab info
    const tab = await chrome.tabs.get(tabId);

    // Check for restricted pages
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('about:') || tab.url.startsWith('edge://')) {
      throw new Error('Cannot capture browser internal pages');
    }

    // Step 1: Inject content script
    if (progressCallback) progressCallback({ step: 'injecting', progress: 0 });
    await injectContentScript(tabId);

    // Small delay to ensure content script is ready
    await sleep(100);

    // Step 2: Prepare — get page dimensions and hide sticky elements
    if (progressCallback) progressCallback({ step: 'preparing', progress: 5 });
    const pageInfo = await sendToContentScript(tabId, { action: 'prepare' });

    const {
      scrollWidth,
      scrollHeight,
      viewportWidth,
      viewportHeight,
      devicePixelRatio
    } = pageInfo;

    // Step 3: Calculate tile grid
    const cols = Math.max(1, Math.ceil(scrollWidth / viewportWidth));
    const rows = Math.max(1, Math.ceil(scrollHeight / viewportHeight));
    const totalTiles = rows * cols;

    if (progressCallback) progressCallback({
      step: 'capturing',
      progress: 10,
      total: totalTiles,
      current: 0
    });

    // Step 4: Capture tiles
    const tiles = [];
    let tileIndex = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const scrollX = col * viewportWidth;
        const scrollY = row * viewportHeight;

        // Tell content script to scroll
        const scrollResult = await sendToContentScript(tabId, {
          action: 'scrollTo',
          x: scrollX,
          y: scrollY,
          delay: settings.captureDelay
        });

        // Capture the visible area
        const dataUrl = await captureVisibleTab(tab.windowId);

        tiles.push({
          dataUrl,
          x: scrollResult.actualX,
          y: scrollResult.actualY,
          width: scrollResult.viewportWidth,
          height: scrollResult.viewportHeight
        });

        tileIndex++;
        if (progressCallback) {
          progressCallback({
            step: 'capturing',
            progress: 10 + Math.round((tileIndex / totalTiles) * 70),
            total: totalTiles,
            current: tileIndex
          });
        }
      }
    }

    // Step 5: Restore page state
    if (progressCallback) progressCallback({ step: 'restoring', progress: 82 });
    await sendToContentScript(tabId, { action: 'restore' });

    // Step 6: Stitch tiles
    if (progressCallback) progressCallback({ step: 'stitching', progress: 85 });
    const stitchedBlob = await stitchTiles(tiles, pageInfo);

    // Convert to data URL for passing to editor
    if (progressCallback) progressCallback({ step: 'finalizing', progress: 95 });
    const stitchedDataUrl = await blobToDataUrl(stitchedBlob);

    // Step 7: Save to history
    await saveToHistory(stitchedDataUrl, tab.url, tab.title);

    if (progressCallback) progressCallback({ step: 'done', progress: 100 });

    return stitchedDataUrl;
  } finally {
    captureInProgress = false;
  }
}

/**
 * Save a screenshot to the history
 */
async function saveToHistory(dataUrl, pageUrl, pageTitle) {
  try {
    const settings = await getSettings();
    const stored = await chrome.storage.local.get('history');
    const history = stored.history || [];

    // Create a small thumbnail (max 200px wide)
    const thumbnailDataUrl = await createThumbnail(dataUrl, 200);

    history.unshift({
      id: Date.now().toString(36),
      thumbnail: thumbnailDataUrl,
      fullImage: dataUrl,
      pageUrl,
      pageTitle,
      timestamp: Date.now()
    });

    // Keep only the last N entries
    while (history.length > settings.maxHistory) {
      history.pop();
    }

    await chrome.storage.local.set({ history });
  } catch (err) {
    console.error('Failed to save to history:', err);
    // Non-fatal — don't break the capture flow
  }
}

/**
 * Create a thumbnail from a data URL
 */
async function createThumbnail(dataUrl, maxWidth) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const scale = Math.min(maxWidth / bitmap.width, 1);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
  return blobToDataUrl(thumbBlob);
}

/**
 * Open the editor with the captured image
 */
async function openEditor(imageDataUrl) {
  // Store image data for the editor to retrieve
  await chrome.storage.local.set({ editorImage: imageDataUrl });

  // Open editor in a new tab
  const editorUrl = chrome.runtime.getURL('editor/editor.html');
  await chrome.tabs.create({ url: editorUrl });
}

/**
 * Simple sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Message Listeners ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'captureFullPage': {
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('No active tab found');

          const dataUrl = await captureFullPage(tab.id, (progress) => {
            // Send progress to popup
            chrome.runtime.sendMessage({
              action: 'captureProgress',
              ...progress
            }).catch(() => { /* popup may be closed */ });
          });

          // Open editor with the captured image
          await openEditor(dataUrl);

          sendResponse({ success: true });
        } catch (err) {
          console.error('Full page capture failed:', err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true; // async response
    }

    case 'captureVisible': {
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('No active tab found');

          const dataUrl = await captureVisible(tab.id);
          await saveToHistory(dataUrl, tab.url, tab.title);
          await openEditor(dataUrl);

          sendResponse({ success: true });
        } catch (err) {
          console.error('Visible capture failed:', err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'getHistory': {
      (async () => {
        try {
          const stored = await chrome.storage.local.get('history');
          sendResponse({ success: true, data: stored.history || [] });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'clearHistory': {
      (async () => {
        try {
          await chrome.storage.local.remove('history');
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'deleteHistoryItem': {
      (async () => {
        try {
          const stored = await chrome.storage.local.get('history');
          const history = (stored.history || []).filter(h => h.id !== message.id);
          await chrome.storage.local.set({ history });
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'openEditorWithImage': {
      (async () => {
        try {
          await openEditor(message.dataUrl);
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'getSettings': {
      (async () => {
        try {
          const settings = await getSettings();
          sendResponse({ success: true, data: settings });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'saveSettings': {
      (async () => {
        try {
          const current = await getSettings();
          const updated = { ...current, ...message.settings };
          await chrome.storage.local.set({ settings: updated });
          sendResponse({ success: true, data: updated });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    default:
      sendResponse({ success: false, error: `Unknown action: ${message.action}` });
      return false;
  }
});

// ── Keyboard Shortcut Commands ────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  switch (command) {
    case 'capture-full-page': {
      try {
        const dataUrl = await captureFullPage(tab.id);
        await openEditor(dataUrl);
      } catch (err) {
        console.error('Keyboard shortcut capture failed:', err);
      }
      break;
    }
    case 'capture-visible': {
      try {
        const dataUrl = await captureVisible(tab.id);
        await saveToHistory(dataUrl, tab.url, tab.title);
        await openEditor(dataUrl);
      } catch (err) {
        console.error('Keyboard shortcut visible capture failed:', err);
      }
      break;
    }
  }
});

// ── Installation ──────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default settings
    chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    console.log('SnapFull installed successfully');
  }
});
