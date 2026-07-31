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

  browser.runtime.onMessage.addListener((message) => {
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
