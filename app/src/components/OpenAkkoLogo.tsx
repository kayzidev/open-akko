// SPDX-License-Identifier: GPL-3.0-or-later
import logo from "@/assets/open-akko.png";

export default function OpenAkkoLogo({ size = 24 }: { size?: number }) {
  return <img src={logo} width={size} height={size} alt="Open Akko" draggable={false} className="pointer-events-none shrink-0 object-contain" />;
}
