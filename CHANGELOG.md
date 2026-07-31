# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.6.1] &ndash; July 31, 2026

### Fixes & Improvements

* Fixed Chrome notifications

## [3.6.0] &ndash; July 31, 2026

### New Features

* **Dedicated "Clear Played" Option:** Added a targeted clear button inside the Played section header to wipe watch history independently, while keeping the main clear button focused on full queue resets.

### Fixes & Improvements

* **Cross-Browser API Standardization:** Migrated extension calls from `chrome.*` to standard webextension `browser.*` APIs for improved Firefox compatibility.
* **Player UI State Sync:** Resolved an issue in Firefox where the play/pause button UI state wasn't updating properly during active playback.
* **Toast Notification Restoration:** Restored missing notification toasts across background and content scripts to ensure visual confirmation when queueing videos.
* **Hotkey Functionality:** Restored keyboard shortcut handlers (`Alt+Q` / `Alt+Click`) for quick video queueing from active YouTube tabs.


## [3.5.2] &ndash; 2026-07-31
- Fix: Firefox playback button

## [3.5.1] &ndash; 2026-07-31
- Ported to Google Chrome
- Optimized storage for sync - increases queue size
- Fixes conflict on cloud sync with local queue

## [3.5.0] &ndash; 2026-07-29

### Added
- Light/Dark mode support[cite: 3].
- Pin to toolbar support and keyboard summon shortcut[cite: 3].

### Improved
- General UI enhancements[cite: 3].
- Player controls are now pinned to be always visible[cite: 3].

## [3.4.0] &ndash; 2026-07-29

### Added
- Cloud sync status indicator under the sync toggle displaying relative time (e.g., "Synced 5m ago").
- 10-second ticker interval to automatically refresh the sync relative timestamp.
- Fetch-first safeguards before cloud writes to prevent overwriting remote queues with empty local state.
- Video ID deduplication and append-merge strategy preserving local FIFO queue priority.
- In-flight write buffering for cloud operations to prevent race conditions during network round-trips.

### Changed
- Updated background script to route context menu and hotkey additions through `safeAddToQueue`.

---

## [3.3.0] &ndash; 2026-07-29

### Improved
- Handling of duplicate video entries across queue mutations.

---

## [3.2.0] &ndash; 2026-07-29

### Added
- Visual drag-and-drop indicators/hints for queue reordering.

### Fixed
- Link drag-and-drop functionality within the sidebar list.

### Improved
- Overall internal queue state handling and management logic.
- Simplified settings UI layout.
- Play button status sync across background and content states.

---

## [3.0.0] &ndash; 2026-07-28

### Added
- Integrated player controls directly inside the extension sidebar.
- Automated queue autoplay behavior between videos.
- Complete visual UI and layout redesign.

---

## [2.2.0] &ndash; 2026-07-24

### Added
- Dedicated Play and Clear Queue action buttons.
- Option to retain or automatically clear videos after playback finishes.

### Improved
- Simplified user interface copy and messaging for better usability.

---

## [1.0.0] &ndash; 2026-07-25

### Added
- Initial release.
