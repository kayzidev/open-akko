# Open Akko

<p align="center"><img src="assets/open-akko.png" width="160" alt="Open Akko : chat siamois et clavier séparés en diagonale"></p>

Configuration des claviers AKKO sous Windows et Linux : éclairage, couleurs par touche, affectations, macros et effets audio selon les capacités du modèle.

[Téléchargements](https://github.com/kayzidev/open-akko/releases/latest) · [Signaler un problème](https://github.com/kayzidev/open-akko/issues) · [Profils de claviers](docs/MULTI-KEYBOARDS-WINDOWS.md)

## Installation

| Système | Format | Mises à jour intégrées |
| --- | --- | --- |
| Windows 10/11 x64 | Installateur `.exe` | Oui, après confirmation |
| Fedora / Linux x64 | `.AppImage` dans un dossier accessible en écriture | Oui, après confirmation |
| Compilation locale, paquet RPM ou archive portable | Selon votre installation | Notification et page de téléchargement |

Sous Linux, installez `pipewire-utils` et `pulseaudio-utils` pour les effets audio. Installez aussi les règles d’accès USB une fois, puis rebranchez le clavier :

```sh
sudo install -m 0644 packaging/70-open-akko.rules /etc/udev/rules.d/70-open-akko.rules
sudo udevadm control --reload-rules
```

Pour exécuter l’AppImage, rendez-la exécutable dans les propriétés du fichier. Selon la distribution, le paquet de compatibilité FUSE 2 peut être nécessaire.

## Claviers et audio

Branchez le clavier en USB pour modifier ses réglages. Le registre distingue les modèles, leurs protocoles et les fonctions validées. Un nom de gamme ou un identifiant USB partagé ne suffit pas à activer une nouvelle fonction.

Le mode audio a été vérifié sur l’Akko 5075 identifié en interne comme `1165` : sortie PC sur la zone principale, microphone sur Home, PgUp, PgDn, End et flèche droite. Les deux sources ont leurs propres réglages. Le son est analysé localement, sans enregistrement.

Les profils 5075B Plus et 3098B préparent leur intégration. Leur présence dans le catalogue ne valide pas le mode audio sur ces modèles. Voir [la documentation audio](AUDIO.md).

## Mises à jour

Après une fusion dans `main`, GitHub vérifie les clients Windows/Linux, construit les deux paquets signés et publie une version. Si un contrôle ou une compilation échoue, aucune nouvelle version n’est proposée aux clients.

Le client vérifie au lancement puis toutes les quatre heures. Une fenêtre propose l’installation ou « Plus tard ». Le téléchargement et l’installation ne commencent qu’après acceptation. La signature est vérifiée avant l’installation ; le logiciel attend les opérations USB en cours et rétablit l’éclairage avant de redémarrer.

La publication nécessite d’abord la configuration de la clé privée dans les secrets GitHub. Voir [le guide GitHub et mises à jour](docs/GITHUB-RELEASES.md).

## Développement

```sh
cd app
npm ci
npm run tauri dev
```

Les dépendances système et les formats sont détaillés dans [le guide Windows/Linux](docs/MULTI-KEYBOARDS-WINDOWS.md). Les tests et les règles de contribution sont dans [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence et origine

Open Akko est une adaptation de [Sharkfin, par dniminenn et ses contributeurs](https://github.com/dniminenn/sharkfin), distribuée sous [GPL-3.0-or-later](LICENSE). Les notices et attributions d’origine sont conservées. Les bibliothèques et polices distribuées sont décrites dans [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Projet communautaire indépendant, sans affiliation à AKKO.
