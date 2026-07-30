const api = typeof browser !== "undefined" ? browser : chrome;
console.log("[QueueExt:Background] Background script initialized.");

// Panel/Sidebar Initialization
if (api.sidePanel && api.sidePanel.setPanelBehavior) {
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} else if (api.sidebarAction) {
  api.action?.onClicked.addListener(() => api.sidebarAction.toggle());
}

async function getStorageEngine() {
  const settings = await api.storage.local.get("storageMode");
  return settings.storageMode === "sync" ? api.storage.sync : api.storage.local;
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v");
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
  } catch (e) {}
  return null;
}

async function fetchVideoTitle(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (res.ok) {
      const data = await res.json();
      return data.title;
    }
  } catch (e) {
    console.error("[QueueExt:Background] Failed to fetch title:", e);
  }
  return `Video (${videoId})`;
}

async function safeAddToQueue(videoToAdd) {
  console.log("[QueueExt:Background] safeAddToQueue called with:", videoToAdd);
  const settings = await api.storage.local.get("storageMode");
  const isSync = settings.storageMode === "sync";

  const normalizedVideo = {
    ...videoToAdd,
    url: videoToAdd.url || `https://www.youtube.com/watch?v=${videoToAdd.id}`,
    thumbnail: videoToAdd.thumbnail || `https://i.ytimg.com/vi/${videoToAdd.id}/hqdefault.jpg`,
  };

  let currentQueue = [];
  if (isSync) {
    const cloudData = await api.storage.sync.get(["queue"]);
    const localData = await api.storage.local.get(["queue"]);
    const remoteQueue = cloudData.queue || [];
    const localQueue = localData.queue || [];
    const localIds = new Set(localQueue.map((item) => item.id));
    const newRemoteQueue = remoteQueue.filter((item) => !localIds.has(item.id));
    currentQueue = [...localQueue, ...newRemoteQueue];
  } else {
    const localData = await api.storage.local.get("queue");
    currentQueue = localData.queue || [];
  }

  const existingIndex = currentQueue.findIndex((i) => i.id === normalizedVideo.id);
  if (existingIndex !== -1) {
    currentQueue[existingIndex] = { ...currentQueue[existingIndex], ...normalizedVideo };
  } else {
    currentQueue.push(normalizedVideo);
  }

  await api.storage.local.set({ queue: currentQueue });
  if (isSync) {
    const compressedSyncQueue = currentQueue.map((item) => ({ id: item.id, title: item.title }));
    await api.storage.sync.set({ queue: compressedSyncQueue });
  }
  console.log("[QueueExt:Background] Updated queue count:", currentQueue.length);
}

async function loadInPlayerTab(url, active = true) {
  if (!url) {
    console.error("[QueueExt:Background] Aborting: loadInPlayerTab received an invalid or undefined URL!");
    return null;
  }

  console.log("[QueueExt:Background] loadInPlayerTab target URL:", url, "active:", active);
  let { playerTabId } = await api.storage.local.get("playerTabId");

  if (playerTabId) {
    try {
      const tab = await api.tabs.get(playerTabId);
      if (tab) {
        console.log("[QueueExt:Background] Found existing tab ID", playerTabId, "- updating URL.");
        await api.tabs.update(playerTabId, { url, active });
        return playerTabId;
      }
    } catch (e) {
      console.warn("[QueueExt:Background] Stored tab ID no longer valid, resetting.");
      await api.storage.local.set({ playerTabId: null });
    }
  }

  console.log("[QueueExt:Background] Creating NEW player tab for:", url);
  const newTab = await api.tabs.create({ url, active });
  console.log("[QueueExt:Background] New tab created with ID:", newTab.id);
  await api.storage.local.set({ playerTabId: newTab.id });
  return newTab.id;
}

api.tabs.onRemoved.addListener(async (tabId) => {
  const { playerTabId } = await api.storage.local.get("playerTabId");
  if (tabId === playerTabId) {
    console.log("[QueueExt:Background] Player tab closed by user.");
    const activeStorage = await getStorageEngine();
    await api.storage.local.set({ playerTabId: null, isPlaying: false });
    await activeStorage.set({ isPlaying: false });
  }
});

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: "add-to-queue",
    title: "Add YouTube link to Queue",
    contexts: ["link"],
  });
});

api.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "add-to-queue" && info.linkUrl) {
    const videoId = extractVideoId(info.linkUrl);
    if (!videoId) return;

    const title = await fetchVideoTitle(videoId);
    await safeAddToQueue({
      id: videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  }
});

// NON-ASYNC top-level listener to prevent Firefox promise scoping issues
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[QueueExt:Background] Received message:", message, "from sender:", sender?.tab ? `Tab ${sender.tab.id}` : "Sidebar/Popup");

  if (message.action === "CHECK_PLAYBACK_STATE") {
    api.storage.local.get("isPlaying").then(({ isPlaying }) => {
      sendResponse({ shouldPlay: !!isPlaying });
    });
    return true; // Keep message channel open asynchronously ONLY for this action
  }

  (async () => {
    try {
      const activeStorage = await getStorageEngine();

      switch (message.type) {
        case "PLAY_VIDEO": {
          const targetUrl = message.url || (message.id ? `https://www.youtube.com/watch?v=${message.id}` : null);
          console.log("[QueueExt:Background] Action PLAY_VIDEO triggered for URL:", targetUrl);
          if (!targetUrl) break;

          const shouldFocus = message.focus !== undefined ? message.focus : true;
          await activeStorage.set({ isPlaying: true });
          await api.storage.local.set({ isPlaying: true });
          await loadInPlayerTab(targetUrl, shouldFocus);
          break;
        }

        case "CONTROL_PLAYER": {
          console.log("[QueueExt:Background] Action CONTROL_PLAYER command:", message.command);
          let { playerTabId } = await api.storage.local.get("playerTabId");
          let tabExists = false;

          if (playerTabId) {
            try {
              const tab = await api.tabs.get(playerTabId);
              if (tab) {
                tabExists = true;
                api.tabs.sendMessage(playerTabId, { command: message.command }).catch((err) => {
                  console.error("[QueueExt:Background] Error sending message to player tab:", err);
                });
              }
            } catch (e) {
              await api.storage.local.set({ playerTabId: null });
            }
          }

          if (!tabExists) {
            console.log("[QueueExt:Background] No player tab exists. Launching target video from queue...");
            const localData = await api.storage.local.get(["queue", "currentPlayingId"]);
            const queue = localData.queue || [];
            const targetVideo = queue.find((i) => i.id === localData.currentPlayingId) || queue[0];

            if (targetVideo) {
              const videoUrl = targetVideo.url || `https://www.youtube.com/watch?v=${targetVideo.id}`;
              await activeStorage.set({ isPlaying: true, currentPlayingId: targetVideo.id });
              await api.storage.local.set({ isPlaying: true });
              await loadInPlayerTab(videoUrl, true);
            } else {
              console.warn("[QueueExt:Background] Queue is empty, cannot launch video.");
            }
          }
          break;
        }

        case "VIDEO_ENDED": {
          console.log("[QueueExt:Background] Action VIDEO_ENDED received.");
          const data = await activeStorage.get(["queue", "playedQueue", "autoplay", "currentPlayingId"]);
          let queue = data.queue || [];
          let playedQueue = data.playedQueue || [];
          const afterPlayMode = (await api.storage.local.get("afterPlay")).afterPlay || "remove";

          if (queue.length > 0) {
            const activeIdx = queue.findIndex((i) => i.id === data.currentPlayingId);
            const finishedVideo = activeIdx !== -1 ? queue.splice(activeIdx, 1)[0] : queue.shift();

            if (afterPlayMode === "keep" && finishedVideo) playedQueue.push(finishedVideo);

            if (data.autoplay !== false && queue.length > 0) {
              const nextVideo = queue[0];
              const nextUrl = nextVideo.url || `https://www.youtube.com/watch?v=${nextVideo.id}`;
              console.log("[QueueExt:Background] Autoplaying next video:", nextVideo);
              await activeStorage.set({ queue, playedQueue, currentPlayingId: nextVideo.id, isPlaying: true });
              await api.storage.local.set({ isPlaying: true });
              await loadInPlayerTab(nextUrl, false);
            } else {
              console.log("[QueueExt:Background] Queue finished or Autoplay disabled.");
              await activeStorage.set({ queue, playedQueue, currentPlayingId: null, isPlaying: false });
              await api.storage.local.set({ isPlaying: false });
            }
          }
          break;
        }

        case "PLAYER_STATUS":
        case "PLAYER_STATE_CHANGED": {
          if (message.isPlaying !== undefined) {
            await activeStorage.set({ isPlaying: message.isPlaying });
            await api.storage.local.set({ isPlaying: message.isPlaying });
          }
          break;
        }

        case "ADD_TO_QUEUE": {
          let title = message.video.title;
          if (!title || title.startsWith("Video (")) {
            title = await fetchVideoTitle(message.video.id);
          }
          await safeAddToQueue({
            id: message.video.id,
            title,
            url: message.video.url || `https://www.youtube.com/watch?v=${message.video.id}`,
            thumbnail: `https://i.ytimg.com/vi/${message.video.id}/hqdefault.jpg`,
          });
          break;
        }
      }
    } catch (err) {
      console.error("[QueueExt:Background] Error processing runtime message:", err);
    }
  })();

  return false; // Tells Firefox no sendResponse promise is expected
});
