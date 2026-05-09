-- Oyon: lower the sample-interval default for tenants who never explicitly
-- tuned it. Only touches rows still on the previous default (1000ms) so any
-- admin that picked their own value is left alone.
-- Why: 1Hz inference is perceptibly laggy in the pill ("emotion changed but
-- the label took a second to catch up"). 333ms (~3Hz) feels live and stays
-- well below typical inference latency on the WebGPU + multi-threaded WASM
-- path now that cross-origin isolation is enabled.

UPDATE oyon_settings
SET sample_interval_ms = 333,
    updated_at = CURRENT_TIMESTAMP
WHERE sample_interval_ms = 1000;
