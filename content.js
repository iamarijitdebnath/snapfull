/**
 * SnapFull Content Script
 * 
 * Injected into the active tab to control page scrolling, hide sticky
 * elements, and report page dimensions for full-page screenshot capture.
 * 
 * This script communicates with the background service worker via
 * chrome.runtime messaging.
 */

(() => {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────
  let originalScrollX = 0;
  let originalScrollY = 0;
  let hiddenElements = [];
  let originalOverflows = {};

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Detect all elements with position: fixed or sticky
   * These cause visual artefacts when scrolling + capturing
   */
  function getFixedAndStickyElements() {
    const allElements = document.querySelectorAll('*');
    const results = [];

    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      const position = style.getPropertyValue('position');
      if (position === 'fixed' || position === 'sticky') {
        results.push({
          element: el,
          originalPosition: position,
          originalDisplay: style.getPropertyValue('display'),
          originalVisibility: style.getPropertyValue('visibility'),
          originalZIndex: el.style.zIndex,
          originalStylePosition: el.style.position,
          originalStyleVisibility: el.style.visibility
        });
      }
    }
    return results;
  }

  /**
   * Hide sticky/fixed elements to prevent duplicates in stitched image
   */
  function hideFixedElements() {
    hiddenElements = getFixedAndStickyElements();
    for (const item of hiddenElements) {
      item.element.style.visibility = 'hidden';
    }
  }

  /**
   * Restore hidden elements to their original state
   */
  function restoreFixedElements() {
    for (const item of hiddenElements) {
      item.element.style.visibility = item.originalStyleVisibility || '';
    }
    hiddenElements = [];
  }

  /**
   * Disable any overflow: hidden on html/body that would prevent scrolling
   * measurement, and record originals for restoration
   */
  function unlockOverflow() {
    const html = document.documentElement;
    const body = document.body;

    originalOverflows = {
      htmlOverflow: html.style.overflow,
      htmlOverflowX: html.style.overflowX,
      htmlOverflowY: html.style.overflowY,
      bodyOverflow: body.style.overflow,
      bodyOverflowX: body.style.overflowX,
      bodyOverflowY: body.style.overflowY
    };

    // Allow free scrolling during capture
    html.style.overflow = 'visible';
    body.style.overflow = 'visible';
  }

  /**
   * Restore original overflow settings
   */
  function restoreOverflow() {
    const html = document.documentElement;
    const body = document.body;

    html.style.overflow = originalOverflows.htmlOverflow || '';
    html.style.overflowX = originalOverflows.htmlOverflowX || '';
    html.style.overflowY = originalOverflows.htmlOverflowY || '';
    body.style.overflow = originalOverflows.bodyOverflow || '';
    body.style.overflowX = originalOverflows.bodyOverflowX || '';
    body.style.overflowY = originalOverflows.bodyOverflowY || '';
  }

  /**
   * Wait for a specified number of milliseconds
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for next animation frame + a small buffer
   */
  function waitForPaint() {
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  }

  /**
   * Get the full page dimensions and viewport size
   */
  function getPageDimensions() {
    const html = document.documentElement;
    const body = document.body;

    // Full scrollable dimensions
    const scrollWidth = Math.max(
      html.scrollWidth, html.offsetWidth, html.clientWidth,
      body ? body.scrollWidth : 0,
      body ? body.offsetWidth : 0
    );
    const scrollHeight = Math.max(
      html.scrollHeight, html.offsetHeight, html.clientHeight,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0
    );

    // Viewport (visible area)
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Device pixel ratio for high-res captures
    const devicePixelRatio = window.devicePixelRatio || 1;

    return {
      scrollWidth,
      scrollHeight,
      viewportWidth,
      viewportHeight,
      devicePixelRatio
    };
  }

  // ── Message Handler ──────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'prepare': {
        // Save current scroll position
        originalScrollX = window.scrollX;
        originalScrollY = window.scrollY;

        // Unlock overflow
        unlockOverflow();

        // Hide fixed/sticky elements
        hideFixedElements();

        // Return page dimensions
        const dims = getPageDimensions();
        sendResponse({
          success: true,
          data: dims
        });
        break;
      }

      case 'scrollTo': {
        // Scroll to the requested position
        window.scrollTo({
          left: message.x,
          top: message.y,
          behavior: 'instant'
        });

        // Wait for rendering to complete, then respond
        const captureDelay = message.delay || 150;
        waitForPaint()
          .then(() => delay(captureDelay))
          .then(() => {
            // Report actual scroll position (may differ at page boundaries)
            sendResponse({
              success: true,
              data: {
                actualX: window.scrollX,
                actualY: window.scrollY,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight
              }
            });
          });

        // Return true to indicate async response
        return true;
      }

      case 'restore': {
        // Restore everything
        restoreFixedElements();
        restoreOverflow();

        // Restore original scroll position
        window.scrollTo({
          left: originalScrollX,
          top: originalScrollY,
          behavior: 'instant'
        });

        sendResponse({ success: true });
        break;
      }

      case 'getPageDimensions': {
        sendResponse({
          success: true,
          data: getPageDimensions()
        });
        break;
      }

      default:
        sendResponse({ success: false, error: `Unknown action: ${message.action}` });
    }

    // Synchronous response for non-async handlers
    return false;
  });
})();
