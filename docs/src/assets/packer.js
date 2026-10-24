/**
 * Drives the Pack and Unpack tabs using Vitemple's browser-native container
 * utility. Picker and drop inputs share validation; names are rendered as text.
 * Packing rejects duplicate names and downloads a VPK1 Blob. Unpacking validates
 * the complete container before exposing file links or bulk downloads; image
 * thumbnails reuse download URLs and unsupported images leave the filename visible. Replacing
 * a pack aborts previous parsing and revokes its URLs; clearing or leaving the
 * page also releases resources. No files are uploaded. Container serialization
 * and validation belong to src/file-pack/index.ts, not this UI module.
 */
import { createFilePack, readFilePack } from "./file-pack.js";

// ----------------------------------------------------------------- Page state and file presentation
const input = document.querySelector("#files");
const dropZone = document.querySelector("#drop-zone");
const list = document.querySelector("#file-list");
const summary = document.querySelector("#summary");
const clear = document.querySelector("#clear");
const form = document.querySelector("#pack-form");
const filename = document.querySelector("#filename");
const download = document.querySelector("#download");
const status = document.querySelector("#status");
const tabs = [...document.querySelectorAll('[role="tab"]')];
const packInput = document.querySelector("#pack-file");
const unpackDropZone = document.querySelector("#unpack-drop-zone");
const unpackSummary = document.querySelector("#unpack-summary");
const unpackList = document.querySelector("#unpacked-list");
const unpackClear = document.querySelector("#unpack-clear");
const downloadAll = document.querySelector("#download-all");
const unpackStatus = document.querySelector("#unpack-status");
const files = new Map();
const downloads = new Map();
const dragDepths = new Map();
const unpackedFiles = [];
let unpackController = null;
let downloadBatch = 0;

// Formats file and container sizes with units readable for both tiny and large assets.
function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }

  return `${unit ? size.toFixed(1) : size} ${units[unit]}`;
}

// Announces selection or download results without treating filenames as HTML.
function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

// Announces parsing and extraction results in the Unpack panel without interpreting HTML.
function setUnpackStatus(message, error = false) {
  unpackStatus.textContent = message;
  unpackStatus.classList.toggle("is-error", error);
}

// Rebuilds the compact selection list and enables actions only when files are present.
function renderSelection() {
  const fragment = document.createDocumentFragment();
  let total = 0;
  for (const file of files.values()) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    const size = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.name;
    size.className = "file-size";
    size.textContent = formatSize(file.size);
    row.append(name, size);
    fragment.append(row);
    total += file.size;
  }

  list.replaceChildren(fragment);
  summary.textContent = files.size
    ? `${files.size} ${files.size === 1 ? "file" : "files"} · ${formatSize(total)}`
    : "No files selected";
  clear.disabled = files.size === 0;
  download.disabled = files.size === 0;
}

// Adds a complete batch atomically; conflicting logical names leave the selection unchanged.
function addFiles(incoming) {
  const additions = new Map();
  for (const file of incoming) {
    if (files.has(file.name) || additions.has(file.name)) {
      setStatus(`Duplicate filename: ${file.name}. Rename it before adding.`, true);
      return;
    }

    additions.set(file.name, file);
  }

  if (!additions.size) {
    setStatus("Drop files, not folders. You can also use the file picker.", true);
    return;
  }

  for (const [name, file] of additions) files.set(name, file);
  renderSelection();
  setStatus("Ready to pack. Add more files or download your pack.");
}

// ----------------------------------------------------------------- Accessible tab navigation
// Selects one panel while retaining each tab's independent file selection and results.
function activateTab(selected) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
  }

  for (const zone of [dropZone, unpackDropZone]) {
    zone.classList.remove("is-dragging");
    dragDepths.set(zone, 0);
  }
}

// Switches panels when a tab is clicked.
function handleTabClick(event) {
  activateTab(event.currentTarget);
}

// Supports standard horizontal tab navigation with arrows, Home, and End.
function handleTabKeydown(event) {
  const index = tabs.indexOf(event.currentTarget);
  let next;

  if (event.key === "ArrowRight") {
    next = tabs[(index + 1) % tabs.length];
  } else if (event.key === "ArrowLeft") {
    next = tabs[(index + tabs.length - 1) % tabs.length];
  } else if (event.key === "Home") {
    next = tabs[0];
  } else if (event.key === "End") {
    next = tabs[tabs.length - 1];
  } else {
    return;
  }

  event.preventDefault();
  activateTab(next);
  next.focus();
}

// ----------------------------------------------------------------- Selection and shared drag-and-drop handlers
// Copies picker files into the selection and permits selecting the same file again after clearing.
function handleSelection() {
  addFiles(input.files);
  input.value = "";
}

// Clears all selected files and resets the page's ready state.
function clearSelection() {
  files.clear();
  input.value = "";
  renderSelection();
  setStatus("Choose files to get started.");
}

// Prevents dropped files from navigating away from the utility page.
function preventFileNavigation(event) {
  event.preventDefault();
}

// Tracks nested drag targets so the drop highlight does not flicker over child elements.
function handleDragEnter(event) {
  event.preventDefault();
  const zone = event.currentTarget;
  dragDepths.set(zone, (dragDepths.get(zone) ?? 0) + 1);
  zone.classList.add("is-dragging");
}

// Clears the highlight once the pointer has left the entire drop zone.
function handleDragLeave(event) {
  event.preventDefault();
  const zone = event.currentTarget;
  const depth = Math.max(0, (dragDepths.get(zone) ?? 0) - 1);
  dragDepths.set(zone, depth);

  if (depth === 0) {
    zone.classList.remove("is-dragging");
  }

}

// Marks the drop as a copy while keeping the browser from opening the dragged file.
function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

// Rejects folders and routes dropped files to the panel that received the drop.
function handleDrop(event) {
  event.preventDefault();
  const zone = event.currentTarget;
  const report = zone === dropZone ? setStatus : setUnpackStatus;
  dragDepths.set(zone, 0);
  zone.classList.remove("is-dragging");
  for (const item of event.dataTransfer.items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      report("Folders are not supported. Drop individual files instead.", true);
      return;
    }

  }

  if (zone === dropZone) {
    addFiles(event.dataTransfer.files);
  } else {
    void openPack(event.dataTransfer.files);
  }

}

// ----------------------------------------------------------------- Pack extraction and persistent download links
// Cancels pending parsing and releases all extracted files before clearing the Unpack panel.
function clearUnpacked() {
  downloadBatch++;
  unpackController?.abort();
  unpackController = null;
  for (const entry of unpackedFiles) URL.revokeObjectURL(entry.url);
  unpackedFiles.length = 0;
  unpackList.replaceChildren();
  unpackSummary.textContent = "No pack selected";
  packInput.value = "";
  unpackClear.disabled = true;
  downloadAll.disabled = true;
  setUnpackStatus("Choose a .vpack file to see its contents.");
}

// Converts logical paths into flat download names without changing the displayed pack names.
function downloadName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

// Removes failed or unsupported image previews while preserving the file's download link.
function hideImagePreview(event) {
  event.currentTarget.remove();
}

// Parses one pack atomically and publishes links only after complete structural validation.
async function openPack(incoming) {
  if (incoming.length !== 1 || !/\.vpack$/i.test(incoming[0].name)) {
    setUnpackStatus("Choose exactly one .vpack file.", true);
    return;
  }

  const file = incoming[0];
  clearUnpacked();
  const controller = new AbortController();
  unpackController = controller;
  unpackClear.disabled = false;
  unpackSummary.textContent = file.name;
  setUnpackStatus("Reading pack…");
  try {
    const entries = [];
    for await (const entry of readFilePack(file, { signal: controller.signal })) {
      entries.push(entry);
    }

    if (unpackController !== controller) {
      return;
    }

    const fragment = document.createDocumentFragment();
    let total = 0;
    for (const entry of entries) {
      const url = URL.createObjectURL(entry.blob);
      const link = document.createElement("a");
      unpackedFiles.push({ url, link });
      const row = document.createElement("li");
      const name = document.createElement("span");
      const size = document.createElement("span");
      link.className = "file-name file-download";
      name.className = "file-label";
      name.textContent = entry.name;
      link.href = url;
      link.download = downloadName(entry.name);

      if (entry.blob.type.startsWith("image/")) {
        const preview = document.createElement("img");
        preview.className = "file-thumbnail";
        preview.alt = "";
        preview.width = 32;
        preview.height = 32;
        preview.loading = "lazy";
        preview.decoding = "async";
        preview.addEventListener("error", hideImagePreview);
        preview.src = url;
        link.append(preview);
      }

      link.append(name);
      size.className = "file-size";
      size.textContent = formatSize(entry.blob.size);
      row.append(link, size);
      fragment.append(row);
      total += entry.blob.size;
    }

    unpackList.replaceChildren(fragment);
    unpackSummary.textContent =
      `${entries.length} ${entries.length === 1 ? "file" : "files"} · ${formatSize(total)}`;
    downloadAll.disabled = entries.length === 0;
    setUnpackStatus(
      entries.length
        ? `${file.name} is ready. Click a filename to download it.`
        : `${file.name} is valid and contains no files.`,
    );
  } catch (error) {
    if (unpackController !== controller) {
      return;
    }

    clearUnpacked();
    setUnpackStatus(error instanceof Error ? error.message : "Unable to read the pack.", true);
  } finally {
    if (unpackController === controller) {
      unpackController = null;
    }

  }
}

// Starts extraction from a file picker and permits choosing the same pack again.
function handlePackSelection() {
  if (packInput.files.length) {
    void openPack(packInput.files);
  }

  packInput.value = "";
}

// Lets the browser handle one download request before issuing the next navigation.
function scheduleNextDownload(resolve) {
  window.setTimeout(resolve, 250);
}

// Requests downloads sequentially and stops the queue when the pack is cleared or replaced.
async function downloadAllFiles() {
  if (!unpackedFiles.length) {
    return;
  }

  const batch = ++downloadBatch;
  const entries = unpackedFiles.slice();
  downloadAll.disabled = true;
  try {
    let requested = 0;
    for (const entry of entries) {
      if (batch !== downloadBatch) {
        return;
      }

      entry.link.click();
      requested++;
      setUnpackStatus(`Requesting download ${requested} of ${entries.length}…`);
      await new Promise(scheduleNextDownload);
    }

    if (batch !== downloadBatch) {
      return;
    }

    setUnpackStatus(
      `Requested ${entries.length} downloads. If your browser blocks them, use the individual file links.`,
    );
  } catch (error) {
    setUnpackStatus(error instanceof Error ? error.message : "Unable to download the files.", true);
  } finally {
    if (batch === downloadBatch) {
      downloadAll.disabled = unpackedFiles.length === 0;
    }

  }
}

// ----------------------------------------------------------------- Pack download lifecycle
// Releases a generated download URL and its scheduled cleanup callback.
function releaseDownload(url) {
  window.clearTimeout(downloads.get(url));
  downloads.delete(url);
  URL.revokeObjectURL(url);
}

// Creates a downloadable pack and reports format-budget errors without losing the selected files.
function downloadPack(event) {
  event.preventDefault();

  if (!files.size) {
    return;
  }

  try {
    const entries = [];
    for (const file of files.values()) entries.push({ name: file.name, blob: file });
    const blob = createFilePack(entries);
    const name = filename.value.trim().replace(/\.vpack$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "files";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.vpack`;
    document.body.append(link);
    link.click();
    link.remove();
    downloads.set(url, window.setTimeout(releaseDownload, 60000, url));
    setStatus(`Download started: ${name}.vpack · ${formatSize(blob.size)}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to create the pack.", true);
  }
}

// Releases temporary downloads and extracted-file resources when leaving the page.
function releaseDownloads() {
  for (const url of downloads.keys()) releaseDownload(url);
  clearUnpacked();
}

// ----------------------------------------------------------------- Page initialization and event registration
input.addEventListener("change", handleSelection);
clear.addEventListener("click", clearSelection);
form.addEventListener("submit", downloadPack);
packInput.addEventListener("change", handlePackSelection);
unpackClear.addEventListener("click", clearUnpacked);
downloadAll.addEventListener("click", downloadAllFiles);
document.addEventListener("dragover", preventFileNavigation);
document.addEventListener("drop", preventFileNavigation);
for (const tab of tabs) {
  tab.addEventListener("click", handleTabClick);
  tab.addEventListener("keydown", handleTabKeydown);
}
for (const zone of [dropZone, unpackDropZone]) {
  zone.addEventListener("dragenter", handleDragEnter);
  zone.addEventListener("dragleave", handleDragLeave);
  zone.addEventListener("dragover", handleDragOver);
  zone.addEventListener("drop", handleDrop);
}
window.addEventListener("pagehide", releaseDownloads);
