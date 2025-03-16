import { useState, useEffect } from 'react';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Plus, FileText } from 'lucide-react';
import { KubernetesClusterForm } from '@/components/dashboard/kubernetes/cluster-form';
import { ClusterDetails } from '@/components/dashboard/kubernetes/cluster-details';
import { ComposeDeployment } from '@/components/dashboard/kubernetes/compose-deployment';

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
  nodeCount: number;
  masterNodeCount: number;
  workerNodeCount: number;
}

interface ServerOption {
  id: string;
  name: string;
  status: string;
}

export default function KubernetesPage() {
  const [clusters, setClusters] = useState<KubernetesCluster[]>([]);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddClusterDialog, setShowAddClusterDialog] = useState(false);
  const [showComposeDialog, setShowComposeDialog] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('clusters');

  const loadClusters = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/kubernetes/clusters');
      if (!response.ok) {
        throw new Error('Failed to load clusters');
      }
      const data = await response.json();
      setClusters(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load clusters',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadServers = async () => {
    try {
      const response = await fetch('/api/servers');
      if (!response.ok) {
        throw new Error('Failed to load servers');
      }
      const data = await response.json();
      setServers(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load servers',
        variant: 'destructive',
      });
    }
  };

  const handleAddCluster = async () => {
    setShowAddClusterDialog(false);
    await loadClusters();
  };

  const handleClusterClick = (clusterId: string) => {
    setSelectedClusterId(clusterId);
    setActiveTab('details');
  };

  const handleBackToList = () => {
    setSelectedClusterId(null);
    setActiveTab('clusters');
  };

  useEffect(() => {
    loadClusters();
    loadServers();
  }, []);

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Kubernetes"
        description="Manage your Kubernetes clusters and deployments"
      >
        <div className="flex gap-2">
          <Dialog open={showComposeDialog} onOpenChange={setShowComposeDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <FileText className="mr-2 h-4 w-4" />
                Deploy Compose
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[800px]">
              <DialogHeader>
                <DialogTitle>Deploy Docker Compose</DialogTitle>
                <DialogDescription>
                  Convert your Docker Compose application to Kubernetes resources and deploy it to your cluster
                </DialogDescription>
              </DialogHeader>
              <ComposeDeployment 
                clusters={clusters.filter(cluster => cluster.status === 'running')} 
                onDeploymentComplete={() => {
                  setShowComposeDialog(false);
                }}
              />
            </DialogContent>
          </Dialog>
          
          <Dialog open={showAddClusterDialog} onOpenChange={setShowAddClusterDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Cluster
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Kubernetes Cluster</DialogTitle>
                <DialogDescription>
                  Create a new Kubernetes cluster on one of your servers.
                </DialogDescription>
              </DialogHeader>
              <KubernetesClusterForm onSubmit={handleAddCluster} servers={servers} />
            </DialogContent>
          </Dialog>
        </div>
      </DashboardHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="clusters">Clusters</TabsTrigger>
          {selectedClusterId && <TabsTrigger value="details">Cluster Details</TabsTrigger>}
          <TabsTrigger value="compose">Docker Compose</TabsTrigger>
        </TabsList>
        
        <TabsContent value="clusters" className="mt-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : clusters.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {clusters.map((cluster) => (
                <div
                  key={cluster.id}
                  className="border rounded-lg p-4 cursor-pointer hover:border-primary transition-colors"
                  onClick={() => handleClusterClick(cluster.id)}
                >
                  <h3 className="font-medium text-lg">{cluster.name}</h3>
                  <div className="flex items-center mt-2 text-sm text-muted-foreground">
                    <span className="mr-4">{cluster.cloudProvider.name}</span>
                    <span>{cluster.provider}</span>
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm">
                      <span className="font-medium">{cluster.nodeCount}</span> nodes
                      {cluster.workerNodeCount > 0 && (
                        <span className="ml-2 text-muted-foreground">
                          ({cluster.masterNodeCount} master, {cluster.workerNodeCount} workers)
                        </span>
                      )}
                    </div>
                    <div className={`px-2 py-1 rounded-full text-xs ${
                      cluster.status === 'running' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {cluster.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 border rounded-lg">
              <p className="text-muted-foreground mb-4">No Kubernetes clusters found</p>
              <Button onClick={() => setShowAddClusterDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Your First Cluster
              </Button>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="details" className="mt-6">
          {selectedClusterId ? (
            <ClusterDetails clusterId={selectedClusterId} />
          ) : (
            <div className="flex items-center justify-center h-64">
              <Button variant="outline" onClick={() => setActiveTab('clusters')}>
                Back to Clusters
              </Button>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="compose" className="mt-6">
          <ComposeDeployment 
            clusters={clusters.filter(cluster => cluster.status === 'running')} 
            onDeploymentComplete={() => {
              // Optionally refresh data or show a notification
            }}
          />
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
} 