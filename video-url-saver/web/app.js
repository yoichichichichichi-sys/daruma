(() => {
  "use strict";

  const STORAGE_KEY = "videoUrlNotebook.v1";
  const MAX_ENTRIES = 300;
  const URL_REGEX = /https?:\/\/[^\s<>"']+/i;

  const newUrlInput = document.getElementById("new-url");
  const addBtn = document.getElementById("add-btn");
  const readClipboardBtn = document.getElementById("read-clipboard-btn");
  const watchToggle = document.getElementById("watch-toggle");
  const searchBox = document.getElementById("search-box");
  const clearAllBtn = document.getElementById("clear-all-btn");
  const itemGrid = document.getElementById("item-grid");
  const emptyMessage = document.getElementById("empty-message");
  const cardTemplate = document.getElementById("card-template");
  const toast = document.getElementById("toast");
  const viewGridBtn = document.getElementById("view-grid-btn");
  const viewListBtn = document.getElementById("view-list-btn");

  const modal = document.getElementById("detail-modal");
  const detailThumb = document.getElementById("detail-thumb");
  const detailTitle = document.getElementById("detail-title");
  const detailSite = document.getElementById("detail-site");
  const detailUrl = document.getElementById("detail-url");
  const detailOpen = document.getElementById("detail-open");
  const detailCopy = document.getElementById("detail-copy");
  const detailDelete = document.getElementById("detail-delete");
  const detailClose = document.getElementById("detail-close");

  /**
   * @typedef {{id: string, url: string, title: string, siteName: string,
   *   thumbnailUrl: string, kind: "youtube"|"vimeo"|"site", addedAt: number}} Entry
   * @type {Entry[]}
   */
  let entries = loadEntries();
  let searchQuery = "";
  let watchTimer = null;
  let lastSeenClipboard = "";
  let activeDetailId = null;

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

  // --- URL parsing / thumbnail resolution -----------------------------

  function extractFirstUrl(text) {
    const match = text.match(URL_REGEX);
    return match ? match[0] : null;
  }

  function extractYouTubeId(u) {
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
    if (host === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (host === "youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const shortsMatch = u.pathname.match(/^\/shorts\/([^/]+)/);
      if (shortsMatch) return shortsMatch[1];
      const embedMatch = u.pathname.match(/^\/embed\/([^/]+)/);
      if (embedMatch) return embedMatch[1];
      const liveMatch = u.pathname.match(/^\/live\/([^/]+)/);
      if (liveMatch) return liveMatch[1];
    }
    return null;
  }

  function extractVimeoId(u) {
    const host = u.hostname.replace(/^www\.|^player\./, "");
    if (host !== "vimeo.com") return null;
    const match = u.pathname.match(/^\/(\d+)/);
    return match ? match[1] : null;
  }

  function buildMetadata(rawUrl) {
    let u;
    try {
      u = new URL(rawUrl);
    } catch {
      return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;

    const siteName = u.hostname.replace(/^www\./, "");

    const ytId = extractYouTubeId(u);
    if (ytId) {
      return {
        url: u.href,
        kind: "youtube",
        siteName: "YouTube",
        title: "YouTube動画",
        thumbnailUrl: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      };
    }

    const vimeoId = extractVimeoId(u);
    if (vimeoId) {
      return {
        url: u.href,
        kind: "vimeo",
        siteName: "Vimeo",
        title: "Vimeo動画",
        thumbnailUrl: `https://vumbnail.com/${vimeoId}.jpg`,
      };
    }

    return {
      url: u.href,
      kind: "site",
      siteName,
      title: siteName,
      thumbnailUrl: `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(u.href)}`,
    };
  }

  // Best-effort: fetch a richer title/thumbnail for non-video links via a
  // public link-preview API. Fails silently (offline / blocked / no CORS)
  // and keeps the favicon fallback set in buildMetadata().
  async function enrichSiteMetadata(entry) {
    if (entry.kind !== "site") return;
    try {
      const res = await fetch(
        `https://api.microlink.io/?url=${encodeURIComponent(entry.url)}&meta=false`
      );
      if (!res.ok) return;
      const json = await res.json();
      const data = json && json.data;
      if (!data) return;
      let changed = false;
      if (data.title && data.title.trim()) {
        entry.title = data.title.trim();
        changed = true;
      }
      if (data.image && data.image.url) {
        entry.thumbnailUrl = data.image.url;
        changed = true;
      } else if (data.logo && data.logo.url) {
        entry.thumbnailUrl = data.logo.url;
        changed = true;
      }
      if (changed) {
        saveEntries();
        render();
      }
    } catch {
      // network blocked or unavailable; keep favicon fallback
    }
  }

  // --- CRUD --------------------------------------------------------------

  function addEntry(rawText) {
    const candidate = extractFirstUrl(rawText.trim()) || rawText.trim();
    const meta = buildMetadata(candidate);
    if (!meta) {
      showToast("有効なURLが見つかりませんでした");
      return null;
    }

    const existingIndex = entries.findIndex((e) => e.url === meta.url);
    if (existingIndex !== -1) {
      const [existing] = entries.splice(existingIndex, 1);
      existing.addedAt = Date.now();
      entries.unshift(existing);
      saveEntries();
      render();
      showToast("すでに保存済みでした（最新に更新）");
      return existing;
    }

    const entry = { id: makeId(), addedAt: Date.now(), ...meta };
    entries.unshift(entry);

    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }

    saveEntries();
    render();
    enrichSiteMetadata(entry);
    return entry;
  }

  function deleteEntry(id) {
    entries = entries.filter((e) => e.id !== id);
    saveEntries();
    render();
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      showToast("URLをコピーしました");
    } catch {
      showToast("コピーに失敗しました");
    }
  }

  // --- Rendering -----------------------------------------------------------

  function formatDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const pad = (n) => String(n).padStart(2, "0");
    if (sameDay) return `今日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }

  function kindBadge(kind) {
    if (kind === "youtube") return "▶ YouTube";
    if (kind === "vimeo") return "▶ Vimeo";
    return "🔗 サイト";
  }

  function buildCard(entry) {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = entry.id;

    const img = node.querySelector(".item-thumb");
    img.src = entry.thumbnailUrl;
    img.alt = entry.title;
    img.addEventListener("error", () => {
      img.classList.add("thumb-broken");
    });

    node.querySelector(".item-kind-badge").textContent = kindBadge(entry.kind);
    node.querySelector(".item-title").textContent = entry.title;
    node.querySelector(".item-site").textContent = `${entry.siteName} · ${formatDate(entry.addedAt)}`;

    node.querySelector(".item-thumb-btn").addEventListener("click", () => openDetail(entry.id));

    return node;
  }

  function render() {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? entries.filter(
          (e) =>
            e.title.toLowerCase().includes(query) ||
            e.siteName.toLowerCase().includes(query) ||
            e.url.toLowerCase().includes(query)
        )
      : entries;

    itemGrid.replaceChildren(...filtered.map(buildCard));
    emptyMessage.hidden = filtered.length !== 0;
  }

  function openDetail(id) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    activeDetailId = id;
    detailThumb.src = entry.thumbnailUrl;
    detailThumb.alt = entry.title;
    detailTitle.textContent = entry.title;
    detailSite.textContent = `${kindBadge(entry.kind)} · ${entry.siteName}`;
    detailUrl.textContent = entry.url;
    detailOpen.href = entry.url;
    modal.hidden = false;
  }

  function closeDetail() {
    modal.hidden = true;
    activeDetailId = null;
  }

  // --- Event wiring --------------------------------------------------------

  addBtn.addEventListener("click", () => {
    if (addEntry(newUrlInput.value)) {
      newUrlInput.value = "";
      newUrlInput.focus();
    }
  });

  newUrlInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      if (addEntry(newUrlInput.value)) newUrlInput.value = "";
    }
  });

  readClipboardBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        addEntry(text);
      } else {
        showToast("クリップボードは空です");
      }
    } catch {
      showToast("クリップボードを読み込めませんでした（権限を確認してください）");
    }
  });

  watchToggle.addEventListener("change", () => {
    if (watchToggle.checked) startWatching();
    else stopWatching();
  });

  function startWatching() {
    if (watchTimer) return;
    watchTimer = setInterval(async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim() && text !== lastSeenClipboard && URL_REGEX.test(text)) {
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
    if (confirm("保存したURLをすべて削除しますか？")) {
      entries = [];
      saveEntries();
      render();
    }
  });

  viewGridBtn.addEventListener("click", () => setView("grid"));
  viewListBtn.addEventListener("click", () => setView("list"));

  function setView(mode) {
    itemGrid.classList.toggle("list-mode", mode === "list");
    viewGridBtn.classList.toggle("active", mode === "grid");
    viewListBtn.classList.toggle("active", mode === "list");
    try {
      localStorage.setItem("videoUrlNotebook.view", mode);
    } catch {
      // ignore
    }
  }

  detailClose.addEventListener("click", closeDetail);
  modal.querySelector(".modal-backdrop").addEventListener("click", closeDetail);
  detailCopy.addEventListener("click", () => {
    const entry = entries.find((e) => e.id === activeDetailId);
    if (entry) copyUrl(entry.url);
  });
  detailDelete.addEventListener("click", () => {
    if (activeDetailId && confirm("このURLを削除しますか？")) {
      deleteEntry(activeDetailId);
      closeDetail();
    }
  });

  // Pull in anything the share-target page queued for us (see
  // share-target.html), then clear the queue.
  function drainShareQueue() {
    try {
      const raw = localStorage.getItem("videoUrlNotebook.shareQueue");
      if (!raw) return;
      const queued = JSON.parse(raw);
      localStorage.removeItem("videoUrlNotebook.shareQueue");
      if (Array.isArray(queued)) {
        queued.forEach((text) => addEntry(text));
        if (queued.length) showToast("共有されたURLを保存しました");
      }
    } catch {
      // ignore malformed queue
    }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // offline support is best-effort; ignore registration failures
    });
  }

  const savedView = (() => {
    try {
      return localStorage.getItem("videoUrlNotebook.view");
    } catch {
      return null;
    }
  })();
  setView(savedView === "list" ? "list" : "grid");

  drainShareQueue();
  render();
})();
