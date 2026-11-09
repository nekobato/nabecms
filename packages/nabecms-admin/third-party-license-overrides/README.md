# Third-party license overrides

[日本語](./README.ja.md)

This directory supplies license and NOTICE files missing from published tarballs for packages included in the Admin bundle.

`@cfworker/json-schema@4.1.4` declares MIT in `package.json`. Its published tarball omits the repository's `LICENSE.md` and `THIRD_PARTY_NOTICES.md`, so the override preserves the following upstream files for that exact version.

- [`LICENSE.md` at commit `e45acacf25e083ac1b4b09bdd940d27c33bffcc5`, tagged `@cfworker/json-schema@4.1.4`](https://github.com/cfworker/cfworker/blob/e45acacf25e083ac1b4b09bdd940d27c33bffcc5/LICENSE.md)
- [`THIRD_PARTY_NOTICES.md` at commit `e45acacf25e083ac1b4b09bdd940d27c33bffcc5`](https://github.com/cfworker/cfworker/blob/e45acacf25e083ac1b4b09bdd940d27c33bffcc5/THIRD_PARTY_NOTICES.md)

The release build fails closed if the dependency version, license identifier, or file contents change. Verify the upstream sources and distribution terms before updating an override.
