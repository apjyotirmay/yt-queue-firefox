const api = typeof browser !== "undefined" ? browser : chrome;

(function () {
  if (window.hasQueueExtContentScript) return;
  window.hasQueueExtContentScript = true;

  console.log("[QueueExt:Content] Script loaded on page.");

  function getMediaElement() {
    return document.querySelector("video");
  }

  function reportPlayerState() {
    const video = getMediaElement();
    if (!video) return;

    const isPlaying = !video.paused && !video.ended && video.readyState > 2;
    api.runtime.sendMessage({
      type: "PLAYER_STATE_CHANGED",
      isPlaying: isPlaying
    }).catch(() => {});
  }

  function handleCommand(command) {
    const video = getMediaElement();
    if (!video) return;

    if (command === "TOGGLE") {
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    } else if (command === "PLAY") {
      video.play().catch(() => {});
    } else if (command === "PAUSE") {
      video.pause();
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
          api.runtime.sendMessage({ type: "VIDEO_ENDED" }).catch(() => {});
        }
        reportPlayerState();
      });
    });

    reportPlayerState();
  }

  // Observer to capture dynamically inserted <video> tags on SPA navigation
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

  api.runtime.onMessage.addListener((message) => {
    if (message.command) {
      handleCommand(message.command);
    }
  });

  // Check state on init
  api.runtime.sendMessage({ action: "CHECK_PLAYBACK_STATE" }, (response) => {
    if (api.runtime.lastError) return;
    if (response && response.shouldPlay) {
      const video = getMediaElement();
      if (video && video.paused) {
        video.play().catch(() => {});
      }
    }
  });
})();
