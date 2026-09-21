import { ArrowCounterClockwise, Trash, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { useLibrary } from '../state/library.tsx';
import { DocumentIcon } from './IconPicker.tsx';

/** A focused modal: deleted pages deserve room to be inspected before their
    two irreversible outcomes are chosen. */
export function TrashPane({ onClose }: { onClose: () => void }) {
  const library = useLibrary();
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={onClose}>
    <section className="dialog trash-view" role="dialog" aria-modal="true" aria-label="Trash" onMouseDown={(event) => event.stopPropagation()}>
      <header className="trash-head">
        <div>
          <h1>Trash</h1>
          <p>Deleted pages wait here until you restore them or remove them for good.</p>
        </div>
        <button type="button" className="trash-close" aria-label="Close Trash" title="Close Trash" onClick={onClose}>
          <X size={17} weight="bold" />
        </button>
      </header>

      {library.archived.length === 0 ? (
        <div className="trash-empty">
          <Trash size={22} weight="duotone" />
          <p>Trash is empty.</p>
        </div>
      ) : (
        <ul className="trash-list">
          {library.archived.map((doc) => (
            <li key={doc.id} className="trash-item">
              <span className="trash-icon"><DocumentIcon icon={doc.icon} kind={doc.kind} size={17} /></span>
              <span className="trash-title">{doc.title || 'Untitled'}</span>
              <div className="trash-actions">
                {confirming === doc.id ? (
                  <>
                    <button type="button" className="trash-delete" onClick={() => void library.destroy(doc.id)}>Delete for good</button>
                    <button type="button" className="trash-keep" onClick={() => setConfirming(null)}>Keep</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="trash-restore" onClick={() => void library.restore(doc.id)}><ArrowCounterClockwise size={15} /> Restore</button>
                    <button type="button" className="trash-delete" onClick={() => setConfirming(doc.id)}>Delete</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
    </div>
  );
}
