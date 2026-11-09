<div align="center">
  <img src="./app/public/icons/open-akko-512.png" width="128" height="128" alt="Logo Open Akko">

# Open Akko

**Configuration complète des claviers AKKO sous Windows et Linux**

[![Intégration continue](https://github.com/kayzidev/open-akko/actions/workflows/ci.yml/badge.svg?event=pull_request)](https://github.com/kayzidev/open-akko/actions/workflows/ci.yml) [![Statut des publications](https://github.com/kayzidev/open-akko/actions/workflows/release.yml/badge.svg?branch=main&event=push)](https://github.com/kayzidev/open-akko/actions/workflows/release.yml) [![Licence GPL-3.0-or-later](https://img.shields.io/badge/Licence-GPL--3.0--or--later-blue)](./LICENSE)

[📥 Télécharger](https://github.com/kayzidev/open-akko/releases/latest) · [🐛 Signaler un bug](https://github.com/kayzidev/open-akko/issues/new/choose) · [📋 Claviers supportés](docs/BOARDS.md)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/T4V727SHOC)

</div>

---

## ✨ Fonctionnalités

Open Akko vous permet de configurer votre clavier AKKO directement depuis votre ordinateur :

- 🎨 **Éclairage RGB** : personnalisez l'éclairage, les couleurs par touche et les effets
- ⌨️ **Remappage des touches** : réaffectez les touches et créez des macros personnalisées
- 🔊 **Effets audio** : réactivité audio en temps réel sur les claviers compatibles
- 🖼️ **Interface intuitive** : visualisation graphique de votre disposition de clavier
- 🔄 **Mises à jour automatiques** : restez à jour avec les dernières fonctionnalités

<!-- Screenshots will be added here when available
![Open Akko interface]()
![Lighting configuration]()
![Key remapping]()
-->

## 🎹 Claviers supportés

Open Akko prend en charge **1413 modèles de claviers AKKO**, dont :

- **1182 claviers en lecture/écriture** (configuration complète)
- **374 claviers avec rendu visuel** prêt à l'emploi
- **832 claviers avec rendu après confirmation**

Consultez la [liste complète des claviers supportés](docs/BOARDS.md) pour vérifier la compatibilité de votre modèle.

> **Note** : Le support audio a été validé sur l'Akko 5075. Voir [AUDIO.md](AUDIO.md) pour les détails.

## 📥 Installation

### Windows 10/11 (64-bit)

1. Téléchargez l'installateur `.exe` depuis la [page des releases](https://github.com/kayzidev/open-akko/releases/latest)
2. Exécutez l'installateur (les mises à jour automatiques seront disponibles)
3. Branchez votre clavier AKKO en USB

**Format portable** : Une archive `.zip` portable est également disponible

### Linux (64-bit)

#### AppImage (recommandé)

1. Téléchargez le fichier `.AppImage` depuis la [page des releases](https://github.com/kayzidev/open-akko/releases/latest)
2. Rendez-le exécutable : `chmod +x Open-Akko-*.AppImage`
3. Installez les règles udev (requis pour l'accès USB) :

```bash
sudo install -m 0644 packaging/70-open-akko.rules /etc/udev/rules.d/70-open-akko.rules
sudo udevadm control --reload-rules
```

4. Débranchez et rebranchez votre clavier
5. Lancez l'AppImage

> **Note** : Selon votre distribution, vous pourriez avoir besoin d'installer FUSE 2 pour l'AppImage.

#### RPM (Fedora, RHEL, OpenSUSE)

```bash
sudo dnf install ./open-akko-*.rpm
```

#### Arch Linux (AUR)

Un paquet AUR pourra être ajouté par la communauté.

#### Dépendances optionnelles (effets audio)

Pour activer les effets audio en temps réel :

```bash
# Ubuntu/Debian
sudo apt install pipewire-utils pulseaudio-utils

# Fedora
sudo dnf install pipewire-utils pulseaudio-utils

# Arch
sudo pacman -S pipewire pipewire-pulse
```

## 🛠️ Compiler depuis les sources

### Prérequis

- **Node.js** 18+ et npm
- **Rust** 1.70+
- **Python 3**
- **Dépendances système** :
  - Linux : `webkit2gtk`, `libayatana-appindicator`, `udev`
  - Windows : Visual Studio Build Tools

### Compilation

```bash
git clone https://github.com/kayzidev/open-akko.git
cd open-akko/app
npm install
npm run tauri dev  # Mode développement
npm run tauri build  # Build de production
```

Consultez [CONTRIBUTING.md](CONTRIBUTING.md) pour plus de détails sur le développement.

## 🤝 Contribuer

Les contributions sont les bienvenues ! Consultez [CONTRIBUTING.md](CONTRIBUTING.md) pour :

- Signaler un bug ou demander une fonctionnalité
- Soumettre un support pour un nouveau clavier
- Contribuer du code

## 📜 Licence

Open Akko est distribué sous licence [GPL-3.0-or-later](LICENSE).

Ce projet est un fork de [Sharkfin](https://github.com/dniminenn/sharkfin) créé par dniminenn et ses contributeurs. Toutes les notices d'attribution d'origine sont conservées.

Chaque paquet contient un fichier `THIRD-PARTY-NOTICES.md` qui liste ses bibliothèques et polices. Le [fichier du dépôt](THIRD-PARTY-NOTICES.md) contient les notices du code tiers inclus dans les sources.

---

<div align="center">
  <sub>Projet communautaire indépendant • Sans affiliation avec AKKO</sub>
</div>
