# Mandelbrot Cross-Stitch

A browser app for designing a cross stitch of the Mandelbrot set: find a spot, choose colors, preview it as half
stitches in DMC, Pirkka or Rauma yarn, and export a stitch-by-stitch chart. A separate **Stitching view** opens that
chart on a phone, highlights one thread at a time and tracks progress.

- **Designer:** https://kristianroth.github.io/kanavatyo/
- **Stitching view:** https://kristianroth.github.io/kanavatyo/work.html

No build step and no dependencies: plain HTML, CSS and JavaScript modules.

## Using it on a phone
1. In the designer (on a computer), click **🧵 Final export** to download the chart (`.json`).
2. Send the file to the phone (Google Drive, email, USB, Quick Share).
3. On the phone, open the Stitching view link in Firefox, then choose **menu → Add to Home screen**. It opens as an
   app and works offline.
4. **☰ Menu → 📂 Open chart**, and pick the file. The chart and your progress stay on the phone.
5. **⬇ Save progress** now and then: it's a backup, and the way to move progress to another device.

## Local development
```
python3 serve.py        # http://localhost:8765 (sends no-cache headers)
```
ES modules don't load from `file://`, so use the server. The service worker (offline mode) is off on localhost. Add
`?sw=1` to `work.html` to test it.

## Deploying
GitHub Pages serves the repo root from the `main` branch (Settings → Pages → Deploy from a branch → `main` /
`(root)`). Push to update. The service worker is network-first, so phones get the new version the next time they're
online.
