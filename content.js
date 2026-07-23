let currentHoveredLink = null;

// 1. Track hovered YouTube video links
document.addEventListener('mouseover', (e) => {
  const link = e.target.closest('a[href*="watch?v="], a[href*="youtu.be/"]');
  currentHoveredLink = link ? link.href : null;
});

document.addEventListener('mouseout', (e) => {
  if (e.target.closest('a[href*="watch?v="], a[href*="youtu.be/"]')) {
    currentHoveredLink = null;
  }
});

// Helper: Extract YouTube Video ID
function getVideoId(urlStr) {
  try {
    const url = new URL(urlStr, window.location.origin);
    if (url.hostname.includes('youtube.com')) {
      return url.searchParams.get('v');
    } else if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1);
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Helper: Show on-screen feedback
function showToast(message) {
  const existing = document.getElementById('yt-ext-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'yt-ext-toast';
  toast.textContent = message; // Safe text assignment
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
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 1200);
}

// 2. Alt + Click Handler
document.addEventListener('click', (e) => {
  if (e.altKey) {
    const link = e.target.closest('a[href*="watch?v="], a[href*="youtu.be/"]');
    if (!link) return;

    e.preventDefault();
    e.stopPropagation();

    const videoId = getVideoId(link.href);
    if (videoId) {
      // Extract title from surrounding card if available
      const card = link.closest('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-video-renderer');
      let title = '';
      if (card) {
        const titleEl = card.querySelector('#video-title, #video-title-link');
        if (titleEl) title = titleEl.innerText.trim();
      }

      browser.runtime.sendMessage({
        type: 'ADD_TO_QUEUE',
        video: { id: videoId, title, url: link.href }
      });

      showToast('✓ Added to Queue');
    }
  }
}, true);

// 3. Alt + Q Hotkey Handler
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'HOTKEY_TRIGGERED') {
    // Priority: Hovered link -> Current Page
    const targetUrl = currentHoveredLink || window.location.href;
    const videoId = getVideoId(targetUrl);

    if (videoId) {
      let title = '';
      if (!currentHoveredLink) {
        // If adding current page, grab document title
        title = document.title.replace('- YouTube', '').trim();
      }

      browser.runtime.sendMessage({
        type: 'ADD_TO_QUEUE',
        video: { id: videoId, title, url: `https://www.youtube.com/watch?v=${videoId}` }
      });

      showToast('✓ Added to Queue');
    }
  }
});

// Autoplay Listener
setInterval(async () => {
  const video = document.querySelector('video');
  if (video && video.ended) {
    const { autoplay, queue = [] } = await browser.storage.local.get(['autoplay', 'queue']);
    if (autoplay && queue.length > 0) {
      const nextVideo = queue.shift();
      await browser.storage.local.set({ queue });
      window.location.href = nextVideo.url;
    }
  }
}, 2000);
