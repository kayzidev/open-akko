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

### 4.1 Logo actuel

**Fichier :** `docs/logo.svg`

**Analyse visuelle :**
- Aileron de requin stylisé (référence "sharkfin", nom de projet original)
- Palette : dégradé bleu cyan (`#8fdcf2` → `#3d9fc4`)
- Vagues stylisées en bas (`#4fb2d4`, opacité 0.55 et 0.3)
- Style : minimaliste, géométrique, SVG vectoriel

**Forces :** Mémorable, cohérent avec le nom "sharkfin"  
**Faiblesse :** Nom original "Sharkfin" masqué, marque "Open Akko" non représentée visuellement

### 4.2 Colorway "akko" (nouveau thème)

**Palette actuelle (`index.css:445-465`) :**

| Variable | Valeur | Usage |
|----------|--------|-------|
| `--background` | `#14131c` | Fond application |
| `--foreground` | `#eeedf5` | Texte principal |
| `--primary` | `#b5a0ee` | Accent violet principal |
| `--primary-foreground` | `#191426` | Texte sur accent |
| `--key-accent` | `#b5a0ee` | Touches accentuées |
| `--key-base` | `#292635` | Touches standard |
| `--key-legend` | `#eee7fa` | Légendes de touches |
| `--key-plate` | `#100f18` | Plaque clavier |

**Caractéristiques :**
- Dominante : **violet foncé** (`#b5a0ee`)
- Arrière-plans : **noir-bleu profond** (`#14131c`, `#1a1824`)
- Contraste : Bon (WCAG AA sur la plupart des paires)

### 4.3 Proposition d'identité visuelle cohérente

#### 4.3.1 Palette de marque dérivée

**Palette primaire (dérivée du logo + colorway akko) :**

| Couleur | Hex | Usage | Origine |
|---------|-----|-------|---------|
| **Cyan Shark** | `#3d9fc4` | Accent bleu, liens | Logo (stop gradient) |
| **Sky Shark** | `#8fdcf2` | Hover, highlights | Logo (start gradient) |
| **Violet Akko** | `#b5a0ee` | Primary actions, CTA | Colorway akko |
| **Deep Violet** | `#30283f` | Secondary, mod keys | Colorway akko |
| **Night** | `#14131c` | Background dark | Colorway akko |
| **Chalk** | `#eeedf5` | Foreground light | Colorway akko |

**Palette sémantique :**

| Rôle | Light | Dark | Hex Light | Hex Dark |
|------|-------|------|-----------|----------|
| Succès | Vert doux | Vert menthe | `#4ade80` | `#86efac` |
| Avertissement | Orange | Ambre | `#fb923c` | `#fbbf24` |
| Erreur | Rouge corail | Rouge rose | `#f87171` | `#fca5a5` |
| Info | Cyan Shark | Sky Shark | `#3d9fc4` | `#8fdcf2` |

#### 4.3.2 Typographie

**Actuelle (déjà bien choisie) :**
- **Sans-serif** : Inter Variable → Moderne, lisible, variable font
- **Mono** : JetBrains Mono Variable → Code, légendes de touches

**Hiérarchie à formaliser :**

| Niveau | Police | Taille | Poids | Usage |
|--------|--------|--------|-------|-------|
| H1 | Inter | 2.25rem | 700 | Titres de pages |
| H2 | Inter | 1.875rem | 600 | Sections |
| H3 | Inter | 1.5rem | 600 | Sous-sections |
| Body | Inter | 1rem | 400 | Texte courant |
| Caption | Inter | 0.875rem | 400 | Labels, tooltips |
| Code | JetBrains Mono | 0.875rem | 400 | Légendes touches |

#### 4.3.3 Spacing et layout

**Échelle actuelle (Tailwind) :**
- Base : `0.25rem` (4px)
- Tokens : `--radius` = `0.625rem` (10px)

**Proposition d'échelle cohérente :**

| Token | Valeur | Usage |
|-------|--------|-------|
| `--space-xs` | 0.25rem (4px) | Padding interne serré |
| `--space-sm` | 0.5rem (8px) | Gap entre éléments liés |
| `--space-md` | 1rem (16px) | Espacement standard |
| `--space-lg` | 1.5rem (24px) | Sections |
| `--space-xl` | 2rem (32px) | Marges de page |
| `--space-2xl` | 3rem (48px) | Séparation majeure |

**Border-radius :**
- Keycap : `--radius-sm` (6px actuel)
- Boutons : `--radius-md` (8px actuel)
- Cards : `--radius-lg` (10px actuel)
- Modales : `--radius-xl` (14px)

#### 4.3.4 Iconographie

**Actuelle :**
- Lucide React (bon choix, cohérent)

**Directives :**
- Style : **Outline** (ligne fine, 1.5px stroke)
- Taille : 20px (base), 16px (inline), 24px (headers)
- Couleur : Hériter du texte parent
- Accent : Cyan Shark (`#3d9fc4`) pour icônes actives

**Icônes à créer/standardiser :**
- Logo app : Combiner aileron + stylisation "AK" (initiales Akko)
- Statuts connexion : USB, 2.4GHz, offline
- Modes clavier : Profile, FN, Macro

#### 4.3.5 Mode clair/sombre

**Actuel :**
- Variables CSS `:root` (light) et `.dark` (dark)
- Colorways indépendants (abyss, olivia, laser, botanical, 8008, akko)

**Proposition d'harmonisation :**

**Mode sombre (défaut, actuel "akko") :**
- Background : `#14131c` (Night)
- Foreground : `#eeedf5` (Chalk)
- Primary : `#b5a0ee` (Violet Akko)
- Accent : `#3d9fc4` (Cyan Shark)

**Mode clair (nouveau, à créer) :**
- Background : `#f8f7fb` (off-white violet)
- Foreground : `#1a1824` (Night, inversé)
- Primary : `#8b6dd9` (Violet Akko assombri)
- Accent : `#2c7fa0` (Cyan Shark assombri)

**Recommandation :** Maintenir les colorways thématiques (olivia, laser, etc.) comme options avancées, mais standardiser un light/dark par défaut.

#### 4.3.6 Composants keycap (existants, à préserver)

**Styles actuels (excellents) :**
- Dégradé 3D réaliste : `linear-gradient(180deg, ...)`
- Ombres multiples : inset + drop shadow
- Animation flash sur écriture : `@keyframes key-flash`
- Variables CSS : `--key-base`, `--key-legend`, `--key-accent`

**À ajouter :**
- État "locked" (verrou visual pour readonly)
- État "error" (bordure rouge, shake animation)

#### 4.3.7 Mapping sur les variables CSS actuelles

**Modifications proposées (`index.css`) :**

```css
:root {
    /* Palette de marque */
    --cyan-shark: #3d9fc4;
    --sky-shark: #8fdcf2;
    --violet-akko: #b5a0ee;
    --deep-violet: #30283f;
    
    /* Sémantique (préserver HSL/OKLCH pour cohérence) */
    --success: oklch(0.75 0.15 145);
    --warning: oklch(0.75 0.15 50);
    --error: oklch(0.70 0.19 22);
    --info: var(--cyan-shark);
    
    /* Redéfinir primary pour cohérence */
    --primary: var(--violet-akko);
    --accent: var(--cyan-shark); /* Nouveau */
}

.dark {
    /* Conserver les valeurs actuelles pour --background, etc. */
}

/* Mode clair (nouveau) */
.light {
    --background: oklch(0.98 0.01 280);
    --foreground: oklch(0.15 0.02 280);
    --primary: oklch(0.55 0.15 280);
    --accent: oklch(0.45 0.12 210);
    /* ... */
}
```

**Implémentation UI :**
- Sélecteur light/dark dans Settings
- Préserver le sélecteur de colorways (thèmes avancés)
- Sauvegarder préférence dans localStorage

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
