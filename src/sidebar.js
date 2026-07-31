const listEl = document.getElementById("queue-list");
const playedListEl = document.getElementById("played-list");
const playedSection = document.getElementById("played-section");
const clearBtn = document.getElementById("clear-btn");
const keepPlayedToggle = document.getElementById("keep-played-toggle");
const syncIndicator = document.getElementById("sync-indicator");
const syncStatusText = document.getElementById("sync-status-text");
const syncTimeText = document.getElementById("sync-time-text");
const counterBadge = document.getElementById("queue-counter");
const playPauseBtn = document.getElementById("play-pause-btn");
const nextBtn = document.getElementById("next-btn");
const autoplayToggle = document.getElementById("autoplay-toggle");
const playedToggleHeader = document.getElementById("played-toggle-header");
const playedListContainer = document.getElementById("played-list-container");
const playedArrow = document.getElementById("played-arrow");
const playedCount = document.getElementById("played-count");
const clearPlayedBtn = document.getElementById("clear-played-btn");

let queue = [];
let playedQueue = [];
let currentPlayingId = null;
let activeStorage = browser.storage.local;
let isPlayedSectionOpen = false;
let isPlaying = false;
let lastSyncedAt = null;

let isSelfSaving = false;
let isSyncing = false;
let writeBuffer = [];
const pendingAdds = new Set();

function extractVideoId(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.hostname.includes("youtube.com")) return url.searchParams.get("v");
    if (url.hostname.includes("youtu.be")) return url.pathname.slice(1);
  } catch (e) {}
  return null;
}

function sanitizeVideoItem(item) {
  if (!item || !item.id) return null;
  return {
    id: item.id,
    title: item.title || "YouTube Video",
    url: item.url || `https://www.youtube.com/watch?v=${item.id}`,
    thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
  };
}

async function fetchVideoTitle(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (res.ok) {
      const data = await res.json();
      return data.title || "YouTube Video";
    }
  } catch (e) {
    console.warn("[QueueExt:Sidebar] oEmbed title fetch failed", e);
  }
  return "YouTube Video";
}

function clearDragIndicators() {
  document.querySelectorAll(".drag-over-above, .drag-over-below").forEach((el) => {
    el.classList.remove("drag-over-above", "drag-over-below");
  });
}

function showToast(message) {
  let toast = document.getElementById("sidebar-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "sidebar-toast";
    toast.style.cssText = `
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      background: #282828; color: #fff; padding: 8px 14px; border-radius: 18px;
      font-size: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 9999;
      transition: opacity 0.2s ease; pointer-events: none;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = "1";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 2200);
}

function highlightVideoItem(videoId) {
  requestAnimationFrame(() => {
    const items = listEl.querySelectorAll("li");
    items.forEach((li) => {
      if (li.dataset.id === videoId) {
        li.style.transition = "background-color 0.3s ease";
        li.style.backgroundColor = "rgba(62, 166, 255, 0.25)";
        setTimeout(() => { li.style.backgroundColor = ""; }, 1200);
      }
    });
  });
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "never";
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

async function updateSyncStatusUI() {
  const settings = await browser.storage.local.get(["storageMode", "lastSyncedAt"]);
  const isSyncMode = settings.storageMode === "sync";
  lastSyncedAt = settings.lastSyncedAt || null;

  if (!syncIndicator || !syncStatusText) return;

  if (isSyncMode) {
    syncIndicator.classList.add("active");
    syncStatusText.textContent = "Cloud Sync";
    if (syncTimeText) {
      syncTimeText.textContent = lastSyncedAt ? `Synced ${formatRelativeTime(lastSyncedAt)}` : "Not synced yet";
    }
  } else {
    syncIndicator.classList.remove("active");
    syncStatusText.textContent = "Local Mode";
    if (syncTimeText) {
      syncTimeText.textContent = "";
    }
  }
}

async function saveState() {
  queue = queue.map(sanitizeVideoItem).filter(Boolean);
  playedQueue = playedQueue.map(sanitizeVideoItem).filter(Boolean);

  if (isSyncing) {
    writeBuffer.push({
      queue: JSON.parse(JSON.stringify(queue)),
      playedQueue: JSON.parse(JSON.stringify(playedQueue)),
      currentPlayingId,
    });
    return;
  }

  isSelfSaving = true;
  await browser.storage.local.set({ queue, playedQueue, currentPlayingId });

  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode === "sync" && browser.storage.sync) {
    try {
      await browser.storage.sync.set({
        queue: compressQueueForSync(queue),
        playedQueue: compressQueueForSync(playedQueue),
        currentPlayingId,
      });
      lastSyncedAt = Date.now();
      await browser.storage.local.set({ lastSyncedAt });
      updateSyncStatusUI();
    } catch (err) {
      console.warn("[QueueExt:Sidebar] Sync update failed:", err);
    }
  }

  setTimeout(() => { isSelfSaving = false; }, 200);
}

async function performCloudSync() {
  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode !== "sync" || isSyncing || !browser.storage.sync) return;

  isSyncing = true;
  try {
    const cloudData = await browser.storage.sync.get(["queue", "playedQueue", "currentPlayingId"]);
    const remoteQueue = (cloudData.queue || []).map(sanitizeVideoItem).filter(Boolean);
    const remotePlayed = (cloudData.playedQueue || []).map(sanitizeVideoItem).filter(Boolean);

    const localQueueIds = new Set(queue.map((item) => item.id));
    const newRemoteQueue = remoteQueue.filter((item) => !localQueueIds.has(item.id));
    queue = [...queue, ...newRemoteQueue].map(sanitizeVideoItem).filter(Boolean);

    const localPlayedIds = new Set(playedQueue.map((item) => item.id));
    const newRemotePlayed = remotePlayed.filter((item) => !localPlayedIds.has(item.id));
    playedQueue = [...playedQueue, ...newRemotePlayed].map(sanitizeVideoItem).filter(Boolean);

    if (!currentPlayingId && cloudData.currentPlayingId) {
      currentPlayingId = cloudData.currentPlayingId;
    }

    if (writeBuffer.length > 0) {
      const latestState = writeBuffer[writeBuffer.length - 1];
      queue = latestState.queue.map(sanitizeVideoItem).filter(Boolean);
      playedQueue = latestState.playedQueue.map(sanitizeVideoItem).filter(Boolean);
      currentPlayingId = latestState.currentPlayingId;
      writeBuffer = [];
    }

    lastSyncedAt = Date.now();
    await browser.storage.local.set({ queue, playedQueue, currentPlayingId, lastSyncedAt });

    isSelfSaving = true;
    await browser.storage.sync.set({
      queue: compressQueueForSync(queue),
      playedQueue: compressQueueForSync(playedQueue),
      currentPlayingId,
    });
    setTimeout(() => { isSelfSaving = false; }, 200);

    renderQueue();
    updateSyncStatusUI();
  } catch (err) {
    console.error("[QueueExt:Sidebar] Sync error:", err);
  } finally {
    isSyncing = false;
  }
}

async function addVideoToQueue(newVideo, targetIndex = null) {
  if (!newVideo || !newVideo.id) return;
  const videoId = String(newVideo.id).trim();

  if (pendingAdds.has(videoId)) return;
  pendingAdds.add(videoId);
  setTimeout(() => { pendingAdds.delete(videoId); }, 1000);

  if (!newVideo.title || newVideo.title === "YouTube Video") {
    newVideo.title = await fetchVideoTitle(videoId);
  }

  const normalizedToAdd = sanitizeVideoItem({ ...newVideo, id: videoId, title: newVideo.title });
  const existingIdx = queue.findIndex((item) => String(item.id).trim() === videoId);
  const playedIdx = playedQueue.findIndex((item) => String(item.id).trim() === videoId);

  if (playedIdx !== -1) {
    const [restored] = playedQueue.splice(playedIdx, 1);
    const itemToInsert = sanitizeVideoItem({ ...restored, ...normalizedToAdd });
    if (targetIndex !== null) queue.splice(targetIndex, 0, itemToInsert);
    else queue.push(itemToInsert);
    showToast("Restored video from played history");
  } else if (existingIdx !== -1) {
    const existingItem = queue[existingIdx];
    const mergedItem = sanitizeVideoItem({ ...existingItem, ...normalizedToAdd });
    if (targetIndex !== null) {
      queue.splice(existingIdx, 1);
      const insertAt = existingIdx < targetIndex ? targetIndex - 1 : targetIndex;
      queue.splice(insertAt, 0, mergedItem);
      showToast("Updated video position");
    } else {
      queue[existingIdx] = mergedItem;
      showToast("Video already in queue");
    }
  } else {
    if (targetIndex !== null) queue.splice(targetIndex, 0, normalizedToAdd);
    else queue.push(normalizedToAdd);
    showToast("✓ Added to Queue");
  }

  await saveState();
  renderQueue();
  highlightVideoItem(videoId);

  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode === "sync") await performCloudSync();
}

function compressQueueForSync(queueArray) {
  return (queueArray || []).map((item) => ({ id: item.id, title: item.title }));
}

async function getStorageEngine() {
  const settings = await browser.storage.local.get(["storageMode", "afterPlay"]);
  const isSync = settings.storageMode === "sync" && !!browser.storage.sync;
  const keepPlayed = (settings.afterPlay || "remove") === "keep";

  if (keepPlayedToggle) keepPlayedToggle.checked = keepPlayed;

  return isSync ? browser.storage.sync : browser.storage.local;
}

async function loadQueue() {
  activeStorage = await getStorageEngine();
  const settings = await browser.storage.local.get(["storageMode", "lastSyncedAt"]);
  lastSyncedAt = settings.lastSyncedAt || null;

  const localData = await browser.storage.local.get(["queue", "playedQueue", "currentPlayingId", "isPlaying", "autoplay"]);
  queue = (localData.queue || []).map(sanitizeVideoItem).filter(Boolean);
  playedQueue = (localData.playedQueue || []).map(sanitizeVideoItem).filter(Boolean);
  currentPlayingId = localData.currentPlayingId || null;
  if (autoplayToggle) autoplayToggle.checked = localData.autoplay !== false;
  isPlaying = !!localData.isPlaying;

  updatePlayButtonUI(isPlaying);
  renderQueue();
  updateSyncStatusUI();

  if (settings.storageMode === "sync" && browser.storage.sync) {
    await performCloudSync();
  }
}

if (autoplayToggle) {
  autoplayToggle.addEventListener("change", async (e) => {
    await activeStorage.set({ autoplay: e.target.checked });
  });
}

if (keepPlayedToggle) {
  keepPlayedToggle.addEventListener("change", async (e) => {
    await browser.storage.local.set({ afterPlay: e.target.checked ? "keep" : "remove" });
    renderQueue();
  });
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (isSelfSaving) return;
  if (areaName === "local" && changes.storageMode) updateSyncStatusUI();
  if (changes.isPlaying) updatePlayButtonUI(!!changes.isPlaying.newValue);
  if (changes.queue || changes.playedQueue || changes.currentPlayingId) loadQueue();
});

browser.runtime.onMessage.addListener((message) => {
  if (message.type === "PLAYER_STATE_CHANGED" || message.type === "PLAYER_STATUS") {
    if (message.isPlaying !== undefined) updatePlayButtonUI(!!message.isPlaying);
  }
});

// Main Clear Button -> Wipes Entire Queue (Unplayed + Played)
clearBtn.addEventListener("click", async () => {
  if (queue.length === 0 && playedQueue.length === 0) return;

  if (confirm("Are you sure you want to clear the entire queue (including played videos)?")) {
    queue = [];
    playedQueue = [];
    currentPlayingId = null;
    await saveState();
    renderQueue();

    const settings = await browser.storage.local.get("storageMode");
    if (settings.storageMode === "sync" && browser.storage.sync) {
      await browser.storage.sync.set({ queue, playedQueue, currentPlayingId });
      lastSyncedAt = Date.now();
      await browser.storage.local.set({ lastSyncedAt });
      updateSyncStatusUI();
    }
  }
});

// Targeted Clear Played Button -> Wipes Only Played History
clearPlayedBtn.addEventListener("click", async () => {
  if (playedQueue.length === 0) return;

  if (confirm("Are you sure you want to clear your played video history?")) {
    playedQueue = [];

    if (currentPlayingId && !queue.some(item => item.id === currentPlayingId)) {
      currentPlayingId = null;
    }

    await saveState();
    renderQueue();

    const settings = await browser.storage.local.get("storageMode");
    if (settings.storageMode === "sync" && browser.storage.sync) {
      await browser.storage.sync.set({ playedQueue });
      lastSyncedAt = Date.now();
      await browser.storage.local.set({ lastSyncedAt });
      updateSyncStatusUI();
    }
  }
});

const settingsBtn = document.getElementById("settings-btn");
if (settingsBtn) {
  settingsBtn.addEventListener("click", () => {
    if (browser.runtime.openOptionsPage) {
      browser.runtime.openOptionsPage();
    } else {
      window.open(browser.runtime.getURL("options/index.html"));
    }
  });
}

function renderQueue() {
  while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
  while (playedListEl.firstChild) playedListEl.removeChild(playedListEl.firstChild);

  const total = queue.length + playedQueue.length;
  let activeIndex = queue.findIndex((item) => item.id === currentPlayingId);

  const isQueueEmpty = queue.length === 0;
  playPauseBtn.disabled = isQueueEmpty && !currentPlayingId;
  nextBtn.disabled = isQueueEmpty;
  clearBtn.disabled = total === 0;

  if (activeIndex !== -1) {
    counterBadge.textContent = `${playedQueue.length + activeIndex + 1}/${total}`;
  } else if (playedQueue.some((item) => item.id === currentPlayingId)) {
    const pIdx = playedQueue.findIndex((item) => item.id === currentPlayingId);
    counterBadge.textContent = `${pIdx + 1}/${total}`;
  } else {
    counterBadge.textContent = total > 0 ? `0/${total}` : `0/0`;
  }

  queue.forEach((item, index) => listEl.appendChild(createVideoItem(item, index, false)));

  if (keepPlayedToggle && keepPlayedToggle.checked && playedQueue.length > 0) {
    playedSection.style.display = "block";
    clearPlayedBtn.style.display = "inline-block";
    clearPlayedBtn.disabled = playedQueue.length === 0;
    playedCount.textContent = playedQueue.length;
    playedQueue.forEach((item, index) => playedListEl.appendChild(createVideoItem(item, index, true)));
  } else {
    playedSection.style.display = "none";
    clearPlayedBtn.style.display = "none";
  }

  updateFoldUI();
}

function createVideoItem(item, index, isPlayed) {
  const li = document.createElement("li");
  li.draggable = true;
  li.dataset.index = index;
  li.dataset.id = item.id;
  li.dataset.isPlayed = isPlayed ? "true" : "false";

  if (item.id === currentPlayingId) li.classList.add("playing");
  if (isPlayed) li.classList.add("played-item");

  const img = document.createElement("img");
  img.className = "thumb-img";
  img.src = item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
  img.addEventListener("click", () => playVideo(item, isPlayed));

  const infoDiv = document.createElement("div");
  infoDiv.className = "info-container";

  const titleSpan = document.createElement("span");
  titleSpan.className = "title";
  titleSpan.title = item.title || "YouTube Video";
  titleSpan.textContent = item.title || "YouTube Video";
  titleSpan.addEventListener("click", () => playVideo(item, isPlayed));

  infoDiv.appendChild(titleSpan);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", async () => {
    if (isPlayed) playedQueue.splice(index, 1);
    else queue.splice(index, 1);
    await saveState();
    renderQueue();
  });

  li.appendChild(img);
  li.appendChild(infoDiv);
  li.appendChild(removeBtn);

  li.addEventListener("dragstart", (e) => {
    li.classList.add("dragging");
    const payload = JSON.stringify({ index, isPlayed });
    e.dataTransfer.setData("application/json", payload);
    e.dataTransfer.setData("text/plain", payload);
  });

  li.addEventListener("dragend", () => {
    li.classList.remove("dragging");
    clearDragIndicators();
  });

  if (!isPlayed) {
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      const rect = li.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      clearDragIndicators();
      if (e.clientY < midpoint) li.classList.add("drag-over-above");
      else li.classList.add("drag-over-below");
    });

    li.addEventListener("dragleave", () => {
      li.classList.remove("drag-over-above", "drag-over-below");
    });

    li.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = li.getBoundingClientRect();
      const isAbove = e.clientY < (rect.top + rect.height / 2);
      clearDragIndicators();

      try {
        const rawData = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
        if (!rawData) return;

        if (rawData.startsWith("{")) {
          const dragData = JSON.parse(rawData);
          const fromIdx = dragData.index;
          let targetIdx = isAbove ? index : index + 1;

          if (dragData.isPlayed) {
            const [movedItem] = playedQueue.splice(fromIdx, 1);
            queue.splice(targetIdx, 0, movedItem);
          } else {
            if (fromIdx < targetIdx) targetIdx--;
            const [movedItem] = queue.splice(fromIdx, 1);
            queue.splice(targetIdx, 0, movedItem);
          }

          await saveState();
          renderQueue();
          const settings = await browser.storage.local.get("storageMode");
          if (settings.storageMode === "sync") await performCloudSync();
        } else {
          const videoId = extractVideoId(rawData);
          if (videoId) {
            let targetIdx = isAbove ? index : index + 1;
            await addVideoToQueue({ id: videoId, url: `https://www.youtube.com/watch?v=${videoId}` }, targetIdx);
          }
        }
      } catch (err) {
        console.error("[QueueExt:Sidebar] Drop error:", err);
      }
    });
  }

  return li;
}

async function playVideo(item, isPlayed = false) {
  const sanitizedItem = sanitizeVideoItem(item);
  if (!sanitizedItem) return;

  if (isPlayed) {
    playedQueue = playedQueue.filter((i) => i.id !== sanitizedItem.id);
    let currentlyPlayingItem = null;
    if (currentPlayingId) {
      const activeIdx = queue.findIndex((i) => i.id === currentPlayingId);
      if (activeIdx !== -1) [currentlyPlayingItem] = queue.splice(activeIdx, 1);
    }
    queue = queue.filter((i) => i.id !== sanitizedItem.id);
    queue.unshift(sanitizedItem);
    if (currentlyPlayingItem && currentlyPlayingItem.id !== sanitizedItem.id) queue.splice(1, 0, currentlyPlayingItem);
  } else {
    if (currentPlayingId && currentPlayingId !== sanitizedItem.id) {
      const activeIdx = queue.findIndex((i) => i.id === currentPlayingId);
      const clickedIdx = queue.findIndex((i) => i.id === sanitizedItem.id);
      if (activeIdx !== -1 && clickedIdx !== -1) {
        const [selected] = queue.splice(clickedIdx, 1);
        queue.unshift(selected);
      }
    }
  }

  currentPlayingId = sanitizedItem.id;
  await saveState();
  renderQueue();

  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode === "sync") await performCloudSync();

  browser.runtime.sendMessage({
    type: "PLAY_VIDEO",
    url: sanitizedItem.url,
    focus: false,
  });
}

playPauseBtn.addEventListener("click", async () => {
  const data = await browser.storage.local.get(["queue", "currentPlayingId"]);
  const currentQueue = (data.queue || []).map(sanitizeVideoItem).filter(Boolean);

  if (!data.currentPlayingId && currentQueue.length > 0) {
    playVideo(currentQueue[0]);
    return;
  }
  browser.runtime.sendMessage({ type: "CONTROL_PLAYER", command: "TOGGLE" });
});

nextBtn.addEventListener("click", async () => {
  const data = await browser.storage.local.get(["queue", "playedQueue", "currentPlayingId"]);
  let q = (data.queue || []).map(sanitizeVideoItem).filter(Boolean);
  let pq = (data.playedQueue || []).map(sanitizeVideoItem).filter(Boolean);
  const afterPlayMode = (await browser.storage.local.get("afterPlay")).afterPlay || "remove";

  if (q.length === 0) return;

  const activeIdx = q.findIndex((item) => item.id === currentPlayingId);
  if (activeIdx !== -1) {
    const [finished] = q.splice(activeIdx, 1);
    if (afterPlayMode === "keep") pq.push(finished);
  }

  if (q.length > 0) {
    queue = q;
    playedQueue = pq;
    await saveState();
    playVideo(queue[0]);
  } else {
    queue = [];
    playedQueue = pq;
    currentPlayingId = null;
    isSelfSaving = true;
    await browser.storage.local.set({ queue, playedQueue, currentPlayingId, isPlaying: false });
    setTimeout(() => { isSelfSaving = false; }, 200);
    renderQueue();
  }

  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode === "sync") await performCloudSync();
});

async function loadFoldState() {
  const settings = await browser.storage.local.get("isPlayedSectionOpen");
  isPlayedSectionOpen = settings.isPlayedSectionOpen || false;
  updateFoldUI();
}

if (playedToggleHeader) {
  playedToggleHeader.addEventListener("click", async () => {
    isPlayedSectionOpen = !isPlayedSectionOpen;
    await browser.storage.local.set({ isPlayedSectionOpen });
    updateFoldUI();
  });
}

function updateFoldUI() {
  if (!playedListContainer || !playedArrow) return;
  if (isPlayedSectionOpen) {
    playedListContainer.classList.remove("collapsed");
    playedArrow.textContent = "▾";
  } else {
    playedListContainer.classList.add("collapsed");
    playedArrow.textContent = "▸";
  }
}

function updatePlayButtonUI(playing) {
  isPlaying = playing;
  if (isPlaying) {
    playPauseBtn.textContent = "❚❚ Pause";
    playPauseBtn.classList.add("playing-state");
  } else {
    playPauseBtn.textContent = "▶ Play";
    playPauseBtn.classList.remove("playing-state");
  }
}

clearPlayedBtn.addEventListener("click", (e) => {
  e.stopPropagation();
});

setInterval(updateSyncStatusUI, 10000);
loadQueue();
loadFoldState();

["dragenter", "dragover"].forEach((eventName) => {
  document.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
});

document.addEventListener("drop", async (e) => {
  const internalData = e.dataTransfer.getData("application/json");
  if (internalData && internalData.startsWith("{")) return;

  e.preventDefault();
  e.stopPropagation();

  let droppedUrl = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
  if (!droppedUrl) {
    const htmlData = e.dataTransfer.getData("text/html");
    if (htmlData) {
      const match = htmlData.match(/href=["']([^"']*watch\?v=[^"']*)["']/);
      if (match) droppedUrl = match[1];
    }
  }

  if (droppedUrl) {
    const videoId = extractVideoId(droppedUrl);
    if (videoId) {
      await addVideoToQueue({ id: videoId, url: `https://www.youtube.com/watch?v=${videoId}` });
    }
  }
});

listEl.addEventListener("dragover", (e) => e.preventDefault());
