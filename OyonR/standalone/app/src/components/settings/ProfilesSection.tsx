import { useState } from 'react';
import { Save, Trash2, Upload } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { EditableSettings } from '@/lib/settingsStore';
import { useProfiles } from '@/lib/profilesStore';

/*
 * ProfilesSection — named, persisted settings profiles. The reproducibility
 * affordance from Tier 5 of the redesign plan. A profile captures the
 * full EditableSettings snapshot under a user-chosen name and shows when
 * it was created.
 */

export interface ProfilesSectionProps {
  current: EditableSettings;
  onLoad: (settings: EditableSettings) => void;
}

export function ProfilesSection({ current, onLoad }: ProfilesSectionProps) {
  const profiles = useProfiles((s) => s.profiles);
  const save = useProfiles((s) => s.save);
  const remove = useProfiles((s) => s.remove);
  const [name, setName] = useState('');

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    save(trimmed, current);
    setName('');
  }

  return (
    <Section
      id="settings-profiles"
      title="Profiles"
      description="Save the current parameter snapshot under a name so you can switch between research conditions in one click. Profiles persist in localStorage."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Save current as profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. baseline, pilot-condition-A"
                className="flex-1 rounded border border-line bg-surface-0 px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                }}
                aria-label="Profile name"
              />
              <Button
                onClick={handleSave}
                variant="primary"
                size="sm"
                disabled={!name.trim()}
              >
                <Save className="size-3.5" aria-hidden="true" />
                Save
              </Button>
            </div>
            <p className="m-0 text-xs text-ink-3">
              Saved profiles capture every editable field above — sampling
              cadence, smoothing, gaze, engagement. Loading a profile
              overwrites the current edits.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved profiles</CardTitle>
            <CardMeta>
              {profiles.length} profile{profiles.length === 1 ? '' : 's'}
            </CardMeta>
          </CardHeader>
          <CardContent className="space-y-2">
            {profiles.length === 0 ? (
              <EmptyState
                title="No saved profiles yet"
                description="Save the current settings under a name to switch between research conditions."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-line" role="list">
                {profiles.map((p) => (
                  <li
                    key={p.name}
                    className="flex items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink-0">
                        {p.name}
                      </div>
                      <div className="text-xs text-ink-3">
                        saved {new Date(p.savedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        onClick={() => onLoad(p.settings)}
                        variant="secondary"
                        size="sm"
                      >
                        <Upload className="size-3.5" aria-hidden="true" />
                        Load
                      </Button>
                      <Button
                        onClick={() => remove(p.name)}
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete profile ${p.name}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}
