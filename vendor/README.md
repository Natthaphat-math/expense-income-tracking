# Third-party files (served from this site, not a CDN)

Loaded only when reading bank slips, then kept in their own service-worker cache.
Folder names carry the version, so files never change in place.

| Folder | Source | License |
|---|---|---|
| `tesseract-5.1.1/tesseract.min.js`, `worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 | Apache-2.0 (`LICENSE-tesseract.js.md`) |
| `tesseract-5.1.1/tesseract-core-*.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) 5.1.1 | Apache-2.0 (`LICENSE-tesseract-core`) |
| `tesseract-5.1.1/tha.traineddata.gz` | Thai model from [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) via `@tesseract.js-data/tha` (4.0.0_best_int) | Apache-2.0 |
| `jsqr-1.4.0/jsQR.min.js` | [jsQR](https://github.com/cozmo/jsQR) 1.4.0, minified | Apache-2.0 (`LICENSE`) |
