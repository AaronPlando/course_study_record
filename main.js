const { app, BrowserWindow, Menu, session, desktopCapturer, ipcMain, screen, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isDev = process.argv.includes('--dev');
const iconPath = path.join(__dirname, 'assets', 'app-icon.ico');

let mainWindow = null;
let lastAutoBackupAt = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function getImagesDir() {
  return path.join(getDataDir(), 'images');
}

function getThumbsDir() {
 return path.join(getDataDir(), 'thumbs');
}

function getBackupsDir() {
  return path.join(getDataDir(), 'backups');
}

function getDataFilePath() {
  return path.join(getDataDir(), 'course-data.json');
}

function ensureAppDataDirs() {
 fs.mkdirSync(getDataDir(), { recursive: true });
 fs.mkdirSync(getImagesDir(), { recursive: true });
 fs.mkdirSync(getThumbsDir(), { recursive: true });
 fs.mkdirSync(getBackupsDir(), { recursive: true });
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(text);
  } catch (error) {
    console.warn('读取 JSON 失败：', error);
    return fallback;
  }
}

function atomicWriteJson(filePath, data) {
  ensureAppDataDirs();
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

function timestampText() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function cleanupBackups(maxCount = 10) {
  try {
    const dir = getBackupsDir();
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map(name => ({ name, fullPath: path.join(dir, name), mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    files.slice(maxCount).forEach(file => {
      try { fs.unlinkSync(file.fullPath); } catch (_) {}
    });
  } catch (error) {
    console.warn('清理备份失败：', error);
  }
}

function createBackup(reason = 'auto') {
  try {
    ensureAppDataDirs();
    const dataFile = getDataFilePath();
    if (!fs.existsSync(dataFile)) return null;

    const safeReason = String(reason || 'auto').replace(/[^a-zA-Z0-9_-]/g, '-');
    const backupPath = path.join(getBackupsDir(), `课程学习记录-backup-${timestampText()}-${safeReason}.json`);
    fs.copyFileSync(dataFile, backupPath);
    cleanupBackups(10);
    return backupPath;
  } catch (error) {
    console.warn('创建备份失败：', error);
    return null;
  }
}

function createThrottledBackup(reason = 'auto-save') {
  const now = Date.now();
  if (now - lastAutoBackupAt < 10 * 60 * 1000) return null;
  lastAutoBackupAt = now;
  return createBackup(reason);
}

function dataUrlToBuffer(dataUrl) {
 const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);

 if (!match) return null;

 const mime = match[1] || 'image/png';
 const isBase64 = Boolean(match[2]);
 const body = match[3] || '';
 const buffer = isBase64 ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf-8');

 return { mime, buffer };
}

function mimeToExt(mime, fallbackName = '') {
 const lowerMime = String(mime || '').toLowerCase();
 const lowerName = String(fallbackName || '').toLowerCase();

 if (lowerMime.includes('jpeg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'jpg';
 if (lowerMime.includes('webp') || lowerName.endsWith('.webp')) return 'webp';
 if (lowerMime.includes('gif') || lowerName.endsWith('.gif')) return 'gif';
 if (lowerMime.includes('bmp') || lowerName.endsWith('.bmp')) return 'bmp';

 return 'png';
}

function getMimeByFileName(fileName) {
 const ext = path.extname(fileName || '').replace('.', '').toLowerCase();

 const mimeMap = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp'
 };

 return mimeMap[ext] || 'image/png';
}

function getThumbFileName(fileName) {
 const parsed = path.parse(fileName || '');

 if (!parsed.name) return '';

 return `${parsed.name}_thumb.png`;
}

function readImageFileAsDataUrl(dir, fileName) {
 try {
  if (!fileName) return '';

  const imagePath = path.join(dir, fileName);

  if (!fs.existsSync(imagePath)) return '';

  const mime = getMimeByFileName(fileName);
  const data = fs.readFileSync(imagePath).toString('base64');

  return `data:${mime};base64,${data}`;
 } catch (error) {
  console.warn('读取图片失败：', error);
  return '';
 }
}

function readImageAsDataUrl(fileName) {
 return readImageFileAsDataUrl(getImagesDir(), fileName);
}

function readImageThumbAsDataUrl(fileName) {
 const thumbName = getThumbFileName(fileName);
 return readImageFileAsDataUrl(getThumbsDir(), thumbName);
}

function ensureThumbnailForFile(fileName) {
 try {
  if (!fileName) return '';

  ensureAppDataDirs();

  const sourcePath = path.join(getImagesDir(), fileName);
  const thumbName = getThumbFileName(fileName);
  const thumbPath = path.join(getThumbsDir(), thumbName);

  if (!fs.existsSync(sourcePath)) return '';
  if (fs.existsSync(thumbPath)) return thumbName;

  const buffer = fs.readFileSync(sourcePath);
  const sourceImage = nativeImage.createFromBuffer(buffer);

  if (sourceImage.isEmpty()) return '';

  const size = sourceImage.getSize();
  const maxWidth = 420;
  const nextWidth = Math.min(maxWidth, Math.max(1, size.width || maxWidth));

  const thumbImage = sourceImage.resize({
   width: nextWidth,
   quality: 'best'
  });

  fs.writeFileSync(thumbPath, thumbImage.toPNG());

  return thumbName;
 } catch (error) {
  console.warn('生成缩略图失败：', error);
  return '';
 }
}

function writeImageDataUrl(dataUrl, preferredName = '') {
 ensureAppDataDirs();

 const parsed = dataUrlToBuffer(dataUrl);

 if (!parsed || !parsed.buffer.length) return null;

 let ext = mimeToExt(parsed.mime, preferredName);

 // 截图、公式、文字图片优先保存 PNG，避免 JPEG 压缩导致文字发糊。
 if (String(parsed.mime || '').toLowerCase().includes('png')) {
  ext = 'png';
 }

 const imageId = crypto.randomBytes(8).toString('hex');
 const fileName = `img_${Date.now()}_${imageId}.${ext}`;
 const imagePath = path.join(getImagesDir(), fileName);

 fs.writeFileSync(imagePath, parsed.buffer);
 ensureThumbnailForFile(fileName);

 return fileName;
}

function clonePlain(value) {
 return JSON.parse(JSON.stringify(value || {}));
}

function walkImagesInState(state, callback) {
 const courses = Array.isArray(state && state.courses) ? state.courses : [];

 courses.forEach(course => {
  (course.chapters || []).forEach(chapter => {
   (chapter.points || []).forEach(point => {
    (point.examples || []).forEach(example => {
     if (!Array.isArray(example.images)) example.images = [];
     example.images = example.images.map(image => callback(image, example)).filter(Boolean);
    });
   });
  });
 });
}

function persistImagesForStorage(rawState) {
 const state = clonePlain(rawState || { courses: [] });

 walkImagesInState(state, image => {
  if (!image) return null;

  const next = {
   id: image.id || crypto.randomBytes(6).toString('hex'),
   name: image.name || '图片'
  };

  if (image.fileName) {
   next.fileName = image.fileName;
   ensureThumbnailForFile(image.fileName);
   return next;
  }

  const data = image.fullData || image.data || image.url || '';

  if (String(data).startsWith('data:image/')) {
   const fileName = writeImageDataUrl(data, image.name || '图片');

   if (!fileName) return null;

   next.fileName = fileName;
   return next;
  }

  return null;
 });

 return state;
}

function hydrateImagesForRenderer(rawState) {
 const state = clonePlain(rawState || { courses: [] });

 walkImagesInState(state, image => {
  if (!image) return null;

  const next = {
   id: image.id || crypto.randomBytes(6).toString('hex'),
   name: image.name || '图片',
   fileName: image.fileName || '',
   hasFullImage: Boolean(image.fileName)
  };

  if (image.fileName) {
   ensureThumbnailForFile(image.fileName);

   const thumbData = readImageThumbAsDataUrl(image.fileName);
   const fallbackData = thumbData || readImageAsDataUrl(image.fileName);

   next.data = fallbackData;
   next.thumbData = thumbData || fallbackData;

   return next.data ? next : null;
  }

  const data = image.fullData || image.data || image.url || '';

  if (String(data).startsWith('data:image/')) {
   const fileName = writeImageDataUrl(data, image.name || '图片');

   next.fileName = fileName || '';
   next.hasFullImage = Boolean(fileName);
   next.data = fileName ? (readImageThumbAsDataUrl(fileName) || data) : data;
   next.thumbData = next.data;

   return next;
  }

  return null;
 });

 return state;
}

function loadCourseDataForRenderer() {
  ensureAppDataDirs();
  const raw = safeReadJson(getDataFilePath(), { courses: [] }) || { courses: [] };
  const hydrated = hydrateImagesForRenderer(raw);

  // 若读取到旧版 base64 图片，顺手迁移为 images 文件夹存储。
  const stored = persistImagesForStorage(hydrated);
  atomicWriteJson(getDataFilePath(), stored);

  return hydrateImagesForRenderer(stored);
}

function saveCourseDataFromRenderer(rawState) {
  ensureAppDataDirs();
  createThrottledBackup('auto-save');
  const stored = persistImagesForStorage(rawState || { courses: [] });
  atomicWriteJson(getDataFilePath(), stored);
  return hydrateImagesForRenderer(stored);
}

async function exportCourseData(exportObject) {
  const date = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出课程学习记录',
    defaultPath: `课程学习进度-${date}.json`,
    filters: [
      { name: 'JSON 数据文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, JSON.stringify(exportObject, null, 2), 'utf-8');
  return { canceled: false, filePath: result.filePath };
}

async function importCourseDataFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入课程学习记录',
    properties: ['openFile'],
    filters: [
      { name: 'JSON 数据文件', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const text = fs.readFileSync(filePath, 'utf-8');
  return { canceled: false, filePath, text };
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: '课程学习记录',
    icon: iconPath,
    backgroundColor: '#f4f7ee',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow = win;
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
      return;
    }
    callback(false);
  });

  if (typeof session.defaultSession.setDisplayMediaRequestHandler === 'function') {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 }
        });

        const screenSource = sources.find(source => source.id.startsWith('screen:')) || sources[0];
        callback({ video: screenSource || null, audio: false });
      } catch (error) {
        console.error('屏幕捕获失败：', error);
        callback({ video: null, audio: false });
      }
    }, { useSystemPicker: true });
  }
}

function findScreenSourceForDisplay(sources, display) {
  if (!Array.isArray(sources) || !sources.length) return null;
  const displayId = String(display && display.id || '');
  const exact = sources.find(source => String(source.display_id || '') === displayId);
  if (exact) return exact;
  return sources.find(source => source.id && source.id.startsWith('screen:')) || sources[0];
}

async function captureDisplayDataUrl(display) {
 const scaleFactor = display && display.scaleFactor ? display.scaleFactor : 1;

 const boundsWidth = display && display.bounds ? display.bounds.width : 1920;
 const boundsHeight = display && display.bounds ? display.bounds.height : 1080;
 const sizeWidth = display && display.size ? display.size.width : boundsWidth;
 const sizeHeight = display && display.size ? display.size.height : boundsHeight;

 const width = Math.max(
  1,
  Math.round(Math.max(sizeWidth, boundsWidth * scaleFactor))
 );

 const height = Math.max(
  1,
  Math.round(Math.max(sizeHeight, boundsHeight * scaleFactor))
 );

 const sources = await desktopCapturer.getSources({
  types: ['screen'],
  thumbnailSize: { width, height },
  fetchWindowIcons: false
 });

 const source = findScreenSourceForDisplay(sources, display);

 if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
  throw new Error('没有获取到屏幕截图');
 }

 // 强制使用 PNG，避免文字截图被 JPEG 压缩糊掉。
 const pngBuffer = source.thumbnail.toPNG();

 return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

function createSnipWindow(ownerWindow, display, payload) {
  return new Promise(resolve => {
    let finished = false;
    const bounds = display.bounds;
    const snipWindow = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#000000',
      icon: iconPath,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webSecurity: true,
        preload: path.join(__dirname, 'snip-preload.js')
      }
    });

    snipWindow.setAlwaysOnTop(true, 'screen-saver');
    snipWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const finish = result => {
      if (finished) return;
      finished = true;
      try {
        if (!snipWindow.isDestroyed()) snipWindow.close();
      } catch (_) {}
      resolve(result || null);
    };

    const doneHandler = (event, result) => {
      if (event.sender !== snipWindow.webContents) return;
      ipcMain.removeListener('screenshot-snipper:done', doneHandler);
      finish(result || null);
    };

    ipcMain.on('screenshot-snipper:done', doneHandler);

    snipWindow.on('closed', () => {
      ipcMain.removeListener('screenshot-snipper:done', doneHandler);
      finish(null);
    });

    snipWindow.webContents.once('did-finish-load', () => {
      snipWindow.webContents.send('screenshot-snipper:init', payload);
      snipWindow.showInactive();
      snipWindow.focus();
    });

    snipWindow.loadFile(path.join(__dirname, 'src', 'snip.html'));
  });
}

function setupDesktopCaptureIpc() {
  ipcMain.handle('desktop-capture:get-sources', async (event, options = {}) => {
    // 保留旧接口作为兜底；新版截图上传默认不再走这里。
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const shouldHideCurrentWindow = Boolean(options.hideCurrentWindow);
    const wasVisible = Boolean(ownerWindow && ownerWindow.isVisible());

    try {
      if (shouldHideCurrentWindow && ownerWindow) {
        ownerWindow.hide();
        await sleep(220);
      }

      const displays = screen.getAllDisplays();
      const maxWidth = Math.max(1920, ...displays.map(display => Math.round(display.size.width * (display.scaleFactor || 1))));
      const maxHeight = Math.max(1080, ...displays.map(display => Math.round(display.size.height * (display.scaleFactor || 1))));

      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: {
          width: Math.min(maxWidth, 3840),
          height: Math.min(maxHeight, 2160)
        },
        fetchWindowIcons: true
      });

      const filteredSources = sources.filter(source => {
        if (!source || !source.thumbnail || source.thumbnail.isEmpty()) return false;
        if (!ownerWindow) return true;
        if (shouldHideCurrentWindow) return true;
        return source.name !== ownerWindow.getTitle();
      });

      return filteredSources.map(source => ({
        id: source.id,
        name: source.name || '未命名窗口',
        type: source.id.startsWith('screen:') ? 'screen' : 'window',
        displayId: source.display_id || '',
        dataUrl: source.thumbnail.toDataURL()
      }));
    } finally {
      if (shouldHideCurrentWindow && ownerWindow && wasVisible) {
        ownerWindow.show();
        ownerWindow.focus();
      }
    }
  });

  ipcMain.handle('screenshot:start-snipping', async (event, options = {}) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const shouldHideCurrentWindow = Boolean(options.hideCurrentWindow);
    const wasVisible = Boolean(ownerWindow && ownerWindow.isVisible());
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay();

    try {
      if (shouldHideCurrentWindow && ownerWindow && !ownerWindow.isDestroyed()) {
        ownerWindow.hide();
        await sleep(220);
      }

      const dataUrl = await captureDisplayDataUrl(display);
      const result = await createSnipWindow(ownerWindow, display, {
        dataUrl,
        display: {
          id: display.id,
          bounds: display.bounds,
          size: display.size,
          scaleFactor: display.scaleFactor || 1
        }
      });

      return { ok: true, dataUrl: result && result.dataUrl ? result.dataUrl : null };
    } catch (error) {
      console.error('截图框选失败：', error);
      return { ok: false, error: String(error && error.message || error), dataUrl: null };
    } finally {
      if (shouldHideCurrentWindow && ownerWindow && wasVisible && !ownerWindow.isDestroyed()) {
        ownerWindow.show();
        ownerWindow.focus();
      }
    }
  });
}

function setupDataIpc() {
  ipcMain.on('data:load-sync', event => {
    try {
      createBackup('startup');
      event.returnValue = { ok: true, state: loadCourseDataForRenderer(), dataDir: getDataDir() };
    } catch (error) {
      console.error('加载数据失败：', error);
      event.returnValue = { ok: false, error: String(error && error.message || error), state: { courses: [] } };
    }
  });

  ipcMain.on('data:save-sync', (event, rawState) => {
    try {
      event.returnValue = { ok: true, state: saveCourseDataFromRenderer(rawState), dataDir: getDataDir() };
    } catch (error) {
      console.error('保存数据失败：', error);
      event.returnValue = { ok: false, error: String(error && error.message || error) };
    }
  });

  ipcMain.handle('data:export', async (event, exportObject) => exportCourseData(exportObject));
  ipcMain.handle('data:import', async () => importCourseDataFile());
  ipcMain.handle('data:open-folder', async () => {
    ensureAppDataDirs();
    await shell.openPath(getDataDir());
    return { ok: true, dataDir: getDataDir() };
  });
  ipcMain.handle('data:create-backup', async (event, reason) => ({ ok: true, backupPath: createBackup(reason || 'manual') }));
  ipcMain.handle('image:save-data-url', async (event, payload = {}) => {
 const fileName = writeImageDataUrl(payload.dataUrl || '', payload.name || '图片');

 if (!fileName) return { ok: false, error: '图片保存失败' };

 const thumbData = readImageThumbAsDataUrl(fileName);
 const fallbackData = thumbData || readImageAsDataUrl(fileName);

 return {
  ok: true,
  image: {
   id: payload.id || crypto.randomBytes(6).toString('hex'),
   name: payload.name || '图片',
   fileName,
   data: fallbackData,
   thumbData: fallbackData,
   hasFullImage: true
  }
 };
});

ipcMain.handle('image:read-full', async (event, payload = {}) => {
 const fileName = payload.fileName || '';

 if (!fileName) return { ok: false, error: '缺少图片文件名', data: '' };

 const data = readImageAsDataUrl(fileName);

 if (!data) return { ok: false, error: '原图读取失败', data: '' };

 return { ok: true, data };
});

}
  
function sendMenuAction(action) {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send('menu:action', action);
  }
}

function setupMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '导入数据...', accelerator: 'CommandOrControl+I', click: () => sendMenuAction('import') },
        { label: '导出数据...', accelerator: 'CommandOrControl+E', click: () => sendMenuAction('export') },
        { label: '立即备份', click: async () => { createBackup('manual'); sendMenuAction('backup-created'); } },
        { label: '打开数据文件夹', click: () => { ensureAppDataDirs(); shell.openPath(getDataDir()); } },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '切换页面风格', click: () => sendMenuAction('toggle-theme') },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' }] : [])
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用须知', click: () => sendMenuAction('usage') },
        { label: '关于', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: '关于', message: '课程学习记录', detail: '桌面版 v1.3\n用于课程、知识点和例题的本地学习记录。' }) }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.aaronplando.course-study-record');
  ensureAppDataDirs();
  setupPermissions();
  setupDesktopCaptureIpc();
  setupDataIpc();
  setupMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
