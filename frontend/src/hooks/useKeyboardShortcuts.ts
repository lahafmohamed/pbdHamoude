import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface Shortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger shortcuts when user is typing in input fields
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.contentEditable === 'true'
    ) {
      return;
    }

    for (const shortcut of shortcuts) {
      const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatches = !!shortcut.ctrlKey === event.ctrlKey;
      const metaMatches = !!shortcut.metaKey === event.metaKey;
      const shiftMatches = !!shortcut.shiftKey === event.shiftKey;
      const altMatches = !!shortcut.altKey === event.altKey;

      if (keyMatches && ctrlMatches && metaMatches && shiftMatches && altMatches) {
        event.preventDefault();
        event.stopPropagation();
        shortcut.action();
        break;
      }
    }
  }, [shortcuts]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

// Default ERP shortcuts
export function useERPShortcuts() {
  const navigate = useNavigate();

  const shortcuts: Shortcut[] = [
    {
      key: 'F1',
      action: () => navigate('/factures/nouvelle'),
      description: 'Nouvelle facture',
    },
    {
      key: 'F2',
      action: () => navigate('/inventaire'),
      description: 'Inventaire',
    },
    {
      key: 'F3',
      action: () => navigate('/tiers'),
      description: 'Contacts',
    },
    {
      key: 'F5',
      action: () => navigate('/commandes'),
      description: 'Commandes',
    },
    {
      key: 'F6',
      action: () => navigate('/caisse'),
      description: 'Caisse',
    },
    {
      key: 'F7',
      action: () => navigate('/reporting'),
      description: 'Rapports',
    },
    {
      key: 'F9',
      action: () => navigate('/devis/nouveau'),
      description: 'Nouveau devis',
    },
    {
      key: 'F10',
      action: () => navigate('/receptions'),
      description: 'Réceptions',
    },
    {
      key: 'h',
      ctrlKey: true,
      action: () => {
        // Toggle help modal or show shortcuts
        const shortcutsList = shortcuts.map(s => `${s.key}: ${s.description}`).join('\n');
        alert('Raccourcis clavier:\n\n' + shortcutsList);
      },
      description: 'Afficher l\'aide',
    },
  ];

  useKeyboardShortcuts(shortcuts);
  return shortcuts;
}
