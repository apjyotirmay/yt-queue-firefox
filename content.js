let currentHoveredLink = null;

// 1. Track hovered YouTube video links
document.addEventListener("mouseover", (e) => {
  const link = e.target.closest('a[href*="watch?v="], a[href*="youtu.be/"]');
  currentHoveredLink = link ? link.href : null;
});

document.addEventListener("mouseout", (e) => {
  if (e.target.closest('a[href*="watch?v="], a[href*="youtu.be/"]')) {
    currentHoveredLink = null;
  }
});

// Helper: Extract YouTube Video ID
function getVideoId(urlStr) {
  try {
    const url = new URL(urlStr, window.location.origin);
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

// Helper: Show on-screen feedback
function showToast(message) {
  const existing = document.getElementById("yt-ext-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "yt-ext-toast";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #ff0000;
    color: #ffffff;
    padding: 10px 18px;
    border-radius: 6px;
    font-family: Roboto, Arial, sans-serif;
    font-size: 14px;
    font-weight: bold;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    z-index: 9999999;
    pointer-events: none;
    transition: opacity 0.2s ease;
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 200);
  }, 1200);
}

// 2. Alt + Click Handler
document.addEventListener(
  "click",
  (e) => {
    if (e.altKey) {
      const link = e.target.closest(
        'a[href*="watch?v="], a[href*="youtu.be/"]',
      );
      if (!link) return;

      e.preventDefault();
      e.stopPropagation();

      const videoId = getVideoId(link.href);
      if (videoId) {
        const card = link.closest(
          "ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-video-renderer",
        );
        let title = "";
        if (card) {
          const titleEl = card.querySelector("#video-title, #video-title-link");
          if (titleEl) title = titleEl.innerText.trim();
        }

        browser.runtime.sendMessage({
          type: "ADD_TO_QUEUE",
          video: { id: videoId, title, url: link.href },
        });

        showToast("✓ Added to Queue");
      }
    }
  },
  true,
);

// 3. Alt + Q Hotkey Handler
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "HOTKEY_TRIGGERED") {
    const targetUrl = currentHoveredLink || window.location.href;
    const videoId = getVideoId(targetUrl);

    if (videoId) {
      let title = "";
      if (!currentHoveredLink) {
        title = document.title.replace("- YouTube", "").trim();
      }

      browser.runtime.sendMessage({
        type: "ADD_TO_QUEUE",
        video: {
          id: videoId,
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
        },
      });

      showToast("✓ Added to Queue");
    }
  }
});

// Helper to broadcast actual video element state
function broadcastVideoState() {
  const video = document.querySelector("video");
  if (!video) return;

  const isPlaying = !video.paused && !video.ended;
  browser.runtime.sendMessage({ type: "PLAYER_STATE_CHANGED", isPlaying });
  browser.runtime.sendMessage({ type: "PLAYER_STATUS", isPlaying });
}

// 4. Video Player Event Monitoring & Status Sync
function attachVideoListeners() {
  const video = document.querySelector("video");
  if (!video || video.dataset.queueTracked) return;

  video.dataset.queueTracked = "true";

  // Sync state immediately upon attachment
  broadcastVideoState();

  // Listen for native player events (YouTube controls, keyboard spacebar, etc.)
  video.addEventListener("play", () => broadcastVideoState());
  video.addEventListener("playing", () => broadcastVideoState());
  video.addEventListener("pause", () => broadcastVideoState());

  // Track video end to auto-advance
  video.addEventListener("ended", async () => {
    broadcastVideoState();
    browser.runtime.sendMessage({ type: "VIDEO_ENDED" });
  });
}

// Observe YouTube SPA navigation changes
const observer = new MutationObserver(() => attachVideoListeners());
observer.observe(document.body, { childList: true, subtree: true });

// Listen to YouTube single-page navigation finished
document.addEventListener("yt-navigate-finish", () => {
  const video = document.querySelector("video");
  if (video) {
    delete video.dataset.queueTracked;
  }
  attachVideoListeners();
});

attachVideoListeners();

// Receive toggle commands directly from extension sidebar/background
browser.runtime.onMessage.addListener((msg) => {
  const video = document.querySelector("video");
  if (!video) return;

  if (msg.command === "TOGGLE") {
    if (video.paused) {
      video
        .play()
        .then(() => broadcastVideoState())
        .catch(console.error);
    } else {
      video.pause();
      broadcastVideoState();
    }
  }
});
