commit 6d7fa104848a52ff9116931bfa92a400f56c51c2
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 16:58:48 2026 +0530

    added light/dark mode and improved UI

commit b757a655194acb1ce20da0032297ac3ca5088584
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 16:45:02 2026 +0530

    player controls are always visible

commit 35826be574e1fc3de935df945136c9c53db2b29b
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 16:27:48 2026 +0530

    added pin to toolbar and keyboard summon shortcut

commit 7b7c95ef46e6bb0c85d5e94d5ada31040cfa35e8
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 15:12:14 2026 +0530

    RELEASE 3.4.0

commit 1b385f12c920959025591fdbe099557b1db5c0a2
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 15:05:47 2026 +0530

    feat(sync): add cloud sync timestamp status and fetch-first safeguards
    
    - Add sync status UI under cloud sync toggle displaying relative time (e.g., "Synced 5m ago")
    - Implement 10s ticker interval to refresh relative timestamp dynamically
    - Introduce fetch-first guard before cloud writes to prevent overwriting remote queues with empty local state
    - Add video ID deduplication and append-merge strategy preserving local FIFO queue order
    - Implement write buffering for in-flight cloud operations to avoid race conditions
    - Update background script to use safeAddToQueue helper for context menu/hotkey additions

commit 4447e2625f3493c49756f34c4d012ab0c1f124e3
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 04:44:44 2026 +0530

    version 3.3

commit 56ce2ab18cae9a51691d2a07d616bc24818986ee
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 04:44:16 2026 +0530

    improve handling of duplicate entries

commit 95de856a4df10861561df4e37686ad6ce8c2b9e6
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 04:19:22 2026 +0530

    version 3.2

commit 21f09dff3f789d3af38fd411dc197078422a3fe4
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 04:18:57 2026 +0530

    added reorder visual hint

commit 19e563d4e6bf86404a7b8dd6f4fc2f828290025b
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 04:14:45 2026 +0530

    fixes link drag and drop

commit 71a3cbdf51eab784ac82d19b0182268050fdd685
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 04:12:36 2026 +0530

    improvement to queue handling logic

commit 6f97024e8efad532e2b588417ad19b135aed6d89
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Wed Jul 29 03:33:40 2026 +0530

    simplified settings UI
    
    bug fixes:
    - sync play button status intelligently

commit ca0d505d767c205d2a950cfc8d10c68d9f57256b
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Tue Jul 28 22:28:58 2026 +0530

    release: v3.0
    
    major features:
    - playback controll
    - queue autoplay behavior
    - new design

commit f8c98745b9b40eaf439633b86e0173879a2c2bf5
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Fri Jul 24 03:05:11 2026 +0530

    added play button, simplified language
    
    Improved UI:
    - simplified english for non-tech savvy people
    - added play and clear queue buttons
    - added option to keep videos in queue after playing

commit df92867c3be8a774bac40bba7d307311c6e1f0a6
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Fri Jul 24 02:42:08 2026 +0530

    version 2.2: first release

commit a16d4a06a7b262b7c584833f1849e19bad5857b2
Author: Apurv Jyotirmay <mail@jyotirmay.dev>
Date:   Sat Jul 25 03:42:18 2026 +0530

    Initial commit
