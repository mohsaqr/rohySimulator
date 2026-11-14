/*
 * The Analyze channel picker's options, given which records exist.
 * Pure, so it is tested in plain node (tests/app-channel-offer.test.js); the
 * hook in channelOptions.ts feeds it either the host feed or the browser's
 * stored windows and events.
 *
 * - Every channel is listed, so the picker shows what Oyon can analyse; one
 *   without records is disabled and labelled "· no data", so choosing it
 *   cannot land on an empty page. "Affect" needs emotion windows, "Writing
 *   acts" document edits, "All channels" events from more than one channel,
 *   every other channel its own events.
 * - The channel in use is never disabled.
 * - With no records at all every channel is enabled, so a first-time user can
 *   still reach Affect and its "Load demo data" button.
 */

/**
 * @param {Array<{ value: string, label: string }>} options  every channel, in picker order
 * @param {{ windows: boolean, eventModalities: string[] }} kinds  what exists
 * @param {string} current  the channel in use
 * @returns {Array<{ value: string, label: string, disabled?: boolean }>} the options, in order
 */
export function offeredChannels(options, kinds, current) {
  const modalities = kinds.eventModalities;
  if (!kinds.windows && modalities.length === 0) return options;
  const has = (channel) => {
    if (channel === current) return true;
    if (channel === 'emotion') return kinds.windows;
    if (channel === 'writing') return modalities.includes('document_edit');
    if (channel === 'all') return modalities.length > 1;
    return modalities.includes(channel);
  };
  return options.map((option) => (has(option.value) ? option : { ...option, label: `${option.label} · no data`, disabled: true }));
}
