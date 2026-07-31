console.log("[QueueExt:Background] Background script initialized.");

// Panel/Sidebar Initialization
if (browser.sidePanel?.setPanelBehavior) {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} else if (browser.sidebarAction) {
  browser.action?.onClicked.addListener(() => browser.sidebarAction.toggle());
}

async function getStorageEngine() {
  const settings = await browser.storage.local.get("storageMode");
  return settings.storageMode === "sync" ? browser.storage.sync : browser.storage.local;
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

async function notifyVideoAdded(messageText = "✓ Added to Queue") {
  // 1. Send to sidebar/popup runtime (safely catch if sidebar is closed)
  browser.runtime.sendMessage({ type: "SHOW_TOAST", message: messageText }).catch(() => {});

  // 2. Send to active tab's content script (safely catch if page isn't ready)
  try {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      browser.tabs.sendMessage(activeTab.id, { type: "SHOW_TOAST", message: messageText }).catch(() => {});
    }
  } catch (e) {
    // Suppress tab query failures
  }
}

async function safeAddToQueue(videoToAdd) {
  console.log("[QueueExt:Background] safeAddToQueue called with:", videoToAdd);
  if (!videoToAdd || !videoToAdd.id) return;

  const videoId = String(videoToAdd.id).trim();
  const settings = await browser.storage.local.get("storageMode");
  const isSync = settings.storageMode === "sync";

  const normalizedVideo = {
    id: videoId,
    title: videoToAdd.title || "YouTube Video",
    url: videoToAdd.url || `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: videoToAdd.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };

  let localData = await browser.storage.local.get(["queue", "playedQueue"]);
  let currentQueue = localData.queue || [];
  let playedQueue = localData.playedQueue || [];

  // Check if video exists in played history and restore it if needed
  const playedIdx = playedQueue.findIndex((item) => String(item.id).trim() === videoId);
  let statusToast = "✓ Added to Queue";

  if (playedIdx !== -1) {
    const [restored] = playedQueue.splice(playedIdx, 1);
    currentQueue.push({ ...restored, ...normalizedVideo });
    statusToast = "Restored video from played history";
  } else {
    const existingIndex = currentQueue.findIndex((i) => String(i.id).trim() === videoId);

    if (existingIndex !== -1) {
      currentQueue[existingIndex] = { ...currentQueue[existingIndex], ...normalizedVideo };
      statusToast = "Video already in queue";
    } else {
      currentQueue.push(normalizedVideo);
    }
  }

  await browser.storage.local.set({ queue: currentQueue, playedQueue });

  if (isSync && browser.storage.sync) {
    const compressedSyncQueue = currentQueue.map((item) => ({ id: item.id, title: item.title }));
    await browser.storage.sync.set({ queue: compressedSyncQueue, playedQueue }).catch(() => {});
  }

  console.log("[QueueExt:Background] Updated queue count:", currentQueue.length);
  await notifyVideoAdded(statusToast);
}

async function loadInPlayerTab(url, active = true) {
  if (!url) {
    console.error("[QueueExt:Background] Aborting: loadInPlayerTab received an invalid or undefined URL!");
    return null;
  }

  console.log("[QueueExt:Background] loadInPlayerTab target URL:", url, "active:", active);
  let { playerTabId } = await browser.storage.local.get("playerTabId");

  if (playerTabId) {
    try {
      const tab = await browser.tabs.get(playerTabId);
      if (tab) {
        console.log("[QueueExt:Background] Found existing tab ID", playerTabId, "- updating URL.");
        await browser.tabs.update(playerTabId, { url, active });
        return playerTabId;
      }
    } catch (e) {
      console.warn("[QueueExt:Background] Stored tab ID no longer valid, resetting.");
      await browser.storage.local.set({ playerTabId: null });
    }
  }

  console.log("[QueueExt:Background] Creating NEW player tab for:", url);
  const newTab = await browser.tabs.create({ url, active });
  console.log("[QueueExt:Background] New tab created with ID:", newTab.id);
  await browser.storage.local.set({ playerTabId: newTab.id });
  return newTab.id;
}

browser.tabs.onRemoved.addListener(async (tabId) => {
  const { playerTabId } = await browser.storage.local.get("playerTabId");
  if (tabId === playerTabId) {
    console.log("[QueueExt:Background] Player tab closed by user.");
    const activeStorage = await getStorageEngine();
    await browser.storage.local.set({ playerTabId: null, isPlaying: false });
    await activeStorage.set({ isPlaying: false });
  }
});

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "add-to-queue",
    title: "Add YouTube link to Queue",
    contexts: ["link"],
  });

  if (details.reason === "install") {
    // Opens options/index.html when the extension is installed for the first time
    if (browser.runtime.openOptionsPage) {
      browser.runtime.openOptionsPage();
    } else {
      browser.tabs.create({ url: browser.runtime.getURL("options/index.html") });
    }
  }
});

browser.contextMenus.onClicked.addListener(async (info) => {
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

// Clean async runtime.onMessage using native Promise returns
browser.runtime.onMessage.addListener((message, sender) => {
  console.log("[QueueExt:Background] Received message:", message, "from sender:", sender?.tab ? `Tab ${sender.tab.id}` : "Sidebar/Popup");

  if (message.action === "CHECK_PLAYBACK_STATE") {
    return browser.storage.local.get("isPlaying").then(({ isPlaying }) => ({
      shouldPlay: !!isPlaying,
    }));
  }

  return (async () => {
    try {
      const activeStorage = await getStorageEngine();

      switch (message.type) {
        case "PLAY_VIDEO": {
          const targetUrl = message.url || (message.id ? `https://www.youtube.com/watch?v=${message.id}` : null);
          if (!targetUrl) break;

          const shouldFocus = message.focus !== undefined ? message.focus : true;
          await activeStorage.set({ isPlaying: true });
          await browser.storage.local.set({ isPlaying: true });
          await loadInPlayerTab(targetUrl, shouldFocus);
          break;
        }

        case "CONTROL_PLAYER": {
          let { playerTabId } = await browser.storage.local.get("playerTabId");
          let tabExists = false;

          if (playerTabId) {
            try {
              const tab = await browser.tabs.get(playerTabId);
              if (tab) {
                tabExists = true;
                browser.tabs.sendMessage(playerTabId, { command: message.command }).catch((err) => {
                  console.error("[QueueExt:Background] Error sending message to player tab:", err);
                });
              }
            } catch (e) {
              await browser.storage.local.set({ playerTabId: null });
            }
          }

          if (!tabExists) {
            const localData = await browser.storage.local.get(["queue", "currentPlayingId"]);
            const queue = localData.queue || [];
            const targetVideo = queue.find((i) => i.id === localData.currentPlayingId) || queue[0];

            if (targetVideo) {
              const videoUrl = targetVideo.url || `https://www.youtube.com/watch?v=${targetVideo.id}`;
              await activeStorage.set({ isPlaying: true, currentPlayingId: targetVideo.id });
              await browser.storage.local.set({ isPlaying: true });
              await loadInPlayerTab(videoUrl, true);
            }
          }
          break;
        }

        case "VIDEO_ENDED": {
          const data = await activeStorage.get(["queue", "playedQueue", "autoplay", "currentPlayingId"]);
          let queue = data.queue || [];
          let playedQueue = data.playedQueue || [];
          const afterPlayMode = (await browser.storage.local.get("afterPlay")).afterPlay || "remove";

          if (queue.length > 0) {
            const activeIdx = queue.findIndex((i) => i.id === data.currentPlayingId);
            const finishedVideo = activeIdx !== -1 ? queue.splice(activeIdx, 1)[0] : queue.shift();

            if (afterPlayMode === "keep" && finishedVideo) playedQueue.push(finishedVideo);

            if (data.autoplay !== false && queue.length > 0) {
              const nextVideo = queue[0];
              const nextUrl = nextVideo.url || `https://www.youtube.com/watch?v=${nextVideo.id}`;
              await activeStorage.set({ queue, playedQueue, currentPlayingId: nextVideo.id, isPlaying: true });
              await browser.storage.local.set({ isPlaying: true });
              await loadInPlayerTab(nextUrl, false);
            } else {
              await activeStorage.set({ queue, playedQueue, currentPlayingId: null, isPlaying: false });
              await browser.storage.local.set({ isPlaying: false });
            }
          }
          break;
        }

        case "PLAYER_STATUS":
        case "PLAYER_STATE_CHANGED": {
          if (message.isPlaying !== undefined) {
            await activeStorage.set({ isPlaying: message.isPlaying });
            await browser.storage.local.set({ isPlaying: message.isPlaying });

            // Notify sidebar/popup runtime listeners directly
            browser.runtime.sendMessage({
              type: "PLAYER_STATE_CHANGED",
              isPlaying: message.isPlaying
            }).catch(() => {});
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
});

// Hotkey Command Listener (Alt+Q)
browser.commands.onCommand.addListener(async (command) => {
  if (command === "add-to-queue-hotkey") {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id || !activeTab.url?.includes("youtube.com")) return;

    try {
      // Ask content script for hovered video or current page video
      const response = await browser.tabs.sendMessage(activeTab.id, { command: "GET_HOVERED_OR_CURRENT_VIDEO" });
      const videoId = response?.videoId || extractVideoId(activeTab.url);

      if (videoId) {
        const title = await fetchVideoTitle(videoId);
        await safeAddToQueue({
          id: videoId,
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        });
      }
    } catch (e) {
      // Fallback: If content script doesn't respond, add current active tab URL
      const videoId = extractVideoId(activeTab.url);
      if (videoId) {
        const title = await fetchVideoTitle(videoId);
        await safeAddToQueue({
          id: videoId,
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        });
      }
    }
  }
});
