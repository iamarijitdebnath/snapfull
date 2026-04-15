# SnapFull — Full Page Screenshot Extension

SnapFull is a production-ready Google Chrome extension (Manifest V3) that allows users to capture full-page screenshots of entire scrollable pages with a single click.

## Features

- **One-Click Capture**: Capture the entire webpage or just the visible viewport.
- **Scroll & Stitch**: Automatically scrolls the page, ignores sticky headers, manages lazy-loaded images, and stitches screenshots perfectly.
- **Editor**: Built-in interactive editor powered by Fabric.js.
  - ✂️ **Crop**: Easily crop the image to the desired area.
  - 🖊️ **Annotate**: Add text, arrows, shapes (rectangles, circles, lines), and freehand drawings.
  - 🔲 **Blur**: Protect sensitive information by blurring out specific areas.
  - 🟡 **Highlight**: Emphasize parts of the image with a highlight tool.
- **Export Options**: Export your work as PNG, JPEG (with quality control), or PDF. You can also copy it directly to your clipboard or enable auto-download.
- **History**: Keeps track of your recent captures locally.
- **Keyboard Shortcuts**: Quickly capture without clicking the toolbar icon.

## Installation

1. Clone or download this repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click on **Load unpacked** in the top left corner.
5. Select the `extension` folder generated manually or from this repository.
6. The SnapFull extension is now installed and accessible from your extensions toolbar!

## Architecture

- **Manifest V3**: Uses modern Chrome extension APIs.
- **Service Worker (`background.js`)**: Orchestrates the capture process and acts as a central hub.
- **Content Script (`content.js`)**: Injected into the active tab to handle scrolling, hide sticky/fixed elements, and report page dimensions.
- **Popup UI**: Built with HTML, CSS, and Vanilla JavaScript, adhering to a modern dark-mode-first design system.
- **Editor UI**: Powered by **Fabric.js** for high-performance canvas object management.

## Keyboard Shortcuts

- `Ctrl+Shift+S` / `Cmd+Shift+S`: Capture full page
- `Ctrl+Shift+V` / `Cmd+Shift+V`: Capture visible area safely

## Limitations

- Due to Chrome security policies, extensions cannot capture restricted pages like `chrome://`, `edge://`, `about:`, or the Chrome Web Store.
- Extremely long pages (> 256 megapixels) may hit browser memory limits.
