# Mood-card illustrations

Original artwork generated with the built-in image generation tool for Sonora. No third-party images or licensed characters are used. Generated PNG masters remain in the local Codex generated-images directory; the app uses alpha-preserving WebP copies in public/mood-overlays/.

The final Pink Energy asset is deliberately a flat cartoon. Two earlier painterly cat drafts were rejected and are not included.

## Prompt set

Shared brief: A transparent decorative illustration for a themed lyric-sharing music card. Compact square composition, complete objects, transparent margin, no text, logo, watermark, UI or mockup.

- **pink-v3.webp:** A flat 2D cartoon cream kitten peeking over a dusty-pink ribbon. Solid flat fills, clean rounded dark-rose outline, dot eyes, tiny triangular nose, two oval paws, blush cheeks and small pointy ears. Original kawaii character. No fur texture, watercolor, photorealism, glossy eyes, other objects or collage.
- **retro-v3.webp:** Authentic pixel-art arcade vignette with two original alien robot companions, small arcade cabinet, ringed planet, pixel stars and controller. Crisp square pixels, 16-bit adventure-game craft, lime, lavender, coral, teal and deep navy.
- **gotham-v3.webp:** 1930s noir jazz illustration: original fedora-wearing saxophonist, brass saxophone, angular Art Deco towers, amber streetlamp, burgundy mist and crescent moon. Vintage screenprint in navy, wine and antique gold; no superheroes.
- **notebook-v3.webp:** Hand-drawn music scrapbook with vintage cassette player, wired headphones, coffee cup, blue-ink stars, torn ivory notebook paper, plaid washi and small wildflowers. Pencil and gouache, cobalt and faded red.
- **classic-v3.webp:** Editorial music collage with forest-green vinyl and sleeve, headphones, layered paper ribbons, ivory starbursts and flowing shapes. Gouache and print texture, mint, cream, forest and restrained vermilion.

## Layout

Canvas composition combines the illustrations with theme-specific borders, ribbon details, paper, print texture, rain, architecture, pixel ornaments and type. Decorations may overlap a frame intentionally. Song text and the SONORA signature use a shared inner safe area. The equalizer uses a footer-relative baseline. Card height and type size follow measured wrapping instead of fixed aspect ratios.

## Retro sprite composition

Retro now uses the 23 individual PNGs supplied by the user in `public/mood-overlays/retro-sprites/`, copied without image edits. `assets_manifest.json` records native dimensions. These replace the single combined Retro vignette in card rendering. The cabinet stands on its rock platform; robots occupy opposite sides of the lyric field, with the planet, controller, crystals, stars and asteroids distributed across the frame. Nearest-neighbor drawing preserves the pixel edges, and placement follows measured card height. Sprites can cross the decorative frame but are kept inside the exported photo.

## Gotham individual sprites and responsive width

Gotham cards use the 17 user-supplied transparent PNGs in `public/mood-overlays/gotham-sprites/` unchanged. The musician, streetlamp, moon, smoke, buildings, bridge and separate saxophone are positioned independently across the measured card. The bridge height is capped to keep its architecture in the footer. Landscape width measures the longest selected lyric at the intended font size, within the space needed for the song header; it is no longer a fixed 1440 pixels. The Retro cabinet is centered on its rock platform, with its base aligned to the top surface.

Gotham composition revision: only the grouped skyline is used, grounded on the inner bottom frame at height minus 76px. The lamp shares the musician’s pavement and draws behind him. Individual floating towers and the bridge are excluded; border stars inherit the theme accent, and crimson clouds layer over the scenery.
