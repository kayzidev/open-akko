# GitHub et mises à jour

Dépôt : https://github.com/kayzidev/open-akko
Branche de publication : `main`.

## Première mise en service

1. Importez les sources dans le dépôt, en conservant `.github/`, `LICENSE`, `THIRD-PARTY-NOTICES.md` et `packaging/updater/public.key`.
2. Dans GitHub, ouvrez **Settings → Secrets and variables → Actions → New repository secret**. Créez `TAURI_SIGNING_PRIVATE_KEY` avec le contenu complet du fichier privé généré lors de la préparation. Le fichier public est déjà inclus dans le projet ; le fichier privé reste hors de l’export.
3. La clé préparée utilise un mot de passe vide. Le secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` est facultatif dans ce cas. Si une autre clé est créée avec un mot de passe, configurez ce second secret et remplacez aussi la clé publique dans `tauri.conf.json` et `packaging/updater/public.key` avant la première distribution.
4. Ouvrez **Actions → Publish clients → Run workflow**, sur `main`, ou fusionnez une modification dans `main`.
5. Attendez la fin des vérifications et des deux compilations. La version apparaît ensuite dans **Releases** avec son installateur Windows, son AppImage Linux, ses signatures, `latest.json`, les sommes SHA-256 et les sources.
6. Installez cette première version sur chaque poste. Les anciennes versions qui n’ont pas encore de vérificateur de mises à jour doivent être remplacées une fois.

Le dépôt est public. Le client ne contient aucun jeton GitHub. Le jeton temporaire `GITHUB_TOKEN` sert uniquement au workflow de publication. La signature de mise à jour ne remplace pas une signature de code Windows Authenticode ; un certificat Windows pourra être ajouté séparément.

Conservez une sauvegarde de la clé privée hors du dépôt. Les clients déjà installés font confiance à cette clé ; un simple remplacement de la clé publique dans une future compilation ne met pas à jour leur confiance.

## Fonctionnement après une fusion

| Étape | Résultat |
| --- | --- |
| Pull request | Tests Linux et Windows, sans accès à la clé de publication |
| Fusion ou push dans `main` | Nouvelle exécution de `Publish clients` |
| Contrôles réussis | Version calculée puis deux compilations signées |
| Deux paquets disponibles | Vérification des signatures avec la clé publique du client |
| Toutes les vérifications réussies | Publication de la release et de `latest.json` |
| Client démarré | Vérification après 8 secondes, puis toutes les 4 heures |
| Nouvelle version | Fenêtre avec nouveautés, « Plus tard » et bouton de mise à jour |
| Acceptation | Téléchargement, contrôle de signature, attente des opérations USB, arrêt audio et installation |

Les tags ne déclenchent pas de publication. Une fusion dans `main`, un push dans `main` ou un lancement manuel sur `main` déclenche les contrôles. Une compilation en échec ne publie pas une version partielle. Une release publiée n’est pas remplacée lors d’une relance du même workflow. Une release laissée en brouillon peut être complétée en relançant la même exécution.

« Plus tard » reporte le rappel de cette version pendant 24 heures. Une nouvelle version différente est proposée sans attendre. Le bouton de recherche dans le panneau latéral permet de vérifier à tout moment. Une absence de réseau ne déclenche pas de fenêtre d’erreur lors des vérifications automatiques.

## Versions

La version du dépôt est le point de départ, actuellement `0.12.0`. Pour chaque exécution du workflow, le numéro d’exécution GitHub s’ajoute au troisième nombre : exécution numéro 5 : `0.12.5`, numéro 6 : `0.12.6`, etc. Les versions déjà publiées restent inchangées. Une relance de la même exécution conserve son numéro.

Le workflow met à jour les versions des fichiers de compilation dans son espace temporaire. Il n’ajoute pas de commit de version à `main` et ne crée pas de boucle de publication. Le tag vise le commit exact ayant déclenché la compilation.

Pour une nouvelle série, modifiez ensemble les versions de `app/package.json`, `app/package-lock.json`, `app/src-tauri/tauri.conf.json`, les deux `Cargo.toml` et leurs `Cargo.lock`. Passez par exemple à `0.13.0`. Ne baissez pas une série déjà distribuée. Gardez le nom du workflow `release.yml`, dont dépend la numérotation des exécutions.

## Windows et Fedora

| Installation | Comportement |
| --- | --- |
| Windows, installateur NSIS `.exe` | Installation après acceptation, puis relance automatique |
| Linux, AppImage dans un dossier utilisateur accessible en écriture | Remplacement de l’AppImage après vérification, puis relance |
| Compilation locale, ZIP portable ou paquet RPM | Détection et fenêtre, puis ouverture de la page de téléchargement |

L’installation locale actuelle sur le poste Fedora était un exécutable compilé directement. Elle pourra détecter les versions publiées, mais le passage à la première AppImage sera nécessaire une fois pour obtenir l’installation intégrée. Les préférences utilisent le même identifiant d’application, `com.kayzidev.open-akko`.

Les règles USB et `pipewire-utils` / `pulseaudio-utils` sont à installer une seule fois sur Fedora. Une mise à jour ne demande pas les droits administrateur pour remplacer une AppImage placée dans un dossier utilisateur. Si elle se trouve dans un dossier système, déplacez-la d’abord dans un emplacement accessible en écriture.

Les builds distribués ciblent Windows et Linux x64. Les profils d’autres claviers et le support audio Windows restent à vérifier sur les appareils correspondants. Une compilation réussie ne remplace pas un essai matériel.

## Import avec Git

Le dépôt existant contient un README initial. Clonez-le avant de copier l’export pour conserver son historique :

```sh
git clone https://github.com/kayzidev/open-akko.git
cd open-akko
git switch -c preparation-client
# Copiez ici le contenu de l’export, y compris les dossiers cachés.
git add .
git commit -m "Prepare releases"
git push -u origin preparation-client
```

Ouvrez ensuite une pull request vers `main`. Configurez le secret avant de fusionner. Aucun envoi GitHub ni aucune publication n’est réalisé par les outils de préparation locale.

## Commandes de contrôle

```sh
python tools/check_studio_profiles.py
python tools/release.py validate
python -m unittest discover -s tools -p test_release.py
cd app
npm ci
npm run build
npx vitest run
cd src-tauri
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --lib
```

`tools/release.py` prépare les versions et refuse une publication incomplète. `tools/verify-release` vérifie les signatures avec la même bibliothèque de vérification que le client. Les clés privées ne sont ni requises ni incluses pour exécuter les tests ordinaires.
