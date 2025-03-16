import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KubernetesAutoscalerList } from "./autoscaler-list";
import { KubernetesVerticalAutoscalerList } from "./vertical-autoscaler-list";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { InfoIcon } from "@/components/icons/info-icon";

interface KubernetesAutoscalingProps {
  deploymentId: string;
  clusterId: string;
  namespace: string;
  deploymentName: string;
}

export function KubernetesAutoscalingSection({
  deploymentId,
  clusterId,
  namespace,
  deploymentName,
}: KubernetesAutoscalingProps) {
  const [horizontalAutoscalers, setHorizontalAutoscalers] = useState([]);
  const [verticalAutoscalers, setVerticalAutoscalers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("horizontal");
  const { toast } = useToast();

  // Fetch autoscalers on component mount
  useEffect(() => {
    const fetchAutoscalers = async () => {
      setIsLoading(true);
      try {
        // Fetch horizontal autoscalers
        const hpaResponse = await fetch(
          `/api/kubernetes/autoscalers?clusterId=${clusterId}&namespace=${namespace}`
        );
        
        if (hpaResponse.ok) {
          const hpaData = await hpaResponse.json();
          setHorizontalAutoscalers(
            hpaData.autoscalers.filter((a: any) => a.deploymentId === deploymentId)
          );
        }

        // Fetch vertical autoscalers
        const vpaResponse = await fetch(
          `/api/kubernetes/vertical-autoscalers?clusterId=${clusterId}&namespace=${namespace}`
        );
        
        if (vpaResponse.ok) {
          const vpaData = await vpaResponse.json();
          setVerticalAutoscalers(
            vpaData.verticalAutoscalers.filter((a: any) => a.deploymentId === deploymentId)
          );
        }
      } catch (error) {
        console.error("Error fetching autoscalers:", error);
        toast({
          title: "Error",
          description: "Failed to fetch autoscalers",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchAutoscalers();
  }, [clusterId, namespace, deploymentId, toast]);

  // Handle adding a horizontal autoscaler
  const handleAddHorizontalAutoscaler = async (autoscalerData: any) => {
    try {
      const response = await fetch("/api/kubernetes/autoscalers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(autoscalerData),
      });

      if (!response.ok) {
        throw new Error("Failed to create horizontal autoscaler");
      }

      const data = await response.json();
      setHorizontalAutoscalers((prev) => [...prev, data.autoscaler]);
      return data;
    } catch (error) {
      console.error("Error adding horizontal autoscaler:", error);
      throw error;
    }
  };

  // Handle updating a horizontal autoscaler
  const handleUpdateHorizontalAutoscaler = async (autoscalerId: string, autoscalerData: any) => {
    try {
      const response = await fetch(`/api/kubernetes/autoscalers/${autoscalerId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(autoscalerData),
      });

      if (!response.ok) {
        throw new Error("Failed to update horizontal autoscaler");
      }

      const data = await response.json();
      setHorizontalAutoscalers((prev) =>
        prev.map((a: any) => (a.id === autoscalerId ? data.autoscaler : a))
      );
      return data;
    } catch (error) {
      console.error("Error updating horizontal autoscaler:", error);
      throw error;
    }
  };

  // Handle deleting a horizontal autoscaler
  const handleDeleteHorizontalAutoscaler = async (autoscalerId: string) => {
    try {
      const response = await fetch(`/api/kubernetes/autoscalers/${autoscalerId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete horizontal autoscaler");
      }

      setHorizontalAutoscalers((prev) => prev.filter((a: any) => a.id !== autoscalerId));
      return true;
    } catch (error) {
      console.error("Error deleting horizontal autoscaler:", error);
      throw error;
    }
  };

  // Handle adding a vertical autoscaler
  const handleAddVerticalAutoscaler = async (autoscalerData: any) => {
    try {
      const response = await fetch("/api/kubernetes/vertical-autoscalers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(autoscalerData),
      });

      if (!response.ok) {
        throw new Error("Failed to create vertical autoscaler");
      }

      const data = await response.json();
      setVerticalAutoscalers((prev) => [...prev, data.verticalAutoscaler]);
      return data;
    } catch (error) {
      console.error("Error adding vertical autoscaler:", error);
      throw error;
    }
  };

  // Handle updating a vertical autoscaler
  const handleUpdateVerticalAutoscaler = async (autoscalerId: string, autoscalerData: any) => {
    try {
      const response = await fetch(`/api/kubernetes/vertical-autoscalers/${autoscalerId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(autoscalerData),
      });

      if (!response.ok) {
        throw new Error("Failed to update vertical autoscaler");
      }

      const data = await response.json();
      setVerticalAutoscalers((prev) =>
        prev.map((a: any) => (a.id === autoscalerId ? data.verticalAutoscaler : a))
      );
      return data;
    } catch (error) {
      console.error("Error updating vertical autoscaler:", error);
      throw error;
    }
  };

  // Handle deleting a vertical autoscaler
  const handleDeleteVerticalAutoscaler = async (autoscalerId: string) => {
    try {
      const response = await fetch(`/api/kubernetes/vertical-autoscalers/${autoscalerId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete vertical autoscaler");
      }

      setVerticalAutoscalers((prev) => prev.filter((a: any) => a.id !== autoscalerId));
      return true;
    } catch (error) {
      console.error("Error deleting vertical autoscaler:", error);
      throw error;
    }
  };

  if (isLoading) {
    return <div>Loading autoscalers...</div>;
  }

  return (
    <div className="space-y-6">
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertTitle>Autoscaling Options</AlertTitle>
        <AlertDescription>
          You can use either Horizontal Pod Autoscaler (HPA) to scale the number of pods, 
          Vertical Pod Autoscaler (VPA) to adjust resource requests, or both together.
          When using both, make sure VPA doesn't control the same metrics that HPA is using for scaling decisions.
        </AlertDescription>
      </Alert>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="horizontal">Horizontal Autoscaling</TabsTrigger>
          <TabsTrigger value="vertical">Vertical Autoscaling</TabsTrigger>
        </TabsList>
        <TabsContent value="horizontal" className="mt-4">
          <KubernetesAutoscalerList
            autoscalers={horizontalAutoscalers}
            deploymentId={deploymentId}
            clusterId={clusterId}
            namespace={namespace}
            deploymentName={deploymentName}
            onAddAutoscaler={handleAddHorizontalAutoscaler}
            onUpdateAutoscaler={handleUpdateHorizontalAutoscaler}
            onDeleteAutoscaler={handleDeleteHorizontalAutoscaler}
          />
        </TabsContent>
        <TabsContent value="vertical" className="mt-4">
          <KubernetesVerticalAutoscalerList
            verticalAutoscalers={verticalAutoscalers}
            deploymentId={deploymentId}
            clusterId={clusterId}
            namespace={namespace}
            deploymentName={deploymentName}
            onAddVerticalAutoscaler={handleAddVerticalAutoscaler}
            onUpdateVerticalAutoscaler={handleUpdateVerticalAutoscaler}
            onDeleteVerticalAutoscaler={handleDeleteVerticalAutoscaler}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
} 