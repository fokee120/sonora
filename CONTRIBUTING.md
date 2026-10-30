# Contributing to Sonora

Thanks for helping make Sonora better. Keep playback stable, treat iPhone Home Screen use as a first-class target, and preserve existing library data.

## Local development

Follow the [runtime setup](README.md#run-sonora), then run `npm run dev`. Production offline behavior requires `npm run build` and `npm start` over HTTPS. Never use a real account database as a test fixture.

Before submitting:

```sh
npm run lint
npm run test:unit
npm run build
```

## Focused browser tests

Install the engines once with `npx playwright install chromium webkit`. Most focused configs use an isolated Vite preview on port 4175; stop another process on that port if it serves a different checkout.

| Area | Command |
| --- | --- |
| Custom order, public playlist saves, YouTube tab | `npx playwright test --config playwright.custom-playlist.config.ts` |
| Song-row swipes and download bars | `npx playwright test --config playwright.row-local.config.ts tests/row-local.spec.ts` |
| Lyrics, cloud device sync and queue handoff | `npx playwright test --config playwright.lyrics-cloud.config.ts` |
| iPhone viewport and search keyboard layout | `npx playwright test --config playwright.viewport-width.config.ts` |
| Theme structure and colors | `npx playwright test --config playwright.theme-palettes.config.ts` |
| Weekly release and archived recaps | `npx playwright test --config playwright.weekly-recap.config.ts` |
| Native media commands | `npx playwright test --config playwright.media-source.config.ts` |

For changes to the audio downloader, install FFmpeg and run `npx tsx --test tests/direct-download.test.ts tests/direct-download-admission.test.ts tests/download-artifact.test.ts` too. Browser engines without a native API may skip relevant checks; test lock-screen controls, long pauses and background transitions on a physical iPhone.

## Project map

- `src/views/`: full screens and collection views.
- `src/components/`: shared navigation, player, rows, sheets and settings.
- `src/lib/audio/`: the persistent playback engine; navigation must not recreate it.
- `src/lib/offline/`: explicit downloads and the separate automatic cache.
- `src/server/`: discovery, imports, accounts and audio services.
- `src/themes.css` and `src/lib/appearance.ts`: theme surfaces and appearance state.
- `tests/`: browser and Node regression suites.

## Pull requests

Describe the concrete behavior change and the checks you ran. Include before/after screenshots for visible changes, using fictional data. Cover narrow phone widths, safe areas, touch interactions and reduced motion where relevant. Keep private libraries, credentials, cookies and `.sonora/` out of Git.

Do not add a project-wide license without the owner's explicit choice. Bundled fonts retain their own license notices.
