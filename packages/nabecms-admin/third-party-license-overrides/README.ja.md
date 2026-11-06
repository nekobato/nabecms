# Third-party license overrides

[English](./README.md)

Admin bundle に含まれるパッケージのうち、公開 tarball に license または NOTICE が含まれないものは、このディレクトリで補完します。

`@cfworker/json-schema@4.1.1` は `package.json` で MIT を宣言しています。
公開 tarball にはリポジトリの `LICENSE.md` と `THIRD_PARTY_NOTICES.md` が含まれないため、該当バージョンの原本を保存しています。

- License: [tag `@cfworker/json-schema@4.1.1` の commit `5409fdc2bd144f68e8b28c61c71fcb16600000a6` にある `LICENSE.md`](https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/LICENSE.md)
- Notices: [commit `d4fe383128d8dae5f7baa212e10d881a4150b1e1` の `THIRD_PARTY_NOTICES.md`](https://github.com/cfworker/cfworker/blob/d4fe383128d8dae5f7baa212e10d881a4150b1e1/THIRD_PARTY_NOTICES.md)

依存のバージョン、ライセンス識別子、本文のいずれかが保存済みの情報と一致しない場合、リリースビルドは失敗します。
補完ファイルを更新する場合は、元のファイルと配布条件を確認してから差し替えます。
