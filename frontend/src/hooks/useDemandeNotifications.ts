import { useEffect, useState, useCallback, useRef } from 'react';
import { demandeService } from '../services/api';
import { useAuth } from '../lib/AuthContext';
import { usePermission, Permissions } from './usePermission';

interface NotificationState {
  unreadCount: number;
  pendingDecisionCount: number;
  pendingExecutionCount: number;
  pendingClosureCount: number;
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
}

interface DemandeNotification {
  id: number;
  numero: string;
  statut: string;
  type: 'awaiting_decision' | 'awaiting_execution' | 'awaiting_closure' | 'new_request';
  message: string;
  timestamp: string;
}

/**
 * Hook for real-time demande notifications with polling
 */
export function useDemandeNotifications(pollInterval = 30000) {
  const { user } = useAuth();
  const { hasPermission, userRole } = usePermission();
  
  const [notifications, setNotifications] = useState<DemandeNotification[]>([]);
  const [state, setState] = useState<NotificationState>({
    unreadCount: 0,
    pendingDecisionCount: 0,
    pendingExecutionCount: 0,
    pendingClosureCount: 0,
    lastUpdated: null,
    isLoading: false,
    error: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActiveRef = useRef(true);
  const is429Ref = useRef(false);

  // Keep latest values in refs to avoid fetchNotifications identity changing
  const userRef = useRef(user);
  const hasPermissionRef = useRef(hasPermission);
  const userRoleRef = useRef(userRole);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { hasPermissionRef.current = hasPermission; }, [hasPermission]);
  useEffect(() => { userRoleRef.current = userRole; }, [userRole]);

  const fetchNotifications = useCallback(async () => {
    if (!userRef.current || !isActiveRef.current || is429Ref.current) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const now = new Date();
      const newNotifications: DemandeNotification[] = [];
      let pendingDecision = 0;
      let pendingExecution = 0;
      let pendingClosure = 0;

      // Fetch based on role
      if (hasPermissionRef.current(Permissions.DEMANDE_DECIDE) || userRoleRef.current === 'admin') {
        // Depot staff: demandes awaiting decision (envoyee)
        const decisionResponse = await demandeService.getAll({ statut: 'envoyee', limit: 10 });
        const decisionDemandes = decisionResponse.data || decisionResponse || [];
        pendingDecision = decisionDemandes.length;
        
        decisionDemandes.forEach((d: any) => {
          newNotifications.push({
            id: d.id,
            numero: d.numero,
            statut: d.statut,
            type: 'awaiting_decision',
            message: `Demande ${d.numero} de ${d.magasin_nom} attend votre décision`,
            timestamp: d.date_envoi || d.date_creation,
          });
        });
      }

      if (hasPermissionRef.current(Permissions.DEMANDE_EXECUTE) || userRoleRef.current === 'admin') {
        // Depot staff: demandes approved awaiting execution
        const execResponse = await demandeService.getAll({ 
          statut: ['approuvee', 'partiellement_approuvee'].join(','),
          limit: 10 
        });
        const execDemandes = execResponse.data || execResponse || [];
        pendingExecution = execDemandes.length;
        
        execDemandes.forEach((d: any) => {
          newNotifications.push({
            id: d.id,
            numero: d.numero,
            statut: d.statut,
            type: 'awaiting_execution',
            message: `Demande ${d.numero} approuvée - prête à être exécutée`,
            timestamp: d.date_decision || d.date_creation,
          });
        });
      }

      if (hasPermissionRef.current(Permissions.DEMANDE_CLOSE) || userRoleRef.current === 'admin') {
        // Magasin staff: delivered demandes awaiting closure
        const closeResponse = await demandeService.getAll({ statut: 'livree', limit: 10 });
        const closeDemandes = closeResponse.data || closeResponse || [];
        pendingClosure = closeDemandes.length;
        
        closeDemandes.forEach((d: any) => {
          newNotifications.push({
            id: d.id,
            numero: d.numero,
            statut: d.statut,
            type: 'awaiting_closure',
            message: `Demande ${d.numero} livrée - en attente de clôture`,
            timestamp: d.date_livraison || d.date_creation,
          });
        });
      }

      // Sort by timestamp (newest first)
      newNotifications.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setNotifications(newNotifications.slice(0, 20)); // Keep top 20
      setState({
        unreadCount: newNotifications.length,
        pendingDecisionCount: pendingDecision,
        pendingExecutionCount: pendingExecution,
        pendingClosureCount: pendingClosure,
        lastUpdated: now,
        isLoading: false,
        error: null,
      });
    } catch (error: any) {
      if (error?.response?.status === 429) {
        is429Ref.current = true;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        // Resume after 2 minutes
        setTimeout(() => { is429Ref.current = false; }, 120000);
      }
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error?.response?.status === 429 ? null : 'Erreur lors de la récupération des notifications',
      }));
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Polling
  useEffect(() => {
    if (pollInterval > 0) {
      intervalRef.current = setInterval(fetchNotifications, pollInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchNotifications, pollInterval]);

  // Visibility change handler (refresh when tab becomes active)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        isActiveRef.current = true;
        fetchNotifications();
      } else {
        isActiveRef.current = false;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchNotifications]);

  const refresh = useCallback(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const dismissNotification = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setState((prev) => ({ ...prev, unreadCount: Math.max(0, prev.unreadCount - 1) }));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setState((prev) => ({ ...prev, unreadCount: 0 }));
  }, []);

  return {
    notifications,
    ...state,
    refresh,
    dismissNotification,
    clearAll,
  };
}

export default useDemandeNotifications;
