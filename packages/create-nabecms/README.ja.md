# create-nabecms

[English](./README.md)

Cloudflare Workers 上で NabeCMS を動かすアプリを生成する initializer です。

```bash
npm create nabecms@next my-cms
```

`next` は最新の Alpha 版を指します。
`0.1.0-alpha.1` を指定する場合は `npm create nabecms@0.1.0-alpha.1 my-cms` を実行します。
アプリの生成後は `pnpm install` まで実行し、本体と CLI の依存バージョンを initializer と同じ値に固定します。

必要なツールと初回起動の手順は[クイックスタート](https://github.com/nekobato/nabecms/blob/main/docs/ja/getting-started.md)に記載しています。
本番環境の設定は[運用とデプロイ](https://github.com/nekobato/nabecms/blob/main/docs/ja/operations.md)の手順で行います。
Alpha 期間の互換性の変更とデータ移行手順は [GitHub Releases](https://github.com/nekobato/nabecms/releases) に記載します。

## License

ISC
