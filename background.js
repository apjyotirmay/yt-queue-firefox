// Helper to choose storage target
async function getStorageEngine() {
  const settings = await browser.storage.local.get("storageMode");
  return settings.storageMode === "sync"
    ? browser.storage.sync
    : browser.storage.local;
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      return parsed.searchParams.get("v");
    } else if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1);
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function fetchVideoTitle(videoId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    );
    if (res.ok) {
      const data = await res.json();
      return data.title;
    }
  } catch (e) {
    console.error("Failed to fetch title:", e);
  }
  return `Video (${videoId})`;
}

// Track tab closure to reset playerTabId cleanly in storage
browser.tabs.onRemoved.addListener(async (tabId) => {
  const { playerTabId } = await browser.storage.local.get("playerTabId");
  if (tabId === playerTabId) {
    await browser.storage.local.set({ playerTabId: null });
  }
});

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "add-to-queue",
    title: "Add YouTube link to Queue",
    contexts: ["link"],
  });
});

browser.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "add-to-queue" && info.linkUrl) {
    const videoId = extractVideoId(info.linkUrl);
    if (!videoId) return;

    const storage = await getStorageEngine();
    const title = await fetchVideoTitle(videoId);
    const { queue = [] } = await storage.get("queue");

    queue.push({
      id: videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });

    await storage.set({ queue });
  }
});

browser.commands.onCommand.addListener(async (command) => {
  if (command === "add-to-queue-hotkey") {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab && tab.id) {
      browser.tabs.sendMessage(tab.id, { type: "HOTKEY_TRIGGERED" });
    }
  }
});

// Update active video ID in storage when the player tab navigates to a video
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const { playerTabId } = await browser.storage.local.get("playerTabId");
  if (
    tabId === playerTabId &&
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.includes("youtube.com/watch")
  ) {
    const match = tab.url.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    if (match) {
      const activeId = match[1];
      const storage = await getStorageEngine();
      await storage.set({ currentPlayingId: activeId });
    }
  }
});

browser.runtime.onMessage.addListener(async (message) => {
  const activeStorage = await getStorageEngine();

  async function loadInPlayerTab(url, active = true) {
    let tabExists = false;
    let { playerTabId } = await browser.storage.local.get("playerTabId");

    if (playerTabId) {
      try {
        await browser.tabs.get(playerTabId);
        await browser.tabs.update(playerTabId, { url, active });
        tabExists = true;
      } catch (e) {
        playerTabId = null;
        await browser.storage.local.set({ playerTabId: null });
      }
    }

    if (!tabExists) {
      const tab = await browser.tabs.create({ url, active });
      await browser.storage.local.set({ playerTabId: tab.id });
    }
  }

  // 1. PLAY_VIDEO: Triggered by clicking an item
  if (message.type === "PLAY_VIDEO") {
    const shouldFocus = message.focus !== undefined ? message.focus : true;
    await loadInPlayerTab(message.url, shouldFocus);
  }

  // 2. CONTROL_PLAYER: Send play/pause toggle command directly to video
  if (message.type === "CONTROL_PLAYER") {
    let tabExists = false;
    let { playerTabId } = await browser.storage.local.get("playerTabId");

    if (playerTabId) {
      try {
        await browser.tabs.get(playerTabId);
        await browser.tabs.sendMessage(playerTabId, {
          command: message.command,
        });
        tabExists = true;
      } catch (e) {
        await browser.storage.local.set({ playerTabId: null });
      }
    }

    // Fallback if no player tab exists
    if (!tabExists) {
      const data = await activeStorage.get(["queue", "currentPlayingId"]);
      const queue = data.queue || [];
      const targetVideo =
        queue.find((i) => i.id === data.currentPlayingId) || queue[0];

      if (targetVideo) {
        await loadInPlayerTab(targetVideo.url);
        await activeStorage.set({
          isPlaying: true,
          currentPlayingId: targetVideo.id,
        });
      }
    }
  }

  // 3. VIDEO_ENDED: Automatically advance to next video
  if (message.type === "VIDEO_ENDED") {
    const data = await activeStorage.get([
      "queue",
      "playedQueue",
      "autoplay",
      "currentPlayingId",
    ]);
    const isAutoplayEnabled = data.autoplay !== false;

    let queue = data.queue || [];
    let playedQueue = data.playedQueue || [];
    const afterPlayMode =
      (await browser.storage.local.get("afterPlay")).afterPlay || "remove";

    if (queue.length > 0) {
      const activeIdx = queue.findIndex((i) => i.id === data.currentPlayingId);
      const finishedVideo =
        activeIdx !== -1 ? queue.splice(activeIdx, 1)[0] : queue.shift();

      if (afterPlayMode === "keep" && finishedVideo) {
        playedQueue.push(finishedVideo);
      }

      if (isAutoplayEnabled && queue.length > 0) {
        const nextVideo = queue[0];
        await activeStorage.set({
          queue,
          playedQueue,
          currentPlayingId: nextVideo.id,
          isPlaying: true,
        });

        await loadInPlayerTab(nextVideo.url, false);
      } else {
        await activeStorage.set({
          queue,
          playedQueue,
          currentPlayingId: null,
          isPlaying: false,
        });
      }
    }
  }

  // 4. PLAYER_STATUS & PLAYER_STATE_CHANGED: Save state from content script
  if (
    message.type === "PLAYER_STATUS" ||
    message.type === "PLAYER_STATE_CHANGED"
  ) {
    if (message.isPlaying !== undefined) {
      await activeStorage.set({ isPlaying: message.isPlaying });
    }
  }

  if (message.type === "ADD_TO_QUEUE") {
    const storage = await getStorageEngine();
    let title = message.video.title;
    if (!title || title.startsWith("Video (")) {
      title = await fetchVideoTitle(message.video.id);
    }
    const { queue = [] } = await storage.get("queue");
    queue.push({
      id: message.video.id,
      title,
      url: message.video.url,
      thumbnail: `https://i.ytimg.com/vi/${message.video.id}/hqdefault.jpg`,
    });
    await storage.set({ queue });
  }
});
