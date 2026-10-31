import { ExternalLink } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { openExternalUrl } from '../../utils/externalLinks';
import { Modal } from '../ui/Modal';

const CHANGELOG_URL = 'https://catrealm.app/changelog/';

export function ChangelogModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);

  return (
    <Modal
      open={activeModal === 'changelog'}
      onClose={closeModal}
      title="Changelog"
      className="!max-w-5xl h-[calc(100vh-2rem)]"
      bodyClassName="!p-0 flex flex-col"
    >
      <iframe
        src={CHANGELOG_URL}
        title="CatRealm changelog"
        className="flex-1 w-full border-0 bg-bg-primary"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
      />
      <div className="flex justify-end px-4 py-2 border-t border-border">
        <button
          type="button"
          onClick={() => void openExternalUrl(CHANGELOG_URL)}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open in browser
        </button>
      </div>
    </Modal>
  );
}
