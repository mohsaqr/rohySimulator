import { createRoute } from '@tanstack/react-router';
import { Fingerprint, Scale } from 'lucide-react';
import {
  OYON_HOST_CONTRACT_VERSION,
  OYON_VERSION,
  OYON_WINDOW_BATCH_SCHEMA_VERSION,
} from 'oyon';
import { rootRoute } from './root';
/*
 * Every licence is imported as raw TEXT and rendered inline — never fetched.
 * The Carm licence requires redistributed copies to include the licence text
 * itself rather than a link, and this app ships inside host pages whose CSP
 * would block a runtime fetch anyway. Importing means the text is in the
 * bundle: it renders offline, and it cannot silently disappear behind a failed
 * request. `scripts/sync-licenses.mjs` keeps these files current at build
 * time; `tests/license-contract.test.js` fails if one is missing or unlinked.
 */
import CARM_LICENSE from '../../../../LICENSE?raw';
import GPL_3_0 from '../../../../licenses/GPL-3.0-or-later.txt?raw';
import CARM_ECOSYSTEM_NOTICES from '../../../../licenses/carm-ecosystem-third-party-notices.txt?raw';
import EMOTIEFFLIB_LICENSE from '../../../../licenses/emotiefflib.LICENSE.txt?raw';
import HSEMOTION_LICENSE from '../../../../licenses/hsemotion.LICENSE.txt?raw';
import MEDIAPIPE_LICENSE from '../../../../licenses/mediapipe.LICENSE.txt?raw';
import ONNXRUNTIME_LICENSE from '../../../../licenses/onnxruntime-web.LICENSE.txt?raw';
import SILERO_LICENSE from '../../../../licenses/silero-vad.LICENSE.txt?raw';
import WEBEYETRACK_LICENSE from '../../../../licenses/webeyetrack.LICENSE.txt?raw';
import WEBGAZER_NOTICE from '../../../../licenses/webgazer.LICENSE.txt?raw';
import { PageHeader } from '@/components/shell/PageHeader';
import {
  Card,
  CardContent,
  CardHeader,
  CardMeta,
  CardTitle,
} from '@/components/ui/Card';
import { Section } from '@/components/ui/Section';
import { StatusPill } from '@/components/ui/StatusPill';

/*
 * Mirrors `scripts/licenses.manifest.mjs`, which is the source of truth.
 * `reach` states HOW the component gets to a user, because that is what
 * decides whose obligation a licence is — a peer dependency the host installs,
 * bytes vendored into this package, or weights downloaded onto the host's own
 * server. A flat list of names would hide that distinction.
 */
const THIRD_PARTY_LICENSES = [
  {
    name: 'WebGazer.js 3.5.3',
    spdx: 'GPL-3.0-or-later',
    copyleft: true,
    reach: 'Optional peer dependency — an opt-in engine, not the default (which is mediapipe). Its notice elects GPL-3.0-or-later; the full text follows it below.',
    latest: 'https://github.com/brownhci/WebGazer/blob/master/LICENSE.md',
    text: `${WEBGAZER_NOTICE}\n\n${'='.repeat(70)}\n\n${GPL_3_0}`,
  },
  {
    name: 'WebEyeTrack 0.0.2',
    spdx: 'MIT',
    copyleft: false,
    reach: 'Vendored byte-for-byte into this package as the alternative gaze engine.',
    latest: 'https://github.com/RedForestAi/WebEyeTrack',
    text: WEBEYETRACK_LICENSE,
  },
  {
    name: 'ONNX Runtime Web 1.25.1',
    spdx: 'MIT',
    copyleft: false,
    reach: 'Peer dependency; its WASM binaries also ship inside the embeddable element.',
    latest: 'https://github.com/microsoft/onnxruntime/blob/main/LICENSE',
    text: ONNXRUNTIME_LICENSE,
  },
  {
    name: '@mediapipe/tasks-vision 0.10.35',
    spdx: 'Apache-2.0',
    copyleft: false,
    reach: 'Peer dependency; WASM and the face-landmarker task file are fetched at runtime.',
    latest: 'https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE',
    text: MEDIAPIPE_LICENSE,
  },
  {
    name: 'Silero VAD v5.1.2',
    spdx: 'MIT',
    copyleft: false,
    reach: 'ONNX weights downloaded onto the host at runtime.',
    latest: 'https://github.com/snakers4/silero-vad/blob/master/LICENSE',
    text: SILERO_LICENSE,
  },
  {
    name: 'EmotiEffLib emotion weights',
    spdx: 'Apache-2.0',
    copyleft: false,
    reach: 'ONNX weights downloaded onto the host at runtime. Upstream states no limitation on academic or commercial use.',
    latest: 'https://github.com/sb-ai-lab/EmotiEffLib/blob/main/LICENSE',
    text: EMOTIEFFLIB_LICENSE,
  },
  {
    name: 'HSEmotion emotion weights',
    spdx: 'Apache-2.0',
    copyleft: false,
    reach: 'ONNX weights downloaded onto the host at runtime. Upstream states no limitation on academic or commercial use.',
    latest: 'https://github.com/HSE-asavchenko/hsemotion-onnx/blob/main/LICENSE',
    text: HSEMOTION_LICENSE,
  },
  {
    name: 'Carm ecosystem third-party notices',
    spdx: 'various',
    copyleft: false,
    reach: 'Carried because the Carm License requires third-party notices to travel with every copy.',
    latest: 'https://raw.githubusercontent.com/mohsaqr/carm-license/main/THIRD-PARTY-NOTICES.txt',
    text: CARM_ECOSYSTEM_NOTICES,
  },
];

function AboutPage() {
  return (
    <>
      <PageHeader
        title="About Oyon"
        description="Scientific overview, capabilities, version, and licensing."
      />

      <div className="flex flex-col gap-8">
        <Section
          id="about-identity"
          title="Oyon"
          description="Part of the LACARM ecosystem."
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
            <Card>
              <CardContent className="space-y-4">
                <StatusPill tone="info">LACARM ecosystem</StatusPill>
                <p className="m-0 text-sm leading-6 text-ink-1">
                  Oyon is a multimodal software platform for real-time
                  behavioral and physiological analytics, built on the Carm
                  software framework. The system enables synchronous
                  acquisition, processing, and time-resolved analysis of
                  camera-derived multimodal signals, supporting both live
                  monitoring and retrospective investigation.
                </p>
                <p className="m-0 text-sm leading-6 text-ink-1">
                  The analytical pipeline performs automated estimation of
                  facial affect, valence, arousal, gaze direction, ocular
                  activity, attention and engagement metrics, head pose and
                  posture, remote photoplethysmographic (rPPG) heart rate,
                  respiration, and measurement-quality indicators. Extracted
                  observations are organized into participant- and
                  session-indexed temporal data structures, enabling scalable
                  longitudinal and cross-sectional analyses.
                </p>
                <p className="m-0 text-sm leading-6 text-ink-1">
                  Carm provides an integrated suite of computational analytics
                  for descriptive, comparative, relational, and temporal
                  exploration of multimodal behavioral data. These capabilities
                  include signal trajectory analysis, state distribution
                  modeling, gaze heatmap generation, transition network
                  construction, graph-centrality analysis, sequence and spell
                  analysis, pattern structure discovery, and between-session
                  comparative analysis. Together, these methods support
                  quantitative characterization of behavioral dynamics and
                  physiological responses across individuals, sessions, and
                  experimental conditions.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="inline-flex items-center gap-1.5">
                    <Fingerprint className="size-3.5" aria-hidden="true" />
                    Pinned release identity
                  </span>
                </CardTitle>
                <CardMeta>immutable tag</CardMeta>
              </CardHeader>
              <CardContent>
                <dl className="m-0 grid gap-3 text-sm">
                  <VersionRow label="Oyon version" value={`v${OYON_VERSION}`} />
                  <VersionRow
                    label="Host contract"
                    value={OYON_HOST_CONTRACT_VERSION}
                  />
                  <VersionRow
                    label="Window batch"
                    value={OYON_WINDOW_BATCH_SCHEMA_VERSION}
                  />
                </dl>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section
          id="about-capabilities"
          title="Capabilities"
          description="Multimodal sensing, dynamic analytics, research workflows, and platform integration."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <CapabilityCard
              title="Real-time multimodal sensing"
              items={[
                'Facial expressions, dominant emotion, valence, and arousal',
                'Gaze coordinates, gaze zones, heatmaps, and area-of-interest dwell',
                'Attention, engagement, focus, blink rate, and eye openness',
                'Heart rate and respiration',
                'Facial action signals, head position, and body posture',
                'Capture quality, confidence, missingness, and calibration status',
              ]}
            />
            <CapabilityCard
              title="Carm-powered dynamic analytics"
              items={[
                'Affect, engagement, gaze, heart-rate, and breathing timelines',
                'State distributions and transition networks',
                'Centrality measures, sequence plots, and spell statistics',
                'Pattern analysis and structural visualizations',
                'User, session, and cohort comparison',
                'Filterable analytical views and detailed window logs',
              ]}
            />
            <CapabilityCard
              title="Research workflow"
              items={[
                'Live monitoring and sensing diagnostics',
                'Gaze calibration and semantic area-of-interest configuration',
                'Participant and session management',
                'Configurable models, sampling, and aggregation',
                'Local session storage and later review',
                'Reproducibility-bundle export',
                'Aggregate-window processing without raw-frame storage or transmission',
              ]}
            />
            <CapabilityCard
              title="Deployment and integration"
              items={[
                'Standalone research application',
                'Embeddable Oyon web component',
                'Capture, capture-with-analytics, and viewer-only modes',
                'Host-supplied participant and session identity',
                'Host-defined semantic gaze areas of interest',
                'Live sample, aggregate-window, and optional validated sync interfaces',
              ]}
            />
          </div>
        </Section>

        <Section
          id="about-license"
          title="License"
          description="Carm Research License v1.4, plus the full text of every third-party license Oyon ships, vendors or downloads."
        >
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="inline-flex items-center gap-1.5">
                    <Scale className="size-3.5" aria-hidden="true" />
                    Carm Research License v1.4
                  </span>
                </CardTitle>
                <CardMeta>2025–2026 Professor Mohammed Saqr, PhD</CardMeta>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="m-0 text-sm text-ink-2">
                  Free for research, teaching and other non-commercial use, including
                  industry-funded academic work. A paid license is required for commercial use.
                  Results you produce are yours and may be published without restriction.
                </p>
                <p className="m-0 text-xs text-ink-3">
                  The text below is embedded at build time from the pinned{' '}
                  <code>v1.4</code> tag — it is what this build is licensed under, and it cannot
                  change without a deliberate release.{' '}
                  <a
                    className="underline"
                    href="https://raw.githubusercontent.com/mohsaqr/carm-license/main/LICENSE.txt"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Latest version ↗
                  </a>{' '}
                  ·{' '}
                  <a
                    className="underline"
                    href="https://github.com/mohsaqr/carm-license"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    mohsaqr/carm-license ↗
                  </a>
                </p>
                <pre className="m-0 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-0 p-4 font-mono text-xs leading-5 text-ink-2">
                  {CARM_LICENSE.trim()}
                </pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Third-party licenses</CardTitle>
                <CardMeta>
                  Embedded in full, not linked — every text below is in this bundle and readable
                  offline. Copyleft components are flagged.
                </CardMeta>
              </CardHeader>
              <CardContent className="space-y-2">
                {THIRD_PARTY_LICENSES.map((entry) => (
                  <details
                    key={entry.name}
                    className="rounded-md border border-line bg-surface-0 px-3 py-2"
                  >
                    <summary className="cursor-pointer text-sm text-ink-1">
                      <span className="font-medium">{entry.name}</span>
                      <span className="ml-2 text-xs text-ink-3">{entry.spdx}</span>
                      {entry.copyleft ? (
                        <StatusPill tone="warn" size="sm">
                          copyleft
                        </StatusPill>
                      ) : null}
                    </summary>
                    <p className="m-0 mt-2 text-xs text-ink-3">{entry.reach}</p>
                    {/*
                     * Embedded text and live link are complementary: the text
                     * below is what THIS build is licensed under, frozen so it
                     * cannot change under the reader; the link is where that
                     * licence lives now, for when this copy is a release behind.
                     */}
                    <p className="m-0 mt-1 text-xs">
                      <a
                        className="text-ink-3 underline"
                        href={entry.latest}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Latest upstream licence ↗
                      </a>
                    </p>
                    <pre className="m-0 mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded border border-line bg-surface-1 p-3 font-mono text-[11px] leading-5 text-ink-2">
                      {entry.text.trim()}
                    </pre>
                  </details>
                ))}

                {/*
                 * Vendored first-party code is NAMED even though it needs no
                 * separate license: the Carm License above already covers the
                 * whole ecosystem. Listing it means "no separate license" is a
                 * visible decision rather than an absence a reader would have
                 * to notice — ladyna was missing from the notices entirely
                 * before this page listed it.
                 */}
                <p className="m-0 border-t border-line pt-3 text-xs text-ink-3">
                  <span className="font-medium text-ink-2">Vendored Carm ecosystem code:</span>{' '}
                  ladyna 1.8.13 (<code>standalone/vendor/ladyna</code>), the tnaj/ladyna
                  analysis engine. No separate license text — the Carm Research License above applies to
                  Carm and every component of the Carm ecosystem, this included.
                </p>
              </CardContent>
            </Card>
          </div>
        </Section>
      </div>
    </>
  );
}

function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-3 border-b border-line pb-2 last:border-0 last:pb-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="m-0 break-all font-mono text-sm text-ink-0">{value}</dd>
    </div>
  );
}

function CapabilityCard({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="m-0 space-y-2 pl-5 text-sm leading-5 text-ink-1">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: AboutPage,
});
