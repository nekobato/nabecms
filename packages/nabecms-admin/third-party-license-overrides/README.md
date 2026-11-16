# Third-party license overrides

[日本語](./README.ja.md)

This directory supplies license and NOTICE files missing from published tarballs for packages included in the Admin bundle.

`@cfworker/json-schema@4.1.6` declares MIT in `package.json`. Its published tarball omits the repository's `LICENSE.md` and `THIRD_PARTY_NOTICES.md`, so the override preserves the following upstream files for that exact version.

- [`LICENSE.md` at commit `1a0aa37471850c28a4673e12e871e010ea6c26e0`, tagged `@cfworker/json-schema@4.1.6`](https://github.com/cfworker/cfworker/blob/1a0aa37471850c28a4673e12e871e010ea6c26e0/LICENSE.md)
- [`THIRD_PARTY_NOTICES.md` at commit `1a0aa37471850c28a4673e12e871e010ea6c26e0`](https://github.com/cfworker/cfworker/blob/1a0aa37471850c28a4673e12e871e010ea6c26e0/THIRD_PARTY_NOTICES.md)

The release build fails closed if the dependency version, license identifier, or file contents change. Verify the upstream sources and distribution terms before updating an override.
