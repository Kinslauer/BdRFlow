import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from '../ui/IconButton';
import { getString } from '../../lib/i18n/index';
import { activeTab, useTabsStore } from '../../store/useTabsStore';

/**
 * Back and Forward through the active tab's history. In a web tab that history
 * holds the pages visited in it, so the same arrows step through the web pages.
 */
export function HistoryArrows({ size }: { size?: 'sm' }) {
  const navigate = useNavigate();
  const canGoBack = useTabsStore((state) => activeTab(state).index > 0);
  const canGoForward = useTabsStore((state) => {
    const tab = activeTab(state);
    return tab.index < tab.entries.length - 1;
  });

  return (
    <>
      <IconButton
        size={size}
        title={getString('topbar_back')}
        aria-label={getString('topbar_back')}
        onClick={() => navigate(-1)}
        disabled={!canGoBack}
        className="text-chrome-neutral-300 hover:text-chrome-neutral-100"
      >
        <ArrowLeft className="rtl:-scale-x-100" />
      </IconButton>
      <IconButton
        size={size}
        title={getString('topbar_forward')}
        aria-label={getString('topbar_forward')}
        onClick={() => navigate(1)}
        disabled={!canGoForward}
        className="text-chrome-neutral-300 hover:text-chrome-neutral-100"
      >
        <ArrowRight className="rtl:-scale-x-100" />
      </IconButton>
    </>
  );
}
