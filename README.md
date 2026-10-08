# FlatColor Vectorizer

A static, GitHub Pages–ready web app for converting simple raster artwork into flat-color vector paths and exporting SVG and EPS.

## Features

- Upload PNG, JPG, JPEG or WebP images.
- Choose 2, 3, 4, 5, 6 or 8 colors.
- Use an automatically detected palette.
- Or select exact colors and sample them directly from the source image with the eyedropper.
- Preserve white as a real vector fill for silhouette workflows.
- Adjustable edge smoothing and small-detail removal.
- Client-side processing: the image does not need to be uploaded to a server.
- Download editable SVG and EPS output.

## GitHub Pages

1. Create a GitHub repository.
2. Upload `index.html`, `styles.css` and `script.js`.
3. In **Settings → Pages**, publish the main branch root as the source.
4. Open the generated GitHub Pages URL.

No build step is required.

## Notes

The vectorizer is optimized for flat-color graphics, silhouettes, icons and simple illustrations. It traces color-region boundaries on a reduced working raster for browser performance, then scales the resulting paths to the original image dimensions.

For best silhouette results, choose **2 colors**, sample black and white from the artwork, keep **Edge smoothing** around 1–2, and use only a small amount of **Remove tiny details**.


### Multiple image selection
The upload control accepts multiple images at once. Selected files appear in a queue; click any filename to make it the active image for palette selection, vectorization, and SVG/EPS export.
