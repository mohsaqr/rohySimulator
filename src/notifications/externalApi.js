// Module-level bridge so non-React producers (the EventLogger singleton, any
// module-scope service that fires before mount) can dispatch through the
// center without using a hook. Set by NotificationProvider on mount; cleared
// on unmount so post-unmount calls are buffered, not crashed.
let externalApi = null;
export function setExternalApi(api) { externalApi = api; }
export function getExternalApi() { return externalApi; }
