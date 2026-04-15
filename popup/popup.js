/**
 * SnapFull — Popup Script
 * 
 * Handles user interactions in the popup UI:
 * - Capture buttons
 * - Settings management
 * - History display
 * - Progress updates
 */

// ── DOM Elements ──────────────────────────────────────────────────────
const btnCaptureFullPage = document.getElementById('btn-capture-full');
const btnCaptureVisible = document.getElementById('btn-capture-visible');
const captureSection = document.getElementById('capture-section');
const progressSection = document.getElementById('progress-section');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const errorSection = document.getElementById('error-section');
const errorText = document.getElementById('error-text');
const btnDismissError = document.getElementById('btn-dismiss-error');
const btnToggleSettings = document.getElementById('btn-toggle-settings');
const settingsPanel = document.getElementById('settings-panel');
const settingsChevron = document.getElementById('settings-chevron');
const settingFormat = document.getElementById('setting-format');
const settingQuality = document.getElementById('setting-quality');
const qualityValue = document.getElementById('quality-value');
const jpegQualityRow = document.getElementById('jpeg-quality-row');
const settingDelay = document.getElementById('setting-delay');
const delayValue = document.getElementById('delay-value');
const settingAutoDownload = document.getElementById('setting-autodownload');
const historyGrid = document.getElementById('history-grid');
const historyEmpty = document.getElementById('history-empty');
const btnClearHistory = document.getElementById('btn-clear-history');

// ── State ─────────────────────────────────────────────────────────────
let isCapturing = false;

// ── Progress Labels ───────────────────────────────────────────────────
const PROGRESS_LABELS = {
  injecting: 'Preparing page...',
  preparing: 'Analyzing page dimensions...',
  capturing: 'Capturing screenshots...',
  restoring: 'Restoring page state...',
  stitching: 'Stitching tiles together...',
  finalizing: 'Finalizing image...',
  done: 'Complete!'
};

// ── Initialize ────────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  await loadHistory();
  attachEventListeners();
}

// ── Settings ──────────────────────────────────────────────────────────
async function loadSettings() {
  chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (response && response.success) {
      const s = response.data;
      settingFormat.value = s.format || 'png';
      settingQuality.value = Math.round((s.jpegQuality || 0.92) * 100);
      qualityValue.textContent = settingQuality.value + '%';
      settingDelay.value = s.captureDelay || 150;
      delayValue.textContent = settingDelay.value + 'ms';
      settingAutoDownload.checked = s.autoDownload || false;
      updateJpegVisibility();
    }
  });
}

function saveSettings() {
  const settings = {
    format: settingFormat.value,
    jpegQuality: parseInt(settingQuality.value) / 100,
    captureDelay: parseInt(settingDelay.value),
    autoDownload: settingAutoDownload.checked
  };
  chrome.runtime.sendMessage({ action: 'saveSettings', settings });
}

function updateJpegVisibility() {
  if (settingFormat.value === 'jpeg') {
    jpegQualityRow.classList.remove('hidden');
  } else {
    jpegQualityRow.classList.add('hidden');
  }
}

// ── History ───────────────────────────────────────────────────────────
async function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
    if (response && response.success) {
      renderHistory(response.data);
    }
  });
}

function renderHistory(history) {
  historyGrid.innerHTML = '';

  if (!history || history.length === 0) {
    historyEmpty.classList.remove('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');

  for (const item of history) {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.title = item.pageTitle || item.pageUrl || 'Screenshot';

    const img = document.createElement('img');
    img.src = item.thumbnail;
    img.alt = item.pageTitle || 'Screenshot';
    img.className = 'history-thumb';

    const overlay = document.createElement('div');
    overlay.className = 'history-overlay';

    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = formatTimestamp(item.timestamp);

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const btnOpen = document.createElement('button');
    btnOpen.className = 'history-action-btn';
    btnOpen.title = 'Open in editor';
    btnOpen.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>`;
    btnOpen.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({
        action: 'openEditorWithImage',
        imageId: item.id
      });
      window.close();
    });

    const btnDelete = document.createElement('button');
    btnDelete.className = 'history-action-btn history-action-delete';
    btnDelete.title = 'Delete';
    btnDelete.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: 'deleteHistoryItem', id: item.id }, () => {
        card.remove();
        const remaining = historyGrid.querySelectorAll('.history-card');
        if (remaining.length === 0) {
          historyEmpty.classList.remove('hidden');
        }
      });
    });

    actions.appendChild(btnOpen);
    actions.appendChild(btnDelete);
    overlay.appendChild(time);
    overlay.appendChild(actions);
    card.appendChild(img);
    card.appendChild(overlay);
    historyGrid.appendChild(card);
  }
}

function formatTimestamp(ts) {
  const date = new Date(ts);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return date.toLocaleDateString();
}

// ── Capture Handlers ──────────────────────────────────────────────────
async function startCapture(action) {
  if (isCapturing) return;

  // Pre-flight check to prevent extension gallery "cannot be scripted" errors
  if (action === 'captureFullPage') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const url = tab.url || '';
        if (
          url.startsWith('chrome://') || 
          url.startsWith('chrome-extension://') ||
          url.startsWith('about:') || 
          url.startsWith('devtools://') ||
          url.startsWith('edge://') ||
          url.startsWith('https://chrome.google.com/webstore') ||
          url.startsWith('https://chromewebstore.google.com')
        ) {
          showError('Chrome policy prevents full-page screenshots on this page.');
          return;
        }
      }
    } catch (e) {
      // Ignore and proceed to normal flow if query fails
    }
  }

  isCapturing = true;

  // Show progress
  captureSection.classList.add('capturing');
  progressSection.classList.remove('hidden');
  errorSection.classList.add('hidden');
  progressBar.style.width = '0%';
  progressText.textContent = 'Starting capture...';

  // Disable buttons
  btnCaptureFullPage.disabled = true;
  btnCaptureVisible.disabled = true;

  chrome.runtime.sendMessage({ action }, (response) => {
    isCapturing = false;
    btnCaptureFullPage.disabled = false;
    btnCaptureVisible.disabled = false;

    if (response && response.success) {
      progressBar.style.width = '100%';
      progressText.textContent = 'Done! Opening editor...';
      setTimeout(() => window.close(), 500);
    } else {
      // Handle the case where the error bubbles up
      showError(response?.error || 'Capture failed. Please try again.');
      progressSection.classList.add('hidden');
      captureSection.classList.remove('capturing');
    }
  });
}

function showError(message) {
  errorText.textContent = message;
  errorSection.classList.remove('hidden');
}

// ── Event Listeners ───────────────────────────────────────────────────
function attachEventListeners() {
  // Capture buttons
  btnCaptureFullPage.addEventListener('click', () => startCapture('captureFullPage'));
  btnCaptureVisible.addEventListener('click', () => startCapture('captureVisible'));

  // Error dismiss
  btnDismissError.addEventListener('click', () => {
    errorSection.classList.add('hidden');
  });

  // Settings toggle
  btnToggleSettings.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    settingsChevron.classList.toggle('rotated');
  });

  // Settings changes
  settingFormat.addEventListener('change', () => {
    updateJpegVisibility();
    saveSettings();
  });

  settingQuality.addEventListener('input', () => {
    qualityValue.textContent = settingQuality.value + '%';
  });
  settingQuality.addEventListener('change', saveSettings);

  settingDelay.addEventListener('input', () => {
    delayValue.textContent = settingDelay.value + 'ms';
  });
  settingDelay.addEventListener('change', saveSettings);

  settingAutoDownload.addEventListener('change', saveSettings);

  // Clear history
  btnClearHistory.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
      historyGrid.innerHTML = '';
      historyEmpty.classList.remove('hidden');
    });
  });

  // Listen for progress updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'captureProgress') {
      progressBar.style.width = message.progress + '%';
      let label = PROGRESS_LABELS[message.step] || message.step;
      if (message.step === 'capturing' && message.total) {
        label += ` (${message.current}/${message.total})`;
      }
      progressText.textContent = label;
    }
  });
}

// ── Boot ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
