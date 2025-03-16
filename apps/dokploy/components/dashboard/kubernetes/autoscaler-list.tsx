import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EyeIcon } from "@/components/icons/eye-icon";
import { PencilIcon } from "@/components/icons/pencil-icon";
import { TrashIcon } from "@/components/icons/trash-icon";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { KubernetesAutoscalerForm } from "./autoscaler-form";

interface KubernetesAutoscaler {
  id: string;
  name: string;
  namespace: string;
  clusterId: string;
  deploymentId: string;
  deploymentName: string;
  minReplicas: number;
  maxReplicas: number;
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: number;
  currentReplicas?: number;
  desiredReplicas?: number;
  status: string;
  createdAt: string;
}

interface KubernetesAutoscalerListProps {
  autoscalers: KubernetesAutoscaler[];
  deploymentId: string;
  clusterId: string;
  namespace: string;
  deploymentName: string;
  onAddAutoscaler: (autoscalerData: any) => void;
  onUpdateAutoscaler: (autoscalerId: string, autoscalerData: any) => void;
  onDeleteAutoscaler: (autoscalerId: string) => void;
}

export function KubernetesAutoscalerList({ 
  autoscalers, 
  deploymentId,
  clusterId,
  namespace,
  deploymentName,
  onAddAutoscaler,
  onUpdateAutoscaler,
  onDeleteAutoscaler
}: KubernetesAutoscalerListProps) {
  const [openDialog, setOpenDialog] = useState(false);
  const [editingAutoscaler, setEditingAutoscaler] = useState<KubernetesAutoscaler | null>(null);
  const [deletingAutoscalerId, setDeletingAutoscalerId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleAddAutoscaler = async (autoscalerData: any) => {
    try {
      await onAddAutoscaler(autoscalerData);
      setOpenDialog(false);
      toast({
        title: "Success",
        description: "Kubernetes autoscaler added successfully",
      });
    } catch (error) {
      console.error("Error adding Kubernetes autoscaler:", error);
      toast({
        title: "Error",
        description: "Failed to add Kubernetes autoscaler",
        variant: "destructive",
      });
    }
  };

  const handleUpdateAutoscaler = async (autoscalerData: any) => {
    try {
      if (!editingAutoscaler) return;
      
      await onUpdateAutoscaler(editingAutoscaler.id, autoscalerData);
      setEditingAutoscaler(null);
      toast({
        title: "Success",
        description: "Kubernetes autoscaler updated successfully",
      });
    } catch (error) {
      console.error("Error updating Kubernetes autoscaler:", error);
      toast({
        title: "Error",
        description: "Failed to update Kubernetes autoscaler",
        variant: "destructive",
      });
    }
  };

  const handleDeleteAutoscaler = async (autoscalerId: string) => {
    try {
      await onDeleteAutoscaler(autoscalerId);
      setDeletingAutoscalerId(null);
      toast({
        title: "Success",
        description: "Kubernetes autoscaler deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting Kubernetes autoscaler:", error);
      toast({
        title: "Error",
        description: "Failed to delete Kubernetes autoscaler",
        variant: "destructive",
      });
    }
  };

  if (autoscalers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Autoscalers</CardTitle>
              <CardDescription>
                No autoscalers found for this deployment
              </CardDescription>
            </div>
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
              <DialogTrigger asChild>
                <Button>Add Autoscaler</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]">
                <KubernetesAutoscalerForm
                  deploymentId={deploymentId}
                  clusterId={clusterId}
                  namespace={namespace}
                  deploymentName={deploymentName}
                  onSubmit={handleAddAutoscaler}
                  onCancel={() => setOpenDialog(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Autoscalers</CardTitle>
            <CardDescription>
              Manage horizontal pod autoscalers for this deployment
            </CardDescription>
          </div>
          <Dialog open={openDialog} onOpenChange={setOpenDialog}>
            <DialogTrigger asChild>
              <Button>Add Autoscaler</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <KubernetesAutoscalerForm
                deploymentId={deploymentId}
                clusterId={clusterId}
                namespace={namespace}
                deploymentName={deploymentName}
                onSubmit={handleAddAutoscaler}
                onCancel={() => setOpenDialog(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Replicas</TableHead>
              <TableHead>CPU Target</TableHead>
              <TableHead>Memory Target</TableHead>
              <TableHead>Current</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {autoscalers.map((autoscaler) => (
              <TableRow key={autoscaler.id}>
                <TableCell className="font-medium">{autoscaler.name}</TableCell>
                <TableCell>{autoscaler.minReplicas} - {autoscaler.maxReplicas}</TableCell>
                <TableCell>
                  {autoscaler.targetCPUUtilizationPercentage ? 
                    `${autoscaler.targetCPUUtilizationPercentage}%` : 
                    "Not set"}
                </TableCell>
                <TableCell>
                  {autoscaler.targetMemoryUtilizationPercentage ? 
                    `${autoscaler.targetMemoryUtilizationPercentage}%` : 
                    "Not set"}
                </TableCell>
                <TableCell>
                  {autoscaler.currentReplicas !== undefined ? 
                    `${autoscaler.currentReplicas} → ${autoscaler.desiredReplicas || autoscaler.currentReplicas}` : 
                    "Unknown"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      autoscaler.status === "active"
                        ? "success"
                        : autoscaler.status === "pending"
                        ? "outline"
                        : "destructive"
                    }
                  >
                    {autoscaler.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Dialog open={editingAutoscaler?.id === autoscaler.id} onOpenChange={(open) => {
                      if (!open) setEditingAutoscaler(null);
                    }}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingAutoscaler(autoscaler)}
                        >
                          <PencilIcon className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[600px]">
                        {editingAutoscaler && (
                          <KubernetesAutoscalerForm
                            deploymentId={deploymentId}
                            clusterId={clusterId}
                            namespace={namespace}
                            deploymentName={deploymentName}
                            initialData={{
                              id: editingAutoscaler.id,
                              name: editingAutoscaler.name,
                              minReplicas: editingAutoscaler.minReplicas,
                              maxReplicas: editingAutoscaler.maxReplicas,
                              targetCPUUtilizationPercentage: editingAutoscaler.targetCPUUtilizationPercentage,
                              targetMemoryUtilizationPercentage: editingAutoscaler.targetMemoryUtilizationPercentage,
                            }}
                            onSubmit={handleUpdateAutoscaler}
                            onCancel={() => setEditingAutoscaler(null)}
                          />
                        )}
                      </DialogContent>
                    </Dialog>
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
                          <AlertDialogTitle>Delete Kubernetes Autoscaler</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete this autoscaler? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteAutoscaler(autoscaler.id)}
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