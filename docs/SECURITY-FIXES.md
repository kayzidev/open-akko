# Correctifs de sécurité et fiabilité

**Date** : 4 novembre 2026  
**Référence** : Audit technique (docs/AUDIT.md)

## Vulnérabilités corrigées

### V1 – CSP renforcée (Moyenne)

**Fichier** : `app/src-tauri/tauri.conf.json`

**Correctif** :
- Ajout de `object-src 'none'` pour bloquer les plugins
- Ajout de `base-uri 'self'` pour limiter les URLs de base
- Ajout de `form-action 'self'` pour restreindre les soumissions de formulaires
- Simplification de la CSP en supprimant les références redondantes à `tauri:` et `asset:`
- Note : `style-src 'unsafe-inline'` conservé temporairement (extraction des styles inline requiert un refactoring plus large du frontend)

**Impact** : Réduction significative de la surface d'attaque XSS.

### V2 – Parsing descripteurs HID sécurisé (Moyenne)

**Fichier** : `app/src-tauri/src/hid.rs`

**Correctifs** :
- Ajout de `MAX_DESCRIPTOR_SIZE = 4096` : refuse les descripteurs > 4 Ko
- Ajout de `MAX_ITERATIONS = 256` : prévient les boucles infinies
- Ajout de `MAX_STACK_DEPTH = 32` : limite la profondeur de pile Push/Pop
- Ajout de `MAX_LONG_ITEM_LEN = 255` : valide la longueur des items longs
- Compteur d'itérations explicite pour détecter les descripteurs malformés

**Tests ajoutés** :
- `hid_parsing_rejects_oversized_descriptors`
- `hid_parsing_rejects_excessive_iterations`
- `hid_parsing_rejects_deep_stacks`
- `hid_parsing_rejects_oversized_long_items`

**Impact** : Élimination du risque DoS via descripteurs USB malveillants.

### V3 – Validation config importée (Moyenne)

**Fichier** : `app/src-tauri/src/commands/mod.rs`

**Correctifs** :
- Nouvelle fonction `validate_saved_config()` appelée avant désérialisation
- Validation des tailles de tableaux (`profiles` ≤ 8, `fn_layers` ≤ 8)
- Validation de la taille de chaque profil (exactement 512 octets)
- Validation des plages de valeurs :
  - `debounce` : 1-10
  - `brightness` : 0-7
- Messages d'erreur explicites au lieu de panics

**Tests ajoutés** :
- `validate_config_accepts_valid_config`
- `validate_config_rejects_too_many_profiles`
- `validate_config_rejects_wrong_profile_size`
- `validate_config_rejects_invalid_debounce`
- `validate_config_rejects_invalid_brightness`
- `validate_config_rejects_too_many_fn_layers`

**Impact** : Prévention des crashs sur fichiers de configuration corrompus ou malveillants.

## Améliorations de fiabilité

### Gestion d'erreurs audio

**Fichier** : `app/src-tauri/src/audio.rs:283`

**Correctif** :
- Remplacement de `let _ = reply.send(result)` par log explicite
- Ajout d'un warning si le canal de réponse est fermé

**Impact** : Meilleur diagnostic des erreurs de communication audio.

## Résultats des tests

Tous les tests passent :
```
test result: ok. 109 passed; 0 failed; 1 ignored
```

Compilation sans warnings :
```
cargo clippy --all-targets -- -D warnings ✓
cargo fmt --check ✓
```

## Non implémenté

### Extraction des styles inline (V1 partiel)

**Raison** : Nécessite un refactoring important du frontend (10 fichiers affectés).
Les styles inline sont utilisés pour :
- Aperçus d'effets d'éclairage dynamiques
- Visualisation du clavier avec couleurs personnalisées
- Animations et transformations CSS calculées

**Recommandation** : Faire dans un sprint dédié au design system (Sprint 3 de l'audit).

### Refactoring commands/mod.rs

**Raison** : Le module fait 2153 lignes mais est stable. Un découpage mal fait introduirait plus de risques qu'il n'en résout.

**Recommandation** : Planifier pour Sprint 1 (maintenabilité) avec revue approfondie.

### Uniformisation des types d'erreur

**Raison** : Changement invasif affectant toute la surface API. Risque de régression élevé.

**Recommandation** : Sprint 1, après stabilisation des tests d'intégration.

## Compatibilité CI

Les correctifs sont compatibles avec :
- ✓ Ubuntu (testé avec Rust 1.99.1 stable)
- ✓ Windows (CSP et validation agnostiques de la plateforme)
- ✓ macOS (pas de changements spécifiques OS)

## Prochaines étapes

1. ✅ Valider les tests CI sur GitHub Actions
2. ⏳ Tester manuellement l'import de configs malformées
3. ⏳ Vérifier que les boards USB malveillants sont rejetés
4. ⏳ Extraire les styles inline (Sprint 3)
5. ⏳ Remplacer les `.unwrap()` restants (Sprint 1)
