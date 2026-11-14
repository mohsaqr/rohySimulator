/**
 * oyon/group — group data OUT of Oyon.
 *
 * Oyon senses and aligns; it does not analyse. This subpath turns n members'
 * window events into the one long table that synchrony analysis consumes.
 * The measures themselves (coupling indices, WCC, CRQA/MdRQA, cluster phase,
 * shared-arousal events, joint attention, surrogate nulls, regime/TNA
 * framings) live in ladyna: `import { pairwiseSynchrony } from 'ladyna/synchrony'`.
 * See docs/GROUP_SYNCHRONY.md.
 */
export {
  groupTimeline,
  channelMatrix,
  checkGroupContext,
  GROUP_CONTEXT_KEYS,
  GROUP_REQUIRED_CONTEXT_KEYS,
} from './timeline.js';
export { GROUP_CHANNELS, channelSpec, listGroupChannels, screenZone, speakingState } from './channels.js';
export { GroupInputError } from './stats.js';
