# Admin UI guide

Use the Admin UI to define the structure of your content, edit entries, and manage the people who can publish them.
To create the first administrator, follow the [Quick Start](../getting-started.md).

## Sign in and manage sessions

Open `/admin/` and sign in with your email address and password.
Sign in again if inactivity or a permission change ends your session.
To let account owners recover access by email, set up [authentication email](../email.md).

## Design models

Create a model under **Models** for each kind of content, such as an article or product. Add fields that match what editors will enter.
For example, an article can use a `text` field as its display title and `rich_text` for the body.
Choose `hasLocales` for values that need a separate translation and `isPrivate` for values that should stay out of the Contents API. See the [field reference](./fields.md) for supported types and validation.

Use **Edit** in the model header to change its title or description. Drag fields to reorder them, then apply or reset the order.
Deleting a model also deletes its entries, fields, and revisions. See [the effects of schema changes](../data-management.md#breaking-changes) before changing a model with existing content.

## Manage entries

Under **Contents**, create an entry in the model you want to use. A draft gives you a place to edit before delivery clients can read the entry.
Select **Publish** and review the confirmation to make the content available. Restoring a revision creates a new draft, leaving the current published version available until you publish again.

Search the entry list by display title or ID. The main column uses the model's display title field, with the ID as a fallback.
Use **Columns** to choose what to display and the Sheet View headers to sort. If a value is missing in the selected locale, sorting uses the default locale.

### View and edit related entries

Open a selected relation or an entry reference in rich text to review that entry in a dialog.
Breadcrumbs track where you came from. Going back preserves the inputs, and **Unsaved changes** lets you resume an edit even after you leave that path.
Opening an entry again resumes its existing editor.

Save and publish apply to the visible entry. You can save changes to a related entry independently of the original entry.
When closing the dialog, choose which unsaved related changes to discard. Your input on the original page remains available.
Leaving or reloading the page checks for unsaved work in all open entries. Unsaved input stays available while the page is open.
If a related entry cannot be opened, return to the original entry. If a save fails, the editor keeps your input.

## Manage media

Under **Media**, select files or drop them onto the upload area. The Admin UI sends one file at a time.
The list lets you filter by type and inspect dimensions and size.
See the [upload requirements](../api/admin.md#upload-requirements) for supported formats and size limits.

If you have variant templates, all are selected when you start an upload. Clear the templates you do not need.
Use `fit: cover` to fill the target area by cropping and `contain` to fit the whole image inside it. Set `upscale: false` to keep variants at or below the original size.
See [media operations](../operations.md#media-operations) for what happens when a file is deleted.

## Locales and languages

Set the default locale under **Settings → Locales**.
Use localized fields to give each language its own value. Media is shared, so different locales can refer to the same file or select different files.

## Users and permissions

Create roles under **Roles**, then assign them under **Users**. Choose Create, Read, Update, Delete, or Publish for entries and Read or Write for other resources.
Entry permissions set here apply across all models. See the [Admin API](../api/admin.md#authorization-model) for model-specific permission patterns.

Invite new users into a regular role. The [invitation rules](../security.md#invitations) explain which roles can be granted.
Edit an existing user to change their roles. The account owner manages their own email address, with user editing permission, and changes their password through [reset email](../email.md#reset-a-password).

## API keys

Create a delivery key under **API Keys**. Select at least one permission. Set `allowedModels` if the integration should read only specific models, then confirm their names in the list.
When replacing a key, switch the integration to the new one and revoke the old one.

## View and search logs

Open **Logs** with `logs:*:read` to inspect activity, revisions, or authentication results.
Find an activity by time range, action, or exact target ID. Find a sign-in result by time range, outcome, or exact user ID.
Dates use the browser's time zone and include the entire end date.

Select **Search** to apply filters, or **Clear** to reset them. Each tab keeps its own filters and page position.
Activity logs show state changes and revision IDs. Open the corresponding entry from a revision when you need its contents.

## Settings

Open **Settings** to check the running version and record counts.
For exporting records, see [data management](../data-management.md#export-data-for-another-cms). For invitation and reset emails, see [authentication email](../email.md).

## Log management

A Super Admin can set a shared retention period for activity and authentication logs in **Settings → Log management**.
The default is 90 days. Choose a whole number from 1 to 730000 days or indefinite retention.
The change takes effect at the next scheduled run. Review what will become eligible for deletion before shortening the period.

Refresh the state to see the last start, end, successful run, deleted counts, and whether expired logs remain.
The screen distinguishes a first run pending, no observed run for at least 48 hours, and an unfinished run after the 15-minute lease. A first run can be pending with Cron configured.

If cleanup fails, give the deployment administrator the error code and use [scheduled log cleanup](../operations.md#scheduled-log-cleanup) to diagnose it.
During a database outage the screen retains the last state it fetched.
