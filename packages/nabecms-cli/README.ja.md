# @nekobato/nabecms-cli

[English](./README.md)

NabeCMS host app の診断、D1 migration、runtime migration bundle 生成を行う Node.js CLI です。

通常は `create-nabecms` が生成する package scripts から利用します。
必要なツールと導入手順は [NabeCMS Quick Start](https://github.com/nekobato/nabecms/blob/main/docs/ja/getting-started.md) に記載しています。

## Commands

```bash
pnpm nabecms:doctor
pnpm nabecms:migrate --local
pnpm nabecms:bundle-migrations
```

- **`doctor`**：Wrangler bindings、ローカル環境変数、`nabecms.config.ts` を検証します。
- **`migrate`**：Wrangler 経由で D1 migration を適用し、runtime migration bundle を更新します。
  production では `--remote --env production` を指定します。
- **`bundle-migrations`**：`migrations/` から runtime migration bundle を再生成します。

Worker runtime の依存には `@nekobato/nabecms` を指定します。
この CLI は Node.js の package scripts で実行し、Worker bundle には import しません。

## License

ISC
