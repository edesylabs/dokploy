import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Loader2, RefreshCw, Plus, Trash, Play, Square, Server, Terminal } from 'lucide-react';
import { ServerProvisioningForm } from './server-provisioning-form';

interface ServerListProps {
  servers: any[];
  cloudProviders: any[];
  onRefresh: () => void;
  isLoading?: boolean;
}

export function ServerList({ servers, cloudProviders, onRefresh, isLoading = false }: ServerListProps) {
  const router = useRouter();
  const [isProvisioningDialogOpen, setIsProvisioningDialogOpen] = useState(false);
  const [isTerminatingServer, setIsTerminatingServer] = useState(false);
  const [serverToTerminate, setServerToTerminate] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Handle server provisioning
  const handleProvisionServer = async (data: any) => {
    try {
      const response = await fetch(`/api/cloud-providers/${data.cloudProviderId}/servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to provision server');
      }

      setIsProvisioningDialogOpen(false);
      onRefresh();
    } catch (error) {
      console.error('Error provisioning server:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to provision server');
      throw error;
    }
  };

  // Handle server termination
  const handleTerminateServer = async (serverId: string) => {
    try {
      setIsTerminatingServer(true);
      
      const response = await fetch(`/api/servers/${serverId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to terminate server');
      }

      toast.success('Server terminated successfully');
      setServerToTerminate(null);
      onRefresh();
    } catch (error) {
      console.error('Error terminating server:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to terminate server');
    } finally {
      setIsTerminatingServer(false);
    }
  };

  // Handle server status refresh
  const handleRefreshStatus = async (serverId: string) => {
    try {
      setIsRefreshing(true);
      
      const response = await fetch(`/api/servers/${serverId}/status`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to refresh server status');
      }

      toast.success('Server status refreshed');
      onRefresh();
    } catch (error) {
      console.error('Error refreshing server status:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to refresh server status');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Handle installing Kubernetes
  const handleInstallKubernetes = async (serverId: string) => {
    try {
      const response = await fetch(`/api/servers/${serverId}/install-kubernetes`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to install Kubernetes');
      }

      const data = await response.json();
      toast.success('Kubernetes installed successfully');
      
      // Redirect to the cluster page
      router.push(`/dashboard/kubernetes/clusters/${data.clusterId}`);
    } catch (error) {
      console.error('Error installing Kubernetes:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to install Kubernetes');
    }
  };

  // Get status badge color
  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-green-500';
      case 'provisioning':
        return 'bg-blue-500';
      case 'stopped':
        return 'bg-yellow-500';
      case 'terminated':
        return 'bg-red-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  // Format cost
  const formatCost = (hourlyRate: number, currentBilling: number) => {
    return (
      <div className="text-sm">
        <div>${hourlyRate.toFixed(4)}/hr</div>
        <div className="text-muted-foreground">Total: ${currentBilling.toFixed(2)}</div>
      </div>
    );
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Servers</CardTitle>
          <CardDescription>
            Manage your cloud servers across providers.
          </CardDescription>
        </div>
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
          <Dialog open={isProvisioningDialogOpen} onOpenChange={setIsProvisioningDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Provision Server
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
              <ServerProvisioningForm
                cloudProviders={cloudProviders}
                onSubmit={handleProvisionServer}
                onCancel={() => setIsProvisioningDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-8">
            <Server className="h-12 w-12 mx-auto text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">No servers found</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Get started by provisioning a new server.
            </p>
            <Button
              className="mt-4"
              onClick={() => setIsProvisioningDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Provision Server
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Instance Type</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell className="font-medium">{server.name}</TableCell>
                    <TableCell>
                      {server.cloudProvider?.name || server.provider}
                    </TableCell>
                    <TableCell>{server.instanceType}</TableCell>
                    <TableCell>
                      {server.publicIp || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusBadgeColor(server.status)}>
                        {server.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatCost(server.hourlyRate, server.currentBilling)}
                    </TableCell>
                    <TableCell>
                      {formatDate(server.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end space-x-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleRefreshStatus(server.id)}
                          disabled={isRefreshing}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        
                        {server.status === 'running' && !server.kubernetesClusterId && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleInstallKubernetes(server.id)}
                            title="Install Kubernetes"
                          >
                            <Terminal className="h-4 w-4" />
                          </Button>
                        )}
                        
                        {server.status === 'stopped' && (
                          <Button
                            variant="outline"
                            size="icon"
                            title="Start Server"
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                        )}
                        
                        {server.status === 'running' && (
                          <Button
                            variant="outline"
                            size="icon"
                            title="Stop Server"
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                        )}
                        
                        {['running', 'stopped', 'error'].includes(server.status) && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                className="text-red-500"
                                onClick={() => setServerToTerminate(server)}
                              >
                                <Trash className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Terminate Server</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to terminate {server.name}? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-red-500 hover:bg-red-600"
                                  onClick={() => handleTerminateServer(server.id)}
                                  disabled={isTerminatingServer}
                                >
                                  {isTerminatingServer && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                  Terminate
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 