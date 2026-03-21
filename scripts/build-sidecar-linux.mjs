import { execFileSync } from 'node:child_process';
import {
  chmodSync,
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

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const hostTargetByArch = {
  x64: 'x86_64-unknown-linux-gnu',
  arm64: 'aarch64-unknown-linux-gnu',
};

if (process.platform !== 'linux') {
  throw new Error('Linux sidecar builder must run on Linux.');
}

const defaultTarget = hostTargetByArch[process.arch];
if (!defaultTarget) {
  throw new Error(`Unsupported Linux architecture: ${process.arch}`);
}

const target = args.get('--target') ?? defaultTarget;
if (target !== defaultTarget) {
  throw new Error(
    `Cross-building the Linux sidecar is not supported from ${defaultTarget} to ${target}.`,
  );
}

const seaBlobPath = join(sidecarDir, 'sea-prep.blob');
const seaConfigPath = join(sidecarDir, 'sea-config.json');
const outputPath = join(binariesDir, `localteam-sidecar-${target}`);
const nodeBinary = process.execPath;
const nodeMajor = process.versions.node.split('.')[0];

mkdirSync(binariesDir, { recursive: true });

function run(command, commandArgs, cwd) {
  execFileSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
  });
}

try {
  run('npm', ['run', 'build'], sidecarDir);
  run(
    'npx',
    [
      'esbuild',
      'dist/index.js',
      '--bundle',
      '--platform=node',
      `--target=node${nodeMajor}`,
      '--format=cjs',
      '--outfile=dist/bundle.cjs',
    ],
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

  run(nodeBinary, ['--experimental-sea-config', seaConfigPath], sidecarDir);

  copyFileSync(nodeBinary, outputPath);
  chmodSync(outputPath, 0o755);

  run(
    'npx',
    [
      'postject@1.0.0-alpha.6',
      outputPath,
      'NODE_SEA_BLOB',
      seaBlobPath,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ],
    root,
  );
} finally {
  if (existsSync(seaConfigPath)) {
    rmSync(seaConfigPath, { force: true });
  }
  if (existsSync(seaBlobPath)) {
    rmSync(seaBlobPath, { force: true });
  }
}
