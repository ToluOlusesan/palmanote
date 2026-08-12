import { ArrowBendUpLeft } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { flattenAll } from '../core/tree.ts';
import type { Backlink, DocumentMeta } from '../core/types.ts';
import { store } from '../data/index.ts';
import { useLibrary } from '../state/library.tsx';
import { DocumentIcon } from './IconPicker.tsx';

/**
 * What points here.
 *
 * The app has always been able to follow a link forwards — `@` in the prose,
 * and every page made inside another one leaves one behind. Read the other way
 * the same graph answers a different question: standing on a page, which
 * others mention it? Nothing had ever asked.
 *
 * It shows nothing at all when the answer is nothing. A page with no
 * references is the ordinary case, and a heading over an empty list is a
 * reproach for not having filed properly.
 */
export function Backlinks({ documentId }: { documentId: string }) {
  const { byId, tree, select } = useLibrary();
  const [links, setLinks] = useState<Backlink[]>([]);

  // Read when the page opens. Nothing can add a reference to the page you are
  // looking at without leaving it first, so there is no live case to chase.
  useEffect(() => {
    let cancelled = false;
    setLinks([]);
    void store
      .backlinks(documentId)
      .then((found) => {
        if (!cancelled) setLinks(found);
      })
      // A page that will not answer this is still a page you can write on.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // The store answers about every body it holds; the tree decides which of
  // those you could still reach. A reference from inside an archived folder is
  // not a reference you can follow.
  const rows: { doc: DocumentMeta; link: Backlink }[] = [];
  if (links.length > 0) {
    const live = new Set(flattenAll(tree).map((node) => node.doc.id));
    for (const link of links) {
      const doc = byId.get(link.id);
      if (doc && live.has(doc.id)) rows.push({ doc, link });
    }
    // Most recently touched first — the page that mentioned this one today is
    // likelier to be the one you meant than the one that did so in March.
    rows.sort((a, b) => b.doc.updatedAt - a.doc.updatedAt);
  }

  if (rows.length === 0) return null;

  return (
    <section className="backlinks" aria-label="Pages referencing this one">
      <h2 className="backlinks-heading">
        <ArrowBendUpLeft size={14} weight="bold" />
        Referenced on {rows.length} {rows.length === 1 ? 'page' : 'pages'}
      </h2>
      <ul className="backlinks-list">
        {rows.map(({ doc, link }) => (
          <li key={doc.id}>
            <button type="button" className="backlink" onClick={() => select(doc.id)}>
              <span className="backlink-title">
                <DocumentIcon icon={doc.icon} kind={doc.kind} size={14} />
                {doc.title || 'Untitled'}
                {link.count > 1 && <span className="backlink-count">×{link.count}</span>}
              </span>
              {link.context && <span className="backlink-context">{link.context}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
