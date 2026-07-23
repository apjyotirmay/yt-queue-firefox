const listEl = document.getElementById('queue-list');
const dropZone = document.getElementById('drop-zone');
const autoplayToggle = document.getElementById('autoplay-toggle');
const storageModeSelect = document.getElementById('storage-mode');

let queue = [];
let activeStorage = browser.storage.local;

async function getStorageEngine() {
  const settings = await browser.storage.local.get('storageMode');
  const mode = settings.storageMode || 'local';
  storageModeSelect.value = mode;
  return mode === 'sync' ? browser.storage.sync : browser.storage.local;
}

async function loadQueue() {
  activeStorage = await getStorageEngine();
  const data = await activeStorage.get(['queue', 'autoplay']);
  queue = data.queue || [];
  autoplayToggle.checked = !!data.autoplay;
  renderQueue();
}

browser.storage.onChanged.addListener(async () => {
  loadQueue();
});

storageModeSelect.addEventListener('change', async (e) => {
  const newMode = e.target.value;
  await browser.storage.local.set({ storageMode: newMode });
  const targetStorage = newMode === 'sync' ? browser.storage.sync : browser.storage.local;
  await targetStorage.set({ queue, autoplay: autoplayToggle.checked });
  loadQueue();
});

autoplayToggle.addEventListener('change', async (e) => {
  await activeStorage.set({ autoplay: e.target.checked });
});

function renderQueue() {
  // Safe clear without innerHTML
  while (listEl.firstChild) {
    listEl.removeChild(listEl.firstChild);
  }

  queue.forEach((item, index) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.index = index;

    // 1. Thumbnail Image
    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.src = item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
    img.alt = 'Thumbnail';
    img.addEventListener('click', () => playVideo(item.url));

    // 2. Info Container & Safe Title Text
    const infoDiv = document.createElement('div');
    infoDiv.className = 'info-container';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'title';
    titleSpan.title = item.title;
    titleSpan.textContent = item.title; // Safe text insertion
    titleSpan.addEventListener('click', () => playVideo(item.url));

    infoDiv.appendChild(titleSpan);

    // 3. Remove Button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.title = 'Remove video';
    removeBtn.textContent = '✕'; // Safe text insertion
    removeBtn.addEventListener('click', async () => {
      queue.splice(index, 1);
      await activeStorage.set({ queue });
    });

    // Assemble List Item
    li.appendChild(img);
    li.appendChild(infoDiv);
    li.appendChild(removeBtn);

    // Drag-and-Drop Handlers
    li.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', index));
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const toIdx = index;
      if (isNaN(fromIdx)) return;

      const [moved] = queue.splice(fromIdx, 1);
      queue.splice(toIdx, 0, moved);
      await activeStorage.set({ queue });
    });

    listEl.appendChild(li);
  });
}

function playVideo(url) {
  browser.tabs.create({ url });
}

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const link = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (link) {
    const match = link.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    if (match) {
      const videoId = match[1];
      browser.runtime.sendMessage({
        type: 'ADD_TO_QUEUE',
        video: { 
          id: videoId, 
          title: '', 
          url: `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        }
      });
    }
  }
});

loadQueue();
