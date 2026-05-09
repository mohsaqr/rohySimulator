# Rohy Oyon Add-On Template

This folder is a copyable template for integrating Oyon as a Rohy add-on.

Use this path when Rohy should own:

- database rows,
- the launch button,
- admin monitoring,
- optional student self-view,
- consent and visibility settings.

The add-on owns only `oyon_*` tables and `/api/addons/oyon/*` routes.
Rohy core should continue to work if this folder is absent, disabled, or
partially broken.

Minimum steps in Rohy:

1. Copy `001_oyon_addon.sql` into Rohy's migration system.
2. Register `addon.json` with Rohy's add-on loader.
3. Add isolated backend routes under `/api/addons/oyon`.
4. Add frontend slot content that lazy-loads `oyon/addon`.
5. Keep `OYON_ENABLED=0` until the add-on passes fallback tests.

Frontend sketch:

```js
import { createRohyOyonAddon } from 'oyon/addon';

const oyon = createRohyOyonAddon({
  enabled: config.flags.oyon === true,
  apiBaseUrl: '',
  getToken: () => auth.token,
  getSession: () => ({
    session_id: activeSession.id,
    user_id: auth.user.id,
    case_id: activeCase.id,
    tenant_id: auth.user.tenant_id,
  }),
  maxSaveFailures: 3,
});

const result = await oyon.start();
if (!result.ok) {
  showToast('Emotion capture unavailable');
}
```
