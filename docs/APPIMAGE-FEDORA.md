# AppImage on Fedora

The 0.12.4 AppImage can abort its WebKit process at startup on Fedora 44:

```
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

Its Ubuntu display libraries conflict with the host Mesa/EGL stack. The same
extracted executable was tested on Fedora 44/KDE Wayland: it reproduced the
abort with the bundled libraries, then loaded the interface and performed device
detection after removing the ten libraries listed in `tools/fix_appimage.py`.
The corrected process remained alive for the 15-second startup test. Keyboard
writes and audio capture were not exercised.

Release packaging now removes those libraries, verifies the repacked image and
signs the final artifact. WebKit and GIO remain bundled. Graphics acceleration
and the WebKit sandbox are not disabled.

Upstream report: https://github.com/tauri-apps/tauri/issues/15976

An affected image cannot display its update dialog. Download the corrected
AppImage from the project's Releases page to replace it once.
