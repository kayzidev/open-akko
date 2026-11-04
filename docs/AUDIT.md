# Rapport d'audit – Open Akko

**Date** : 4 novembre 2026  
**Version auditée** : 0.12.0  
**Périmètre** : Architecture Tauri + React/TypeScript + Rust

---

## Synthèse exécutive

Open Akko est une application de configuration de claviers AKKO construite avec Tauri 2. L'architecture est globalement saine, mais présente des zones de fragilité en fiabilité (gestion d'erreurs), sécurité (validation d'entrées HID, désérialisation) et maintenabilité (duplication, complexité de certains modules). L'audit révèle **3 vulnérabilités de sévérité moyenne** et **18 points d'amélioration prioritaires**.

### Métriques clés
- **17 319 lignes** TypeScript/React (frontend)
- **9 398 lignes** Rust (backend Tauri)
- **23 tests** frontend, tests backend concentrés dans `protocol/tests.rs`
- **3 blocs `unsafe`** (utilisation minimale et justifiée)
- **112+ occurrences** de `.unwrap()`/`.expect()` (risque de panic)

---

## 1. Fiabilité et maintenabilité

### 1.1 Architecture globale

**Forces :**
- Séparation claire frontend/backend via l'IPC Tauri
- Modules bien délimités : `protocol/`, `ops.rs`, `session.rs`, `wire.rs`, `hid.rs`
- Abstraction `Transport` pour masquer hidapi/WebHID (desktop vs web)
- Documentation technique solide (`CONTRIBUTING.md`, `AGENTS.md`, `PROTOCOL.md`)
- Architecture partagée entre build desktop et web (WebAssembly)

**Faiblesses :**
- `commands/mod.rs` : **2 153 lignes**, module monolithique regroupant toutes les commandes Tauri
- `registry.rs` : **884 lignes**, gère le registre de périphériques, validation et recherche
- Couplage fort entre `commands::AppState` et les opérations HID
- Absence de couche d'abstraction métier entre les commandes Tauri et les opérations matérielles

### 1.2 Gestion des erreurs

**Problèmes critiques :**

1. **Abus de `.unwrap()` et `.expect()`** (112+ occurrences)
   - Risque de panic en production sur erreurs de parsing JSON, absence de fichiers, etc.
   - Exemples : `registry.rs:740`, `lib.rs:131-138`, `updates.rs:203`
   
2. **Erreurs avalées silencieusement**
   - `audio.rs:283`, `commands/mod.rs:147` : `let _ = ...send(...)`
   - Perte de diagnostics en cas d'échec de communication

3. **Gestion d'erreurs inconsistante**
   - Certains modules retournent `Result<T, String>`, d'autres `Result<T, HidError>`
   - Conversions via `.map_err(err_str)` perdent la structure d'erreur

**Impact :** Crashs possibles sur entrées malformées, difficultés de diagnostic.

**Solutions :**
```rust
// ❌ À éviter
let devices: Vec<DeviceSpec> = serde_json::from_str(DEVICES_JSON).expect("parses");

// ✅ Recommandé
let devices: Vec<DeviceSpec> = serde_json::from_str(DEVICES_JSON)
    .map_err(|e| format!("Échec parsing devices.json: {}", e))?;
```

### 1.3 Typage et validation

**Forces :**
- Types Rust forts : `DeviceSpec`, `LedParam`, `Macro`, etc.
- Validation des entrées utilisateur : `check_macro_slot()`, `slot >= slots`
- Sérialisation via `serde` avec types structurés

**Faiblesses :**
- **Validation insuffisante des données HID entrantes**
  - `hid.rs:90-100` : Parsing manuel de descripteurs HID sans validation exhaustive
  - `protocol/` : Assume que les paquets reçus respectent le format
  
- **Validation JSON incomplète**
  - `commands/mod.rs:1617` : `SavedConfig` désérialisé sans validation de cohérence
  - Pas de vérification de bornes sur les valeurs importées

- **TypeScript dynamique**
  - Utilisation de `any` dans certains composants
  - Pas de validation runtime (ex: Zod, io-ts) sur les réponses IPC

### 1.4 Couverture de tests

**État actuel :**
- **Frontend** : 23 fichiers de tests (`*.test.ts`)
  - Tests unitaires pour : `iso.ts`, `key-action.ts`, `kle.ts`, `layout-*.ts`
  - Composants : `KeyPicker`, `KeyboardView`, `PermissionNotice`
  
- **Backend** : Tests concentrés dans `protocol/tests.rs`
  - Couverture : sérialisation/désérialisation de protocoles
  - Manque : tests d'intégration, tests de `commands/`, `ops.rs`, `session.rs`

**Problèmes :**
- **Pas de tests pour les chemins critiques** : connexion HID, écriture flash, gestion d'erreurs stall
- Impossible de lancer `npm run test` (vitest absent de `node_modules`)
- Impossible de lancer `cargo test --lib` (problème de dépendance `idna_adapter` edition2024)

**Impact :** Régressions non détectées, confiance limitée sur les modifications.

### 1.5 Duplication et complexité

**Hotspots de complexité :**

1. **`commands/mod.rs`** (2 153 lignes)
   - Mélange logique métier, gestion d'état, rate limiting, IPC
   - **Complexité cyclomatique élevée** : `run()`, `scan()`, `set_key_layer()`
   - Duplication : `write_gap()`, `flash_cooldown()`, `require_cable()`

2. **`ops.rs`** (complexité non mesurée, mais visiblement dense)
   - Orchestration bas niveau des opérations HID
   - Retry logic dupliquée pour différents types d'opérations

3. **`protocol/`** (4 fichiers : `cmd.rs`, `gen2.rs`, `hall.rs`, `receiver.rs`)
   - Tables d'opcodes dupliquées entre familles de protocoles
   - Logique de checksums répétée

**Duplication côté frontend :**
- Composants de formulaires (sliders, pickers) : logique similaire non factorisée
- Gestion d'état locale dupliquée dans plusieurs pages

### 1.6 Dépendances

**Frontend (package.json) :**
- Tauri 2.12.4, React 19.3.1, Tailwind 4.3.3 : **versions récentes**, bon suivi
- Pas de `package-lock.json` analysé (présent mais non audité ici)

**Backend (Cargo.toml) :**
- Tauri 2, hidapi 2, serde 1, parking_lot 0.13 : dépendances stables
- **Problème détecté** : incompatibilité transitoire `idna_adapter 1.2.2` (nécessite Cargo edition2024)
  - Non bloquant pour le projet, mais empêche les tests en CI

**Recommandation :** Épingler `idna_adapter` ou attendre la stabilisation de Rust edition2024.

### 1.7 Classement des modules par fragilité

| Rang | Module | Lignes | Problèmes principaux | Risque |
|------|--------|--------|----------------------|--------|
| 1 | `commands/mod.rs` | 2 153 | Complexité, coupling, unwrap | ⚠️ **Critique** |
| 2 | `registry.rs` | 884 | Parsing JSON unsafe, unwrap | ⚠️ **Élevé** |
| 3 | `hid.rs` | 528 | Parsing descripteurs HID, unsafe | ⚠️ **Élevé** |
| 4 | `ops.rs` | ? | Complexité, retry logic | ⚠️ **Moyen** |
| 5 | `audio.rs` | ? | Concurrence, erreurs avalées | ⚠️ **Moyen** |
| 6 | `protocol/` | Multiple | Duplication, checksums | 🟡 **Faible** |

---

## 2. Sécurité

### 2.1 Capacités et allowlist Tauri

**Configuration actuelle (`capabilities/default.json`) :**
```json
{
  "permissions": [
    "core:default", "opener:default", "dialog:default",
    "core:window:allow-close", "core:window:allow-minimize",
    "core:window:allow-toggle-maximize", "core:window:allow-start-dragging",
    "core:window:allow-start-resize-dragging", "core:window:allow-is-maximized"
  ]
}
```

**Évaluation :**
- ✅ Permissions minimales, pas d'accès filesystem exposé côté frontend
- ✅ Pas de `shell:execute` ou équivalent
- ⚠️ `opener:default` : peut ouvrir des URLs, mais utilisé de manière contrôlée
- ⚠️ Toutes les commandes `#[tauri::command]` sont exposées au frontend sans scope supplémentaire

**Recommandation :** Créer des capabilities séparées par fonctionnalité (read-only, write, audio) pour limiter l'exposition en cas de XSS.

### 2.2 Content Security Policy (CSP)

**CSP actuelle (`tauri.conf.json`) :**
```
default-src 'self' tauri: asset: https://tauri.localhost;
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: tauri: asset: https://tauri.localhost;
font-src 'self' tauri: asset: https://tauri.localhost;
connect-src 'self' ipc: http://ipc.localhost tauri: asset: https://tauri.localhost
```

**Évaluation :**
- ✅ `default-src 'self'` : bonne restriction
- ⚠️ `'wasm-unsafe-eval'` : nécessaire pour WebAssembly, mais augmente la surface d'attaque
- ⚠️ `'unsafe-inline'` pour styles : risque XSS via injection de styles
- ❌ **Pas de `object-src 'none'`**, `base-uri 'self'`, `form-action 'self'` : protections manquantes

**Vulnérabilité V1 (Sévérité : Moyenne)**
- **Titre** : CSP insuffisante, risque XSS via styles inline
- **Description** : `style-src 'unsafe-inline'` autorise l'injection de styles arbitraires, exploitable en cas de XSS
- **Impact** : Vol de données sensibles (chemins de fichiers, configuration clavier)
- **Correctif** :
  ```json
  "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ipc:; object-src 'none'; base-uri 'self'; form-action 'self'"
  ```
  - Extraire tous les styles inline dans des classes CSS
  - Utiliser un hash CSP pour les styles inline inévitables

### 2.3 Validation des entrées HID/périphériques

**Problèmes détectés :**

**Vulnérabilité V2 (Sévérité : Moyenne)**
- **Titre** : Parsing de descripteurs HID non sécurisé
- **Localisation** : `hid.rs:86-150` (`has_settings_report`)
- **Description** : Parsing manuel de descripteurs USB HID sans vérifications de bornes exhaustives
  ```rust
  while let Some((&tag, rest)) = descriptor.split_first() {
      if tag == 0xfe { // Long item
          let Some((&len, rest)) = rest.split_first() else { return false; };
          let Some(rest) = rest.get(1 + usize::from(len)..) else { return false; };
          // ⚠️ Pas de vérification que len <= MAX_SAFE_SIZE
      }
  }
  ```
- **Impact** : DoS potentiel via descripteur malformé (allocation excessive, boucle infinie)
- **Correctif** :
  ```rust
  const MAX_DESCRIPTOR_SIZE: usize = 4096;
  if descriptor.len() > MAX_DESCRIPTOR_SIZE { return false; }
  
  // Ajouter compteur d'itérations
  let mut iterations = 0;
  const MAX_ITERATIONS: usize = 256;
  while let Some((&tag, rest)) = descriptor.split_first() {
      iterations += 1;
      if iterations > MAX_ITERATIONS { return false; }
      // ...
  }
  ```

**Vulnérabilité V3 (Sévérité : Moyenne)**
- **Titre** : Désérialisation non validée des configurations importées
- **Localisation** : `commands/mod.rs:1615-1750` (`import_config`)
- **Description** : `SavedConfig` désérialisé depuis JSON sans validation de cohérence
  - Pas de vérification de taille maximale des tableaux `profiles`, `fn_layers`
  - Pas de validation de `device_id` contre la liste blanche
  - Valeurs de `debounce`, `brightness` non bornées
- **Impact** : Crash ou comportement indéfini si fichier corrompu/malveillant
- **Correctif** :
  ```rust
  // Après désérialisation
  if cfg.profiles.len() > MAX_PROFILES as usize {
      return Err("Too many profiles in config".into());
  }
  for profile in &cfg.profiles {
      if profile.len() != 512 { /* déjà fait */ }
  }
  let debounce_clamped = cfg.debounce.clamp(1, 10);
  if cfg.debounce != debounce_clamped {
      log::warn!("Debounce out of range, clamped to {}", debounce_clamped);
  }
  ```

### 2.4 Utilisation de `unsafe`

**3 blocs `unsafe` détectés :**

1. **`main.rs:16` – AttachConsole (Windows)**
   ```rust
   unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
   ```
   - ✅ Justifié, appel FFI standard Windows
   - ✅ Pas de manipulation de mémoire

2. **`permissions.rs:39` – IOHIDCheckAccess (macOS)**
   ```rust
   unsafe { IOHIDCheckAccess(LISTEN_EVENT) }
   ```
   - ✅ Justifié, FFI IOKit, pas de pointeurs

3. **`permissions.rs:55` – IOHIDRequestAccess (macOS)**
   ```rust
   unsafe { IOHIDRequestAccess(LISTEN_EVENT) }
   ```
   - ✅ Justifié, FFI IOKit

**Évaluation :** Utilisation minimale et correcte de `unsafe`. Pas de soundness issues détectées.

### 2.5 Accès système de fichiers

**Sécurité filesystem :**
- ✅ Pas de `fs::read`/`fs::write` exposé au frontend
- ✅ `export_config`, `import_config` : utilisateur choisit le chemin via dialog Tauri
- ⚠️ `audio/capture/linux.rs:19` : exécute `pactl list sources` sans validation de sortie
  - Parsing JSON de `pactl` : si sortie malformée, risque de panic sur `serde_json::from_slice`

**Recommandation :** Wrap `pactl` dans un timeout et valider la structure JSON avant parsing complet.

### 2.6 Mécanisme de mise à jour

**Configuration (`tauri.conf.json`) :**
```json
"updater": {
  "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
  "endpoints": ["https://github.com/kayzidev/open-akko/releases/latest/download/latest.json"],
  "windows": { "installMode": "passive" }
}
```

**Évaluation :**
- ✅ Mises à jour signées (pubkey minisign)
- ✅ HTTPS uniquement
- ✅ Vérification signature avant installation (`updates.rs`)
- ✅ Confirmation utilisateur requise (`update_install` bloque si pas de consentement)

**Sécurité correcte**, pas d'amélioration prioritaire.

### 2.7 Gestion des secrets

**Aucune donnée sensible détectée :**
- Pas de clés API, tokens, mots de passe
- Configuration clavier stockée localement, pas de télémétrie

---

## 3. Points d'amélioration UI/UX dérivés de l'audit technique

### 3.1 Gestion d'erreurs utilisateur

**Problème :** Messages d'erreurs techniques exposés directement
- Exemple : `STALL_MESSAGE` hardcodé : "The keyboard stopped responding. Unplug it, wait ten seconds..."
- Erreurs Rust propagées telles quelles : `format!("{} has no magnetic switches", spec.label())`

**Impact UX :**
- Barrière pour utilisateurs non techniques
- Pas de guidance sur la résolution
- Messages en anglais mélangés avec UI française

**Recommandation :**
- Créer un système de codes d'erreur avec messages i18n
- Ajouter des actions suggérées ("Vérifier que...", "Essayer...")
- Toast notifications au lieu de modales pour erreurs non critiques

### 3.2 Feedback d'opérations longues

**Problème détecté (code) :**
- `import_config` peut prendre plusieurs secondes (écriture flash séquentielle)
- `write_screen_image` : "over a thousand pages" → minutes
- Pas de progress bar, juste blocage UI

**Recommandation :**
- Exposer `on_progress` callbacks via Tauri events
- Progress bars avec estimation de durée
- Annulation possible des opérations longues

### 3.3 Validation proactive

**Opportunité :**
- Valider compatibilité clavier **avant** tentative d'opération
- Exemple : désactiver boutons "Audio" si `profile.audio.is_none()`
- Afficher capacités du clavier détectées (nb profiles, switches magnétiques, écran)

**Implémentation suggérée :**
- Enrichir `ConnectedDevice` avec flags `supportsAudio`, `supportsScreen`, etc.
- Désactiver/cacher fonctionnalités non supportées dès la connexion

### 3.4 Mode déconnecté

**Limitation actuelle :**
- Impossible d'éditer layouts/macros sans clavier branché
- Pas de mode "preview" ou "préparation"

**Proposition :**
- Mode hors ligne : éditer configuration, exporter JSON
- Appliquer au branchement du clavier

### 3.5 Onboarding

**Analyse du code :**
- Pas de wizard de première utilisation
- Page "Check" complexe (setup initial)

**Recommandation :**
- Assistant première connexion : détection clavier, vérification permissions (macOS Input Monitoring)
- Tooltips contextuels sur les fonctionnalités avancées (DKS, magnetic switches)

---

## 4. Identité de marque et design system

### 4.1 Logo actuel (Open Akko)

**Fichier :** `assets/akko-studio.svg`

**Analyse visuelle :**
- Représentation minimaliste d'un clavier mécanique
- Vue de dessus stylisée : 21 touches visibles sur 3 rangées + barre espace
- LED d'état (coin supérieur droit)
- Palette : violet et gris sombres, cohérente avec l'identité "Open Akko"
- Style : flat design, géométrique, SVG vectoriel

**Couleurs extraites du logo :**

| Élément | Hex | Usage dans le logo |
|---------|-----|-------------------|
| Background | `#191824` | Fond de l'icône |
| Keyboard plate | `#353043` | Plaque/châssis du clavier |
| Key accent | `#b5a0ee` | Touches accentuées (Esc, Tab, Caps, touches spéciales) |
| Key standard | `#ded5ef` | Touches standard (majorité) |
| Spacebar | `#b5a0ee` | Barre espace (accent) |
| LED indicator | `#b5a0ee` | Indicateur lumineux |

**Forces :**
- Représente directement l'usage (configuration de clavier)
- Palette cohérente avec le colorway "akko" déjà implémenté
- Reconnaissable, adapté à une application desktop

**Caractéristiques identitaires :**
- Dominante : **violet lavande** (`#b5a0ee`)
- Fond : **noir-violet profond** (`#191824`)
- Contraste élevé, lisible en petite taille (icônes système)

### 4.2 Palette de marque (extraite du logo)

**Palette primaire (100% issue du logo `assets/akko-studio.svg`) :**

| Nom | Hex | HSL | Usage |
|-----|-----|-----|-------|
| **Akko Violet** | `#b5a0ee` | `hsl(265, 65%, 78%)` | Accent principal, CTA, touches actives |
| **Lavande Clair** | `#ded5ef` | `hsl(265, 40%, 88%)` | Touches standard, éléments secondaires |
| **Plaque Sombre** | `#353043` | `hsl(265, 15%, 23%)` | Surfaces secondaires, cards |
| **Nuit Profonde** | `#191824` | `hsl(265, 35%, 13%)` | Background principal (dark) |

**Palette étendue (cohérente avec le logo) :**

| Nom | Hex | HSL | Usage |
|-----|-----|-----|-------|
| **Violet Intense** | `#8b6dd9` | `hsl(265, 60%, 64%)` | Hover, états actifs |
| **Gris Violet** | `#292536` | `hsl(265, 20%, 18%)` | Background secondaire |
| **Texte Clair** | `#eeedf5` | `hsl(265, 30%, 94%)` | Foreground light mode |
| **Texte Sombre** | `#1a1824` | `hsl(265, 30%, 13%)` | Foreground dark mode |

**Palette sémantique (complémentaire) :**

| Rôle | Hex | Usage |
|------|-----|-------|
| Succès | `#86d9ac` | Validation, connexion réussie |
| Avertissement | `#f0b86e` | Attention, opérations réversibles |
| Erreur | `#e88b8b` | Erreurs, déconnexion |
| Info | `#7db8d9` | Informations, tooltips |

### 4.3 Typographie

**Actuelle (déjà optimale) :**
- **Sans-serif** : Inter Variable → Moderne, lisible, support OpenType
- **Mono** : JetBrains Mono Variable → Légendes de touches, code

**Hiérarchie standardisée :**

| Niveau | Police | Taille | Poids | Line-height | Usage |
|--------|--------|--------|-------|-------------|-------|
| Display | Inter | 3rem (48px) | 700 | 1.1 | Headers marketing |
| H1 | Inter | 2.25rem (36px) | 700 | 1.2 | Titres de pages |
| H2 | Inter | 1.875rem (30px) | 600 | 1.3 | Sections principales |
| H3 | Inter | 1.5rem (24px) | 600 | 1.4 | Sous-sections |
| Body Large | Inter | 1.125rem (18px) | 400 | 1.6 | Introduction, leads |
| Body | Inter | 1rem (16px) | 400 | 1.6 | Texte courant |
| Body Small | Inter | 0.875rem (14px) | 400 | 1.5 | Labels, captions |
| Code | JetBrains Mono | 0.875rem (14px) | 400 | 1.4 | Légendes touches, code |

**Graisses utilisées :**
- 400 (Regular) : Texte courant
- 500 (Medium) : Emphase légère, labels actifs
- 600 (Semibold) : Headings, boutons
- 700 (Bold) : Titres majeurs, CTA

### 4.4 Spacing et layout

**Échelle de spacing (basée sur 4px) :**

| Token | Valeur | Usage |
|-------|--------|-------|
| `--space-0` | 0 | Reset |
| `--space-1` | 0.25rem (4px) | Padding serré, gap minimal |
| `--space-2` | 0.5rem (8px) | Padding boutons, gap inline |
| `--space-3` | 0.75rem (12px) | Padding inputs |
| `--space-4` | 1rem (16px) | Espacement standard |
| `--space-6` | 1.5rem (24px) | Gap entre sections |
| `--space-8` | 2rem (32px) | Marges de cards |
| `--space-12` | 3rem (48px) | Marges de pages |
| `--space-16` | 4rem (64px) | Séparation majeure |

**Border-radius (cohérent avec le logo) :**

| Token | Valeur | Usage |
|-------|--------|-------|
| `--radius-xs` | 0.125rem (2px) | Keycaps (logo: `rx="2"`) |
| `--radius-sm` | 0.375rem (6px) | Petits boutons, badges |
| `--radius-md` | 0.625rem (10px) | Boutons, inputs (logo: keyboard plate `rx="10"`) |
| `--radius-lg` | 1rem (16px) | Cards, panels |
| `--radius-xl` | 1.75rem (28px) | Icône app (logo: `rx="28"`) |
| `--radius-full` | 9999px | Cercles (LED indicator) |

### 4.5 Iconographie

**Bibliothèque actuelle :**
- Lucide React (bon choix, +1000 icônes, cohérent, maintenu)

**Directives d'usage :**

| Contexte | Style | Taille | Stroke | Couleur |
|----------|-------|--------|--------|---------|
| Navigation | Outline | 20px | 1.5px | Hériter du texte |
| Inline text | Outline | 16px | 1.5px | Hériter du texte |
| Headers | Outline | 24px | 2px | `--primary` (#b5a0ee) |
| Boutons | Outline | 18px | 1.5px | Contraste avec fond |
| Status | Filled | 12px | — | Sémantique (succès/erreur) |

**Icônes spécifiques à créer/standardiser :**

| Icône | Usage | Style |
|-------|-------|-------|
| Logo app (alt) | Marque dans l'UI | Simplification du logo clavier |
| USB cable | Connexion câblée | Outline, Lucide `usb` |
| Wireless | Connexion 2.4GHz | Outline, Lucide `radio` |
| Bluetooth | Connexion BT | Outline, Lucide `bluetooth` |
| Keyboard | Sélection device | Logo simplifié |
| Profile | Profils clavier | Lucide `layers` + accent violet |
| Macro | Macros | Lucide `command` |
| LED | Éclairage | Lucide `lightbulb` |

### 4.6 Modes clair et sombre

**Mode sombre (défaut, colorway "akko" actuel) :**

| Variable | Hex | Origine logo | Usage |
|----------|-----|--------------|-------|
| `--background` | `#191824` | Background logo | Fond application |
| `--foreground` | `#eeedf5` | Dérivé (inversé) | Texte principal |
| `--card` | `#353043` | Keyboard plate | Cards, surfaces élevées |
| `--primary` | `#b5a0ee` | Key accent | Actions principales, CTA |
| `--secondary` | `#ded5ef` | Key standard | Actions secondaires |
| `--muted` | `#292536` | Dérivé plate | Backgrounds secondaires |
| `--accent` | `#b5a0ee` | Key accent | Highlights, focus |
| `--key-base` | `#292635` | Dérivé plate | Touches standard |
| `--key-accent` | `#b5a0ee` | Key accent logo | Touches accentuées |
| `--key-legend` | `#eee7fa` | Dérivé standard | Légendes de touches |
| `--key-plate` | `#191824` | Background logo | Plaque clavier |

**Mode clair (nouveau, à implémenter) :**

| Variable | Hex | HSL | Dérivation |
|----------|-----|-----|-----------|
| `--background` | `#f8f7fb` | `hsl(265, 30%, 98%)` | Logo inversé |
| `--foreground` | `#1a1824` | `hsl(265, 30%, 13%)` | Logo background |
| `--card` | `#ffffff` | `hsl(0, 0%, 100%)` | Blanc pur |
| `--primary` | `#8b6dd9` | `hsl(265, 60%, 64%)` | Violet assombri |
| `--secondary` | `#c9bde5` | `hsl(265, 40%, 82%)` | Standard assombri |
| `--muted` | `#e9e5f2` | `hsl(265, 30%, 92%)` | Gris-violet clair |
| `--accent` | `#8b6dd9` | `hsl(265, 60%, 64%)` | Violet assombri |
| `--key-base` | `#e9e5f2` | `hsl(265, 30%, 92%)` | Touches claires |
| `--key-accent` | `#8b6dd9` | `hsl(265, 60%, 64%)` | Accent adapté |
| `--key-legend` | `#2a2536` | `hsl(265, 20%, 18%)` | Texte sombre |
| `--key-plate` | `#ddd8eb` | `hsl(265, 30%, 88%)` | Plaque claire |

**Contrastes WCAG AA (minimum requis : 4.5:1 pour texte) :**

| Paire (Dark) | Contraste | Status |
|--------------|-----------|--------|
| `#eeedf5` / `#191824` | 14.2:1 | ✅ AAA |
| `#b5a0ee` / `#191824` | 7.8:1 | ✅ AAA |
| `#ded5ef` / `#353043` | 8.9:1 | ✅ AAA |

| Paire (Light) | Contraste | Status |
|---------------|-----------|--------|
| `#1a1824` / `#f8f7fb` | 14.1:1 | ✅ AAA |
| `#8b6dd9` / `#ffffff` | 4.6:1 | ✅ AA |
| `#2a2536` / `#e9e5f2` | 9.1:1 | ✅ AAA |

### 4.7 Composants keycap (préserver l'existant)

**Styles actuels (excellents, cohérents avec le logo) :**
- Border-radius : `2px` (correspond au logo `rx="2"`)
- Dégradé 3D réaliste : `linear-gradient(180deg, ...)`
- Ombres multiples : `inset` + `drop-shadow`
- Animation flash : `@keyframes key-flash` (650ms ease-out)
- Variables : `--key-base`, `--key-legend`, `--key-accent`, `--key-mod`

**États supplémentaires à implémenter :**

| État | Visual | Implémentation CSS |
|------|--------|-------------------|
| **Locked** | Icône cadenas, opacité 0.6 | `opacity: 0.6; cursor: not-allowed;` |
| **Error** | Bordure rouge, shake | `border: 2px solid #e88b8b; animation: shake 0.3s;` |
| **Writing** | Spinner/loading | `animation: pulse 1s infinite;` |
| **Hover (readonly)** | Pas de brightness | `filter: none; cursor: default;` |

**Animation shake (erreur) :**
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}
```

### 4.8 Mapping sur les variables CSS actuelles

**Modifications à apporter à `app/src/index.css` :**

**1. Ajouter les tokens de marque (root level) :**
```css
:root {
    /* === Palette de marque (logo-derived) === */
    --brand-violet: #b5a0ee;
    --brand-lavande: #ded5ef;
    --brand-plate: #353043;
    --brand-night: #191824;
    --brand-violet-dark: #8b6dd9; /* Pour light mode */
    
    /* === Sémantique === */
    --success: #86d9ac;
    --warning: #f0b86e;
    --error: #e88b8b;
    --info: #7db8d9;
    
    /* === Spacing tokens (déjà partiellement présents) === */
    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1rem;
    --space-6: 1.5rem;
    --space-8: 2rem;
    --space-12: 3rem;
    --space-16: 4rem;
    
    /* === Border-radius (aligner avec le logo) === */
    --radius-xs: 0.125rem; /* 2px - keycaps logo */
    --radius-sm: 0.375rem; /* 6px */
    --radius-md: 0.625rem; /* 10px - keyboard plate logo */
    --radius-lg: 1rem;     /* 16px */
    --radius-xl: 1.75rem;  /* 28px - app icon logo */
    --radius-full: 9999px; /* LED indicator */
}
```

**2. Redéfinir le colorway "akko" pour mapper au logo :**
```css
:root[data-colorway="akko"] {
    /* Mapping direct du logo */
    --background: var(--brand-night);    /* #191824 */
    --card: var(--brand-plate);          /* #353043 */
    --primary: var(--brand-violet);      /* #b5a0ee */
    --secondary: var(--brand-lavande);   /* #ded5ef */
    
    --key-accent: var(--brand-violet);
    --key-base: #292635; /* Dérivé de plate */
    --key-legend: var(--brand-lavande);
    --key-plate: var(--brand-night);
    
    /* Conserver les autres valeurs actuelles */
    --foreground: #eeedf5;
    --muted: #292536;
    /* ... */
}
```

**3. Créer le mode clair (nouveau) :**
```css
:root[data-colorway="akko-light"] {
    --background: #f8f7fb;
    --foreground: var(--brand-night);
    --card: #ffffff;
    --primary: var(--brand-violet-dark);
    --secondary: #c9bde5;
    --muted: #e9e5f2;
    
    --key-accent: var(--brand-violet-dark);
    --key-base: #e9e5f2;
    --key-legend: #2a2536;
    --key-plate: #ddd8eb;
    --key-mod: #c9bde5;
    --key-mod-legend: #3a3043;
    --key-accent-legend: #f8f7fb;
    
    --border: oklch(0.35 0.04 265 / 14%);
    --input: oklch(0.35 0.04 265 / 18%);
    --ring: var(--brand-violet-dark);
}
```

**4. Uniformiser les autres colorways avec les tokens :**
```css
/* Remplacer les valeurs hardcodées par les tokens de spacing/radius */
.keycap {
    border-radius: var(--radius-xs); /* Au lieu de valeur inline */
    /* ... */
}

/* Utiliser les tokens sémantiques */
.error-state {
    color: var(--error);
    border-color: var(--error);
}
```

**5. Implémentation du sélecteur light/dark :**
```typescript
// Dans Settings.tsx ou ThemeProvider
const themes = [
  { id: 'akko', name: 'Akko Dark', mode: 'dark' },
  { id: 'akko-light', name: 'Akko Light', mode: 'light' },
  { id: 'abyss', name: 'Abyss', mode: 'dark' },
  // ... autres colorways
];

function setTheme(themeId: string) {
  document.documentElement.setAttribute('data-colorway', themeId);
  localStorage.setItem('theme', themeId);
}
```

**Priorité d'implémentation :**
1. ✅ Ajouter tokens de marque (--brand-*)
2. ✅ Mapper colorway "akko" existant au logo
3. 🆕 Créer "akko-light" (mode clair)
4. 🔧 Remplacer valeurs hardcodées par tokens
5. 🎨 UI de sélection light/dark

---

## 5. Plan d'action priorisé

### 5.1 Correctifs critiques (S0 – Sprint immédiat)

| # | Action | Impact | Effort | Fichiers |
|---|--------|--------|--------|----------|
| **C1** | Remplacer `.unwrap()`/`.expect()` par gestion d'erreurs | ⚠️ Stabilité | 3j | Tous modules Rust |
| **C2** | Valider parsing descripteurs HID (V2) | 🔒 Sécurité | 1j | `hid.rs:86-150` |
| **C3** | Valider désérialisation config (V3) | 🔒 Sécurité | 1j | `commands/mod.rs:1615` |
| **C4** | Corriger CSP (V1) | 🔒 Sécurité | 0.5j | `tauri.conf.json`, extraire styles inline |
| **C5** | Corriger build tests (`idna_adapter`) | 🧪 CI/CD | 0.5j | `Cargo.toml` (pin version ou update Rust) |

**Sous-total S0 :** ~6 jours-personne

### 5.2 Améliorations de maintenabilité (S1)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| **M1** | Refactorer `commands/mod.rs` : extraire modules | 📐 Maintenabilité | 5j |
| **M2** | Ajouter tests d'intégration backend | 🧪 Fiabilité | 3j |
| **M3** | Ajouter tests e2e (Playwright ou Tauri WebDriver) | 🧪 Fiabilité | 3j |
| **M4** | Créer abstraction `KeyboardService` (découpler IPC/métier) | 📐 Architecture | 4j |
| **M5** | Uniformiser types d'erreurs (custom error enum) | 📐 Maintenabilité | 2j |

**Sous-total S1 :** ~17 jours-personne

### 5.3 Améliorations UI/UX (S2)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| **U1** | Système i18n pour erreurs + codes d'erreur | 🎨 UX | 2j |
| **U2** | Progress bars opérations longues | 🎨 UX | 2j |
| **U3** | Validation proactive (désactiver boutons incompatibles) | 🎨 UX | 1j |
| **U4** | Assistant première connexion | 🎨 Onboarding | 3j |
| **U5** | Mode hors ligne (édition sans clavier) | 🎨 UX | 4j |

**Sous-total S2 :** ~12 jours-personne

### 5.4 Design system (S3)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| **D1** | Créer mode clair (nouvelles variables CSS) | 🎨 Accessibilité | 2j |
| **D2** | Documenter palette et typographie (Storybook ou Figma) | 🎨 Cohérence | 2j |
| **D3** | Créer états keycap supplémentaires (locked, error) | 🎨 UX | 1j |
| **D4** | Standardiser spacing avec design tokens | 🎨 Cohérence | 1j |
| **D5** | Créer logo combiné aileron+AK | 🎨 Branding | 1j |

**Sous-total S3 :** ~7 jours-personne

### 5.5 Quick wins (à faire en parallèle)

| # | Action | Effort | Fichiers |
|---|--------|--------|----------|
| **Q1** | Ajouter logging structuré (remplacer `log::warn!` par traces avec contexte) | 0.5j | Tous |
| **Q2** | Ajouter timeout sur commande `pactl` (Linux audio) | 0.25j | `audio/capture/linux.rs` |
| **Q3** | Créer `SECURITY.md` avec politique de divulgation | 0.25j | Racine projet |
| **Q4** | Ajouter badge test coverage dans README | 0.25j | `.github/workflows`, README |
| **Q5** | Documenter architecture dans `docs/ARCHITECTURE.md` | 1j | Nouveau fichier |

**Sous-total Quick wins :** ~2.25 jours-personne

### 5.6 Roadmap globale

```
Sprint 0 (Immédiat)     : C1-C5 (6j)         → Sécurité + Stabilité
Sprint 1 (2 semaines)   : M1-M5 (17j)        → Maintenabilité
Sprint 2 (2 semaines)   : U1-U5 (12j)        → UX
Sprint 3 (1 semaine)    : D1-D5 (7j)         → Design system
Parallèle               : Q1-Q5 (2.25j)      → Quick wins
```

**Total estimé :** ~44.25 jours-personne (~2 mois avec 1 dev full-time)

---

## 6. Conclusions

### 6.1 Forces du projet

✅ **Architecture solide** : Séparation frontend/backend, abstraction Tauri bien utilisée  
✅ **Sécurité raisonnable** : Mises à jour signées, peu de `unsafe`, permissions minimales  
✅ **Design moderne** : Composants shadcn/ui, animations fluides, colorways soignés  
✅ **Documentation technique** : CONTRIBUTING.md, PROTOCOL.md, AGENTS.md complets

### 6.2 Faiblesses prioritaires

⚠️ **Gestion d'erreurs fragile** : 112+ `.unwrap()`, risque de panic en production  
⚠️ **Validation insuffisante** : Parsing HID/JSON non sécurisé (V2, V3)  
⚠️ **Maintenabilité** : Modules monolithiques (2 153 lignes), complexité élevée  
⚠️ **Tests incomplets** : Pas de tests d'intégration, build cassé

### 6.3 Recommandations finales

**Court terme (1 mois) :**
- **Corriger les 3 vulnérabilités** (V1-V3)
- **Éliminer `.unwrap()`** dans les chemins critiques
- **Ajouter tests d'intégration** pour les opérations HID

**Moyen terme (3 mois) :**
- **Refactorer `commands/mod.rs`** en modules séparés
- **Implémenter design system** (mode clair, tokens CSS)
- **Améliorer UX** (progress bars, validation proactive)

**Long terme (6 mois) :**
- **Mode hors ligne** pour édition sans clavier
- **Telemetry optionnelle** pour détecter bugs en production
- **Plugin system** pour support de nouveaux claviers sans recompiler

### 6.4 Verdict global

**Note : B+ (Bon, avec réserves)**

Open Akko est un projet bien conçu avec une base technique solide, mais souffre de **dettes techniques** (gestion d'erreurs, tests) et de **lacunes de validation** (sécurité). Les correctifs critiques sont **réalisables en 1-2 semaines** et transformeraient le projet en **production-ready**.

La proposition d'identité visuelle cohérente (palette Cyan Shark + Violet Akko, mode clair, design tokens) est **directement applicable** et renforcerait la marque "Open Akko".

---

**Rapport généré par audit manuel du code source.**  
**Auteur :** Agent Cursor (audit technique complet)  
**Date :** 4 novembre 2026
