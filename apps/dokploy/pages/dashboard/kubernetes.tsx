import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { PageTitle } from "@/components/shared/page-title";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/icons/plus-icon";
import { useRouter } from "next/router";
import { Skeleton } from "@/components/ui/skeleton";
import { KubernetesClusterList } from "@/components/dashboard/kubernetes/cluster-list";
import { KubernetesClusterForm } from "@/components/dashboard/kubernetes/cluster-form";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";

export default function KubernetesPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [clusters, setClusters] = useState([]);
  const [openDialog, setOpenDialog] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    // Fetch Kubernetes clusters
    const fetchClusters = async () => {
      try {
        const response = await fetch("/api/kubernetes/clusters");
        if (response.ok) {
          const data = await response.json();
          setClusters(data.clusters || []);
        } else {
          toast({
            title: "Error",
            description: "Failed to fetch Kubernetes clusters",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Error fetching Kubernetes clusters:", error);
        toast({
          title: "Error",
          description: "Failed to fetch Kubernetes clusters",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchClusters();
  }, [toast]);

  const handleAddCluster = async (clusterData) => {
    try {
      const response = await fetch("/api/kubernetes/clusters", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(clusterData),
      });

      if (response.ok) {
        const data = await response.json();
        setClusters([...clusters, data.cluster]);
        setOpenDialog(false);
        toast({
          title: "Success",
          description: "Kubernetes cluster added successfully",
        });
      } else {
        const errorData = await response.json();
        toast({
          title: "Error",
          description: errorData.message || "Failed to add Kubernetes cluster",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error adding Kubernetes cluster:", error);
      toast({
        title: "Error",
        description: "Failed to add Kubernetes cluster",
        variant: "destructive",
      });
    }
  };

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between">
        <PageTitle
          title="Kubernetes"
          description="Manage your Kubernetes clusters and deployments"
        />
        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogTrigger asChild>
            <Button>
              <PlusIcon className="mr-2 h-4 w-4" />
              Add Cluster
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <KubernetesClusterForm onSubmit={handleAddCluster} />
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="clusters" className="mt-6">
        <TabsList>
          <TabsTrigger value="clusters">Clusters</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
        </TabsList>
        <TabsContent value="clusters" className="mt-6">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <KubernetesClusterList 
              clusters={clusters} 
              onClusterClick={(clusterId) => 
                router.push(`/dashboard/kubernetes/cluster/${clusterId}`)
              } 
            />
          )}
        </TabsContent>
        <TabsContent value="deployments" className="mt-6">
          <div className="text-center py-8">
            <h3 className="text-lg font-medium">Select a cluster to view deployments</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Deployments are managed at the cluster level
            </p>
          </div>
        </TabsContent>
        <TabsContent value="services" className="mt-6">
          <div className="text-center py-8">
            <h3 className="text-lg font-medium">Select a cluster to view services</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Services are managed at the cluster level
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
} 