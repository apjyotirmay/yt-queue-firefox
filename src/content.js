(function () {
  if (window.hasQueueExtContentScript) return;
  window.hasQueueExtContentScript = true;

  console.log("[QueueExt:Content] Script loaded on page.");

  // --- Hotkeys & Hover Tracking ---
  let hoveredVideoId = null;

  function extractVideoId(urlStr) {
    try {
      const parsed = new URL(urlStr, window.location.origin);
      if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v");
      if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
    } catch (e) {}
    return null;
  }

  // Track currently hovered video link or thumbnail
  document.addEventListener("mouseover", (e) => {
    const linkEl = e.target.closest("a[href*='watch?v='], a[href*='/shorts/']");
    if (linkEl) {
      hoveredVideoId = extractVideoId(linkEl.href);
    } else {
      hoveredVideoId = null;
    }
  }, true);

  // Intercept Alt + Click on video links/thumbnails
  document.addEventListener("click", (e) => {
    if (!e.altKey) return;

    const linkEl = e.target.closest("a[href*='watch?v='], a[href*='/shorts/']");
    if (linkEl) {
      const videoId = extractVideoId(linkEl.href);
      if (videoId) {
        e.preventDefault();
        e.stopPropagation();

        // Extract title if available from DOM element
        const titleEl = linkEl.closest("#details, ytd-grid-video-renderer, ytd-rich-item-renderer")?.querySelector("#video-title");
        const title = titleEl ? titleEl.textContent.trim() : null;

        browser.runtime.sendMessage({
          type: "ADD_TO_QUEUE",
          video: {
            id: videoId,
            title: title,
            url: `https://www.youtube.com/watch?v=${videoId}`
          }
        }).catch(() => {});
      }
    }
  }, true);

  // Handle direct Alt+Q keydown inside the page
  document.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "q" || e.key === "Q")) {
      const targetId = hoveredVideoId || extractVideoId(window.location.href);
      if (targetId) {
        e.preventDefault();
        browser.runtime.sendMessage({
          type: "ADD_TO_QUEUE",
          video: {
            id: targetId,
            url: `https://www.youtube.com/watch?v=${targetId}`
          }
        }).catch(() => {});
      }
    }
  });

  function getMediaElement() {
    return document.querySelector("video");
  }

  function reportPlayerState() {
    const video = getMediaElement();
    if (!video) return;

    const isPlaying = !video.paused && !video.ended && video.readyState > 2;
    browser.runtime.sendMessage({
      type: "PLAYER_STATE_CHANGED",
      isPlaying: isPlaying
    }).catch(() => {});
  }

  function handleCommand(command) {
    const video = getMediaElement();
    if (!video) return;

    if (command === "TOGGLE") {
      if (video.paused) {
        video.play().then(() => reportPlayerState()).catch(() => {});
      } else {
        video.pause();
        reportPlayerState();
      }
    } else if (command === "PLAY") {
      video.play().catch(() => {});
      video.play().then(() => reportPlayerState()).catch(() => {});
    } else if (command === "PAUSE") {
      video.pause();
      reportPlayerState();
    }
  }

  function attachVideoListeners(video) {
    if (!video || video.dataset.queueExtBound) return;
    video.dataset.queueExtBound = "true";

    const events = ["play", "pause", "ended", "playing", "waiting"];
    events.forEach((evt) => {
      video.addEventListener(evt, () => {
        if (evt === "ended") {
          console.log("[QueueExt:Content] Video ended.");
          browser.runtime.sendMessage({ type: "VIDEO_ENDED" }).catch(() => {});
        }
        reportPlayerState();
      });
    });

    reportPlayerState();
  }

  const observer = new MutationObserver(() => {
    const video = getMediaElement();
    if (video) attachVideoListeners(video);
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  const initialVideo = getMediaElement();
  if (initialVideo) attachVideoListeners(initialVideo);

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle queries from background.js asking for the hovered/active video ID (for Alt+Q)
    if (message.command === "GET_HOVERED_OR_CURRENT_VIDEO") {
      const targetId = hoveredVideoId || extractVideoId(window.location.href);
      sendResponse({ videoId: targetId });
      return true; // Keep message channel open for async response
    }

    // Handle player controls (TOGGLE, PLAY, PAUSE)
    if (message.command) {
      handleCommand(message.command);
    }
  });

  // Check state on init using native async promises
  browser.runtime.sendMessage({ action: "CHECK_PLAYBACK_STATE" })
    .then((response) => {
      if (response && response.shouldPlay) {
        const video = getMediaElement();
        if (video && video.paused) {
          video.play().catch(() => {});
        }
      }
    })
    .catch(() => {});
})();
