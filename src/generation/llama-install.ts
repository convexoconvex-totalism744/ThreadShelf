import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { basename, dirname, extname, join, resolve } from 'path';
import { spawn } from 'child_process';

export const LLAMA_CPP_REPOSITORY = 'ggml-org/llama.cpp';
export const LLAMA_CPP_RELEASE_API =
  'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest';

export type LlamaPlatform = 'win32' | 'darwin' | 'linux';
export type LlamaArch = 'x64' | 'arm64';
export type LlamaVariant = 'cpu' | 'vulkan' | 'cuda' | 'rocm' | 'sycl';

export interface ReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
  readonly digest?: string | null;
  readonly size?: number;
}

export interface LlamaRelease {
  readonly tag_name: string;
  readonly html_url: string;
  readonly published_at?: string;
  readonly assets: readonly ReleaseAsset[];
}

export interface InstallSource {
  readonly url: string;
  readonly filename: string;
  readonly sha256?: string;
  readonly tag: string;
  readonly releaseUrl?: string;
  readonly flavor?: LlamaVariant;
  readonly companions?: readonly {
    readonly url: string;
    readonly filename: string;
    readonly sha256: string;
  }[];
}

export interface InstallResult {
  readonly installDirectory: string;
  readonly executablePath: string;
  readonly source: InstallSource;
}

export interface InstallProgress {
  readonly phase: 'downloading' | 'verifying' | 'inspecting' | 'extracting' | 'licensing';
  readonly downloadedBytes?: number;
  readonly totalBytes?: number;
}

const executableNames = (platform: NodeJS.Platform = process.platform): readonly string[] =>
  platform === 'win32' ? ['llama-server.exe'] : ['llama-server'];

const canExecute = async (path: string): Promise<boolean> => {
  try {
    await access(path, process.platform === 'win32' ? undefined : 1);
    return true;
  } catch {
    return false;
  }
};

const unique = (values: readonly string[]): string[] => [
  ...new Set(values.map((value) => resolve(value))),
];

export const defaultLlamaInstallRoot = (): string =>
  resolve(process.env.THREADSHELF_TOOLS_PATH || join(process.cwd(), '.threadshelf', 'tools'));

export const llamaExecutableCandidates = ({
  platform = process.platform,
  installRoot = defaultLlamaInstallRoot(),
  env = process.env,
}: {
  platform?: NodeJS.Platform;
  installRoot?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string[] => {
  const names = executableNames(platform);
  const configured = [env.LLAMA_CPP_SERVER, env.LLAMA_SERVER_PATH].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  const pathDelimiter = platform === 'win32' ? ';' : ':';
  const pathEntries = (env.PATH || '')
    .split(pathDelimiter)
    .filter(Boolean)
    .flatMap((entry) => names.map((name) => join(entry, name)));
  const roots = [
    installRoot,
    join(homedir(), '.local', 'bin'),
    ...(platform === 'win32'
      ? [join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'llama.cpp')]
      : ['/usr/local/bin', '/opt/homebrew/bin']),
  ];
  const rooted = roots.flatMap((root) => names.map((name) => join(root, name)));
  return unique([...configured, ...pathEntries, ...rooted]);
};

const findRecursively = async (
  root: string,
  names: ReadonlySet<string>,
  depth = 3,
): Promise<string[]> => {
  if (depth < 0 || !existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && names.has(entry.name.toLowerCase())) found.push(path);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      found.push(...(await findRecursively(path, names, depth - 1)));
    }
  }
  return found;
};

export const findLlamaExecutables = async (
  options: Parameters<typeof llamaExecutableCandidates>[0] = {},
): Promise<string[]> => {
  const platform = options.platform ?? process.platform;
  const direct = await Promise.all(
    llamaExecutableCandidates(options).map(async (path) =>
      (await canExecute(path)) ? path : null,
    ),
  );
  const installRoot = options.installRoot ?? defaultLlamaInstallRoot();
  const nested = await findRecursively(
    installRoot,
    new Set(executableNames(platform).map((name) => name.toLowerCase())),
  );
  const releaseNumber = (path: string): number => {
    const match = path.match(/[\\/]b(\d+)(?:-[^\\/]+)?[\\/]/i);
    return match?.[1] ? Number(match[1]) : 0;
  };
  const acceleratorScore = (path: string): number =>
    /[\\/]b\d+-(cuda|vulkan|rocm|sycl)[\\/]/i.test(path) ? 1 : 0;
  nested.sort(
    (left, right) =>
      releaseNumber(right) - releaseNumber(left) ||
      acceleratorScore(right) - acceleratorScore(left) ||
      right.localeCompare(left),
  );
  return unique([...direct.filter((path): path is string => path !== null), ...nested]);
};

export const fetchLatestLlamaRelease = async (
  fetchImpl: typeof fetch = fetch,
): Promise<LlamaRelease> => {
  const response = await fetchImpl(LLAMA_CPP_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ThreadShelf-llama-installer',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`);
  const release = (await response.json()) as Partial<LlamaRelease>;
  if (!release.tag_name || !release.html_url || !Array.isArray(release.assets)) {
    throw new Error('GitHub returned an invalid llama.cpp release payload');
  }
  return release as LlamaRelease;
};

const architectureToken = (arch: NodeJS.Architecture): LlamaArch => {
  if (arch === 'x64' || arch === 'arm64') return arch;
  throw new Error(`Unsupported architecture: ${arch}. Use --url for a compatible custom build.`);
};

const platformToken = (platform: NodeJS.Platform): LlamaPlatform => {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') return platform;
  throw new Error(`Unsupported platform: ${platform}. Use --url for a compatible custom build.`);
};

export const selectReleaseAsset = (
  release: LlamaRelease,
  {
    platform = process.platform,
    arch = process.arch,
    variant = 'cpu',
  }: { platform?: NodeJS.Platform; arch?: NodeJS.Architecture; variant?: LlamaVariant } = {},
): ReleaseAsset => {
  const os = platformToken(platform);
  const cpu = architectureToken(arch);
  const supportedVariant = os === 'darwin' ? 'cpu' : variant;
  if (os === 'darwin' && variant !== 'cpu') {
    throw new Error('macOS release builds use Metal automatically; choose the cpu variant.');
  }

  const required =
    os === 'win32'
      ? ['-bin-win-', supportedVariant === 'cpu' ? '-cpu-' : `-${supportedVariant}-`, `-${cpu}.zip`]
      : os === 'darwin'
        ? ['-bin-macos-', `-${cpu}.tar.gz`]
        : [
            '-bin-ubuntu-',
            ...(supportedVariant === 'cpu' ? [] : [`-${supportedVariant}-`]),
            `-${cpu}.tar.gz`,
          ];

  const matches = release.assets.filter((asset) => {
    const name = asset.name.toLowerCase();
    if (name.startsWith('cudart-')) return false;
    if (
      os === 'linux' &&
      supportedVariant === 'cpu' &&
      /-(vulkan|rocm|sycl|openvino)-/.test(name)
    ) {
      return false;
    }
    return required.every((token) => name.includes(token));
  });
  const asset = matches.sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!asset) {
    throw new Error(
      `No official ${os}/${cpu}/${supportedVariant} binary exists in release ${release.tag_name}. Use --url for a custom build.`,
    );
  }
  return asset;
};

const normalizeDigest = (digest: string | null | undefined): string | undefined => {
  if (!digest) return undefined;
  const value = digest.toLowerCase().replace(/^sha256:/, '');
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
};

export const sourceFromRelease = (
  release: LlamaRelease,
  options: Parameters<typeof selectReleaseAsset>[1] = {},
): InstallSource => {
  const asset = selectReleaseAsset(release, options);
  const sha256 = normalizeDigest(asset.digest);
  if (!sha256) {
    throw new Error(`Release asset ${asset.name} has no usable SHA-256 digest; refusing install.`);
  }
  const platform = options.platform ?? process.platform;
  const variant = options.variant ?? 'cpu';
  let companions: InstallSource['companions'];
  if (platform === 'win32' && variant === 'cuda') {
    const expectedName = asset.name.replace(/^llama-[^-]+-bin-win-/i, 'cudart-llama-bin-win-');
    const companion = release.assets.find(
      (candidate) => candidate.name.toLowerCase() === expectedName.toLowerCase(),
    );
    const companionSha256 = normalizeDigest(companion?.digest);
    if (!companion || !companionSha256) {
      throw new Error(
        `Release ${release.tag_name} has no authenticated CUDA runtime companion ${expectedName}; refusing an incomplete Windows CUDA install.`,
      );
    }
    companions = [
      {
        url: companion.browser_download_url,
        filename: companion.name,
        sha256: companionSha256,
      },
    ];
  }
  return {
    url: asset.browser_download_url,
    filename: asset.name,
    sha256,
    tag: release.tag_name,
    releaseUrl: release.html_url,
    flavor: options.variant ?? 'cpu',
    companions,
  };
};

export const sha256File = async (path: string): Promise<string> =>
  new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });

const downloadFile = async (
  url: string,
  destination: string,
  onProgress?: (progress: InstallProgress) => void,
): Promise<void> => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Download URL must use HTTPS or HTTP');
  }
  const response = await fetch(parsed, {
    redirect: 'follow',
    headers: { 'User-Agent': 'ThreadShelf-llama-installer' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status})`);
  }
  const { Readable } = await import('stream');
  const { Transform } = await import('stream');
  const { pipeline } = await import('stream/promises');
  const { createWriteStream } = await import('fs');
  const totalBytes = Number(response.headers.get('content-length')) || undefined;
  let downloadedBytes = 0;
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedBytes += chunk.length;
      onProgress?.({ phase: 'downloading', downloadedBytes, totalBytes });
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as never),
    progress,
    createWriteStream(destination, { mode: 0o600 }),
  );
};

const run = async (command: string, args: readonly string[]): Promise<void> =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, [...args], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`${command} exited with code ${code}`)),
    );
  });

export const runCommandCapture = async (
  command: string,
  args: readonly string[],
): Promise<string> =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, [...args], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    // `exit` can fire before stdout/stderr have emitted their final buffered
    // chunks. `close` is emitted only after the stdio streams are closed.
    child.once('close', (code) =>
      code === 0
        ? resolveRun(stdout)
        : reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`)),
    );
  });

export const assertSafeArchiveEntries = (entries: readonly string[]): void => {
  if (entries.length === 0) throw new Error('Archive is empty');
  for (const original of entries) {
    const normalized = original.trim().replace(/\\/g, '/').replace(/\/$/, '');
    if (!normalized) continue;
    const segments = normalized.split('/');
    if (
      normalized.startsWith('/') ||
      /^[a-zA-Z]:/.test(normalized) ||
      normalized.includes('\0') ||
      segments.includes('..')
    ) {
      throw new Error(`Unsafe archive entry: ${original}`);
    }
  }
};

export const inspectLlamaArchive = async (archive: string): Promise<void> => {
  const lower = archive.toLowerCase();
  if (lower.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const listing = await runCommandCapture('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "& { param($archive) Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($archive); try { foreach($e in $z.Entries) { if ((($e.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Archive contains a symbolic link' }; $e.FullName } } finally { $z.Dispose() } }",
        archive,
      ]);
      assertSafeArchiveEntries(listing.split(/\r?\n/).filter(Boolean));
      return;
    }
    const listing = await runCommandCapture('unzip', ['-Z1', archive]);
    const verbose = await runCommandCapture('unzip', ['-Z', '-l', archive]);
    if (/^\s*l[rwx-]{9}\s/m.test(verbose)) {
      throw new Error('Archive contains a symbolic link');
    }
    assertSafeArchiveEntries(listing.split(/\r?\n/).filter(Boolean));
    return;
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    const listing = await runCommandCapture('tar', ['-tzf', archive]);
    const verbose = await runCommandCapture('tar', ['-tvzf', archive]);
    if (/^[lh][rwx-]{9}\s/m.test(verbose)) {
      throw new Error('Archive contains a symbolic or hard link');
    }
    assertSafeArchiveEntries(listing.split(/\r?\n/).filter(Boolean));
    return;
  }
  throw new Error(`Unsupported archive type: ${basename(archive)}`);
};

const extractArchive = async (archive: string, destination: string): Promise<void> => {
  const lower = archive.toLowerCase();
  if (lower.endsWith('.zip')) {
    if (process.platform === 'win32') {
      await run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination }',
        archive,
        destination,
      ]);
      return;
    }
    await run('unzip', ['-q', archive, '-d', destination]);
    return;
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await run('tar', ['-xzf', archive, '-C', destination]);
    return;
  }
  throw new Error(`Unsupported archive type: ${basename(archive)}`);
};

const installCompanionArchives = async (
  companions: NonNullable<InstallSource['companions']>,
  targetDirectory: string,
  staging: string,
  onProgress?: (progress: InstallProgress) => void,
): Promise<void> => {
  for (const [index, companion] of companions.entries()) {
    const archive = join(staging, `companion-${index}-${basename(companion.filename)}`);
    const extracted = join(staging, `companion-${index}-extracted`);
    await mkdir(extracted);
    onProgress?.({ phase: 'downloading', downloadedBytes: 0 });
    await downloadFile(companion.url, archive, onProgress);
    onProgress?.({ phase: 'verifying' });
    const actual = await sha256File(archive);
    if (actual !== companion.sha256.toLowerCase()) {
      throw new Error(
        `SHA-256 mismatch for ${companion.filename}: expected ${companion.sha256}, got ${actual}`,
      );
    }
    onProgress?.({ phase: 'inspecting' });
    await inspectLlamaArchive(archive);
    onProgress?.({ phase: 'extracting' });
    await extractArchive(archive, extracted);
    // Runtime archives contain DLLs shared by the executable. Never replace an
    // existing file during repair; matching files are left untouched.
    for (const entry of await readdir(extracted)) {
      await cp(join(extracted, entry), join(targetDirectory, entry), {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    }
  }
};

const copyLicense = async (tag: string, destination: string): Promise<void> => {
  const url = `https://raw.githubusercontent.com/${LLAMA_CPP_REPOSITORY}/${encodeURIComponent(tag)}/LICENSE`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ThreadShelf-llama-installer' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Could not retrieve llama.cpp license (${response.status})`);
  await writeFile(join(destination, 'LICENSE.llama.cpp'), await response.text(), {
    encoding: 'utf8',
    mode: 0o600,
  });
};

export const installLlamaCpp = async (
  source: InstallSource,
  {
    installRoot = defaultLlamaInstallRoot(),
    onProgress,
  }: { installRoot?: string; onProgress?: (progress: InstallProgress) => void } = {},
): Promise<InstallResult> => {
  const safeTag = source.tag.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeFlavor = source.flavor?.replace(/[^a-zA-Z0-9._-]/g, '_');
  const destination = resolve(
    installRoot,
    'llama.cpp',
    safeFlavor ? `${safeTag}-${safeFlavor}` : safeTag,
  );
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(join(tmpdir(), 'threadshelf-llama-'));
  try {
    if (existsSync(destination)) {
      if (!source.companions?.length) {
        throw new Error(`Install destination already exists: ${destination}`);
      }
      const metadata = await readFile(join(destination, 'THREADSHELF_INSTALL.json'), 'utf8')
        .then(
          (value) =>
            JSON.parse(value) as {
              source?: { tag?: string; flavor?: LlamaVariant };
            },
        )
        .catch(() => null);
      if (
        metadata?.source?.tag !== source.tag ||
        (metadata.source.flavor ?? 'cpu') !== (source.flavor ?? 'cpu')
      ) {
        throw new Error(
          `Existing install metadata does not match ${source.tag}/${source.flavor ?? 'cpu'}; refusing repair.`,
        );
      }
      const existing = await findRecursively(
        destination,
        new Set(executableNames().map((name) => name.toLowerCase())),
        5,
      );
      const executablePath = existing[0];
      if (!executablePath) {
        throw new Error(`Existing install has no llama-server: ${destination}`);
      }
      await installCompanionArchives(
        source.companions,
        dirname(executablePath),
        staging,
        onProgress,
      );
      await writeFile(
        join(destination, 'THREADSHELF_INSTALL.json'),
        `${JSON.stringify({ source, installedAt: new Date().toISOString() }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      return { installDirectory: destination, executablePath, source };
    }
    const archive = join(
      staging,
      source.filename || `llama${extname(new URL(source.url).pathname)}`,
    );
    const extracted = join(staging, 'extracted');
    await mkdir(extracted);
    onProgress?.({ phase: 'downloading', downloadedBytes: 0 });
    await downloadFile(source.url, archive, onProgress);
    if (source.sha256) {
      onProgress?.({ phase: 'verifying' });
      const actual = await sha256File(archive);
      if (actual !== source.sha256.toLowerCase()) {
        throw new Error(
          `SHA-256 mismatch for ${source.filename}: expected ${source.sha256}, got ${actual}`,
        );
      }
    }
    onProgress?.({ phase: 'inspecting' });
    await inspectLlamaArchive(archive);
    onProgress?.({ phase: 'extracting' });
    await extractArchive(archive, extracted);
    const found = await findRecursively(
      extracted,
      new Set(executableNames().map((name) => name.toLowerCase())),
      5,
    );
    const executable = found[0];
    if (!executable) throw new Error('Archive does not contain llama-server');
    if (process.platform !== 'win32') await chmod(executable, 0o755);
    if (source.companions?.length) {
      await installCompanionArchives(source.companions, dirname(executable), staging, onProgress);
    }
    if (source.releaseUrl?.includes('github.com/ggml-org/llama.cpp/')) {
      onProgress?.({ phase: 'licensing' });
      await copyLicense(source.tag, extracted);
    }
    await writeFile(
      join(extracted, 'THREADSHELF_INSTALL.json'),
      `${JSON.stringify({ source, installedAt: new Date().toISOString() }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await rename(extracted, destination).catch(async (error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EXDEV') throw error;
      await cp(extracted, destination, { recursive: true, errorOnExist: true });
    });
    const relativeExecutable = executable.slice(extracted.length + 1);
    return {
      installDirectory: destination,
      executablePath: join(destination, relativeExecutable),
      source,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};

export const customInstallSource = (
  url: string,
  { sha256, tag = 'custom' }: { sha256?: string; tag?: string } = {},
): InstallSource => {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Custom URL must use HTTPS or HTTP');
  }
  const filename = basename(parsed.pathname);
  if (!filename || (!filename.endsWith('.zip') && !filename.match(/\.(tar\.gz|tgz)$/))) {
    throw new Error('Custom URL must point to a .zip, .tar.gz, or .tgz archive');
  }
  const normalizedSha = normalizeDigest(sha256);
  if (sha256 && !normalizedSha) throw new Error('Invalid SHA-256 digest');
  return { url: parsed.toString(), filename, sha256: normalizedSha, tag };
};

export const readInstalledSource = async (
  installDirectory: string,
): Promise<InstallSource | null> => {
  try {
    const raw = await readFile(join(installDirectory, 'THREADSHELF_INSTALL.json'), 'utf8');
    return (JSON.parse(raw) as { source?: InstallSource }).source ?? null;
  } catch {
    return null;
  }
};
