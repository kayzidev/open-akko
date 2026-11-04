# SPDX-License-Identifier: GPL-3.0-or-later
"""Keep host graphics libraries out of AppImages without stripping WebKit/GIO."""
import tempfile
import unittest
from pathlib import Path

from fix_appimage import bundled_display_libraries, use_host_display_libraries


class DisplayLibrariesTest(unittest.TestCase):
    def test_remove_versioned_libraries_and_links_preserving_other_dependencies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            library = root / "usr/lib/x86_64-linux-gnu"
            library.mkdir(parents=True)
            (library / "libwayland-client.so.0.21.0").touch()
            (library / "libwayland-client.so.0").symlink_to("libwayland-client.so.0.21.0")
            (library / "libXau.so.6").symlink_to("missing-version")
            (library / "libwebkit2gtk-4.1.so.0").touch()
            gio = library / "gio/modules/libgiognutls.so"
            gio.parent.mkdir(parents=True)
            gio.touch()
            lib64 = root / "usr/lib64"
            lib64.mkdir()
            (lib64 / "libxkbcommon.so.0").touch()
            self.assertEqual(len(bundled_display_libraries(root)), 4)
            use_host_display_libraries(root)
            self.assertEqual(bundled_display_libraries(root), [])
            self.assertTrue((library / "libwebkit2gtk-4.1.so.0").exists())
            self.assertTrue(gio.exists())


if __name__ == "__main__":
    unittest.main()
