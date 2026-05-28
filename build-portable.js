const fs = require('fs');
const path = require('path');

const root = __dirname;
const distDir = path.join(root, 'dist');
const outDir = path.join(distDir, 'win-unpacked');
const appDir = path.join(outDir, 'resources', 'app');
const productExeName = '课程学习记录.exe';
const iconFile = path.join(root, 'assets', 'app-icon.ico');

function removeDir(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest, ignoreNames = new Set()) {
  ensureDir(dest);

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (ignoreNames.has(entry.name)) continue;

    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(from, to, ignoreNames);
    } else if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(from);
      const stat = fs.statSync(real);

      if (stat.isDirectory()) copyDir(real, to, ignoreNames);
      else copyFile(real, to);
    } else {
      copyFile(from, to);
    }
  }
}

function mustExist(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

async function patchExeIcon(targetExe) {
  if (process.platform !== 'win32') {
    console.log('Skipping EXE icon patch because current platform is not Windows.');
    return;
  }

  try {
    const rcedit = require('rcedit');

    console.log('Patching EXE icon and version information...');

    await rcedit(targetExe, {
      icon: iconFile,
      'version-string': {
        CompanyName: 'AaronPlando',
        FileDescription: '课程学习记录',
        ProductName: '课程学习记录',
        OriginalFilename: productExeName,
        InternalName: 'CourseStudyRecord'
      }
    });

    console.log('EXE icon patched successfully.');
  } catch (error) {
    console.warn('WARNING: Failed to patch EXE icon. The app can still run, but Explorer may show the default Electron icon.');
    console.warn(error && error.message ? error.message : error);
  }
}

async function main() {
  console.log('==========================================================');
  console.log('Course Study Record - Custom Portable Build');
  console.log('This build does not use electron-builder, NSIS, or winCodeSign.');
  console.log('==========================================================');

  mustExist(path.join(root, 'main.js'), 'main.js');
  mustExist(path.join(root, 'preload.js'), 'preload.js');
  mustExist(path.join(root, 'snip-preload.js'), 'snip-preload.js');
  mustExist(path.join(root, 'src', 'index.html'), 'src/index.html');
  mustExist(path.join(root, 'src', 'snip.html'), 'src/snip.html');
  mustExist(iconFile, 'assets/app-icon.ico');
  mustExist(path.join(root, 'assets', 'app-icon.png'), 'assets/app-icon.png');

  const electronExe = require('electron');
  const electronDir = path.dirname(electronExe);

  mustExist(electronExe, 'Electron executable');

  console.log('Electron executable:', electronExe);
  console.log('Cleaning dist folder...');

  removeDir(distDir);
  ensureDir(outDir);

  console.log('Copying Electron runtime...');
  copyDir(electronDir, outDir, new Set());

  const originalElectronExe = path.join(outDir, path.basename(electronExe));
  const targetExe = path.join(outDir, productExeName);

  if (fs.existsSync(originalElectronExe)) {
    fs.renameSync(originalElectronExe, targetExe);
  } else if (!fs.existsSync(targetExe)) {
    throw new Error('Cannot find copied electron.exe in output folder.');
  }

  await patchExeIcon(targetExe);

  console.log('Copying app source...');

  ensureDir(appDir);

  for (const file of ['main.js', 'preload.js', 'snip-preload.js', 'package.json']) {
    copyFile(path.join(root, file), path.join(appDir, file));
  }

  copyDir(path.join(root, 'src'), path.join(appDir, 'src'));
  copyDir(path.join(root, 'assets'), path.join(appDir, 'assets'));

  const readme = [
    '课程学习记录 - 免安装版',
    '',
    '运行方式：双击“课程学习记录.exe”。',
    '发给别人时：请压缩并发送整个 win-unpacked 文件夹，不要只发送单独 exe。',
    '数据位置：软件会把课程数据保存到当前 Windows 用户的 AppData 应用数据目录里。',
    '',
    '本版本使用自定义免安装打包脚本，不生成安装包，不调用 winCodeSign。'
  ].join('\r\n');

  fs.writeFileSync(path.join(outDir, 'README_免安装版说明.txt'), readme, 'utf8');

  console.log('');
  console.log('Build completed.');
  console.log('Output:', outDir);
  console.log('Run:', targetExe);
  console.log('==========================================================');
}

main().catch(error => {
  console.error('');
  console.error('BUILD FAILED:');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
