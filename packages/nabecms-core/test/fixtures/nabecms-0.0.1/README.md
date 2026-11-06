# NabeCMS 0.0.1 migration fixture

[日本語](./README.ja.md)

This directory is an immutable copy of the pre-Alpha `create-nabecms` basic starter migration chain, identified as NabeCMS 0.0.1 (`0000` through `0006`).

Forward-migration tests apply this copy instead of selecting a prefix from the current project migrations. This prevents later edits to the active migration chain from silently changing the 0.0.1 baseline.

`checksums.json` records a SHA-256 checksum for every SQL file. The Workers Vitest configuration verifies all checksums before exposing the fixture to integration tests.

Do not regenerate this fixture from current migrations. Add a separate versioned fixture when another baseline is required.
