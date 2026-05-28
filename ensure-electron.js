const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = __dirname;
const electronDir = path.join(root, 'node_modules', 'electron');
const pathTxt = path.join(electronDir, 'path.txt');
const mirror = 'https://npmmirror.com/mirrors/electron/';

function exists(p) {
  return fs.existsSync(p);
}

function removeDir(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function run(command, args) {
  const env = Object.assign({}, process.env, {
    ELECTRON_MIRROR: mirror,
    npm_config_registry: process.env.npm_config_registry || 'https://registry.npmmirror.com'
  });

  console.log(`> ${command} ${args.join(' ')}`);
  childProcess.execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env,
    shell: false
  });
}

function npmCmd() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function verifyElectron() {
  if (!exists(pathTxt)) return false;
  try {
    const relative = fs.readFileSync(pathTxt, 'utf8').trim();
    const exePath = path.join(electronDir, 'dist', relative);
    return exists(exePath);
  } catch (error) {
    return false;
  }
}

function main() {
  console.log('==========================================================');
  console.log('Checking Electron runtime...');
  console.log('==========================================================');

  if (verifyElectron()) {
    console.log('Electron runtime is ready.');
    return;
  }

  console.log('Electron runtime is missing or incomplete.');
  console.log('This usually means node_modules/electron/path.txt was not created.');
  console.log('Reinstalling Electron with mirror:', mirror);

  // A half-installed electron folder prevents npm from running postinstall again in some cases.
  removeDir(electronDir);

  try {
    run(npmCmd(), ['install']);
  } catch (error) {
    console.error('npm install failed.');
    throw error;
  }

  if (!verifyElectron()) {
    console.log('Electron is still incomplete. Running npm rebuild electron --force...');
    try {
      run(npmCmd(), ['rebuild', 'electron', '--force']);
    } catch (error) {
      console.error('npm rebuild electron failed.');
    }
  }

  if (!verifyElectron() && exists(path.join(electronDir, 'install.js'))) {
    console.log('Electron is still incomplete. Running electron/install.js directly...');
    try {
      run(process.execPath, [path.join(electronDir, 'install.js')]);
    } catch (error) {
      console.error('electron/install.js failed.');
    }
  }

  if (!verifyElectron()) {
    throw new Error([
      'Electron runtime is still incomplete after repair.',
      `Missing or invalid: ${pathTxt}`,
      'Please check your network, then run this command in the project folder:',
      'npm install'
    ].join('\n'));
  }

  console.log('Electron runtime repaired successfully.');
}

try {
  main();
} catch (error) {
  console.error('');
  console.error('ELECTRON CHECK FAILED:');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
