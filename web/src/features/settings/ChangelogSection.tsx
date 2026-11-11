import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Loader } from '../../components/ui/Loader';
import { useToast } from '../../context/ToastContext';
import { language, t } from '../../i18n';

interface Group { title: string; items: string[] }
interface Release { version: string; date: string; groups: Group[] }

/** Liest CHANGELOG.md: "## Version – Datum", "### Gruppe", "- Eintrag". */
function parse(markdown: string): Release[] {
  const out: Release[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      const [version, date = ''] = line.slice(3).split(/\s+[–-]\s+/);
      out.push({ version: version.trim(), date: date.trim(), groups: [] });
    } else if (line.startsWith('### ') && out.length) {
      out[out.length - 1].groups.push({ title: line.slice(4), items: [] });
    } else if (line.startsWith('- ') && out.length) {
      const rel = out[out.length - 1];
      if (!rel.groups.length) rel.groups.push({ title: '', items: [] });
      rel.groups[rel.groups.length - 1].items.push(line.slice(2));
    }
  }
  return out;
}

export function ChangelogSection() {
  const toast = useToast();
  const [data, setData] = useState<{ version: string; markdown: string } | null>(null);
  useEffect(() => { api.system.changelog(language()).then(setData).catch(e => toast.error(e)); }, [toast]);
  const releases = useMemo(() => parse(data?.markdown ?? ''), [data]);

  if (!data) return <Loader />;
  return (
    <div className="narrow">
      {releases.map(r => (
        <Card key={r.version} className="release">
          <div className="release__head">
            <h2>{t('log.version', { version: r.version })}</h2>
            {r.version === data.version && <Badge tone="ok">{t('log.installed')}</Badge>}
            <span className="muted">{r.date}</span>
          </div>
          {r.groups.map(g => (
            <div key={g.title} className="release__group">
              {g.title && <h3>{g.title}</h3>}
              <ul>{g.items.map(i => <li key={i}>{i.replace(/`/g, '')}</li>)}</ul>
            </div>
          ))}
        </Card>
      ))}
      {releases.length === 0 && <p className="muted">{t('log.empty')}</p>}
    </div>
  );
}
