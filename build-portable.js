const fs = require("fs");
const path = require("path");

const root = __dirname;
const distDir = path.join(root, "dist");
const outDir = path.join(distDir, "win-unpacked");
const appDir = path.join(outDir, "resources", "app");

const productName = "课程学习记录";
const productExeName = `${productName}.exe`;

const iconIco = path.join(root, "assets", "app-icon.ico");
const iconPng = path.join(root, "assets", "app-icon.png");

function removeDir(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
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

      if (stat.isDirectory()) {
        copyDir(real, to, ignoreNames);
      } else {
        copyFile(real, to);
      }
    } else {
      copyFile(from, to);
    }
  }
}

function mustExist(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} 不存在：${filePath}`);
  }
}

function findElectronExe() {
  const electronPath = require("electron");

  if (typeof electronPath !== "string") {
    throw new Error("无法获取 Electron 可执行文件路径。");
  }

  mustExist(electronPath, "Electron 可执行文件");

  return electronPath;
}

async function patchExeIcon(targetExe) {
  if (process.platform !== "win32") {
    console.log("当前不是 Windows 环境，跳过 EXE 图标写入。");
    return;
  }

  mustExist(iconIco, "assets/app-icon.ico");

  const rceditModule = require("rcedit");

  const rcedit =
    typeof rceditModule === "function"
      ? rceditModule
      : typeof rceditModule.default === "function"
        ? rceditModule.default
        : typeof rceditModule.rcedit === "function"
          ? rceditModule.rcedit
          : null;

  if (!rcedit) {
    throw new Error("无法正确加载 rcedit。请检查 package.json 里的 rcedit 依赖是否正常安装。");
  }

  console.log("正在写入 EXE 图标和版本信息...");

  await rcedit(targetExe, {
    icon: iconIco,
    "version-string": {
      CompanyName: "AaronPlando",
      FileDescription: productName,
      ProductName: productName,
      OriginalFilename: productExeName,
      InternalName: "CourseStudyRecord"
    },
    "file-version": "1.4.1",
    "product-version": "1.4.1"
  });

  console.log("EXE 图标写入完成。");
}

  mustExist(iconIco, "assets/app-icon.ico");

  const rcedit = require("rcedit");

  console.log("正在写入 EXE 图标和版本信息...");

  await rcedit(targetExe, {
    icon: iconIco,
    "version-string": {
      CompanyName: "AaronPlando",
      FileDescription: productName,
      ProductName: productName,
      OriginalFilename: productExeName,
      InternalName: "CourseStudyRecord"
    },
    "file-version": "1.4.1",
    "product-version": "1.4.1"
  });

  console.log("EXE 图标写入完成。");
}

async function main() {
  console.log("==========================================================");
  console.log("课程学习记录 - 自定义免安装版打包");
  console.log("不使用 electron-builder，不调用 NSIS，不调用 winCodeSign。");
  console.log("==========================================================");

  mustExist(path.join(root, "main.js"), "main.js");
  mustExist(path.join(root, "preload.js"), "preload.js");
  mustExist(path.join(root, "snip-preload.js"), "snip-preload.js");
  mustExist(path.join(root, "package.json"), "package.json");
  mustExist(path.join(root, "src", "index.html"), "src/index.html");
  mustExist(path.join(root, "src", "snip.html"), "src/snip.html");
  mustExist(iconIco, "assets/app-icon.ico");
  mustExist(iconPng, "assets/app-icon.png");

  const electronExe = findElectronExe();
  const electronDir = path.dirname(electronExe);

  console.log("Electron 可执行文件：", electronExe);

  console.log("清理旧 dist...");
  removeDir(distDir);
  ensureDir(outDir);

  console.log("复制 Electron 运行环境...");
  copyDir(electronDir, outDir);

  const originalElectronExe = path.join(outDir, path.basename(electronExe));
  const targetExe = path.join(outDir, productExeName);

  mustExist(originalElectronExe, "复制后的 electron.exe");

  fs.renameSync(originalElectronExe, targetExe);

  await patchExeIcon(targetExe);

  console.log("复制应用源码...");

  ensureDir(appDir);

  for (const file of ["main.js", "preload.js", "snip-preload.js", "package.json"]) {
    copyFile(path.join(root, file), path.join(appDir, file));
  }

  copyDir(path.join(root, "src"), path.join(appDir, "src"));
  copyDir(path.join(root, "assets"), path.join(appDir, "assets"));

  const readme = [
    "课程学习记录 - 免安装版",
    "",
    "运行方式：双击“课程学习记录.exe”。",
    "发给别人时：请压缩并发送整个 win-unpacked 文件夹，不要只发送单独 exe。",
    "数据位置：软件会把课程数据保存到当前 Windows 用户的 AppData 应用数据目录里。",
    "",
    "本版本使用自定义免安装打包脚本，不生成安装包，不调用 winCodeSign。"
  ].join("\r\n");

  fs.writeFileSync(path.join(outDir, "README_免安装版说明.txt"), readme, "utf8");

  console.log("");
  console.log("打包完成。");
  console.log("输出目录：", outDir);
  console.log("运行文件：", targetExe);
  console.log("==========================================================");
}

main().catch(error => {
  console.error("");
  console.error("打包失败：");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
