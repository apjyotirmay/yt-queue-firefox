const fs = require('fs-extra') ? require('fs-extra') : require('fs');
const path = require('path');
const archiver = require('archiver');

const SRC_DIR = path.join(__dirname, '..', 'src');
const DIST_DIR = path.join(__dirname, '..', 'dist');

// Read common manifest template
const commonManifest = JSON.parse(
  fs.readFileSync(path.join(SRC_DIR, 'manifest.common.json'), 'utf8')
);

// Helper to recursively copy directories using native Node.js API
function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Helper to zip output folders
function zipDirectory(sourceDir, outPath) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = fs.createWriteStream(outPath);

  return new Promise((resolve, reject) => {
    archive
      .directory(sourceDir, false)
      .on('error', (err) => reject(err))
      .pipe(stream);

    stream.on('close', () => resolve());
    archive.finalize();
  });
}

async function build() {
  console.log('🧹 Cleaning previous builds...');
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const targets = ['chrome', 'firefox'];

  for (const target of targets) {
    const targetDir = path.join(DIST_DIR, target);
    console.log(`📦 Building for ${target.toUpperCase()}...`);

    // Copy all source files (excluding manifest.common.json)
    fs.mkdirSync(targetDir, { recursive: true });
    fs.readdirSync(SRC_DIR).forEach((file) => {
      if (file !== 'manifest.common.json') {
        copyRecursiveSync(path.join(SRC_DIR, file), path.join(targetDir, file));
      }
    });

    // Build specific manifest.json
    let targetManifest = JSON.parse(JSON.stringify(commonManifest));

    if (target === 'chrome') {
      targetManifest.background = { service_worker: 'background.js' };
      targetManifest.permissions.push('sidePanel');
      targetManifest.side_panel = { default_path: 'sidebar.html' };
    } else if (target === 'firefox') {
      targetManifest.background = { scripts: ['background.js'] };
      targetManifest.sidebar_action = {
        default_title: 'YouTube Queue',
        default_panel: 'sidebar.html',
        default_icon: 'icons/icon32.png'
      };
      targetManifest.browser_specific_settings = {
        gecko: {
          id: 'yt-queue-sidebar@jyotirmay.dev',
          strict_min_version: '109.0',
          data_collection_permissions: { required: ['none'] }
        }
      };
    }

    // Write generated manifest.json
    fs.writeFileSync(
      path.join(targetDir, 'manifest.json'),
      JSON.stringify(targetManifest, null, 2)
    );

    // Create zip
    const zipPath = path.join(DIST_DIR, `${target}-extension.zip`);
    await zipDirectory(targetDir, zipPath);
    console.log(`  └─ Created: dist/${target}-extension.zip`);
  }

  console.log('\n✅ Build complete!');
}

build().catch(console.error);
