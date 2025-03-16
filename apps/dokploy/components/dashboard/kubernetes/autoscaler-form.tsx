import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface KubernetesAutoscalerFormProps {
  deploymentId: string;
  clusterId: string;
  namespace: string;
  deploymentName: string;
  initialData?: {
    id?: string;
    name?: string;
    minReplicas?: number;
    maxReplicas?: number;
    targetCPUUtilizationPercentage?: number;
    targetMemoryUtilizationPercentage?: number;
  };
  onSubmit: (autoscalerData: any) => void;
  onCancel?: () => void;
}

export function KubernetesAutoscalerForm({ 
  deploymentId, 
  clusterId, 
  namespace, 
  deploymentName,
  initialData,
  onSubmit,
  onCancel
}: KubernetesAutoscalerFormProps) {
  const isEditing = !!initialData?.id;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: initialData?.name || `${deploymentName}-autoscaler`,
    minReplicas: initialData?.minReplicas || 1,
    maxReplicas: initialData?.maxReplicas || 10,
    targetCPUUtilizationPercentage: initialData?.targetCPUUtilizationPercentage || 50,
    enableCPUScaling: !!initialData?.targetCPUUtilizationPercentage,
    targetMemoryUtilizationPercentage: initialData?.targetMemoryUtilizationPercentage || 50,
    enableMemoryScaling: !!initialData?.targetMemoryUtilizationPercentage,
  });
  const { toast } = useToast();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleNumberInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: parseInt(value, 10) }));
  };

  const handleSliderChange = (name: string, value: number[]) => {
    setFormData((prev) => ({ ...prev, [name]: value[0] }));
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
          description: "Autoscaler name is required",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      if (formData.minReplicas < 1) {
        toast({
          title: "Validation Error",
          description: "Minimum replicas must be at least 1",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      if (formData.maxReplicas < formData.minReplicas) {
        toast({
          title: "Validation Error",
          description: "Maximum replicas must be greater than or equal to minimum replicas",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      if (!formData.enableCPUScaling && !formData.enableMemoryScaling) {
        toast({
          title: "Validation Error",
          description: "At least one scaling metric (CPU or Memory) must be enabled",
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
        minReplicas: formData.minReplicas,
        maxReplicas: formData.maxReplicas,
        targetCPUUtilizationPercentage: formData.enableCPUScaling ? formData.targetCPUUtilizationPercentage : undefined,
        targetMemoryUtilizationPercentage: formData.enableMemoryScaling ? formData.targetMemoryUtilizationPercentage : undefined,
      };

      // Submit the form
      await onSubmit(autoscalerData);
    } catch (error) {
      console.error("Error submitting form:", error);
      toast({
        title: "Error",
        description: `Failed to ${isEditing ? 'update' : 'create'} Kubernetes autoscaler`,
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
          <CardTitle>{isEditing ? 'Edit' : 'Add'} Kubernetes Autoscaler</CardTitle>
          <CardDescription>
            Configure horizontal pod autoscaling for your deployment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Autoscaler Name</Label>
            <Input
              id="name"
              name="name"
              placeholder="my-deployment-autoscaler"
              value={formData.name}
              onChange={handleInputChange}
              disabled={isEditing}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="minReplicas">Minimum Replicas</Label>
              <Input
                id="minReplicas"
                name="minReplicas"
                type="number"
                min={1}
                value={formData.minReplicas}
                onChange={handleNumberInputChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxReplicas">Maximum Replicas</Label>
              <Input
                id="maxReplicas"
                name="maxReplicas"
                type="number"
                min={formData.minReplicas}
                value={formData.maxReplicas}
                onChange={handleNumberInputChange}
                required
              />
            </div>
          </div>

          <div className="space-y-4 border rounded-md p-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="enableCPUScaling">CPU-based Scaling</Label>
              <Switch
                id="enableCPUScaling"
                checked={formData.enableCPUScaling}
                onCheckedChange={(checked) => handleSwitchChange("enableCPUScaling", checked)}
              />
            </div>
            
            {formData.enableCPUScaling && (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor="targetCPUUtilizationPercentage">Target CPU Utilization</Label>
                  <span className="text-sm">{formData.targetCPUUtilizationPercentage}%</span>
                </div>
                <Slider
                  id="targetCPUUtilizationPercentage"
                  min={1}
                  max={100}
                  step={1}
                  value={[formData.targetCPUUtilizationPercentage]}
                  onValueChange={(value) => handleSliderChange("targetCPUUtilizationPercentage", value)}
                />
                <p className="text-sm text-muted-foreground">
                  Pods will scale up when CPU utilization exceeds this percentage
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4 border rounded-md p-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="enableMemoryScaling">Memory-based Scaling</Label>
              <Switch
                id="enableMemoryScaling"
                checked={formData.enableMemoryScaling}
                onCheckedChange={(checked) => handleSwitchChange("enableMemoryScaling", checked)}
              />
            </div>
            
            {formData.enableMemoryScaling && (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor="targetMemoryUtilizationPercentage">Target Memory Utilization</Label>
                  <span className="text-sm">{formData.targetMemoryUtilizationPercentage}%</span>
                </div>
                <Slider
                  id="targetMemoryUtilizationPercentage"
                  min={1}
                  max={100}
                  step={1}
                  value={[formData.targetMemoryUtilizationPercentage]}
                  onValueChange={(value) => handleSliderChange("targetMemoryUtilizationPercentage", value)}
                />
                <p className="text-sm text-muted-foreground">
                  Pods will scale up when memory utilization exceeds this percentage
                </p>
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