import { execFileSync, execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const sidecarDir = join(root, 'src-sidecar');
const binariesDir = join(root, 'src-tauri', 'binaries');
const buildDir = join(root, '.localteam-build', 'windows-sidecar');

const nodeVersion = process.version.replace(/^v/, '');
const seaBlobPath = join(sidecarDir, 'sea-prep.blob');
const seaConfigPath = join(sidecarDir, 'sea-config.json');
const windowsNodePath = join(buildDir, `node-v${nodeVersion}-win-x64.exe`);
const outputPath = join(
  binariesDir,
  'localteam-sidecar-x86_64-pc-windows-msvc.exe',
);
const postjectCliPath = join(root, 'node_modules', 'postject', 'dist', 'cli.js');
const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';

mkdirSync(binariesDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
}

function runNpm(args, cwd) {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    throw new Error(
      'npm_execpath is not set. Run this script via npm (for example: npm run build:sidecar:windows).',
    );
  }

  run(process.execPath, [npmExecPath, ...args], cwd);
}

function downloadWindowsNode() {
  if (existsSync(windowsNodePath)) {
    return;
  }

  const url = `https://nodejs.org/dist/v${nodeVersion}/win-x64/node.exe`;
  run(curlCommand, ['-fsSL', '-o', windowsNodePath, url], root);
}

runNpm(['run', 'build'], sidecarDir);
runNpm(
  [
    'exec',
    '--',
    [
      'esbuild',
      'dist/index.js',
      '--bundle',
      '--platform=node',
      '--target=node20',
      '--format=cjs',
      '--outfile=dist/bundle.cjs',
    ],
  ].flat(),
  sidecarDir,
);

writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: 'dist/bundle.cjs',
      output: 'sea-prep.blob',
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  ) + '\n',
);

run(process.execPath, ['--experimental-sea-config', seaConfigPath], sidecarDir);
downloadWindowsNode();

copyFileSync(windowsNodePath, outputPath);
if (!existsSync(postjectCliPath)) {
  throw new Error(`postject CLI not found at ${postjectCliPath}. Run npm install in the repo root.`);
}
run(
  process.execPath,
  [
    postjectCliPath,
    outputPath,
    'NODE_SEA_BLOB',
    seaBlobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  root,
);

rmSync(seaConfigPath, { force: true });
rmSync(seaBlobPath, { force: true });

if (process.platform !== 'win32') {
  execSync(`file "${outputPath}"`, {
    cwd: root,
    stdio: 'inherit',
  });
}
console.log(`Built sidecar binary: ${outputPath}`);
