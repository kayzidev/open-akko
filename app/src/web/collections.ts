// SPDX-FileCopyrightText: JR Lanteigne <root@dnim.dev>
// SPDX-FileCopyrightText: Shiroki Satsuki <me@shirok1.dev>
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Which HID collection carries the settings protocol. Same rules as
// `hid.rs` on the desktop, so the two builds find the same boards.
// WebHID has no interface number and no serial, so boards that share a
// USB id are one group when both interfaces are granted.

export const USAGE_PAGE = 0xffff;
// Almost every board reports usage 2 on the vendor page; the Akko ACR75 v2
// reports 1, and the vendor's own driver looks for both.
export const USAGES = [0x0001, 0x0002];

/**
 * Boards that answer the protocol on their keyboard collection instead of a
 * vendor page. The Akko 5075B Plus-S in Mac mode enumerates as Apple
 * 05ac:024f with no vendor collection; the vendor's driver carries the same
 * exception, and issue #58 is the round trip. Chromium lets feature reports
 * through on a keyboard collection, which is all sharkfin sends. A real
 * Apple Aluminium Keyboard shares the id and will appear as a stranger.
 */
export const KEYBOARD_COLLECTIONS: HIDDeviceFilter[] = [
  { vendorId: 0x05ac, productId: 0x024f, usagePage: 0x01, usage: 0x06 },
  // 3098B (3151:4002), and 3151:4003 boards that answer on the keyboard
  // collection. The collection itself must carry the 64-byte feature report.
  // A vendor collection that also has one is preferred below.
  { vendorId: 0x3151, productId: 0x4002, usagePage: 0x01, usage: 0x06 },
  { vendorId: 0x3151, productId: 0x4003, usagePage: 0x01, usage: 0x06 },
];

const hasSettingsReport = (c: HIDCollectionInfo): boolean =>
  c.featureReports.some(
    (r) =>
      r.reportId === 0 &&
      r.items.reduce(
        (bits, item) => bits + item.reportSize * item.reportCount,
        0,
      ) === 512,
  ) || c.children.some(hasSettingsReport);

const matches = (d: HIDDevice, f: HIDDeviceFilter) =>
  d.vendorId === f.vendorId &&
  d.productId === f.productId &&
  d.collections.some(
    (c) => c.usagePage === f.usagePage && c.usage === f.usage && hasSettingsReport(c),
  );

export const isSettingsCollection = (d: HIDDevice, vendors: number[]) =>
  (vendors.includes(d.vendorId) &&
    d.collections.some(
      (c) =>
        c.usagePage === USAGE_PAGE &&
        USAGES.includes(c.usage ?? -1) &&
        hasSettingsReport(c),
    )) ||
  KEYBOARD_COLLECTIONS.some((f) => matches(d, f));

export const requestFilters = (vendors: number[]): HIDDeviceFilter[] => [
  ...vendors.flatMap((vendorId) =>
    USAGES.map((usage) => ({ vendorId, usagePage: USAGE_PAGE, usage })),
  ),
  ...KEYBOARD_COLLECTIONS,
];

const vendorSettings = (d: HIDDevice): boolean =>
  d.collections.some(
    (c) =>
      c.usagePage === USAGE_PAGE &&
      USAGES.includes(c.usage ?? -1) &&
      hasSettingsReport(c),
  );

const keyboardSettings = (d: HIDDevice): boolean =>
  KEYBOARD_COLLECTIONS.some(
    (f) => f.usagePage === 0x01 && matches(d, f),
  );

/** Vendor collection wins when the same id also has a keyboard settings collection. */
export const selectSettingsDevices = (devices: HIDDevice[]): HIDDevice[] => {
  const key = (d: HIDDevice) => `${d.vendorId}:${d.productId}`;
  const claimed = new Set(devices.filter(vendorSettings).map(key));
  return devices.filter(
    (d) => !claimed.has(key(d)) || vendorSettings(d) || !keyboardSettings(d),
  );
};
