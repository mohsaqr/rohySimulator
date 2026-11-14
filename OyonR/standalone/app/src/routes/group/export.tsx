import { Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardMeta, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { bundleFile, exportFiles } from '@/lib/groupDashboard';
import { download } from '@/components/group/download';
import { GroupGate, useGroupData, useGroupView } from './model';

/*
 * /group/export — the brushed span's tables (one row per observation), the
 * coding file and the input bundle.
 */
const EXPORT_NAMES = ['timeline.csv', 'pairs.csv', 'group.csv', 'regimes.csv', 'coding.json'];

export function GroupExportView() {
  const d = useGroupData();
  const { base, view } = useGroupView();
  if (!view) return <GroupGate base={base} />;
  const input = d.input;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export</CardTitle>
        <CardMeta>brushed span; one row per observation</CardMeta>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {EXPORT_NAMES.map((name) => (
          <Button
            key={name}
            size="sm"
            variant="outline"
            onClick={() => {
              // Built on click: the timeline CSV can be large.
              const file = exportFiles(view).find((f) => f.name === name);
              if (file) download(file);
            }}
          >
            <Download className="size-3.5" aria-hidden="true" /> {name}
          </Button>
        ))}
        {input ? (
          <Button size="sm" variant="outline" onClick={() => download(bundleFile(input, d.groupId))}>
            <Download className="size-3.5" aria-hidden="true" /> bundle
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
