# TODO — group physiological synchrony dashboard

Added 2026-09-06. Full text of the plan: [`docs/GROUP_SYNCHRONY_PLAN.md`](docs/GROUP_SYNCHRONY_PLAN.md)
(web: https://claude.ai/code/artifact/6ef3b4d0-383a-447f-a11f-5cdf04d83231).
Evidence base: [`docs/PHYSIOLOGICAL_SYNCHRONY_LITERATURE.md`](docs/PHYSIOLOGICAL_SYNCHRONY_LITERATURE.md)
(web: https://claude.ai/code/artifact/6aead272-462e-4c39-871b-8fde0dee4565).
Section numbers below refer to the plan; "Lit §" to the literature review.

> **Status 2026-11-13.** Split decided by the owner: **Oyon captures and aligns;
> ladyna analyses.** Phases 0 and the data-out step live in Oyon
> (`docs/GROUP_SYNCHRONY.md`); every measure, null, simulator and sequence
> framing lives in ladyna's `ladyna/synchrony` (`../tna-js`,
> `docs/api/synchrony.md`), checked against R. Nothing analytic is in Oyon.

## Phase 0 — alignment plumbing in Oyon (plan §2, §7) — done

- [x] `GroupSessionClock` (`src/core/GroupSessionClock.js`): min-RTT NTP handshake on start and every `group_clock_resync_ms`; `ts_group_ms` beside `ts_ms` on samples and raw-stream rows; `clock_offset_ms`, `clock_rtt_ms`, `clock_source`, `window_{start,end}_group_ms` on windows; `markSync()` marker fallback; failures keep the last offset and are reported. `tests/group-clock.test.js`.
- [x] `window_anchor_ms` setting: `EmotionAggregator` closes windows on the anchored grid; late joiners get missing windows. `tests/group-alignment.test.js`.
- [x] `group_id`, `member_id`, `seat` documented as the group context keys (`docs/GROUP_SYNCHRONY.md` §1); `checkGroupContext()`.
- [x] `raw_streams` on every window by default (`src/aggregation/RawStreamRecorder.js`): affect, head, eye, au, blendshapes, posture, heart_rate, ibi, respiration, illumination, screen_gaze; validator shape/size check (`validateRawStreamsBlock`, 1 MB), `types/`, `examples/rohy-backend` (`0012_group_alignment.sql`), Express/LAILA body limits raised to 4 MB.
- [x] Tests for offset maths, anchored boundaries, raw-stream shapes (`group-clock`, `group-alignment`).

## Phase 1 — synchrony core — done, in ladyna (`ladyna/synchrony`)

- [x] Long table: Oyon `oyon/group` `groupTimeline()` (LOCF within tolerance, person-z, quality, window fallback, derived head speed) — `tests/group-timeline.test.js`. Ladyna consumes it as `SyncRow[]`.
- [x] `pairwiseSynchrony()` — PCI (SM/IDM/DA/r/Fisher-z), SSI, sync cycles, concordance, WCC with peak picking, CRQA symbolic + embedded with lead/lag, PLV, DTW; `partial_out`; `meanPairwise()`. R equivalence vs `rMEA` 1.2.2, `crqa` 2.0.7, `dtw` 1.23.1 (≤ 6.7e-16).
- [x] `arousalEvents()` + `arousalEventSummary()` (shared arousal, out-of-sync).
- [x] `groupSynchrony()` — MdRQA (published EDA embedding, vs `crqa` mdcrqa ≤ 2e-14), cluster phase, dispersion/convergence, mean pairwise.
- [x] `jointAttention()` — ±2 s co-occurrence, cosine JVA, initiation balance, n-way modal share.
- [x] `surrogateNull()` — pseudo-group, circular shift, segment shuffle, IAAFT; `z`, `p_null`, band.
- [x] `partial_out` (nuisance regression) in `pairwiseSynchrony`.
- [x] Every verb returns one row per observation with `overlap`; nulls add `z`, `p_null`; exports `ladyna/synchrony` + root; docs `docs/api/synchrony.md`.
- [x] Formula tests against hand-computed fixtures + invariances (ladyna `tests/synchrony-*.test.ts`).

## Phase 2 — sequence and TNA framings — done, in ladyna

- [x] `codeStates()` with exported `codingTable()`; person terciles; `uncertain` kept.
- [x] `regimeSequence()` (affect / attention / arousal).
- [x] `interactionSequence()` with τ gating and role collapsing.
- [x] Bridges `toSequences` / `toCoOccurrence` / `toLagPairs` → ladyna `tna`, `ftna`, `ctna`, `groupTna`, `sequenceIndices`, `lsa`, `transferEntropy` (verified by calling them).
- [x] `toVarRows` for psychaj `fitGraphicalVAR` / `fitMlVAR` (shape verified; psychaj not called — separate library).
- [x] Worked example: ladyna `examples/synchrony/worked-example.ts` (real output in its README).

## Phase 3 — dashboard

- [x] `examples/group-hub`: clock endpoint, WebSocket relay, roster, export bundle, marker broadcast — `tests/group-hub.test.js`.
- [x] `/group` route in `standalone/app` (`routes/group.tsx`, `components/group/`, `lib/groupDashboard.js`): header with quality chips, trigger-event timeline (shared arousal, out of sync, joint-attention breaks, hub markers), synchrony strip with null band, pairwise matrix with lead arrows and z, member ribbons, regime band + transition counts, joint-attention and member-index tables. Every number from `ladyna/synchrony` (incl. `jointAttentionBreaks`). Loaded with the synthetic demo in a headless browser: every panel rendered, no console errors. Not built: one lane per channel, drawn TNA network, who → whom / psychaj panel, per-phase summaries, multi-channel ribbons.
- [x] Brush (start/end sliders, not drag on the ribbons), measure selector per channel class, shapes + labels with every hue (Okabe-Ito), hatched low-quality spans.
- [x] Exports: `timeline.csv`, `pairs.csv`, `group.csv`, `regimes.csv`, `coding.json`, bundle.
- [x] Replay from a hub export bundle / windows array / timeline rows; live mode over the hub WebSocket (not tested against a running hub).
- [x] Feedback mode, off by default, labelled a study condition.

## Phase 4 — validation

- [x] Synthetic coupled generator: ladyna `simulateGroup` / `simulatePool` (VAR with known coupling and lags, Kuramoto oscillators, gaze leader–follower, block missingness, shared stimulus).
- [x] Recovery: WCC lag ±1 s and TE direction ≥ 90 % from coupling 0.2, CRQA leader from 0.3 (noise SD 1) — `tests/synchrony-recovery.test.ts`, sweep `tools/synchrony-recovery-report.ts`, table in `docs/api/synchrony.md`.
- [x] Null calibration: shared stimulus, uncoupled → mean z 0.07 under pseudo-groups vs 4.95 under circular shift; FPR within binomial bound — `tests/synchrony-surrogates.test.ts`.
- [x] R equivalence fixtures: `rMEA` (WCC), `crqa` (CRQA, MdRQA), `dtw`. Not done: `RTransferEntropy` and `mlVAR`/`graphicalVAR` fixtures (TE is ladyna lagdynamics' own, already R-checked there; VAR models belong to psychaj).
- [ ] Two-laptop live alignment test — tool and protocol ready (`examples/group-hub/alignment-check.html`, README); needs two machines and a camera; not run.

## Later

- [x] Experimental IBI stream from the rPPG pulse (`src/analytics/InterBeatIntervals.js`, `raw_streams.ibi`, channel `heart_rate.ibi`); MdRQA on it = ladyna `groupSynchrony({ channel: 'heart_rate.ibi' })`. Not validated on real faces.
- [x] One-camera multi-face tracks: `FaceTrackAssigner` + `MultiFaceCapture` (`member_id = track_id` or a mapping) — affect + head pose per track; mocks only, never run on a live camera; eye/AU/posture/rPPG stay single-face; no re-identification.
- [x] Host-supplied speaking-turn channel: `runtime.recordHostSample('speech', { state })` + channel `speaking` (held state).

## Interpretation rules to carry into every panel (plan §10; Lit §5–6)

- Synchrony is a marker of shared events and regulation triggers, not a collaboration-quality score (Nguyen 2023; Lämsä 2024; Schneider 2020).
- Face and gaze are the evidenced webcam channels; HR synchrony is weakly evidenced even with contact sensors (Liu 2021) and attenuated over video (Streuber 2026) — label it experimental.
- Negative affect rarely reaches the face (Marx 2025); facial contagion is mostly positive-valence contagion.
- Compare within person first; report the null and the weighted overlap with every number.

## References (full text)

Literature review with all citations and retrieval status: [`docs/PHYSIOLOGICAL_SYNCHRONY_LITERATURE.md`](docs/PHYSIOLOGICAL_SYNCHRONY_LITERATURE.md). Key sources by link:

- Pijeira-Díaz, Drachsler, Järvelä & Kirschner 2016, LAK — physiological coupling indices. https://dl.acm.org/doi/10.1145/2883851.2883897
- Dich, Reilly & Schneider 2018, AIED — PCIs vs collaboration quality and learning gains. https://link.springer.com/chapter/10.1007/978-3-319-93843-1_8
- Schneider, Dich & Radu 2020, ijCSCL — cycles of synchronisation. https://link.springer.com/article/10.1007/s11412-020-09318-2
- Schneider, Sharma, Cuendet, Zufferey, Dillenbourg & Pea 2018, ijCSCL — joint visual attention. https://link.springer.com/article/10.1007/s11412-018-9281-2
- Malmberg et al. 2019, ijCSCL — monitoring, arousal, synchrony in a collaborative exam. https://link.springer.com/article/10.1007/s11412-019-09311-4
- Haataja, Malmberg & Järvelä 2018, CHB — monitoring and synchrony co-occurrence. https://doi.org/10.1016/j.chb.2018.06.007
- Haataja, Malmberg, Dindar & Järvelä 2022, Metacognition & Learning — MdRQA parameters, monitoring valence. https://link.springer.com/article/10.1007/s11409-021-09279-3
- Dindar, Järvelä & Haataja 2020, BJET — MdRQA, metacognitive experiences. https://doi.org/10.1111/bjet.12981
- Dindar, Järvelä, Ahola, Huang & Zhao 2020, IEEE TAC — facial emotion CRQA, leaders and followers. https://doi.org/10.1109/TAFFC.2020.3003243
- Pijeira-Díaz, Drachsler, Järvelä & Kirschner 2019, CHB — arousal commonality in triads. https://www.sciencedirect.com/science/article/abs/pii/S0747563218305442
- Liu, Wang, Wang & Zhang 2021, Frontiers in Psychology — SSI; EDA vs HR synchrony. https://www.frontiersin.org/articles/10.3389/fpsyg.2021.674369
- Nguyen, Järvelä, Rosé, Järvenoja & Malmberg 2023, BJET — shared physiological arousal events. https://doi.org/10.1111/bjet.13280
- Li, Hu, Li & Mao 2023, Frontiers in Psychology — synchronised HR arousal episodes in four-member groups. https://pmc.ncbi.nlm.nih.gov/articles/PMC9888411/
- Lämsä et al. 2024, JLA — linguistic alignment and synchrony around trigger events. https://doi.org/10.18608/jla.2024.8287
- Sobocinski, Malmberg & Järvelä 2021, TKL — HR and adaptation. https://link.springer.com/article/10.1007/s10758-021-09526-1
- Törmänen, Järvenoja, Saqr, Malmberg & Järvelä 2022, BJEP — group affective states and regulation. https://doi.org/10.1111/bjep.12525
- Yan et al. 2025, IJAIED — HR synchrony in nursing simulations. https://link.springer.com/article/10.1007/s40593-025-00475-9
- Medical residents 2026, Learning & Instruction — MdRQA and leader performance. https://www.sciencedirect.com/science/article/pii/S0959475225002269
- Algumaei et al. 2023, Sensors — cross-correlation vs MdRQA in triads. https://www.mdpi.com/1424-8220/23/4/2268
- Jiang, Liu, Ma & Wang 2026, ijCSCL — FER, lag sequential analysis, collective emotions. https://link.springer.com/article/10.1007/s11412-026-09481-y
- Golrang & Sharma 2026 — JVA / joint mental-effort feedback in pair programming. https://arxiv.org/abs/2605.05836
- Marx, Sachs, Frenzel & Schweizer 2025, Frontiers in Psychology — facial contagion in video calls, CRQA vs surrogates. https://pmc.ncbi.nlm.nih.gov/articles/PMC12003383/
- Tomashin, Gordon & Wallot 2022, Frontiers in Human Neuroscience — MdRQA, false-pair surrogates, baseline caveat. https://www.frontiersin.org/articles/10.3389/fnhum.2022.903407
- Streuber et al. 2026, Scientific Reports — HRV synchrony face-to-face vs video vs VR. https://www.nature.com/articles/s41598-026-35955-y
- Mayo, Lavidor & Gordon 2021, Physiology & Behavior — meta-analysis. https://doi.org/10.1016/j.physbeh.2021.113391
- Febriantoro, Gauthier & Cukurova 2023, EC-TEL — systematic review, 13 studies. https://link.springer.com/chapter/10.1007/978-3-031-42682-7_6
- Schneider, Fang, Kang, Chejara & Bu 2025, ijCSCL — 25-year collaboration-sensing review. https://link.springer.com/article/10.1007/s11412-025-09458-3
- Lawrence & Weinberger 2022, Frontiers in Education — Being in-sync framework. https://www.frontiersin.org/articles/10.3389/feduc.2022.867186
- Ahonen et al. 2016, PLOS ONE; 2018, Scientific Reports — HRV compliance in pair programming. https://doi.org/10.1371/journal.pone.0159178 ; https://doi.org/10.1038/s41598-018-21518-3
- Vrzakova et al. 2020, LAK — multimodal patterns in remote triads. https://dynamicog.org/publications/proceedings/6-VrzakovaDuran2020.pdf
- Wiltshire, Steffensen & Fiore 2019, Applied Ergonomics — multiscale movement coordination. https://www.sciencedirect.com/science/article/abs/pii/S0003687018301972
- Bevilacqua et al. 2019, J. Cognitive Neuroscience; Davidesco et al. 2023, Psychological Science; Tan, Wong & Teo 2023, NeuroImage — classroom hyperscanning. https://doi.org/10.1162/jocn_a_01274 ; https://doi.org/10.1177/09567976231163872 ; https://doi.org/10.1016/j.neuroimage.2023.120367
- Methods: Boker et al. 2002 (windowed cross-correlation); Coco & Dale 2014 (`crqa`); Wallot, Roepstorff & Mønster 2016 (MdRQA); Richardson et al. 2012 (cluster phase); Moulder et al. 2018 (surrogates); Schreiber 2000 (transfer entropy); Kleinbub & Ramseyer 2021 (`rMEA`).
