import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCircle, Truck, Package, Clock, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDemandeNotifications } from '../hooks/useDemandeNotifications';
import { ScrollArea } from '@/components/ui/scroll-area';

const TYPE_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
  awaiting_decision: { icon: CheckCircle, label: 'Décision requise', color: 'text-warning' },
  awaiting_execution: { icon: Truck, label: 'Exécution requise', color: 'text-info' },
  awaiting_closure: { icon: Package, label: 'Clôture requise', color: 'text-success' },
  new_request: { icon: Clock, label: 'Nouvelle demande', color: 'text-muted-foreground' },
};

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    pendingDecisionCount,
    pendingExecutionCount,
    pendingClosureCount,
    isLoading,
    refresh,
    dismissNotification,
  } = useDemandeNotifications(30000); // Poll every 30 seconds

  const handleNotificationClick = (notification: any) => {
    setOpen(false);
    navigate(`/demandes/${notification.id}`);
  };

  const hasAnyPending = pendingDecisionCount > 0 || pendingExecutionCount > 0 || pendingClosureCount > 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative h-8 w-8 p-0">
          <Bell className="h-4 w-4" />
          {hasAnyPending && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground flex items-center justify-center">
              {Math.min(unreadCount, 9)}
              {unreadCount > 9 && '+'}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <h4 className="font-semibold text-sm">Notifications</h4>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refresh} disabled={isLoading}>
              <Loader2 className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Summary */}
        {(pendingDecisionCount > 0 || pendingExecutionCount > 0 || pendingClosureCount > 0) && (
          <div className="px-3 py-2 bg-muted/50 grid grid-cols-3 gap-2 text-center">
            {pendingDecisionCount > 0 && (
              <div className="text-xs">
                <span className="font-bold text-warning">{pendingDecisionCount}</span>
                <div className="text-muted-foreground">à décider</div>
              </div>
            )}
            {pendingExecutionCount > 0 && (
              <div className="text-xs">
                <span className="font-bold text-info">{pendingExecutionCount}</span>
                <div className="text-muted-foreground">à exécuter</div>
              </div>
            )}
            {pendingClosureCount > 0 && (
              <div className="text-xs">
                <span className="font-bold text-success">{pendingClosureCount}</span>
                <div className="text-muted-foreground">à clôturer</div>
              </div>
            )}
          </div>
        )}

        <ScrollArea className="h-[300px]">
          {notifications.length === 0 ? (
            <div className="px-3 py-8 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Aucune notification</p>
              <p className="text-xs mt-1">Les demandes en attente apparaîtront ici</p>
            </div>
          ) : (
            notifications.map((notification, index) => {
              const config = TYPE_CONFIG[notification.type];
              const Icon = config.icon;

              return (
                <div key={`${notification.id}-${index}`}>
                  <DropdownMenuItem
                    className="px-3 py-2 cursor-pointer focus:bg-accent"
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start gap-3 w-full">
                      <div className={`mt-0.5 ${config.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{notification.numero}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {notification.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(notification.timestamp).toLocaleString('fr-FR', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissNotification(notification.id);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </DropdownMenuItem>
                  {index < notifications.length - 1 && <DropdownMenuSeparator />}
                </div>
              );
            })
          )}
        </ScrollArea>

        <div className="p-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setOpen(false);
              navigate('/demandes');
            }}
          >
            Voir toutes les demandes
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default NotificationBell;
