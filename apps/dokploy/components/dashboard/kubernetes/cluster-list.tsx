import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EyeIcon } from "@/components/icons/eye-icon";
import { TrashIcon } from "@/components/icons/trash-icon";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";

interface KubernetesCluster {
  id: string;
  name: string;
  server: string;
  status: "connected" | "disconnected" | "error";
  createdAt: string;
}

interface KubernetesClusterListProps {
  clusters: KubernetesCluster[];
  onClusterClick: (clusterId: string) => void;
}

export function KubernetesClusterList({ clusters, onClusterClick }: KubernetesClusterListProps) {
  const [deletingClusterId, setDeletingClusterId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleDeleteCluster = async (clusterId: string) => {
    try {
      const response = await fetch(`/api/kubernetes/clusters/${clusterId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast({
          title: "Success",
          description: "Kubernetes cluster deleted successfully",
        });
        // Refresh the page to update the list
        window.location.reload();
      } else {
        const errorData = await response.json();
        toast({
          title: "Error",
          description: errorData.message || "Failed to delete Kubernetes cluster",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error deleting Kubernetes cluster:", error);
      toast({
        title: "Error",
        description: "Failed to delete Kubernetes cluster",
        variant: "destructive",
      });
    } finally {
      setDeletingClusterId(null);
    }
  };

  if (clusters.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Clusters Found</CardTitle>
          <CardDescription>
            Add a Kubernetes cluster to get started with Kubernetes deployments.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kubernetes Clusters</CardTitle>
        <CardDescription>
          Manage your connected Kubernetes clusters
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Server</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clusters.map((cluster) => (
              <TableRow key={cluster.id}>
                <TableCell className="font-medium">{cluster.name}</TableCell>
                <TableCell>{cluster.server}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      cluster.status === "connected"
                        ? "success"
                        : cluster.status === "disconnected"
                        ? "outline"
                        : "destructive"
                    }
                  >
                    {cluster.status}
                  </Badge>
                </TableCell>
                <TableCell>{new Date(cluster.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onClusterClick(cluster.id)}
                    >
                      <EyeIcon className="h-4 w-4 mr-1" />
                      View
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                        >
                          <TrashIcon className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Kubernetes Cluster</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete this Kubernetes cluster? This action cannot be undone.
                            <br />
                            <br />
                            <strong>Note:</strong> This will only remove the cluster from Dokploy. The actual Kubernetes cluster will not be affected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteCluster(cluster.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
} 