# Bundled libraries

SoftCreatR/JSONPath 2.0.0 (MIT)
- Upstream: https://github.com/SoftCreatR/JSONPath
- Commit: 941fe4742e42380d394064fda61e2d9cc5615db1
- Included: src/, LICENSE.md, README.md, composer.json. Sources match the pinned commit except for the patch below.
- Loaded by the namespace autoloader in ../search.php. No host install/build step.

To update: review upstream changes, replace these files from an exact release commit,
retain the license and this provenance, and run the complete test suite on PHP 8.4+.
Upstream's JSONPath token cache is scoped to the PHP request; we parse each condition
once before scanning and reuse it for all captures.

Local patch: `jsonpath-string-comparison.patch` makes JSONPath predicate equality
and ordering of two strings use strict equality / lexical ordering. Upstream uses
PHP loose comparison, which treats distinct IDs such as "01" and "1" as equal.
Reapply this patch on update unless upstream has fixed it. The HTTP integration
suite covers string identity, typed numeric comparisons, and lexical ordering.
Structural validation in ../search.php also rejects unclosed brackets upstream
would otherwise silently accept. No other upstream source edits are applied.
