# NabeCMS documentation

[日本語](./ja/index.md)

NabeCMS is a headless CMS for Cloudflare Workers.
Editors define content models and publish entries in the Admin UI, and external sites retrieve the published content through the Contents API.
The editing interface and both APIs run on one Worker.

## Use NabeCMS

Follow the [Quick Start](./getting-started.md) to publish your first article on a local Worker.
When you start designing your own models, use the [Admin UI guide](./admin/index.md) to find the editing controls and the [field reference](./admin/fields.md) to choose how values are stored and delivered.

Use the [API overview](./api/index.md) to choose between retrieving content and automating administration.
It explains which credentials each API accepts and links to request examples and endpoint references.

## Operate an app

Before deploying, review the [Cloudflare requirements](./cloudflare.md) for the services and bindings the app uses.
Then follow the [deployment guide](./operations.md) to create the production resources and check the running Worker.
The [configuration reference](./configuration.md) explains options you can set in the app.

Use the [security guide](./security.md) to set access and publication boundaries.
If you want invitations or password resets to reach users by email, set up [authentication email](./email.md).
For schema changes, backups, and exports, see [data management](./data-management.md).

## Develop NabeCMS

The [developer guide](./developer.md) explains how to run and test the source checkout.
Read the [architecture](./architecture.md) to find the code responsible for a request, a data model, or a write.
