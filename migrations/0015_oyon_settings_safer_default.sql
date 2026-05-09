-- Oyon: walk back the previous 333ms (3Hz) default to 500ms (2Hz).
-- Why: inference and ONNX preprocessing currently run on the React main
-- thread; an earlier attempt to move them to a Web Worker was abandoned
-- because MediaPipe's `var ModuleFactory` doesn't bind in module workers
-- (see HANDOFF.md). At 3Hz, every sample tick blocks the UI long enough
-- to feel laggy in the simulator. 500ms restores responsiveness while
-- still being live enough for the pill.
--
-- Only touches rows still on the previous default (333) so any admin who
-- explicitly tuned it is left alone.

UPDATE oyon_settings
SET sample_interval_ms = 500,
    updated_at = CURRENT_TIMESTAMP
WHERE sample_interval_ms = 333;
