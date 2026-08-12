import { X } from '@phosphor-icons/react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useMemo } from 'react';

export interface OpenPdf {
  path: string;
  name: string;
}

/**
 * A PDF, in the main window.
 *
 * The viewer is the one already inside WebView2 — zoom, search, print, page
 * navigation and thumbnails all come from Edge and cost nothing to carry.
 * Pointing an iframe at the file is the whole implementation; the alternative
 * was bundling pdf.js, which is about half the size of this entire app.
 *
 * The main process widens the asset scope to the single file that was picked,
 * so the page can read that PDF and nothing else on the disk.
 */
export function PdfReader({ file, onClose }: { file: OpenPdf; onClose: () => void }) {
  const source = useMemo(() => convertFileSrc(file.path), [file.path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="reader">
      <header className="reader-bar">
        <span className="reader-name" title={file.path}>
          {file.name}
        </span>
        <button type="button" className="chrome-btn" aria-label="Close the PDF" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <iframe className="reader-frame" src={source} title={file.name} />
    </div>
  );
}
