// Helper to choose storage target
async function getStorageEngine() {
  const settings = await browser.storage.local.get('storageMode');
  return settings.storageMode === 'sync' ? browser.storage.sync : browser.storage.local;
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com')) {
      return parsed.searchParams.get('v');
    } else if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1);
    }
  } catch (e) {
    return null;
  }
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
    console.error("Failed to fetch title:", e);
  }
  return `Video (${videoId})`;
}

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "add-to-queue",
    title: "Add YouTube link to Queue",
    contexts: ["link"]
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
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    });
    
    await storage.set({ queue });
  }
});

browser.commands.onCommand.addListener(async (command) => {
  if (command === "add-to-queue-hotkey") {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      browser.tabs.sendMessage(tab.id, { type: 'HOTKEY_TRIGGERED' });
    }
  }
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'ADD_TO_QUEUE') {
    const storage = await getStorageEngine();
    let title = message.video.title;
    
    if (!title || title.startsWith("Video (")) {
      title = await fetchVideoTitle(message.video.id);
    }

    const { queue = [] } = await storage.get('queue');
    queue.push({ 
      id: message.video.id, 
      title, 
      url: message.video.url,
      thumbnail: `https://i.ytimg.com/vi/${message.video.id}/hqdefault.jpg`
    });
    
    await storage.set({ queue });
  }
});
