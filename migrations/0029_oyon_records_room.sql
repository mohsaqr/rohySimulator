-- Oyon v2: stamp each captured window with the simulator room it was
-- captured in ('chat' | 'examination' | 'lab' | 'radiology' | 'consultant',
-- or an app surface like 'settings'). The capture widget stamps the active
-- room at persist time; the Gaze analytics view breaks gaze down per room
-- (the analog of chatoyon's per-page gaze breakdown).

ALTER TABLE oyon_emotion_records ADD COLUMN room TEXT;
