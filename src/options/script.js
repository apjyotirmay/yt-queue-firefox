function loadActiveShortcuts() {
  if (!browser || !browser.commands || !browser.commands.getAll) {
    const kbdEl = document.getElementById("shortcut-add-queue");
    if (kbdEl) kbdEl.textContent = "Alt + Q"; // Fallback if API unavailable
    return;
  }

  browser.commands.getAll((commands) => {
    console.log("Registered Manifest Commands:", commands); // Check F12 console to inspect names

    // Finds either 'add-to-queue', '_execute_action', or falls back to the first custom command
    const targetCommand =
      commands.find((c) => c.name === "add-to-queue-hotkey") ||
      commands.find((c) => c.name !== "_execute_action") ||
      commands[0];

    const kbdEl = document.getElementById("shortcut-add-queue");
    if (kbdEl) {
      if (targetCommand && targetCommand.shortcut) {
        kbdEl.textContent = targetCommand.shortcut;
      } else if (targetCommand && !targetCommand.shortcut) {
        kbdEl.textContent = "Not set";
      } else {
        kbdEl.textContent = "Alt + Q";
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const importFileInput = document.getElementById("import-file-input");
  const storageModeSelect = document.getElementById("storage-mode-select");
  const statusMsg = document.getElementById("status-message");

  // Multi-browser runtime API selector
  const api = typeof browser !== "undefined" ? browser : chrome;

  // Load existing storage settings
  const settings = await browser.storage.local.get("storageMode");
  if (settings.storageMode) {
    storageModeSelect.value = settings.storageMode;
  }

  // Dynamically load version from manifest.json
  const manifestData = browser.runtime.getManifest();
  const versionElement = document.getElementById("version-badge");
  if (versionElement && manifestData.version) {
    // If you use "version_name" in manifest, it will prefer that over "version"
    const displayVersion = manifestData.version_name || manifestData.version;
    versionElement.textContent = `v${displayVersion}`;
  }

  const openShortcutsBtn = document.getElementById("open-shortcuts-btn");

  if (openShortcutsBtn) {
    openShortcutsBtn.addEventListener("click", () => {
      // const api = typeof browser !== "undefined" ? browser : chrome;

      // Determine correct URL scheme (Chrome vs Firefox)
      const isFirefox = typeof InstallTrigger !== "undefined" || navigator.userAgent.includes("Firefox");
      const shortcutsUrl = isFirefox ? "about:addons" : "chrome://extensions/shortcuts";

      browser.tabs.create({ url: shortcutsUrl });
    });
  }

  // Handle Storage Mode Switch
  storageModeSelect.addEventListener("change", async (e) => {
    const newMode = e.target.value;
    await browser.storage.local.set({ storageMode: newMode });
    showStatus("Storage mode updated successfully.", "success");
  });

  // --- Export Queue Data ---
  exportBtn.addEventListener("click", async () => {
    try {
      const data = await browser.storage.local.get(["queue", "playedQueue"]);
      const queue = data.queue || [];
      const playedQueue = data.playedQueue || [];

      if (queue.length === 0 && playedQueue.length === 0) {
        showStatus("Queue is empty. Nothing to export.", "error");
        return;
      }

      const backupObj = {
        version: 1,
        exportedAt: new Date().toISOString(),
        queue,
        playedQueue
      };

      const jsonString = JSON.stringify(backupObj, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const dateStr = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = url;
      link.download = `yt-queue-backup-${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showStatus("Queue exported successfully!", "success");
    } catch (err) {
      console.error(err);
      showStatus("Failed to export queue data.", "error");
    }
  });

  // --- Trigger File Dialog ---
  importBtn.addEventListener("click", () => {
    importFileInput.value = "";
    importFileInput.click();
  });

  // --- Import Queue Data ---
  importFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target.result);
        const importedQueue = Array.isArray(data.queue) ? data.queue : [];
        const importedPlayed = Array.isArray(data.playedQueue) ? data.playedQueue : [];

        const validImportedQueue = importedQueue.filter(isValidItem);
        const validImportedPlayed = importedPlayed.filter(isValidItem);

        if (validImportedQueue.length === 0 && validImportedPlayed.length === 0) {
          showStatus("Invalid file format or no valid videos found.", "error");
          return;
        }

        const choice = prompt(
          `Import Summary:\n` +
          `• Active Items: ${validImportedQueue.length}\n` +
          `• Played History: ${validImportedPlayed.length}\n\n` +
          `Type 'MERGE' to append to your current queue, or 'REPLACE' to overwrite completely:`,
          "MERGE"
        );

        if (!choice) return;

        const mode = choice.trim().toUpperCase();
        const currentData = await browser.storage.local.get(["queue", "playedQueue"]);
        let currentQueue = currentData.queue || [];
        let currentPlayed = currentData.playedQueue || [];

        if (mode === "REPLACE") {
          currentQueue = validImportedQueue;
          currentPlayed = validImportedPlayed;
        } else if (mode === "MERGE") {
          const existingQueueIds = new Set(currentQueue.map((item) => item.id));
          const existingPlayedIds = new Set(currentPlayed.map((item) => item.id));

          validImportedQueue.forEach((item) => {
            if (!existingQueueIds.has(item.id)) currentQueue.push(item);
          });
          validImportedPlayed.forEach((item) => {
            if (!existingPlayedIds.has(item.id)) currentPlayed.push(item);
          });
        } else {
          showStatus("Import canceled (invalid option specified).", "error");
          return;
        }

        // Write updated state to local storage
        await browser.storage.local.set({ queue: currentQueue, playedQueue: currentPlayed });

        // If Cloud Sync is active, sync up to cloud storage
        if (settings.storageMode === "sync" && browser.storage.sync) {
          await browser.storage.sync.set({ queue: currentQueue, playedQueue: currentPlayed });
        }

        showStatus(`Successfully imported data via ${mode}.`, "success");
      } catch (err) {
        console.error(err);
        showStatus("Error parsing JSON file.", "error");
      }
    };

    reader.readAsText(file);
  });

  function isValidItem(item) {
    return (
      typeof item === "object" &&
      item !== null &&
      typeof item.id === "string" &&
      item.id.trim().length > 0 &&
      typeof item.title === "string"
    );
  }

  function showStatus(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = `status-message ${type}`;
    setTimeout(() => {
      statusMsg.className = "status-message";
    }, 4000);
  }

  loadActiveShortcuts();
});
