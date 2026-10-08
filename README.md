# FlatColor Vectorizer

A static GitHub Pages tool for converting flat-color PNG/JPG/WebP artwork into clean SVG and EPS vectors.

## Batch vectorization

1. Click **Choose Images** and select multiple image files at once, or drag and drop multiple files.
2. Choose 2, 3, 4, 5, 6, or 8 colors.
3. Use **Selected Colors** for one shared palette across the whole batch, or **Auto Palette** to detect a separate palette for every image.
4. Click **Vectorize All** once. The tool processes the images **serially**, one file at a time, and shows progress.
5. Each completed file gets separate SVG and EPS download buttons in the batch results list.

All processing happens in the browser. No server upload is required.

## GitHub Pages

Upload `index.html`, `styles.css`, and `script.js` to a repository and enable GitHub Pages from the repository's main branch/root folder.


## Vectorization engine
The primary tracing engine is ImageTracerJS 1.2.6 loaded from jsDelivr. It traces 8-direction contours and fits straight/quadratic spline segments for smoother editable vector paths. The site keeps the previous tracer as a fallback if the external engine is unavailable.

The GitHub Pages site therefore needs normal internet access when opened so the ImageTracerJS CDN file can load.
