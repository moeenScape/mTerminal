# mTerminal landing page

This folder is the complete static website. It has a product preview, platform downloads, and a standalone quickstart at `/docs/`.

## Preview and deploy

From this folder, start a local server with Python 3.

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open [the landing page on port 4173](http://127.0.0.1:4173/). To deploy, serve this folder with an HTTPS static host and enable directory index files so `/docs/` serves `docs/index.html`. Set the publish directory to `landing-page` when deploying from the repository root. No build step or hosting credentials are required in this folder.

## Publish installers

The landing page reads the latest public, non-prerelease GitHub release for `moeenScape/mTerminal`. It links to matching uploaded assets named with an `mterminal` prefix and a separator. Use descriptive filenames that include the target architecture, such as `mterminal_0.1.0_amd64.deb`, `mTerminal-0.1.0-arm64.dmg`, or `mTerminal-Setup-0.1.0-x64.exe`. Publish macOS and Windows assets after completing each platform's packaging and signing work. When the repository or release is unavailable to the public, visitors see the release and installation-guide links. GitHub visibility controls access to downloads.

`index.html` is the landing page. `docs/index.html` contains the quickstart. `styles.css` and `site.js` provide styling and progressive enhancement. `assets/` contains the app mark, horizon artwork, and the self-hosted JetBrains Mono font with its license.

## Verify download selection

Run `node --test landing-page/tests/release-assets.test.mjs` from the repository root with Node.js 24. The test uses sample GitHub release metadata and needs no network access. The test files can be excluded from the hosting upload.

## Artwork

`assets/hero-horizon.webp` was generated with the built-in image tool and optimized for the web. The prompt requested a wide, near-black alpine landscape with a dim cobalt horizon, layered mountains, subtle film grain, and a restrained indigo and teal glow. The design leaves open sky for the terminal preview and uses no text or logos in the background.
