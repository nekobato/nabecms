# Third-party license overrides

[日本語](./README.ja.md)

This directory supplies license and NOTICE files missing from published tarballs for packages included in the Admin bundle.

`@cfworker/json-schema@4.1.1` declares MIT in `package.json`. Its published tarball omits the repository's `LICENSE.md` and `THIRD_PARTY_NOTICES.md`, so the override preserves the following upstream files for that exact version.

- [`LICENSE.md` at commit `5409fdc2bd144f68e8b28c61c71fcb16600000a6`, tagged `@cfworker/json-schema@4.1.1`](https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/LICENSE.md)
- [`THIRD_PARTY_NOTICES.md` at commit `d4fe383128d8dae5f7baa212e10d881a4150b1e1`](https://github.com/cfworker/cfworker/blob/d4fe383128d8dae5f7baa212e10d881a4150b1e1/THIRD_PARTY_NOTICES.md)

The release build fails closed if the dependency version, license identifier, or file contents change. Verify the upstream sources and distribution terms before updating an override.
