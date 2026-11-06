# @nekobato/nabecms-admin

[日本語](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-admin/README.ja.md)

This package provides the prebuilt static files for the NabeCMS Admin UI.
A typical host app uses `@nekobato/nabecms`, which also includes the Worker runtime.
See the [Quick Start](https://github.com/nekobato/nabecms/blob/main/docs/getting-started.md) and [Admin UI guide](https://github.com/nekobato/nabecms/blob/main/docs/admin/index.md).

## Assets path

Serve `./node_modules/@nekobato/nabecms/admin/dist` when using `@nekobato/nabecms`, or `./node_modules/@nekobato/nabecms-admin/dist` when using this package directly.
For Workers Assets configuration, see [Cloudflare requirements](https://github.com/nekobato/nabecms/blob/main/docs/cloudflare.md).

Third-party licenses and notices are bundled in `dist/THIRD_PARTY_NOTICES.txt`.

## License

ISC
