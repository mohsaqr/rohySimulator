import { createRoute } from '@tanstack/react-router';
import { BookOpen, ExternalLink } from 'lucide-react';
import { rootRoute } from './root';
import { PageHeader } from '@/components/shell/PageHeader';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { Section } from '@/components/ui/Section';
import { StatusPill } from '@/components/ui/StatusPill';
import { useRuntime } from '@/lib/RuntimeProvider';
import { MODEL_PROFILES } from '@/lib/modelProfiles';
import { useSettings } from '@/lib/settingsStore';

/*
 * Help — docs surfacing, model card, glossary. The page is intentionally
 * informational: every other route in the app has a one-line link from
 * here.
 */

interface DocLink {
  title: string;
  doc: string;
  teaser: string;
}

const articles: ReadonlyArray<DocLink> = [
  {
    title: 'Platform design',
    doc: 'docs/PLATFORM_DESIGN.md',
    teaser:
      'Boundaries between Oyon and host apps; data streams; settings versioning.',
  },
  {
    title: 'UI architecture',
    doc: 'docs/UI_ARCHITECTURE.md',
    teaser:
      'The new shell — workflow domains, design-system primitives, runtime provider boundary, storage strategy.',
  },
  {
    title: 'Eye tracking signals',
    doc: 'docs/EYE_TRACKING.md',
    teaser:
      'Blink rate, eye openness, gaze entropy, focus score — what each means and how to read it.',
  },
  {
    title: 'Screen-point gaze',
    doc: 'docs/SCREEN_POINT_GAZE.md',
    teaser:
      'WebEyeTrack + WebGazer adapter contract, AOI dwell, calibration provenance.',
  },
  {
    title: 'Model selection',
    doc: 'docs/MODEL_SELECTION.md',
    teaser:
      'Which classifier to pick, license review, model-card requirements.',
  },
  {
    title: 'Deployment',
    doc: 'docs/DEPLOYMENT.md',
    teaser: 'HTTPS, CSP, caching, asset hosting.',
  },
  {
    title: 'Standalone mode',
    doc: 'docs/STANDALONE.md',
    teaser:
      'How the standalone shape works, sidecar lifecycle, local storage contract.',
  },
];

interface GlossaryEntry {
  term: string;
  unit?: string;
  range?: string;
  definition: string;
  nullMeans?: string;
}

const glossary: ReadonlyArray<GlossaryEntry> = [
  {
    term: 'focus_score',
    range: '[0, 1]',
    definition:
      'Composite engagement scalar combining blink rate, openness, and gaze stability. Higher = more focused.',
    nullMeans: 'no valid frames had eye openness.',
  },
  {
    term: 'blink_rate_hz',
    unit: 'Hz',
    definition:
      'Rising-edge count on the raw blink stream divided by window duration. Resting ≈ 0.20–0.33 Hz; cognitive load drops it.',
    nullMeans: 'window duration was zero.',
  },
  {
    term: 'gaze_entropy',
    range: '[0, 1]',
    definition:
      'Normalized Shannon entropy over the iris-offset bin distribution. Low = focused; high = scanning.',
    nullMeans: 'no frame produced an iris offset.',
  },
  {
    term: 'gaze.zone_proportions',
    definition:
      'How much of the window was spent in each named (3×3) or indexed (r#c#) zone. Sum ≈ 1 per window.',
    nullMeans: 'no valid frame produced a zone label.',
  },
  {
    term: 'gaze.calibration_confidence',
    definition:
      'measured | inferred | unknown. "unknown" means the engine cannot quantify; quality is null and should not be treated as zero.',
  },
  {
    term: 'settings_hash',
    definition:
      'Stable hex hash of the editable parameter set. Same hash → same processing pipeline. Surfaced in the TopBar.',
  },
];

function HelpPage() {
  const runtime = useRuntime();
  const editable = useSettings();
  const activeProfile = MODEL_PROFILES[editable.model_profile];

  return (
    <>
      <PageHeader
        title="Help & Documentation"
        description="Companion docs, the active model card, and a glossary of the metrics the dashboard surfaces."
      />

      <div className="flex flex-col gap-8">
        <Section
          id="help-model-card"
          title="Active model card"
          description="The classifier currently selected in Settings → Inference. Switching profiles changes this card."
        >
          <Card>
            <CardHeader>
              <CardTitle>{activeProfile.label}</CardTitle>
              <CardMeta>profile id: {activeProfile.id}</CardMeta>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="m-0 text-sm text-ink-1">{activeProfile.hint}</p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
                <KVRow k="Status" v={runtime.status} />
                <KVRow k="Settings hash" v={editable.settings_hash.slice(0, 7)} />
                <KVRow k="Gaze engine" v={editable.gaze_engine} />
                <KVRow
                  k="Sample interval"
                  v={`${editable.sample_interval_ms} ms`}
                />
                <KVRow
                  k="Window length"
                  v={`${editable.aggregate_window_ms} ms`}
                />
                <KVRow k="Min valid frames" v={String(editable.min_valid_frames)} />
              </dl>
              <p className="m-0 text-xs text-ink-3">
                Aggregate facial-expression signals are NOT ground-truth
                emotions. The EU AI Act (Article 5 / Recital 44) prohibits
                emotion-inference systems in education/workplace contexts
                outside medical or safety use cases. Treat this as
                research-governed, opt-in observation.
              </p>
            </CardContent>
          </Card>
        </Section>

        <Section
          id="help-docs"
          title="Documentation"
          description="Each card links to the canonical file in docs/. Opens in a new tab so your dashboard state survives."
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((a) => (
              <a
                key={a.doc}
                href={`https://github.com/mohsaqr/Oyon/blob/main/${a.doc}`}
                target="_blank"
                rel="noreferrer"
                className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info"
              >
                <Card className="h-full transition-colors group-hover:border-status-info">
                  <CardHeader>
                    <CardTitle>
                      <span className="inline-flex items-center gap-1.5">
                        <BookOpen className="size-3.5" aria-hidden="true" />
                        {a.title}
                      </span>
                    </CardTitle>
                    <ExternalLink
                      className="size-3.5 text-ink-3 group-hover:text-status-info"
                      aria-hidden="true"
                    />
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="m-0 text-sm text-ink-2">{a.teaser}</p>
                    <code className="block font-mono text-xs text-ink-3">
                      {a.doc}
                    </code>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        </Section>

        <Section
          id="help-glossary"
          title="Glossary"
          description="Plain-language definitions for the metrics the dashboard surfaces. Every entry also documents what `null` means — research-grade honesty about absence."
        >
          <Card>
            <CardContent>
              <ul className="flex flex-col divide-y divide-line" role="list">
                {glossary.map((g) => (
                  <li key={g.term} className="py-3 first:pt-0 last:pb-0">
                    <div className="mb-1 flex items-center gap-2">
                      <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-1">
                        {g.term}
                      </code>
                      {g.unit ? (
                        <StatusPill tone="info" size="sm">
                          {g.unit}
                        </StatusPill>
                      ) : null}
                      {g.range ? (
                        <StatusPill tone="info" size="sm">
                          {g.range}
                        </StatusPill>
                      ) : null}
                    </div>
                    <p className="m-0 text-sm text-ink-1">{g.definition}</p>
                    {g.nullMeans ? (
                      <p className="m-0 mt-1 text-xs text-ink-3">
                        <span className="font-medium text-ink-2">
                          null means:
                        </span>{' '}
                        {g.nullMeans}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </Section>
      </div>
    </>
  );
}

function KVRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-1.5 last:border-b-0">
      <dt className="text-[10px] uppercase tracking-wider text-ink-3">{k}</dt>
      <dd className="m-0 font-mono text-sm text-ink-0">{v}</dd>
    </div>
  );
}

export const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help',
  component: HelpPage,
});
