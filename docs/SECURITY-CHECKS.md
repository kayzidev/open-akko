# Contrôles de sécurité

Les checks bloquent la publication si `npm audit --audit-level=low` signale une vulnérabilité, si `cargo audit` signale une vulnérabilité bloquante ou si un outil d’audit ne peut pas s’exécuter. Les erreurs ne sont pas remplacées par un message de succès.

La chaîne frontend inclut les dépendances de développement dans son audit. Le générateur shadcn n’est pas nécessaire à l’exécution ni à la compilation ; sa feuille de styles utilisée par l’application est conservée dans `app/src/vendor`, avec sa licence MIT. Les composants déjà présents restent dans le projet.

Le linter TypeScript utilise un remplacement ciblé de `minimatch` par la version corrigée 11.0.1. Seule la dépendance de `@typescript-eslint/typescript-estree` est remplacée ; les anciens consommateurs de minimatch 3 gardent leur API. Le projet utilise Node 22 et contrôle l’installation, le lint, la compilation et les tests avec ce remplacement.

## Avis Rust informatifs

RustSec distingue les vulnérabilités bloquantes des avis informatifs. Les avis `unmaintained`, `unsound` et les versions retirées restent visibles dans le journal de `cargo audit`. Aucune liste d’exclusion d’avis n’est configurée.

Après mise à jour des dépendances, les avis informatifs suivants subsistent en amont :

| Composant | Avis | Suivi |
| --- | --- | --- |
| glib 0.18.5 | RUSTSEC-2024-0429, `VariantStrIter` | Corrigé à partir de glib 0.20. La pile GTK 3 utilisée par Tauri dépend encore de glib 0.18. Aucun usage direct de ces itérateurs n’est présent dans Open Akko ; cela ne démontre pas l’absence d’usage en amont. |
| proc-macro-error 1.0.4 | RUSTSEC-2024-0370 | Dépendance transitive non maintenue. |
| zbus_names 4.3.5 | RUSTSEC-2026-0371 | Dépendance transitive non maintenue. |
| zvariant 5.15.1 | RUSTSEC-2026-0370 | Dépendance transitive non maintenue. |
| zvariant_derive 5.15.1 | RUSTSEC-2026-0372 | Dépendance transitive non maintenue. |

Ces avis ne sont pas des correctifs apportés par le projet. Une évolution de la pile amont sera nécessaire pour les supprimer. Les journaux permettent de suivre les avis ajoutés ou corrigés à chaque PR.

Sources : [RustSec](https://rustsec.org/advisories/), [avis glib](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
