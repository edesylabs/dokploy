import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { InfoIcon } from "@/components/icons/info-icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface KubernetesVerticalAutoscalerFormProps {
  deploymentId: string;
  clusterId: string;
  namespace: string;
  deploymentName: string;
  initialData?: {
    id?: string;
    name?: string;
    updateMode?: string;
    minAllowedCpu?: string;
    minAllowedMemory?: string;
    maxAllowedCpu?: string;
    maxAllowedMemory?: string;
    controlledResources?: string[];
  };
  onSubmit: (autoscalerData: any) => void;
  onCancel?: () => void;
}

export function KubernetesVerticalAutoscalerForm({ 
  deploymentId, 
  clusterId, 
  namespace, 
  deploymentName,
  initialData,
  onSubmit,
  onCancel
}: KubernetesVerticalAutoscalerFormProps) {
  const isEditing = !!initialData?.id;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: initialData?.name || `${deploymentName}-vpa`,
    updateMode: initialData?.updateMode || "Auto",
    minAllowedCpu: initialData?.minAllowedCpu || "",
    minAllowedMemory: initialData?.minAllowedMemory || "",
    maxAllowedCpu: initialData?.maxAllowedCpu || "",
    maxAllowedMemory: initialData?.maxAllowedMemory || "",
    controlCpu: initialData?.controlledResources?.includes("cpu") ?? true,
    controlMemory: initialData?.controlledResources?.includes("memory") ?? true,
  });
  const { toast } = useToast();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData((prev) => ({ ...prev, [name]: checked }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Validate form data
      if (!formData.name) {
        toast({
          title: "Validation Error",
          description: "Vertical autoscaler name is required",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Validate resource limits format
      const cpuRegex = /^(\d+m|(\d+(\.\d+)?))$/;
      const memoryRegex = /^(\d+Ki|Mi|Gi|Ti|Pi|Ei|[kmgtpe]i|[KMGTPE]i|\d+(\.\d+)?)$/;

      if (formData.minAllowedCpu && !cpuRegex.test(formData.minAllowedCpu)) {
        toast({
          title: "Validation Error",
          description: "Min CPU must be in the format of '100m' or '0.1'",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      if (formData.maxAllowedCpu && !cpuRegex.test(formData.maxAllowedCpu)) {
        toast({
          title: "Validation Error",
          description: "Max CPU must be in the format of '100m' or '0.1'",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      if (formData.minAllowedMemory && !memoryRegex.test(formData.minAllowedMemory)) {
        toast({
          title: "Validation Error",
          description: "Min Memory must be in the format of '100Mi' or '1Gi'",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      if (formData.maxAllowedMemory && !memoryRegex.test(formData.maxAllowedMemory)) {
        toast({
          title: "Validation Error",
          description: "Max Memory must be in the format of '100Mi' or '1Gi'",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Build controlled resources array
      const controlledResources = [];
      if (formData.controlCpu) controlledResources.push("cpu");
      if (formData.controlMemory) controlledResources.push("memory");

      if (controlledResources.length === 0) {
        toast({
          title: "Validation Error",
          description: "At least one resource (CPU or Memory) must be controlled",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      // Prepare data for submission
      const autoscalerData = {
        id: initialData?.id,
        name: formData.name,
        namespace,
        clusterId,
        deploymentId,
        updateMode: formData.updateMode,
        minAllowedCpu: formData.minAllowedCpu || null,
        minAllowedMemory: formData.minAllowedMemory || null,
        maxAllowedCpu: formData.maxAllowedCpu || null,
        maxAllowedMemory: formData.maxAllowedMemory || null,
        controlledResources,
      };

      // Submit the form
      await onSubmit(autoscalerData);
    } catch (error) {
      console.error("Error submitting form:", error);
      toast({
        title: "Error",
        description: `Failed to ${isEditing ? 'update' : 'create'} Kubernetes vertical autoscaler`,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? 'Edit' : 'Add'} Vertical Pod Autoscaler</CardTitle>
          <CardDescription>
            Configure vertical pod autoscaling for your deployment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Autoscaler Name</Label>
            <Input
              id="name"
              name="name"
              placeholder="my-deployment-vpa"
              value={formData.name}
              onChange={handleInputChange}
              disabled={isEditing}
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="updateMode">Update Mode</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InfoIcon className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Off: Only provide recommendations</p>
                    <p>Initial: Set resources for new pods only</p>
                    <p>Auto: Automatically update pods (requires restart)</p>
                    <p>Recreate: Force pod recreation to apply changes</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Select
              value={formData.updateMode}
              onValueChange={(value) => handleSelectChange("updateMode", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select update mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Off">Off (Recommendations Only)</SelectItem>
                <SelectItem value="Initial">Initial (New Pods Only)</SelectItem>
                <SelectItem value="Auto">Auto (Restart Required)</SelectItem>
                <SelectItem value="Recreate">Recreate (Force Restart)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4 border rounded-md p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="controlCpu">Control CPU Resources</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InfoIcon className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Enable VPA to manage CPU resource requests and limits</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Switch
                id="controlCpu"
                checked={formData.controlCpu}
                onCheckedChange={(checked) => handleSwitchChange("controlCpu", checked)}
              />
            </div>
            
            {formData.controlCpu && (
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="space-y-2">
                  <Label htmlFor="minAllowedCpu">Min CPU</Label>
                  <Input
                    id="minAllowedCpu"
                    name="minAllowedCpu"
                    placeholder="100m"
                    value={formData.minAllowedCpu}
                    onChange={handleInputChange}
                  />
                  <p className="text-xs text-muted-foreground">
                    Example: 100m or 0.1
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxAllowedCpu">Max CPU</Label>
                  <Input
                    id="maxAllowedCpu"
                    name="maxAllowedCpu"
                    placeholder="1"
                    value={formData.maxAllowedCpu}
                    onChange={handleInputChange}
                  />
                  <p className="text-xs text-muted-foreground">
                    Example: 1000m or 1
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 border rounded-md p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="controlMemory">Control Memory Resources</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InfoIcon className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Enable VPA to manage memory resource requests and limits</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Switch
                id="controlMemory"
                checked={formData.controlMemory}
                onCheckedChange={(checked) => handleSwitchChange("controlMemory", checked)}
              />
            </div>
            
            {formData.controlMemory && (
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="space-y-2">
                  <Label htmlFor="minAllowedMemory">Min Memory</Label>
                  <Input
                    id="minAllowedMemory"
                    name="minAllowedMemory"
                    placeholder="128Mi"
                    value={formData.minAllowedMemory}
                    onChange={handleInputChange}
                  />
                  <p className="text-xs text-muted-foreground">
                    Example: 128Mi or 1Gi
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxAllowedMemory">Max Memory</Label>
                  <Input
                    id="maxAllowedMemory"
                    name="maxAllowedMemory"
                    placeholder="1Gi"
                    value={formData.maxAllowedMemory}
                    onChange={handleInputChange}
                  />
                  <p className="text-xs text-muted-foreground">
                    Example: 512Mi or 2Gi
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (isEditing ? "Updating..." : "Creating...") : (isEditing ? "Update" : "Create")}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
} 