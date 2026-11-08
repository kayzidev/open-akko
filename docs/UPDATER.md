# Système de mise à jour automatique

Ce document explique comment fonctionne le système de mise à jour intégré d'Open Akko.

## Vue d'ensemble

Open Akko utilise le plugin Tauri Updater pour fournir des mises à jour automatiques sécurisées. Le système :

- Vérifie automatiquement les mises à jour au démarrage et toutes les 4 heures
- Télécharge et vérifie les signatures cryptographiques
- Propose l'installation via une fenêtre de dialogue
- Redémarre l'application après l'installation

## Configuration

### Endpoints de mise à jour

L'application vérifie les mises à jour via :

```
https://github.com/kayzidev/open-akko/releases/latest/download/latest.json
```

Ce fichier JSON contient :
- La version disponible
- Les notes de version (générées automatiquement)
- Les URLs de téléchargement par plateforme
- Les signatures cryptographiques

### Signature des releases

Chaque release est signée avec une clé privée Ed25519. La clé publique est embarquée dans l'application :

```
packaging/updater/public.key
```

**Sécurité** : La clé privée (`TAURI_SIGNING_PRIVATE_KEY`) est stockée dans les secrets GitHub Actions et ne doit jamais être commise dans le dépôt.

## Workflow de release

Lors d'un push sur `main`, le workflow `.github/workflows/release.yml` :

1. **Version** : Calcule la version depuis `package.json` + le numéro de run
2. **Build** : Compile les binaires Windows et Linux signés
3. **Génération du changelog** depuis les commits qui suivent le dernier tag stable
4. **Publication** : Crée une GitHub Release avec :
   - Les binaires signés (`.exe`, `.AppImage`)
   - Le fichier `latest.json` pour l'updater
   - Les signatures `.sig` pour chaque binaire
   - Un fichier `SHA256SUMS.txt`
   - L'archive des sources

## Comportement par type d'installation

### Windows (`.exe`)

- Mises à jour intégrées : ✅ Oui
- Mode d'installation : passif (installation silencieuse en arrière-plan)
- L'application redémarre automatiquement après mise à jour

### Linux AppImage

- Mises à jour intégrées : ✅ Oui
- L'AppImage doit être dans un dossier accessible en écriture
- L'ancien fichier est remplacé par le nouveau
- L'application redémarre automatiquement après mise à jour

### Autres installations (RPM, portable, sources)

- Mises à jour intégrées : ❌ Non
- L'application affiche une notification avec un lien vers la page de téléchargement
- L'utilisateur doit télécharger et installer manuellement

## Frontend

Le composant `UpdateNotice.tsx` gère l'interface utilisateur :

- Bouton "Rechercher une mise à jour" dans la barre latérale
- Fenêtre de dialogue pour visualiser et installer les mises à jour
- Barre de progression pendant le téléchargement
- Gestion des erreurs réseau

### API Update

L'API frontend (`update-session.ts`) expose :

```typescript
interface UpdateApi {
  status(): Promise<UpdateSnapshot>;
  check(): Promise<UpdateInfo | null>;
  install(notify: (progress: UpdateProgress) => void): Promise<void>;
  openReleases(url: string): Promise<void>;
}
```

## Backend

Le backend Rust (`updates.rs`) implémente :

- `update_status()` : Retourne la version actuelle et le type d'installation
- `update_check()` : Vérifie la disponibilité d'une mise à jour
- `update_install()` : Télécharge, vérifie et installe la mise à jour

### Vérifications de sécurité

Le système vérifie automatiquement :

1. **TLS** : Les téléchargements utilisent HTTPS uniquement
2. **Signature** : Chaque binaire est vérifié avec la clé publique embarquée
3. **Intégrité** : Le hash SHA-256 est vérifié
4. **No downgrade** : Seules les versions plus récentes sont acceptées

Ces paramètres de sécurité sont configurés dans `tauri.conf.json` et validés par `tools/release.py`.

## Tests

### Test manuel local

Pour tester localement le mécanisme de mise à jour :

1. Créer une fausse release avec une version supérieure
2. Générer un `latest.json` local
3. Modifier temporairement l'endpoint dans `tauri.conf.json`
4. Compiler et tester

### Tests automatisés

Les tests unitaires couvrent :

- La session de mise à jour (`update-session.test.ts`)
- La gestion des états (checking, downloading, installing)
- Les cas d'erreur (offline, signature invalide)

## Dépannage

### "Vérification impossible"

Causes possibles :
- Pas de connexion internet
- GitHub indisponible
- Proxy bloquant les requêtes

### "Échec de la signature"

Causes possibles :
- Binaire corrompu pendant le téléchargement
- Clé publique incorrecte dans l'application
- Signature invalide (release non officielle)

### Les mises à jour ne s'appliquent pas

Pour AppImage :
- Vérifier que l'AppImage est dans un dossier avec droits d'écriture
- Vérifier les permissions du fichier

Pour Windows :
- L'installateur peut nécessiter des droits administrateur
- Vérifier l'antivirus (faux positif possible)

## Régénération de la clé de signature

Si la clé privée est compromise :

```bash
# Générer une nouvelle paire de clés
cargo install tauri-cli
cargo tauri signer generate

# Stocker la clé privée dans les secrets GitHub
# Remplacer packaging/updater/public.key par la nouvelle clé publique
# Recompiler l'application avec la nouvelle clé
```

⚠️ **Important** : Les anciennes installations ne pourront plus se mettre à jour automatiquement après un changement de clé.

## Références

- [Tauri Updater Plugin](https://v2.tauri.app/plugin/updater/)
- [Conventional Commits](https://www.conventionalcommits.org/)
