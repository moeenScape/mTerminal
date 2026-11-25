import { releaseInstaller, repository } from './release-assets.js';

const switcher = document.querySelector('.preview-switcher');
if (switcher) {
  const buttons = [...switcher.querySelectorAll('button')];
  switcher.hidden = false;
  for (const button of buttons) {
    button.addEventListener('click', () => {
      for (const option of buttons) {
        const active = option === button;
        option.setAttribute('aria-pressed', String(active));
        document.getElementById(option.getAttribute('aria-controls')).hidden = !active;
      }
    });
  }
}

function showInstallers(card, installers) {
  if (installers.length === 1) {
    const [installer] = installers;
    const button = card.querySelector('.button');
    button.href = installer.url;
    button.textContent = installer.architecture
      ? `Download · ${installer.architecture}`
      : `Download .${installer.extension}`;
    button.setAttribute('aria-label', `Download ${installer.name}`);
    button.classList.replace('button-secondary', 'button-primary');
    return;
  }
  const list = card.querySelector('.installer-list');
  for (const { url, architecture, extension, format, size, name } of installers) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    const detail = document.createElement('small');
    link.href = url;
    link.textContent = architecture
      ? `${format} · ${architecture}`
      : `Download ${format.toLowerCase()}`;
    link.setAttribute('aria-label', `Download ${name}`);
    detail.textContent = `.${extension} · ${size >= 1048576 ? Math.round(size / 1048576) + ' MB' : Math.max(1, Math.round(size / 1024)) + ' KB'}`;
    link.append(detail);
    item.append(link);
    list.append(item);
  }
  list.hidden = false;
}

async function loadInstallers() {
  const status = document.getElementById('release-status');
  if (!status) return;
  const cards = [...document.querySelectorAll('[data-platform]')];
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.status === 404) {
      status.textContent =
        'No public installers are listed right now. See the Linux guide to build a package from source.';
    } else {
      if (!response.ok) throw new Error('Release lookup failed');
      const { assets, tag_name: tag } = await response.json();
      if (!Array.isArray(assets) || typeof tag !== 'string')
        throw new Error('Invalid release response');
      let available = false;
      for (const card of cards) {
        const platform = card.dataset.platform;
        const installers = assets.map((asset) => releaseInstaller(asset, platform)).filter(Boolean);
        if (installers.length) {
          available = true;
          showInstallers(card, installers);
        }
      }
      status.textContent = available
        ? `Latest release: ${tag}. Direct downloads appear where installers are available.`
        : 'The latest release does not include a matching installer. Check GitHub for release notes.';
    }
  } catch {
    status.textContent =
      'Installer availability could not be checked. See GitHub Releases or the installation guide.';
  }
}

void loadInstallers();
