import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PencilIcon } from "@/components/icons/pencil-icon";
import { TrashIcon } from "@/components/icons/trash-icon";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { KubernetesVerticalAutoscalerForm } from "./vertical-autoscaler-form";
import { InfoIcon } from "@/components/icons/info-icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface KubernetesVerticalAutoscaler {
  id: string;
  name: string;
  namespace: string;
  clusterId: string;
  deploymentId: string;
  deploymentName: string;
  updateMode: string;
  minAllowedCpu?: string;
  minAllowedMemory?: string;
  maxAllowedCpu?: string;
  maxAllowedMemory?: string;
  controlledResources: string[];
  recommendation?: {
    cpu?: string;
    memory?: string;
  };
  status: string;
  createdAt: string;
}

interface KubernetesVerticalAutoscalerListProps {
  verticalAutoscalers: KubernetesVerticalAutoscaler[];
  deploymentId: string;
  clusterId: string;
  namespace: string;
  deploymentName: string;
  onAddVerticalAutoscaler: (autoscalerData: any) => void;
  onUpdateVerticalAutoscaler: (autoscalerId: string, autoscalerData: any) => void;
  onDeleteVerticalAutoscaler: (autoscalerId: string) => void;
}

export function KubernetesVerticalAutoscalerList({ 
  verticalAutoscalers, 
  deploymentId,
  clusterId,
  namespace,
  deploymentName,
  onAddVerticalAutoscaler,
  onUpdateVerticalAutoscaler,
  onDeleteVerticalAutoscaler
}: KubernetesVerticalAutoscalerListProps) {
  const [openDialog, setOpenDialog] = useState(false);
  const [editingAutoscaler, setEditingAutoscaler] = useState<KubernetesVerticalAutoscaler | null>(null);
  const { toast } = useToast();

  const handleAddVerticalAutoscaler = async (autoscalerData: any) => {
    try {
      await onAddVerticalAutoscaler(autoscalerData);
      setOpenDialog(false);
      toast({
        title: "Success",
        description: "Kubernetes vertical autoscaler added successfully",
      });
    } catch (error) {
      console.error("Error adding Kubernetes vertical autoscaler:", error);
      toast({
        title: "Error",
        description: "Failed to add Kubernetes vertical autoscaler",
        variant: "destructive",
      });
    }
  };

  const handleUpdateVerticalAutoscaler = async (autoscalerData: any) => {
    try {
      if (!editingAutoscaler) return;
      
      await onUpdateVerticalAutoscaler(editingAutoscaler.id, autoscalerData);
      setEditingAutoscaler(null);
      toast({
        title: "Success",
        description: "Kubernetes vertical autoscaler updated successfully",
      });
    } catch (error) {
      console.error("Error updating Kubernetes vertical autoscaler:", error);
      toast({
        title: "Error",
        description: "Failed to update Kubernetes vertical autoscaler",
        variant: "destructive",
      });
    }
  };

  const handleDeleteVerticalAutoscaler = async (autoscalerId: string) => {
    try {
      await onDeleteVerticalAutoscaler(autoscalerId);
      toast({
        title: "Success",
        description: "Kubernetes vertical autoscaler deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting Kubernetes vertical autoscaler:", error);
      toast({
        title: "Error",
        description: "Failed to delete Kubernetes vertical autoscaler",
        variant: "destructive",
      });
    }
  };

  const getUpdateModeLabel = (mode: string) => {
    switch (mode) {
      case "Off":
        return "Recommendations Only";
      case "Initial":
        return "New Pods Only";
      case "Auto":
        return "Auto (Restart Required)";
      case "Recreate":
        return "Force Restart";
      default:
        return mode;
    }
  };

  if (verticalAutoscalers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Vertical Pod Autoscalers</CardTitle>
              <CardDescription>
                No vertical autoscalers found for this deployment
              </CardDescription>
            </div>
            <Dialog open={openDialog} onOpenChange={setOpenDialog}>
              <DialogTrigger asChild>
                <Button>Add Vertical Autoscaler</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]">
                <KubernetesVerticalAutoscalerForm
                  deploymentId={deploymentId}
                  clusterId={clusterId}
                  namespace={namespace}
                  deploymentName={deploymentName}
                  onSubmit={handleAddVerticalAutoscaler}
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
            <CardTitle>Vertical Pod Autoscalers</CardTitle>
            <CardDescription>
              Automatically adjust resource requests and limits for your pods
            </CardDescription>
          </div>
          <Dialog open={openDialog} onOpenChange={setOpenDialog}>
            <DialogTrigger asChild>
              <Button>Add Vertical Autoscaler</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <KubernetesVerticalAutoscalerForm
                deploymentId={deploymentId}
                clusterId={clusterId}
                namespace={namespace}
                deploymentName={deploymentName}
                onSubmit={handleAddVerticalAutoscaler}
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
              <TableHead>Update Mode</TableHead>
              <TableHead>CPU Resources</TableHead>
              <TableHead>Memory Resources</TableHead>
              <TableHead>Recommendations</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {verticalAutoscalers.map((autoscaler) => (
              <TableRow key={autoscaler.id}>
                <TableCell className="font-medium">{autoscaler.name}</TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                          {getUpdateModeLabel(autoscaler.updateMode)}
                          <InfoIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Off: Only provide recommendations</p>
                        <p>Initial: Set resources for new pods only</p>
                        <p>Auto: Automatically update pods (requires restart)</p>
                        <p>Recreate: Force pod recreation to apply changes</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell>
                  {autoscaler.controlledResources.includes("cpu") ? (
                    <div>
                      {autoscaler.minAllowedCpu && autoscaler.maxAllowedCpu ? (
                        `${autoscaler.minAllowedCpu} - ${autoscaler.maxAllowedCpu}`
                      ) : autoscaler.minAllowedCpu ? (
                        `Min: ${autoscaler.minAllowedCpu}`
                      ) : autoscaler.maxAllowedCpu ? (
                        `Max: ${autoscaler.maxAllowedCpu}`
                      ) : (
                        "Auto"
                      )}
                    </div>
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {autoscaler.controlledResources.includes("memory") ? (
                    <div>
                      {autoscaler.minAllowedMemory && autoscaler.maxAllowedMemory ? (
                        `${autoscaler.minAllowedMemory} - ${autoscaler.maxAllowedMemory}`
                      ) : autoscaler.minAllowedMemory ? (
                        `Min: ${autoscaler.minAllowedMemory}`
                      ) : autoscaler.maxAllowedMemory ? (
                        `Max: ${autoscaler.maxAllowedMemory}`
                      ) : (
                        "Auto"
                      )}
                    </div>
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {autoscaler.recommendation ? (
                    <div className="space-y-1">
                      {autoscaler.recommendation.cpu && (
                        <div className="text-xs">CPU: {autoscaler.recommendation.cpu}</div>
                      )}
                      {autoscaler.recommendation.memory && (
                        <div className="text-xs">Memory: {autoscaler.recommendation.memory}</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">No recommendations yet</span>
                  )}
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
                          <KubernetesVerticalAutoscalerForm
                            deploymentId={deploymentId}
                            clusterId={clusterId}
                            namespace={namespace}
                            deploymentName={deploymentName}
                            initialData={{
                              id: editingAutoscaler.id,
                              name: editingAutoscaler.name,
                              updateMode: editingAutoscaler.updateMode,
                              minAllowedCpu: editingAutoscaler.minAllowedCpu,
                              minAllowedMemory: editingAutoscaler.minAllowedMemory,
                              maxAllowedCpu: editingAutoscaler.maxAllowedCpu,
                              maxAllowedMemory: editingAutoscaler.maxAllowedMemory,
                              controlledResources: editingAutoscaler.controlledResources,
                            }}
                            onSubmit={handleUpdateVerticalAutoscaler}
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
                          <AlertDialogTitle>Delete Vertical Pod Autoscaler</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete this vertical autoscaler? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteVerticalAutoscaler(autoscaler.id)}
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