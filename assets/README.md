# Open Akko logo

`open-akko.png` is the transparent master approved on 2026-11-04.
Design brief: a Siamese cat and mechanical keyboard divided diagonally, with
a dark mask, blue eye, ivory fur and lavender keys. Generated with imagegen.
Distributed under the project's GPL-3.0-or-later license.

Regenerate the desktop icons with:

```
cd app
npx tauri icon ../assets/open-akko.png --output /tmp/open-akko-icons
```

Copy the existing desktop icon filenames from that directory into
`app/src-tauri/icons`. The interface uses its 256-pixel PNG. Generate web
icons with `--png 32 --png 192 --png 512` and use the `open-akko-<size>.png`
names in `app/public/icons`.
