const listEl = document.getElementById("queue-list");
const playedListEl = document.getElementById("played-list");
const playedSection = document.getElementById("played-section");
const dropZone = document.getElementById("drop-zone");
const clearBtn = document.getElementById("clear-btn");
const keepPlayedToggle = document.getElementById("keep-played-toggle");
const cloudSyncToggle = document.getElementById("cloud-sync-toggle");
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

// Helper to extract YouTube video ID from arbitrary link structures
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
}

autoplayToggle.addEventListener("change", async (e) => {
  await activeStorage.set({ autoplay: e.target.checked });
});

cloudSyncToggle.addEventListener("change", async (e) => {
  const newMode = e.target.checked ? "sync" : "local";
  await browser.storage.local.set({ storageMode: newMode });

  const targetStorage =
    newMode === "sync" ? browser.storage.sync : browser.storage.local;
  await targetStorage.set({ queue, playedQueue, currentPlayingId });
  loadQueue();
});

keepPlayedToggle.addEventListener("change", async (e) => {
  const newMode = e.target.checked ? "keep" : "remove";
  await browser.storage.local.set({ afterPlay: newMode });
  renderQueue();
});

// Real-time state listeners
browser.storage.onChanged.addListener((changes) => {
  if (changes.isPlaying) {
    updatePlayButtonUI(!!changes.isPlaying.newValue);
  }
  if (changes.queue || changes.playedQueue || changes.currentPlayingId) {
    loadQueue();
  }
});

browser.runtime.onMessage.addListener((message) => {
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
    await activeStorage.set({ queue, playedQueue, currentPlayingId });
    renderQueue();
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
    await activeStorage.set({ queue, playedQueue });
    renderQueue();
  });

  li.appendChild(img);
  li.appendChild(infoDiv);
  li.appendChild(removeBtn);

  li.addEventListener("dragstart", (e) => {
    const payload = JSON.stringify({ index, isPlayed });
    e.dataTransfer.setData("application/json", payload);
    e.dataTransfer.setData("text/plain", payload);
  });

  if (!isPlayed) {
    li.addEventListener("dragover", (e) => e.preventDefault());
    li.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const rawData =
          e.dataTransfer.getData("application/json") ||
          e.dataTransfer.getData("text/plain");

        if (!rawData) return;
        const dragData = JSON.parse(rawData);
        const fromIdx = dragData.index;
        const fromPlayed = dragData.isPlayed;

        if (isNaN(fromIdx)) return;

        if (fromPlayed) {
          const [movedItem] = playedQueue.splice(fromIdx, 1);
          queue.splice(index, 0, movedItem);
        } else {
          const [movedItem] = queue.splice(fromIdx, 1);
          queue.splice(index, 0, movedItem);
        }

        await activeStorage.set({ queue, playedQueue });
        renderQueue();
      } catch (err) {
        console.error("Internal list drop error:", err);
      }
    });
  }

  return li;
}

async function playVideo(item, isPlayed = false) {
  if (isPlayed) {
    // 1. Remove selected item from playedQueue
    playedQueue = playedQueue.filter((i) => i.id !== item.id);

    // 2. Extract current playing video from queue (if present)
    let currentlyPlayingItem = null;
    if (currentPlayingId) {
      const activeIdx = queue.findIndex((i) => i.id === currentPlayingId);
      if (activeIdx !== -1) {
        [currentlyPlayingItem] = queue.splice(activeIdx, 1);
      }
    }

    // Deduplicate in queue
    queue = queue.filter((i) => i.id !== item.id);

    // 3. Put restored played video at Index 0 (Now Playing)
    queue.unshift(item);

    // 4. Put previous active video right next to it at Index 1 (Up Next)
    if (currentlyPlayingItem && currentlyPlayingItem.id !== item.id) {
      queue.splice(1, 0, currentlyPlayingItem);
    }
  } else {
    // Clicking an item inside the main queue
    if (currentPlayingId && currentPlayingId !== item.id) {
      const activeIdx = queue.findIndex((i) => i.id === currentPlayingId);
      const clickedIdx = queue.findIndex((i) => i.id === item.id);

      if (activeIdx !== -1 && clickedIdx !== -1) {
        // Move clicked item to index 0 (Now Playing)
        const [selected] = queue.splice(clickedIdx, 1);
        queue.unshift(selected);
      }
    }
  }

  // Set active ID
  currentPlayingId = item.id;

  // Persist and update UI
  await activeStorage.set({ queue, playedQueue, currentPlayingId });
  renderQueue();

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
    await activeStorage.set({ queue, playedQueue });
    playVideo(queue[0]);
  } else {
    queue = [];
    playedQueue = pq;
    currentPlayingId = null;
    await activeStorage.set({
      queue,
      playedQueue,
      currentPlayingId,
      isPlaying: false,
    });
    renderQueue();
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

loadQueue();
loadFoldState();

// Global listeners to accept external video drag-and-drop into the sidebar
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

document.addEventListener("drop", async (e) => {
  // If the drop target is handling an internal list reorder, ignore global handling
  if (e.dataTransfer.getData("application/json")) return;

  e.preventDefault();
  e.stopPropagation();

  // Extract link from URI or text transfer
  let droppedUrl =
    e.dataTransfer.getData("text/uri-list") ||
    e.dataTransfer.getData("text/plain");

  // Fallback: search raw HTML string for watch URLs (dragging YouTube cards/thumbnails)
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
      browser.runtime.sendMessage({
        type: "ADD_TO_QUEUE",
        video: {
          id: videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          title: "",
        },
      });
    }
  }
});

listEl.addEventListener("dragover", (e) => e.preventDefault());
listEl.addEventListener("drop", async (e) => {
  if (e.target === listEl) {
    e.preventDefault();
    try {
      const rawData = e.dataTransfer.getData("application/json");
      if (!rawData) return;

      const dragData = JSON.parse(rawData);
      const fromIdx = dragData.index;
      const fromPlayed = dragData.isPlayed;

      if (fromPlayed && !isNaN(fromIdx)) {
        const [movedItem] = playedQueue.splice(fromIdx, 1);
        queue.push(movedItem);
        await activeStorage.set({ queue, playedQueue });
        renderQueue();
      }
    } catch (err) {
      console.error("List area drop error:", err);
    }
  }
});
