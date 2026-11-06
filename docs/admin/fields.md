# Field definitions

Choose a field type by the value an editor needs to enter and the shape a client should receive.
An article might use `text` for its title, `rich_text` for its body, and `media` for a lead image.
The [Admin UI guide](./index.md#design-models) explains how to add them to a model.

## Common properties

| Property | Effect |
| --- | --- |
| `name` | Label shown to editors |
| `fieldKey` | Key used in API payloads |
| `required` | Requires a value when saving or publishing |
| `hasLocales` | Stores a separate value per locale |
| `isUnique` | Prevents duplicate published values within a model and locale. Unavailable for `rich_text` |
| `isPrivate` | Keeps the field out of the Contents API |
| `isDisplayTitle` | Uses the field as the display title. The first field becomes the title field, and each model has at most one |
| `defaultValue` | Initial value for an omitted field. `null` means there is no default |

Deleting a field removes its stored values. Deleting the title field clears the model's `titleFieldId`.

### Rules for fieldKey

Use lowercase ASCII letters, digits, and single underscores between segments. Start with a lowercase letter, as in `hero_image`.
Changing this key changes API output for clients using the field.

### Applying defaultValue

The API applies defaults to omitted fields when creating an entry, updating with a field payload, or publishing a revision.
Defaults apply to `text`, `number`, `date`, `list`, `json`, `boolean`, and existing `custom` fields. Use an array matching `item.type` for a list default.
Entry saves ignore defaults for `relation`, `media`, and `rich_text`.

### Locale payload validation

A field with `hasLocales=false` accepts one value per saved version. If that value specifies a locale, it must exist, and the API saves the value under the default locale.
A field with `hasLocales=true` accepts one value per configured locale. An omitted or `null` locale refers to the default locale.
These rules apply when saving entries and when publishing saved revisions or a selection in bulk.

### Scope of `required` validation

The API checks required values when saving a draft or publishing, including revision and bulk publishing.
For partial locale updates, it checks the resulting saved version after merging changes and applying defaults. Localized fields must have a value for each locale in that version and the default locale.

Whitespace-only text, unset numbers, dates and JSON, empty lists, unselected media or relations, and rich text without actual text count as empty.
`false` is a valid boolean. An empty default does not satisfy the requirement.

### Media reference validation

Saving an entry or publishing a saved revision checks that each nonempty media ID exists and matches `options.allowedKinds` when set.
This applies to scheduled and bulk publishing as well. The `single` variant uses `valueMedia`, and `multiple` uses the ID array in `valueJson`.
Use `required` to disallow an empty selection.

### Scope of `isUnique` validation

A value must differ from published values for the same model, field, and locale when saving or publishing a published entry. Draft saves can contain duplicates.
The check skips missing values. Lists, JSON, and multiple media or relations use exact stored values, including array order.
Bulk publishing checks the selection against itself and against published entries before publishing any of them.

## Field types

The [field contracts](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/model-field.ts) define the exported types for variants and options.

### text

Choose `shortText` or `longText` for a single or multiline text editor, `markdown` for Markdown source, or `code` for a code editor. These variants have no options.
The Markdown variant stores and returns the source string. The editor's HTML, iframe, and script preview controls apply only to the current preview.

### rich_text

Use `rich_text` for formatted text and embedded references. It has no variants or options.

### number

Choose `integer` for JavaScript safe integers or `decimal` for finite numbers. Neither variant has options.
Empty input is saved as `null`. Numeric strings such as `42`, `-1.25`, and `1e3` are converted, while `0x10`, `Infinity`, `NaN`, and `1,000` fail validation.

### date

The variants are `date` and `datetime`. Set `options.format` to choose how the value is parsed and stored.

| Format | Accepted value |
| --- | --- |
| `date` | A valid `YYYY-MM-DD` date, stored as entered |
| `datetime` | ISO datetime without a time zone. Missing seconds normalize to `YYYY-MM-DDTHH:mm:ss` |
| `datetime_with_timezone` | ISO datetime with `Z` or an offset such as `+09:00`, stored in UTC |

If `format` is omitted, `variant: datetime` uses `datetime` and other variants use `date`.

### list

Use a list for multiple values of one scalar type. Set `item` to `{ type }` with `text`, `number`, `date`, or `boolean`.
The field and its items have no variants, and items have no options. Dates are stored as `YYYY-MM-DD` and an empty list is stored as `[]`.
For multiple files or related entries, use the corresponding `media` or `relation` variant.

### media

Choose `single` for one file or `multiple` for several. To restrict the selection, set `allowedKinds` to permitted values from `image`, `video`, `audio`, `document`, and `archive`.
See [media reference validation](#media-reference-validation) for checks on saving.

### json

A JSON field has no variants. It can store any JSON value, with an optional `schema` given as a Draft 7 object or a string containing that object.
Use the Draft 7 URI in `$schema` or omit it. Local `$ref` values are supported when they resolve within the schema.

| Option | Effect |
| --- | --- |
| `stripUnknown: false` (default) | Validates the value as supplied. Draft 7 `additionalProperties` governs undeclared keys |
| `stripUnknown: true` | Requires a schema, removes undeclared keys from nested objects before validation, and keeps array elements in place. A key outside `properties` and `patternProperties` is removed even if `additionalProperties` permits it |

Empty input is normalized to `null`. Use `required` to require a value.
The API validates stored values again when restoring or publishing a revision, including scheduled and bulk publishing.
For branch matching, references, and validation details, see the [JSON field validator](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/json-schema.ts) and its [examples in tests](https://github.com/nekobato/nabecms/blob/main/packages/nabecms-core/src/contracts/json-schema.spec.ts).

### relation

Choose `one` to allow one related entry or `many` for several. Set `allowedModels` to the models editors can select from.
The API also accepts `filter` and `onDelete` (`restrict`, `nullify`, or `cascade`).
To remove an entry that is still referenced, see [entry deletion](../api/admin.md#entries).

### boolean

Use a boolean for a true or false value. It has no variants or options.

### custom

Existing custom fields remain readable. They can have an arbitrary variant and the options `customTypeId`, `version`, `schema`, and `config`.
Creation and dedicated editing of custom fields are unavailable.

## Admin UI support

### Field definition UI

Use the UI to create fields of any supported type except `custom`.
Set `json.schema`, `json.stripUnknown`, `relation.filter`, and `relation.onDelete` through the [Admin API](../api/admin.md#fields).

### Entry editor

The editor uses the field's type and options to select the input and validate it. A JSON field with a schema uses the same validation as the API.
In the relation picker, search the allowed models or create a draft in the selected model when no suitable entry exists.

### View and edit related entries

For the editor, breadcrumbs, and rules for saving and keeping input, see [view and edit related entries](./index.md#view-and-edit-related-entries).
