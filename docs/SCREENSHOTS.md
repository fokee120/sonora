# Screenshot capture

The README images are screenshots of Sonora itself, captured with an isolated fictional library. Album names, track names and SVG cover artwork come from `scripts/capture-screenshots.mjs`. No real account, listening history, audio stream or third-party album artwork is needed.

Install dependencies and Chromium, then use two terminals:

```sh
npx vite --host 127.0.0.1 --port 4175 --strictPort
```

```sh
npm run screenshots
```

The script blocks service workers, mocks API responses, seeds only a temporary browser profile, waits for fonts/transitions, and captures desktop Home, mobile Home/Library/Recap and four themed players. It closes that browser when finished. Output goes into `docs/screenshots/`.

`SONORA_SCREENSHOT_URL` can select another local development port; non-local hosts are rejected. The script needs the Vite source modules, so do not point it at a production build. Review the generated images before committing. Re-capture when the UI changes; do not hand-edit the screenshots to imply app features that are not present.
