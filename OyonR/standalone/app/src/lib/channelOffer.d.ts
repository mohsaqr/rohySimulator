// Types for channelOffer.js — the channels the Analyze picker offers.
export declare function offeredChannels<T extends { value: string; label: string }>(
  options: ReadonlyArray<T>,
  kinds: { windows: boolean; eventModalities: string[] },
  current: string,
): Array<T & { disabled?: boolean }>;
