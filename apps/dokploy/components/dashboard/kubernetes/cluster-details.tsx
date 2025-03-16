import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Server, Plus, Download, RefreshCw, Trash2, Key } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

interface KubernetesNode {
  id: string;
  name: string;
  role: 'master' | 'worker';
  status: string;
  server: {
    id: string;
    name: string;
    publicIp: string;
    privateIp: string;
    status: string;
    instanceType: string;
  };
}

interface KubernetesCluster {
  id: string;
  name: string;
  provider: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  cloudProvider: {
    id: string;
    name: string;
    type: string;
  };
  nodes: KubernetesNode[];
  version: string;
}

interface ServerOption {
  id: string;
  name: string;
  status: string;
}

interface ClusterDetailsProps {
  clusterId: string;
  onDelete: () => void;
}

export function ClusterDetails({ clusterId, onDelete }: ClusterDetailsProps) {
  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [loading, setLoading] = useState(true);
  const [availableServers, setAvailableServers] = useState<ServerOption[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [addingWorker, setAddingWorker] = useState(false);
  const [showAddWorkerDialog, setShowAddWorkerDialog] = useState(false);
  const [downloadingKubeconfig, setDownloadingKubeconfig] = useState(false);
  const router = useRouter();

  const loadClusterDetails = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/kubernetes/clusters/${clusterId}`);
      if (!response.ok) {
        throw new Error('Failed to load cluster details');
      }
      const data = await response.json();
      setCluster(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load cluster details',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableServers = async () => {
    try {
      // Get the cloud provider ID from the cluster
      if (!cluster) return;
      
      const response = await fetch(`/api/cloud-providers/${cluster.cloudProvider.id}/servers`);
      if (!response.ok) {
        throw new Error('Failed to load available servers');
      }
      
      const servers = await response.json();
      
      // Filter out servers that are already part of the cluster
      const clusterServerIds = cluster.nodes.map(node => node.server.id);
      const availableServers = servers.filter(
        (server: ServerOption) => 
          !clusterServerIds.includes(server.id) && 
          server.status === 'running'
      );
      
      setAvailableServers(availableServers);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load available servers',
        variant: 'destructive',
      });
    }
  };

  const handleAddWorkerNode = async () => {
    if (!selectedServerId) {
      toast({
        title: 'Error',
        description: 'Please select a server',
        variant: 'destructive',
      });
      return;
    }

    try {
      setAddingWorker(true);
      const response = await fetch(`/api/servers/${selectedServerId}/join-kubernetes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clusterId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add worker node');
      }

      toast({
        title: 'Success',
        description: 'Worker node added successfully',
      });

      setShowAddWorkerDialog(false);
      loadClusterDetails();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add worker node',
        variant: 'destructive',
      });
    } finally {
      setAddingWorker(false);
    }
  };

  const handleDownloadKubeconfig = async () => {
    try {
      setDownloadingKubeconfig(true);
      const response = await fetch(`/api/kubernetes/clusters/${clusterId}/kubeconfig`);
      if (!response.ok) {
        throw new Error('Failed to download kubeconfig');
      }
      
      const { kubeconfig } = await response.json();
      
      // Create a blob and download it
      const blob = new Blob([kubeconfig], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cluster?.name || 'cluster'}-kubeconfig.yaml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: 'Success',
        description: 'Kubeconfig downloaded successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to download kubeconfig',
        variant: 'destructive',
      });
    } finally {
      setDownloadingKubeconfig(false);
    }
  };

  useEffect(() => {
    loadClusterDetails();
  }, [clusterId]);

  useEffect(() => {
    if (cluster) {
      loadAvailableServers();
    }
  }, [cluster]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!cluster) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-muted-foreground">Cluster not found</p>
        <Button 
          variant="outline" 
          className="mt-4"
          onClick={() => router.push('/dashboard/kubernetes')}
        >
          Back to Clusters
        </Button>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
        return 'bg-green-500';
      case 'pending':
        return 'bg-yellow-500';
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{cluster.name}</h2>
          <p className="text-muted-foreground">
            {cluster.cloudProvider.name} ({cluster.provider})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadClusterDetails}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadKubeconfig}
            disabled={downloadingKubeconfig}
          >
            {downloadingKubeconfig ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download Kubeconfig
          </Button>
          <Link href={`/dashboard/kubernetes/${cluster.id}/secrets`} passHref>
            <Button variant="outline">
              <Key className="mr-2 h-4 w-4" />
              Manage Secrets
            </Button>
          </Link>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Cluster
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the Kubernetes cluster
                  and all associated resources.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cluster Information</CardTitle>
          <CardDescription>Details about your Kubernetes cluster</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium">Status</p>
              <Badge 
                variant={cluster.status === 'running' ? 'success' : 'secondary'}
                className="mt-1"
              >
                {cluster.status}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-medium">Provider</p>
              <p className="text-sm mt-1">{cluster.provider}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Created</p>
              <p className="text-sm mt-1">{formatDistanceToNow(new Date(cluster.createdAt))} ago</p>
            </div>
            <div>
              <p className="text-sm font-medium">Cloud Provider</p>
              <p className="text-sm mt-1">{cluster.cloudProvider.name}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Nodes</CardTitle>
            <CardDescription>Servers in your Kubernetes cluster</CardDescription>
          </div>
          <Dialog open={showAddWorkerDialog} onOpenChange={setShowAddWorkerDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Worker Node
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Worker Node</DialogTitle>
                <DialogDescription>
                  Select a server to add as a worker node to your Kubernetes cluster.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <label htmlFor="server" className="block text-sm font-medium mb-2">
                  Server
                </label>
                <select
                  id="server"
                  className="w-full p-2 border rounded-md"
                  value={selectedServerId}
                  onChange={(e) => setSelectedServerId(e.target.value)}
                >
                  <option value="">Select a server</option>
                  {availableServers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {server.name}
                    </option>
                  ))}
                </select>
                {availableServers.length === 0 && (
                  <p className="text-sm text-muted-foreground mt-2">
                    No available servers. Please provision a new server first.
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowAddWorkerDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddWorkerNode}
                  disabled={!selectedServerId || addingWorker}
                >
                  {addingWorker ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add Worker Node'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Instance Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cluster.nodes.map((node) => (
                <TableRow key={node.id}>
                  <TableCell className="font-medium">{node.name}</TableCell>
                  <TableCell>
                    <Badge variant={node.role === 'master' ? 'default' : 'outline'}>
                      {node.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={node.status === 'running' ? 'success' : 'secondary'}
                    >
                      {node.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{node.server.publicIp}</TableCell>
                  <TableCell>{node.server.instanceType}</TableCell>
                </TableRow>
              ))}
              {cluster.nodes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-4">
                    No nodes found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
} 