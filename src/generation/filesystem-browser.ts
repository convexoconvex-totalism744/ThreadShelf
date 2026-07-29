import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { homedir, platform } from 'os';
import { dirname, parse, resolve } from 'path';
import { ValidationError } from '../validation.js';

const MAX_DIRECTORIES = 500;

export interface DirectoryBrowserResult {
  readonly path: string;
  readonly parent?: string;
  readonly roots: readonly { readonly name: string; readonly path: string }[];
  readonly directories: readonly { readonly name: string; readonly path: string }[];
  readonly truncated: boolean;
}

export const isLoopbackAddress = (address: string | undefined): boolean => {
  let normalized = String(address || '')
    .trim()
    .replace(/^"|"$/g, '')
    .toLowerCase();
  if (normalized.startsWith('[')) normalized = normalized.slice(1, normalized.indexOf(']'));
  else normalized = normalized.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, '$1');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
};

const forwardedAddresses = (value: string | readonly string[] | undefined): string[] =>
  (Array.isArray(value) ? value : [value ?? ''])
    .flatMap((header) => header.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);

export const isLoopbackRequest = (
  remoteAddress: string | undefined,
  forwardedFor?: string | readonly string[],
  forwarded?: string | readonly string[],
  requestHostname?: string,
): boolean => {
  if (!isLoopbackAddress(remoteAddress)) return false;
  if (
    requestHostname !== undefined &&
    requestHostname.toLowerCase() !== 'localhost' &&
    !isLoopbackAddress(requestHostname)
  ) {
    return false;
  }
  const proxyAddresses = forwardedAddresses(forwardedFor);
  const forwardedEntries = forwardedAddresses(forwarded);
  for (const entry of forwardedEntries) {
    const matches = [...entry.matchAll(/(?:^|;)\s*for=("?)(\[[^\]]+\]|[^;\s"]+)\1/gi)];
    if (matches.length === 0) return false;
    proxyAddresses.push(
      ...matches.map((match) => match[2]).filter((address): address is string => Boolean(address)),
    );
  }
  return proxyAddresses.every(isLoopbackAddress);
};

const filesystemRoots = (): { name: string; path: string }[] => {
  const home = resolve(homedir());
  if (platform() !== 'win32') {
    return [
      { name: 'Home', path: home },
      { name: 'Filesystem', path: '/' },
    ];
  }
  const drives = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    .split('')
    .map((letter) => `${letter}:\\`)
    .filter((path) => existsSync(path))
    .map((path) => ({ name: path.slice(0, 2), path }));
  return [
    { name: 'Home', path: home },
    ...drives.filter((drive) => drive.path !== parse(home).root),
  ];
};

export const browseDirectories = async (
  requestedPath?: string,
): Promise<DirectoryBrowserResult> => {
  if (
    requestedPath !== undefined &&
    (typeof requestedPath !== 'string' ||
      requestedPath.length > 4096 ||
      requestedPath.includes('\0'))
  ) {
    throw new ValidationError('Invalid directory path', { field: 'path' });
  }
  const path = resolve(requestedPath?.trim() || homedir());
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) {
    throw new ValidationError('Directory does not exist or is not accessible', { field: 'path' });
  }
  const entries = await readdir(path, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, path: resolve(path, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? undefined : parent,
    roots: filesystemRoots(),
    directories: directories.slice(0, MAX_DIRECTORIES),
    truncated: directories.length > MAX_DIRECTORIES,
  };
};
