export const repository = 'moeenScape/mTerminal';
const releasePrefix = `/${repository}/releases/download/`;
const platforms = {
  linux: { deb: 'Debian package', appimage: 'AppImage', rpm: 'RPM' },
  macos: { dmg: 'Disk image', pkg: 'Installer package' },
  windows: { exe: 'Executable', msi: 'Installer package' },
};

export function releaseInstaller(asset, platform) {
  const { name, browser_download_url: url, size, state } = asset ?? {};
  if (
    typeof name !== 'string' ||
    typeof url !== 'string' ||
    state !== 'uploaded' ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    !/^mterminal[_. -]/i.test(name)
  )
    return;
  const extension = name.split('.').at(-1).toLowerCase();
  const formats = platforms[platform];
  if (!formats) return;
  if (!Object.hasOwn(formats, extension)) return;

  let download;
  try {
    download = new URL(url);
    if (
      download.origin !== 'https://github.com' ||
      download.username ||
      download.password ||
      download.search ||
      download.hash ||
      !download.pathname.startsWith(releasePrefix) ||
      decodeURIComponent(download.pathname.split('/').at(-1)) !== name
    )
      return;
  } catch {
    return;
  }

  let architecture = '';
  if (/(?:^|[_. -])(?:aarch64|arm64)(?=[_. -])/i.test(name)) {
    architecture = platform === 'macos' ? 'Apple Silicon' : 'ARM64';
  } else if (/(?:^|[_. -])(?:x64|x86_64|amd64)(?=[_. -])/i.test(name)) {
    architecture = platform === 'macos' ? 'Intel' : '64-bit (x64)';
  } else if (/(?:^|[_. -])universal(?=[_. -])/i.test(name)) {
    architecture = 'Universal';
  }
  return { url: download.href, architecture, extension, format: formats[extension], size, name };
}
