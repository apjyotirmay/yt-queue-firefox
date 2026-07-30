const listEl = document.getElementById("queue-list");
const playedListEl = document.getElementById("played-list");
const playedSection = document.getElementById("played-section");
const clearBtn = document.getElementById("clear-btn");
const keepPlayedToggle = document.getElementById("keep-played-toggle");
const cloudSyncToggle = document.getElementById("cloud-sync-toggle");
const syncStatusRow = document.getElementById("sync-status-row");
const syncStatusText = document.getElementById("sync-status-text");
const counterBadge = document.getElementById("queue-counter");
const playPauseBtn = document.getElementById("play-pause-btn");
const nextBtn = document.getElementById("next-btn");
const autoplayToggle = document.getElementById("autoplay-toggle");
const playedToggleHeader = document.getElementById("played-toggle-header");
const playedListContainer = document.getElementById("played-list-container");
const playedArrow = document.getElementById("played-arrow");
const playedCount = document.getElementById("played-count");

let queue = [];
let playedQueue = [];
let currentPlayingId = null;
let activeStorage = browser.storage.local;
let isPlayedSectionOpen = false;
let isPlaying = false;

// Sync Timestamp & Status State
let lastSyncedAt = null;

// Flags & Buffers for Concurrency & Sync Lock
let isSelfSaving = false;
let isSyncing = false;
let writeBuffer = [];
const pendingAdds = new Set();

function extractVideoId(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.hostname.includes("youtube.com")) {
      return url.searchParams.get("v");
    } else if (url.hostname.includes("youtu.be")) {
      return url.pathname.slice(1);
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Fetch real title directly from YouTube oEmbed if title is missing
async function fetchVideoTitle(videoId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    );
    if (res.ok) {
      const data = await res.json();
      return data.title || "YouTube Video";
    }
  } catch (e) {
    console.warn("Could not fetch YouTube title via oEmbed", e);
  }
  return "YouTube Video";
}

function clearDragIndicators() {
  document
    .querySelectorAll(".drag-over-above, .drag-over-below")
    .forEach((el) => {
      el.classList.remove("drag-over-above", "drag-over-below");
    });
}

function showToast(message) {
  let toast = document.getElementById("sidebar-toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "sidebar-toast";
    toast.style.cssText = `
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: #282828;
      color: #fff;
      padding: 8px 14px;
      border-radius: 18px;
      font-size: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      z-index: 9999;
      transition: opacity 0.2s ease;
      pointer-events: none;
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.opacity = "1";

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = "0";
  }, 2200);
}

function highlightVideoItem(videoId) {
  requestAnimationFrame(() => {
    const items = listEl.querySelectorAll("li");
    items.forEach((li) => {
      if (li.dataset.id === videoId) {
        li.style.transition = "background-color 0.3s ease";
        li.style.backgroundColor = "rgba(62, 166, 255, 0.25)";
        setTimeout(() => {
          li.style.backgroundColor = "";
        }, 1200);
      }
    });
  });
}

// Format relative time (e.g., "just now", "2m ago", "1h ago")
function formatRelativeTime(timestamp) {
  if (!timestamp) return "never";
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// Update Sync Status UI display
function updateSyncStatusUI() {
  if (!cloudSyncToggle.checked) {
    syncStatusRow.style.display = "none";
    return;
  }

  syncStatusRow.style.display = "block";
  syncStatusText.textContent = formatRelativeTime(lastSyncedAt);
}

// Save queue helper with self-save flag protection and write buffer handling
async function saveState() {
  if (isSyncing) {
    writeBuffer.push({
      queue: JSON.parse(JSON.stringify(queue)),
      playedQueue: JSON.parse(JSON.stringify(playedQueue)),
      currentPlayingId,
    });
    return;
  }

  isSelfSaving = true;

  // 1. Save full state locally
  await browser.storage.local.set({ queue, playedQueue, currentPlayingId });

  // 2. Immediately reflect deletion/reordering in Sync storage
  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode === "sync") {
    try {
      await browser.storage.sync.set({
        queue: compressQueueForSync(queue),
        playedQueue: compressQueueForSync(playedQueue),
        currentPlayingId,
      });
    } catch (err) {
      console.warn("Failed to update Cloud Sync on local save:", err);
    }
  }

  setTimeout(() => {
    isSelfSaving = false;
  }, 200);
}

// Robust Cloud Synchronization Workflow
async function performCloudSync() {
  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode !== "sync" || isSyncing) return;

  isSyncing = true;

  try {
    // 1. FETCH-FIRST GUARD
    const cloudData = await browser.storage.sync.get([
      "queue",
      "playedQueue",
      "currentPlayingId",
    ]);

    const remoteQueue = (cloudData.queue || []).map(rehydrateQueueItem);
    const remotePlayed = (cloudData.playedQueue || []).map(rehydrateQueueItem);

    // 2. MERGE & DEDUPLICATE ACTIVE QUEUE
    const localQueueIds = new Set(queue.map((item) => item.id));
    const newRemoteQueue = remoteQueue.filter(
      (item) => !localQueueIds.has(item.id),
    );

    queue = [...queue, ...newRemoteQueue];

    // 3. MERGE & DEDUPLICATE PLAYED QUEUE
    const localPlayedIds = new Set(playedQueue.map((item) => item.id));
    const newRemotePlayed = remotePlayed.filter(
      (item) => !localPlayedIds.has(item.id),
    );
    playedQueue = [...playedQueue, ...newRemotePlayed];

    if (!currentPlayingId && cloudData.currentPlayingId) {
      currentPlayingId = cloudData.currentPlayingId;
    }

    // 4. DRAIN WRITE BUFFER
    if (writeBuffer.length > 0) {
      const latestState = writeBuffer[writeBuffer.length - 1];
      queue = latestState.queue;
      playedQueue = latestState.playedQueue;
      currentPlayingId = latestState.currentPlayingId;
      writeBuffer = [];
    }

    // 5. UPDATE LOCAL, TIMESTAMP & PUSH COMPRESSED STATE TO CLOUD
    lastSyncedAt = Date.now();
    await browser.storage.local.set({
      queue,
      playedQueue,
      currentPlayingId,
      lastSyncedAt,
    });

    isSelfSaving = true;
    await browser.storage.sync.set({
      queue: compressQueueForSync(queue),
      playedQueue: compressQueueForSync(playedQueue),
      currentPlayingId,
    });
    setTimeout(() => {
      isSelfSaving = false;
    }, 200);

    renderQueue();
    updateSyncStatusUI();
  } catch (err) {
    console.error("Cloud Queue Sync failed:", err);
  } finally {
    isSyncing = false;
  }
}

// Synchronous check & async process to handle queue additions reliably
async function addVideoToQueue(newVideo, targetIndex = null) {
  if (!newVideo || !newVideo.id) return;

  const videoId = newVideo.id;

  // Lock: Block rapid duplicate calls for the exact same video
  if (pendingAdds.has(videoId)) return;
  pendingAdds.add(videoId);

  setTimeout(() => {
    pendingAdds.delete(videoId);
  }, 1000);

  // If title is missing or generic, attempt to fetch the real title
  if (!newVideo.title || newVideo.title === "YouTube Video") {
    newVideo.title = await fetchVideoTitle(videoId);
  }

  const existingIdx = queue.findIndex((item) => item.id === videoId);
  const playedIdx = playedQueue.findIndex((item) => item.id === videoId);

  // Case 1: Video is currently in Played History -> Restore it
  if (playedIdx !== -1) {
    const [restored] = playedQueue.splice(playedIdx, 1);
    const itemToInsert = {
      ...restored,
      ...newVideo,
      title: newVideo.title || restored.title,
    };

    if (targetIndex !== null) {
      queue.splice(targetIndex, 0, itemToInsert);
    } else {
      queue.push(itemToInsert);
    }
    showToast("Restored video from played history");
  }
  // Case 2: Video already exists in Queue -> Update title & reposition
  else if (existingIdx !== -1) {
    const existingItem = queue[existingIdx];
    const mergedItem = {
      ...existingItem,
      ...newVideo,
      title: newVideo.title || existingItem.title,
    };

    if (targetIndex !== null) {
      queue.splice(existingIdx, 1);
      const insertAt =
        existingIdx < targetIndex ? targetIndex - 1 : targetIndex;
      queue.splice(insertAt, 0, mergedItem);
      showToast("Updated video position");
    } else {
      queue[existingIdx] = mergedItem;
      showToast("Video already in queue");
    }
  }
  // Case 3: Completely New Video
  else {
    const itemToInsert = {
      ...newVideo,
      title: newVideo.title || "YouTube Video",
    };

    if (targetIndex !== null) {
      queue.splice(targetIndex, 0, itemToInsert);
    } else {
      queue.push(itemToInsert);
    }
  }

  await saveState();
  renderQueue();
  highlightVideoItem(videoId);

  // Trigger sync push if cloud sync is active
  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode === "sync") {
    await performCloudSync();
  }
}

// Strip bloated metadata before pushing to storage.sync
function compressQueueForSync(queueArray) {
  return (queueArray || []).map((item) => ({
    id: item.id,
    title: item.title,
  }));
}

// Rehydrate sync items with standard URLs and thumbnails
function rehydrateQueueItem(item) {
  return {
    id: item.id,
    title: item.title || "YouTube Video",
    url: item.url || `https://www.youtube.com/watch?v=${item.id}`,
    thumbnail:
      item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
  };
}

async function getStorageEngine() {
  const settings = await browser.storage.local.get([
    "storageMode",
    "afterPlay",
  ]);

  const isSync = settings.storageMode === "sync";
  const keepPlayed = (settings.afterPlay || "remove") === "keep";

  if (cloudSyncToggle) cloudSyncToggle.checked = isSync;
  if (keepPlayedToggle) keepPlayedToggle.checked = keepPlayed;

  return isSync ? browser.storage.sync : browser.storage.local;
}

async function loadQueue() {
  activeStorage = await getStorageEngine();
  const settings = await browser.storage.local.get([
    "storageMode",
    "lastSyncedAt",
  ]);
  lastSyncedAt = settings.lastSyncedAt || null;

  if (settings.storageMode === "sync") {
    // First load existing local data to populate UI instantly
    const localData = await browser.storage.local.get([
      "queue",
      "playedQueue",
      "currentPlayingId",
      "isPlaying",
      "autoplay",
    ]);
    queue = localData.queue || [];
    playedQueue = localData.playedQueue || [];
    currentPlayingId = localData.currentPlayingId || null;
    autoplayToggle.checked = localData.autoplay !== false;
    isPlaying = !!localData.isPlaying;

    updatePlayButtonUI(isPlaying);
    renderQueue();
    updateSyncStatusUI();

    // Perform Fetch-First Sync with Cloud
    await performCloudSync();
  } else {
    const data = await activeStorage.get([
      "queue",
      "playedQueue",
      "currentPlayingId",
      "isPlaying",
      "autoplay",
    ]);

    queue = data.queue || [];
    playedQueue = data.playedQueue || [];
    currentPlayingId = data.currentPlayingId || null;
    autoplayToggle.checked = data.autoplay !== false;

    isPlaying = !!data.isPlaying;
    updatePlayButtonUI(isPlaying);

    renderQueue();
    updateSyncStatusUI();
  }
}

autoplayToggle.addEventListener("change", async (e) => {
  await activeStorage.set({ autoplay: e.target.checked });
});

cloudSyncToggle.addEventListener("change", async (e) => {
  const newMode = e.target.checked ? "sync" : "local";
  await browser.storage.local.set({ storageMode: newMode });

  if (newMode === "sync") {
    await performCloudSync();
  } else {
    updateSyncStatusUI();
    loadQueue();
  }
});

keepPlayedToggle.addEventListener("change", async (e) => {
  const newMode = e.target.checked ? "keep" : "remove";
  await browser.storage.local.set({ afterPlay: newMode });
  renderQueue();
});

// Storage change listener guarded against self-saved changes
browser.storage.onChanged.addListener((changes) => {
  if (isSelfSaving) return;

  if (changes.isPlaying) {
    updatePlayButtonUI(!!changes.isPlaying.newValue);
  }
  if (changes.queue || changes.playedQueue || changes.currentPlayingId) {
    loadQueue();
  }
});

// Runtime messages from background / content scripts
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "ADD_TO_QUEUE" && message.video) {
    addVideoToQueue(message.video);
    return;
  }
  if (
    message.type === "PLAYER_STATE_CHANGED" ||
    message.type === "PLAYER_STATUS"
  ) {
    if (message.isPlaying !== undefined) {
      updatePlayButtonUI(!!message.isPlaying);
    }
  }
});

clearBtn.addEventListener("click", async () => {
  if (queue.length === 0 && playedQueue.length === 0) return;

  const confirmed = confirm("Are you sure you want to clear your video queue?");
  if (confirmed) {
    queue = [];
    playedQueue = [];
    currentPlayingId = null;
    await saveState();
    renderQueue();

    const settings = await browser.storage.local.get("storageMode");
    if (settings.storageMode === "sync") {
      await browser.storage.sync.set({ queue, playedQueue, currentPlayingId });
      lastSyncedAt = Date.now();
      await browser.storage.local.set({ lastSyncedAt });
      updateSyncStatusUI();
    }
  }
});

function renderQueue() {
  while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
  while (playedListEl.firstChild)
    playedListEl.removeChild(playedListEl.firstChild);

  const total = queue.length + playedQueue.length;
  let activeIndex = queue.findIndex((item) => item.id === currentPlayingId);

  const isQueueEmpty = queue.length === 0;
  const isTotalEmpty = total === 0;

  playPauseBtn.disabled = isQueueEmpty && !currentPlayingId;
  nextBtn.disabled = isQueueEmpty;
  clearBtn.disabled = isTotalEmpty;

  if (activeIndex !== -1) {
    counterBadge.textContent = `${playedQueue.length + activeIndex + 1}/${total}`;
  } else if (playedQueue.some((item) => item.id === currentPlayingId)) {
    const pIdx = playedQueue.findIndex((item) => item.id === currentPlayingId);
    counterBadge.textContent = `${pIdx + 1}/${total}`;
  } else {
    counterBadge.textContent = total > 0 ? `0/${total}` : `0/0`;
  }

  queue.forEach((item, index) => {
    const li = createVideoItem(item, index, false);
    listEl.appendChild(li);
  });

  if (keepPlayedToggle.checked && playedQueue.length > 0) {
    playedSection.style.display = "block";
    playedCount.textContent = playedQueue.length;

    playedQueue.forEach((item, index) => {
      const li = createVideoItem(item, index, true);
      playedListEl.appendChild(li);
    });
  } else {
    playedSection.style.display = "none";
  }

  updateFoldUI();
}

function createVideoItem(item, index, isPlayed) {
  const li = document.createElement("li");
  li.draggable = true;
  li.dataset.index = index;
  li.dataset.id = item.id;
  li.dataset.isPlayed = isPlayed ? "true" : "false";

  if (item.id === currentPlayingId) {
    li.classList.add("playing");
  }
  if (isPlayed) {
    li.classList.add("played-item");
  }

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
    if (isPlayed) {
      playedQueue.splice(index, 1);
    } else {
      queue.splice(index, 1);
    }

    // saveState() now handles writing to local AND sync immediately!
    await saveState();
    renderQueue();
  });

  li.appendChild(img);
  li.appendChild(infoDiv);
  li.appendChild(removeBtn);

  // Drag Start
  li.addEventListener("dragstart", (e) => {
    li.classList.add("dragging");
    const payload = JSON.stringify({ index, isPlayed });
    e.dataTransfer.setData("application/json", payload);
    e.dataTransfer.setData("text/plain", payload);
  });

  // Drag End
  li.addEventListener("dragend", () => {
    li.classList.remove("dragging");
    clearDragIndicators();
  });

  if (!isPlayed) {
    // Drag Over
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      const rect = li.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      clearDragIndicators();

      if (e.clientY < midpoint) {
        li.classList.add("drag-over-above");
      } else {
        li.classList.add("drag-over-below");
      }
    });

    li.addEventListener("dragleave", () => {
      li.classList.remove("drag-over-above", "drag-over-below");
    });

    // Drop Handler
    li.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = li.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const isAbove = e.clientY < midpoint;

      clearDragIndicators();

      try {
        const rawData =
          e.dataTransfer.getData("application/json") ||
          e.dataTransfer.getData("text/plain");

        if (!rawData) return;

        // Internal list reorder
        if (rawData.startsWith("{")) {
          const dragData = JSON.parse(rawData);
          const fromIdx = dragData.index;
          const fromPlayed = dragData.isPlayed;

          if (isNaN(fromIdx)) return;

          let targetIdx = isAbove ? index : index + 1;

          if (fromPlayed) {
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
          if (settings.storageMode === "sync") {
            await performCloudSync();
          }
        } else {
          // Dropped external link directly onto item
          const videoId = extractVideoId(rawData);
          if (videoId) {
            let targetIdx = isAbove ? index : index + 1;
            await addVideoToQueue(
              {
                id: videoId,
                url: `https://www.youtube.com/watch?v=${videoId}`,
              },
              targetIdx,
            );
          }
        }
      } catch (err) {
        console.error("List drop error:", err);
      }
    });
  }

  return li;
}

async function playVideo(item, isPlayed = false) {
  if (isPlayed) {
    playedQueue = playedQueue.filter((i) => i.id !== item.id);

    let currentlyPlayingItem = null;
    if (currentPlayingId) {
      const activeIdx = queue.findIndex((i) => i.id === currentPlayingId);
      if (activeIdx !== -1) {
        [currentlyPlayingItem] = queue.splice(activeIdx, 1);
      }
    }

    queue = queue.filter((i) => i.id !== item.id);
    queue.unshift(item);

    if (currentlyPlayingItem && currentlyPlayingItem.id !== item.id) {
      queue.splice(1, 0, currentlyPlayingItem);
    }
  } else {
    if (currentPlayingId && currentPlayingId !== item.id) {
      const activeIdx = queue.findIndex((i) => i.id === currentPlayingId);
      const clickedIdx = queue.findIndex((i) => i.id === item.id);

      if (activeIdx !== -1 && clickedIdx !== -1) {
        const [selected] = queue.splice(clickedIdx, 1);
        queue.unshift(selected);
      }
    }
  }

  currentPlayingId = item.id;
  await saveState();
  renderQueue();

  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode === "sync") {
    await performCloudSync();
  }

  browser.runtime.sendMessage({
    type: "PLAY_VIDEO",
    url: item.url,
    focus: false,
  });
}

playPauseBtn.addEventListener("click", async () => {
  const data = await activeStorage.get([
    "queue",
    "currentPlayingId",
    "isPlaying",
  ]);
  const currentQueue = data.queue || [];

  if (!data.currentPlayingId && currentQueue.length > 0) {
    playVideo(currentQueue[0]);
    return;
  }

  browser.runtime.sendMessage({ type: "CONTROL_PLAYER", command: "TOGGLE" });
});

nextBtn.addEventListener("click", async () => {
  const activeStorage = await getStorageEngine();
  const data = await activeStorage.get([
    "queue",
    "playedQueue",
    "currentPlayingId",
  ]);
  let q = data.queue || [];
  let pq = data.playedQueue || [];
  const afterPlayMode =
    (await browser.storage.local.get("afterPlay")).afterPlay || "remove";

  if (q.length === 0) return;

  const activeIdx = q.findIndex((item) => item.id === currentPlayingId);
  if (activeIdx !== -1) {
    const [finished] = q.splice(activeIdx, 1);
    if (afterPlayMode === "keep") {
      pq.push(finished);
    }
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
    await activeStorage.set({
      queue,
      playedQueue,
      currentPlayingId,
      isPlaying: false,
    });
    setTimeout(() => {
      isSelfSaving = false;
    }, 200);
    renderQueue();
  }

  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode === "sync") {
    await performCloudSync();
  }
});

async function loadFoldState() {
  const settings = await browser.storage.local.get("isPlayedSectionOpen");
  isPlayedSectionOpen = settings.isPlayedSectionOpen || false;
  updateFoldUI();
}

playedToggleHeader.addEventListener("click", async () => {
  isPlayedSectionOpen = !isPlayedSectionOpen;
  await browser.storage.local.set({ isPlayedSectionOpen });
  updateFoldUI();
});

function updateFoldUI() {
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

// Automatically update relative timestamp every 10 seconds
setInterval(updateSyncStatusUI, 10000);

loadQueue();
loadFoldState();

// Global dragover handler
["dragenter", "dragover"].forEach((eventName) => {
  document.addEventListener(
    eventName,
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    false,
  );
});

// Single global drop event listener
document.addEventListener("drop", async (e) => {
  const internalData = e.dataTransfer.getData("application/json");
  if (internalData && internalData.startsWith("{")) return;

  e.preventDefault();
  e.stopPropagation();

  let droppedUrl =
    e.dataTransfer.getData("text/uri-list") ||
    e.dataTransfer.getData("text/plain");

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
      await addVideoToQueue({
        id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }
  }
});

listEl.addEventListener("dragover", (e) => e.preventDefault());
