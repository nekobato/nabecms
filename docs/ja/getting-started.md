# クイックスタート

CMS アプリを作成して管理画面にログインし、記事を一つ公開します。
Wrangler が D1 と R2 をローカルで動かすため、Cloudflare にリソースを作成する前に一通り試せます。

## 前提

Node.js は 24.22.3 以降の 24.x、または 26.13.1 以降の 26.x を使います。
pnpm は 11 以降が必要です。
Wrangler は生成されるアプリの依存関係に含まれます。
Cloudflare アカウントは[本番へ配備する](./operations.md)段階で用意します。

## Alpha版の導入

初回の試験公開は `0.1.0-alpha.1` です。
npm の `next` は最新の Alpha 版を指します。
Alpha 期間は API や設定に互換性のない変更が入ることがあります。
保存済みのデータがあるアプリを更新する前に、対象バージョンの[GitHub Release](https://github.com/nekobato/nabecms/releases)で移行手順を確認します。

## アプリを生成する

```bash
npm create nabecms@next my-cms
cd my-cms
```

初期化ツールはアプリのファイルを生成し、`pnpm install` を実行します。
本体と CLI には初期化ツールと同じバージョンを指定するため、同じリリースの組み合わせで起動できます。
初回の Alpha 版を指定して導入する場合は `npm create nabecms@0.1.0-alpha.1 my-cms` を実行します。

## ローカルのシークレットを設定する

アプリのディレクトリでローカル用の設定ファイルを作成します。

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` の `BOOTSTRAP_SECRET`、`JWT_SECRET`、`BETTER_AUTH_SECRET` にそれぞれ別の値を指定します。
次のコマンドを一回実行するごとに一つの値を生成できます。

```bash
openssl rand -hex 32
```

`BOOTSTRAP_SECRET` は初期設定画面で入力します。
残り二つは API のトークンとログインセッションの保護に使います。
`.dev.vars` はローカルに保管し、Git の管理対象から外します。
本番環境での扱いは[シークレット管理](./security.md#シークレット管理)を参照します。

## ローカルで起動する

データベースにマイグレーションを適用し、ローカルの設定と型を確認して Worker を起動します。

```bash
pnpm nabecms:migrate --local
pnpm nabecms:doctor
pnpm typecheck
pnpm dev
```

`http://localhost:8787/admin/` を開くと、管理画面の初期設定が始まります。

## 最初の記事を公開する

1. 初期設定画面で名前、メールアドレス、パスワード、既定ロケールを入力します。`.dev.vars` の `BOOTSTRAP_SECRET` を入力して初期管理者を作成します。
2. ログインして「Models」で記事用のモデルを作成します。見出しに `text`、本文に `rich_text` のフィールドを追加します。
3. 「Contents」で記事用モデルのエントリーを作成し、見出しと本文を入力します。「Publish」を選ぶと配信用 API から取得できる状態になります。

別のアプリから記事を読むには、`contents:read` を持つキーを作成し、[Contents API](./api/contents.md)を使います。
下書きと公開済みの版の扱いは、[エントリー運用](./admin/index.md#エントリー運用)を参照します。

## 次の手順

ローカルで動作を確認したら、[Cloudflare の前提と設定](./cloudflare.md)を参照してプランを選び、[運用とデプロイ](./operations.md)に従って本番用の Worker、データベース、バケットを用意します。
NabeCMS 本体を変更する場合は、[開発者ガイド](./developer.md)にソースから起動する手順があります。
