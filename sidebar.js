const listEl = document.getElementById('queue-list');
const playedListEl = document.getElementById('played-list');
const playedSection = document.getElementById('played-section');
const dropZone = document.getElementById('drop-zone');
const playBtn = document.getElementById('play-btn');
const clearBtn = document.getElementById('clear-btn');
const afterPlaySelect = document.getElementById('after-play-mode');
const storageModeSelect = document.getElementById('storage-mode');
const counterBadge = document.getElementById('queue-counter');

let queue = [];
let playedQueue = [];
let currentPlayingId = null;
let activeStorage = browser.storage.local;

async function getStorageEngine() {
  const settings = await browser.storage.local.get(['storageMode', 'afterPlay']);
  const mode = settings.storageMode || 'local';
  storageModeSelect.value = mode;
  afterPlaySelect.value = settings.afterPlay || 'remove';
  return mode === 'sync' ? browser.storage.sync : browser.storage.local;
}

async function loadQueue() {
  activeStorage = await getStorageEngine();
  const data = await activeStorage.get(['queue', 'playedQueue', 'currentPlayingId']);
  queue = data.queue || [];
  playedQueue = data.playedQueue || [];
  currentPlayingId = data.currentPlayingId || null;
  renderQueue();
}

browser.storage.onChanged.addListener(() => loadQueue());

storageModeSelect.addEventListener('change', async (e) => {
  const newMode = e.target.value;
  await browser.storage.local.set({ storageMode: newMode });
  const targetStorage = newMode === 'sync' ? browser.storage.sync : browser.storage.local;
  await targetStorage.set({ queue, playedQueue, currentPlayingId });
  loadQueue();
});

afterPlaySelect.addEventListener('change', async (e) => {
  await browser.storage.local.set({ afterPlay: e.target.value });
});

// 1. Play Queue
playBtn.addEventListener('click', () => {
  if (queue.length > 0) {
    playVideo(queue[0]);
  }
});

// 2. Clear Queue with Confirmation
clearBtn.addEventListener('click', async () => {
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
  while (playedListEl.firstChild) playedListEl.removeChild(playedListEl.firstChild);

  // 5. Update Queue Counter (e.g., 2/5)
  const total = queue.length + playedQueue.length;
  let activeIndex = queue.findIndex(item => item.id === currentPlayingId);
  
  if (activeIndex !== -1) {
    counterBadge.textContent = `${playedQueue.length + activeIndex + 1}/${total}`;
  } else if (playedQueue.some(item => item.id === currentPlayingId)) {
    const pIdx = playedQueue.findIndex(item => item.id === currentPlayingId);
    counterBadge.textContent = `${pIdx + 1}/${total}`;
  } else {
    counterBadge.textContent = total > 0 ? `0/${total}` : `0/0`;
  }

  // Render "Up Next" Queue
  queue.forEach((item, index) => {
    const li = createVideoItem(item, index, false);
    listEl.appendChild(li);
  });

  // 3. Render "Played" Section if items exist
  if (afterPlaySelect.value === 'keep' && playedQueue.length > 0) {
    playedSection.style.display = 'block';
    playedQueue.forEach((item, index) => {
      const li = createVideoItem(item, index, true);
      playedListEl.appendChild(li);
    });
  } else {
    playedSection.style.display = 'none';
  }
}

function createVideoItem(item, index, isPlayed) {
  const li = document.createElement('li');
  li.draggable = !isPlayed;
  li.dataset.index = index;

  // 4. Highlight currently playing video
  if (item.id === currentPlayingId) {
    li.classList.add('playing');
  }
  if (isPlayed) {
    li.classList.add('played-item');
  }

  const img = document.createElement('img');
  img.className = 'thumb-img';
  img.src = item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
  img.addEventListener('click', () => playVideo(item));

  const infoDiv = document.createElement('div');
  infoDiv.className = 'info-container';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'title';
  titleSpan.title = item.title || 'YouTube Video';
  titleSpan.textContent = item.title || 'YouTube Video';
  titleSpan.addEventListener('click', () => playVideo(item));

  infoDiv.appendChild(titleSpan);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', async () => {
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

  if (!isPlayed) {
    li.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', index));
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (isNaN(fromIdx)) return;

      const [moved] = queue.splice(fromIdx, 1);
      queue.splice(index, 0, moved);
      await activeStorage.set({ queue });
      renderQueue();
    });
  }

  return li;
}

async function playVideo(item) {
  currentPlayingId = item.id;

  const afterPlayMode = (await browser.storage.local.get('afterPlay')).afterPlay || 'remove';

  if (afterPlayMode === 'keep') {
    // 3. Move video to Played section
    const qIndex = queue.findIndex(i => i.id === item.id);
    if (qIndex !== -1) {
      const [played] = queue.splice(qIndex, 1);
      playedQueue.push(played);
    }
  } else {
    // Pop video out of queue
    queue = queue.filter(i => i.id !== item.id);
  }

  await activeStorage.set({ queue, playedQueue, currentPlayingId });
  browser.tabs.create({ url: item.url });
}

loadQueue();
