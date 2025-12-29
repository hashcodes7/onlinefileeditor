/* ===============================
   Capability detection
   =============================== */
if (!window.showOpenFilePicker) {
  alert("This browser does not support filesystem editing. Use Chrome or Edge.");
}

/* ===============================
   State
   =============================== */
let fileHandle = null;
let isDirty = false;
let saveTimeout = null;

/* ===============================
   DOM Elements
   =============================== */
const editor = document.getElementById("editor");
const openBtn = document.getElementById("openBtn");
const editBtn = document.getElementById("editBtn");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");
const recentList = document.getElementById("recentList");

/* ===============================
   IndexedDB Logic
   =============================== */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("editor-db", 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (db.objectStoreNames.contains("files")) {
        db.deleteObjectStore("files");
      }
      db.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRecent(handle) {
  try {
    const db = await openDB();
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");

    const all = await new Promise((resolve, reject) => {
      const req = store.get("recent");
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    const filtered = [];
    for (const h of all) {
      try {
        if (h.name !== handle.name) {
          filtered.push(h);
        }
      } catch (e) {}
    }

    filtered.unshift(handle);
    const toSave = filtered.slice(0, 10);

    await new Promise((resolve, reject) => {
      const req = store.put(toSave, "recent");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.error("Failed to save recent file:", error);
  }
}

async function loadRecent() {
  try {
    const db = await openDB();
    const tx = db.transaction("files", "readonly");
    const store = tx.objectStore("files");
    return await new Promise((resolve, reject) => {
      const req = store.get("recent");
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.error("Failed to load recent files:", error);
    return [];
  }
}

/* ===============================
   File Handlers
   =============================== */
async function openFilePicker() {
  try {
    const [handle] = await window.showOpenFilePicker();
    fileHandle = handle;
    await saveRecent(fileHandle);
    await loadFile(fileHandle);
    await renderRecent();
  } catch (e) {
    if (e.name !== 'AbortError') {
      setStatus("Failed to open file", "error");
    }
  }
}

async function loadFile(handle) {
  try {
    const permission = await verifyPermission(handle, false);
    if (!permission) {
      setStatus("Permission denied", "error");
      return;
    }

    const file = await handle.getFile();
    editor.value = await file.text();
    
    // Initial Read-Only State
    editor.disabled = true;
    saveBtn.disabled = true;
    editBtn.disabled = false;
    
    isDirty = false;
    fileHandle = handle;
    setStatus(`Opened (Read Only): ${file.name}`);
  } catch (error) {
    console.error("Failed to load file:", error);
    setStatus("File unavailable or permission revoked", "error");
    resetUI();
  }
}

async function verifyPermission(handle, withWrite = true) {
  const opts = withWrite ? { mode: "readwrite" } : { mode: "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

async function saveNow() {
  if (!fileHandle || !isDirty) return;
  try {
    const permission = await verifyPermission(fileHandle, true);
    if (!permission) {
      setStatus("Cannot save: permission denied", "error");
      return;
    }

    const writable = await fileHandle.createWritable();
    await writable.write(editor.value);
    await writable.close();
    isDirty = false;
    setStatus("Saved ✓", "success");
    
    setTimeout(() => {
      if (!isDirty && fileHandle) {
        setStatus(`Opened: ${fileHandle.name}`);
      }
    }, 2000);
  } catch (error) {
    console.error("Save failed:", error);
    setStatus("Save failed!", "error");
    isDirty = true;
  }
}

/* ===============================
   UI Rendering
   =============================== */
async function renderRecent() {
  recentList.innerHTML = "";
  const recent = await loadRecent();

  if (recent.length === 0) {
    recentList.innerHTML = `<div class="empty">No recent files</div>`;
    return;
  }

  for (const handle of recent) {
    try {
      const btn = document.createElement("button");
      btn.textContent = handle.name;
      btn.onclick = async () => {
        const perm = await handle.queryPermission({ mode: "read" });
        if (perm === "granted" || (await handle.requestPermission({ mode: "read" })) === "granted") {
          await loadFile(handle);
        } else {
          setStatus("Permission denied", "error");
        }
      };
      recentList.appendChild(btn);
    } catch (e) {}
  }
}

function setStatus(text, type = "") {
  status.textContent = text;
  status.className = "status " + type;
}

function resetUI() {
  editor.disabled = true;
  saveBtn.disabled = true;
  editBtn.disabled = true;
}

/* ===============================
   Event Listeners
   =============================== */
openBtn.onclick = openFilePicker;
saveBtn.onclick = saveNow;

editBtn.onclick = async () => {
  if (!fileHandle) return;
  setStatus("Requesting edit permission…");
  const granted = await verifyPermission(fileHandle, true);
  if (granted) {
    editor.disabled = false;
    saveBtn.disabled = false;
    editBtn.disabled = true;
    editor.focus();
    setStatus(`Editing: ${fileHandle.name}`, "success");
  } else {
    setStatus("Edit permission denied", "error");
  }
};

editor.addEventListener("input", () => {
  isDirty = true;
  setStatus("Editing…");
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveNow, 800);
});

window.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveNow();
  }
});

// Start
renderRecent();
