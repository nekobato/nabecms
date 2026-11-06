# フィールド定義

編集者が入力する値と、配信先が受け取る形式に合わせて型を選びます。
記事なら、見出しに `text`、本文に `rich_text`、画像に `media` を使えます。
モデルに追加する手順は[管理画面ガイド](./index.md#モデル設計)を参照します。

## 共通項目

| 項目 | 効果 |
| --- | --- |
| `name` | 編集者に表示する名前 |
| `fieldKey` | API で使うキー |
| `required` | 保存や公開に値を要求する |
| `hasLocales` | ロケールごとに値を保存する |
| `isUnique` | 同じモデルとロケールで公開済みの値との重複を防ぐ。`rich_text` は対象外 |
| `isPrivate` | Contents API の配信対象から外す |
| `isDisplayTitle` | 一覧の表示タイトルに使う。最初のフィールドが選ばれ、一つのモデルで最大一つ |
| `defaultValue` | 値を省略したときの既定値。`null` は既定値なし |

フィールドを削除すると保存済みの値も削除されます。
表示タイトルに使うフィールドを削除すると、モデルの `titleFieldId` は解除されます。

### fieldKey のルール

`hero_image` のように、小文字の英字で始め、小文字英数字とアンダースコアで構成します。
アンダースコアは区切りに一つずつ使います。
キーを変更した場合は、以前のキーを参照する API クライアントも更新します。

### defaultValue の適用

エントリーの作成、フィールドを送信した更新、リビジョンの公開では、省略したフィールドに既定値を適用します。
対象は `text`、`number`、`date`、`list`、`json`、`boolean`、既存の `custom` です。
リストの既定値には `item.type` に合う配列を指定します。
`relation`、`media`、`rich_text` の既定値はエントリー保存時に使いません。

### locale payload の検証

`hasLocales=false` のフィールドは、保存する版ごとに一つの値を持ちます。
値にロケールを指定した場合は、登録済みかどうかを検査し、既定ロケールの値として保存します。
`hasLocales=true` では、登録済みのロケールごとに一つの値を保存します。
ロケールが未指定か `null` の場合は既定ロケールの値として扱います。
これらの規則はエントリーの保存、リビジョンの公開、一括公開で適用します。

### `required` の適用範囲

必須の値は下書きの保存と公開時に検査します。
一部のロケールだけを更新した場合は、変更を既存の版へ反映し、既定値を適用してから検査します。
ロケール別に保存するフィールドでは、保存する版に含まれる各ロケールと既定ロケールの値が必要です。

空白だけのテキスト、未設定の数値や日付や JSON、空のリスト、未選択のメディアや関連先、文字が入っていないリッチテキストは空として扱います。
真偽値の `false` は有効です。
既定値が空の場合は必須条件を満たしません。

### media 参照の検証

エントリーの保存や公開時に、指定したメディア ID が存在し、`options.allowedKinds` がある場合はその種別に合うか確認します。
リビジョンの公開、一括公開、予約公開でも再検査します。
`single` は `valueMedia` の ID、`multiple` は `valueJson` の ID 配列を確認します。
未選択を拒否する場合は `required` を使います。

### `isUnique` の適用範囲

公開済みのエントリーを保存または公開するときに、同じモデル、フィールド、ロケールの公開済みの値と照合します。
下書きでは重複した値も保存できます。
未入力の値は検査の対象外です。
`list`、`json`、複数のメディアや関連先は、配列の順序を含めて保存値を比較します。
一括公開では選択したエントリー同士と公開済みのエントリーを先に比較し、衝突があれば選択全体の公開を中止します。

## フィールドタイプ別の定義

型ごとのバリアントとオプションは[フィールドの型定義](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/model-field.ts)から参照できます。

### text

一行の文字列には `shortText`、複数行には `longText`、Markdown の原文には `markdown`、コードには `code` を選びます。
バリアントにオプションはありません。
Markdown は原文を文字列で保存し、API からも同じ文字列を返します。
`HTML`、`iframe`、`script` の許可は管理画面のプレビューだけに適用します。

### rich_text

装飾付きの文章や埋め込み参照には `rich_text` を使います。
バリアントとオプションはありません。

### number

JavaScript で正確に表せる整数に限る場合は `integer`、小数を含む有限の数値には `decimal` を選びます。
どちらもオプションはありません。
空の入力は `null` になります。
`42`、`-1.25`、`1e3` のような文字列は数値に変換し、`0x10`、`Infinity`、`NaN`、`1,000` は拒否します。

### date

バリアントは `date` と `datetime` です。
`options.format` で入力と保存の形式を指定します。

| 形式 | 受け付ける値 |
| --- | --- |
| `date` | `YYYY-MM-DD` の実在する日付。そのまま保存する |
| `datetime` | タイムゾーンのない ISO 日時。秒がなければ `YYYY-MM-DDTHH:mm:ss` に補う |
| `datetime_with_timezone` | `Z` や `+09:00` などのオフセットを含む ISO 日時。UTC へ変換する |

`format` を省略すると、`variant: datetime` では `datetime`、それ以外では `date` を使います。

### list

同じ型の値を複数入力する場合はリストを使い、`item` を `{ type }` で設定します。
選べる型は `text`、`number`、`date`、`boolean` です。
リストとその要素にバリアントはなく、要素にオプションはありません。
日付の要素は `YYYY-MM-DD` で、空のリストは `[]` で保存します。
複数のファイルやエントリーを参照する場合は、`media` や `relation` のバリアントを選びます。

### media

一つのファイルには `single`、複数には `multiple` を使います。
種別を限定する場合は、`image`、`video`、`audio`、`document`、`archive` から `allowedKinds` に指定します。
保存時の規則は[メディア参照の検証](#media-参照の検証)を参照します。

### json

JSON フィールドにバリアントはありません。
値の構造を制限する場合は、Draft 7 の `schema` をオブジェクトか、それを表す JSON 文字列で指定します。
`$schema` は省略するか Draft 7 の URI を指定します。
`$ref` は同じスキーマ内で解決できる参照に限ります。

| オプション | 効果 |
| --- | --- |
| `stripUnknown: false`（既定） | 入力値をそのまま検証する。未定義のキーは Draft 7 の `additionalProperties` に従う |
| `stripUnknown: true` | スキーマが必要。検証前に入れ子のオブジェクトも含めて未定義のキーを除く。`additionalProperties` で許可していても、`properties` と `patternProperties` のどちらにも該当しないキーは除き、配列の要素は残す |

未入力の値は `null` になります。
入力を必須にする場合は `required` を使います。
リビジョンの復元や公開、一括公開、予約公開でも保存済みの値を検証します。
分岐や参照の処理は[JSON フィールドの検証処理](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/json-schema.ts)と[テストの例](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/json-schema.spec.ts)を参照します。

### relation

一件だけを関連付ける場合は `one`、複数件の場合は `many` を選び、`allowedModels` で選択できるモデルを指定します。
API では `filter` と `onDelete`（`restrict`、`nullify`、`cascade`）も受け付けます。
参照されているエントリーを削除する手順は[Admin API のエントリー](../api/admin.md#エントリー)を参照します。

### boolean

真偽値には `boolean` を使います。
バリアントとオプションはありません。

### custom

既存のフィールド定義と値は読み取れます。
バリアントは任意の文字列で、オプションは `customTypeId`、`version`、`schema`、`config` です。
新規作成と専用の編集画面は提供していません。

## 管理画面での対応状況

### フィールド定義 UI

`custom` を除く型を管理画面で作成できます。
`json.schema`、`json.stripUnknown`、`relation.filter`、`relation.onDelete` は[Admin API](../api/admin.md#フィールド)から設定します。

### エントリー入力 UI

エディターは型とオプションに応じて入力欄を表示します。
スキーマ付きの JSON フィールドは API と同じ条件で検証します。
リレーションの選択画面では許可されたモデルを検索でき、目的のエントリーがなければそのモデルに下書きを作成できます。

### 関連エントリーの閲覧と編集

画面の移動と保存、未保存の入力を再開する操作は[管理画面ガイドの関連エントリー](./index.md#関連エントリーの閲覧と編集)を参照します。
