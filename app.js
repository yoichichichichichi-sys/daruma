(() => {
  "use strict";

  const STORAGE_KEY = "copyHistory.v1";
  const MAX_ENTRIES = 200;

  const newEntryInput = document.getElementById("new-entry");
  const addBtn = document.getElementById("add-btn");
  const readClipboardBtn = document.getElementById("read-clipboard-btn");
  const watchToggle = document.getElementById("watch-toggle");
  const searchBox = document.getElementById("search-box");
  const clearAllBtn = document.getElementById("clear-all-btn");
  const pinnedSection = document.getElementById("pinned-section");
  const pinnedList = document.getElementById("pinned-list");
  const historyList = document.getElementById("history-list");
  const emptyMessage = document.getElementById("empty-message");
  const itemTemplate = document.getElementById("item-template");
  const toast = document.getElementById("toast");

  /** @type {{id: string, text: string, createdAt: number, pinned: boolean}[]} */
  let entries = loadEntries();
  let searchQuery = "";
  let watchTimer = null;
  let lastSeenClipboard = "";

  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveEntries() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // storage full or unavailable; ignore
    }
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.remove("toast");
    void toast.offsetWidth;
    toast.classList.add("toast");
    setTimeout(() => {
      toast.hidden = true;
    }, 1800);
  }

  function addEntry(rawText) {
    const text = rawText.trim();
    if (!text) return;

    const existingIndex = entries.findIndex((e) => e.text === text);
    let pinned = false;
    if (existingIndex !== -1) {
      pinned = entries[existingIndex].pinned;
      entries.splice(existingIndex, 1);
    }

    entries.unshift({ id: makeId(), text, createdAt: Date.now(), pinned });

    const unpinnedCount = entries.filter((e) => !e.pinned).length;
    if (unpinnedCount > MAX_ENTRIES) {
      for (let i = entries.length - 1; i >= 0 && entries.filter((e) => !e.pinned).length > MAX_ENTRIES; i--) {
        if (!entries[i].pinned) entries.splice(i, 1);
      }
    }

    saveEntries();
    render();
  }

  function deleteEntry(id) {
    entries = entries.filter((e) => e.id !== id);
    saveEntries();
    render();
  }

  function togglePin(id) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    entry.pinned = !entry.pinned;
    saveEntries();
    render();
  }

  async function copyEntry(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("コピーしました");
    } catch {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand("copy");
      showToast("コピーしました");
    } catch {
      showToast("コピーに失敗しました");
    } finally {
      document.body.removeChild(el);
    }
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const pad = (n) => String(n).padStart(2, "0");
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (sameDay) return time;
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`;
  }

  function buildItem(entry) {
    const node = itemTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = entry.id;
    node.classList.toggle("pinned", entry.pinned);
    node.querySelector(".item-text").textContent = entry.text;
    node.querySelector(".item-time").textContent = formatTime(entry.createdAt);

    const pinBtn = node.querySelector(".pin-btn");
    pinBtn.classList.toggle("active", entry.pinned);
    pinBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      togglePin(entry.id);
    });

    node.querySelector(".copy-btn").addEventListener("click", (ev) => {
      ev.stopPropagation();
      copyEntry(entry.text);
    });

    node.querySelector(".delete-btn").addEventListener("click", (ev) => {
      ev.stopPropagation();
      deleteEntry(entry.id);
    });

    node.addEventListener("click", () => copyEntry(entry.text));

    return node;
  }

  function render() {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? entries.filter((e) => e.text.toLowerCase().includes(query))
      : entries;

    const pinned = filtered.filter((e) => e.pinned);
    const unpinned = filtered.filter((e) => !e.pinned);

    pinnedSection.hidden = pinned.length === 0;
    pinnedList.replaceChildren(...pinned.map(buildItem));
    historyList.replaceChildren(...unpinned.map(buildItem));

    emptyMessage.hidden = filtered.length !== 0;
  }

  addBtn.addEventListener("click", () => {
    addEntry(newEntryInput.value);
    newEntryInput.value = "";
    newEntryInput.focus();
  });

  newEntryInput.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      addEntry(newEntryInput.value);
      newEntryInput.value = "";
    }
  });

  readClipboardBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        addEntry(text);
        showToast("クリップボードから読み込みました");
      } else {
        showToast("クリップボードは空です");
      }
    } catch {
      showToast("クリップボードを読み込めませんでした（権限を確認してください）");
    }
  });

  watchToggle.addEventListener("change", () => {
    if (watchToggle.checked) {
      startWatching();
    } else {
      stopWatching();
    }
  });

  function startWatching() {
    if (watchTimer) return;
    watchTimer = setInterval(async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim() && text !== lastSeenClipboard) {
          lastSeenClipboard = text;
          addEntry(text);
        }
      } catch {
        // permission not granted or clipboard unavailable; stay silent while polling
      }
    }, 1500);
  }

  function stopWatching() {
    if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
  }

  searchBox.addEventListener("input", () => {
    searchQuery = searchBox.value;
    render();
  });

  clearAllBtn.addEventListener("click", () => {
    if (entries.length === 0) return;
    if (confirm("すべての履歴を削除しますか？（ピン留めも含みます）")) {
      entries = [];
      saveEntries();
      render();
    }
  });

  render();
})();
