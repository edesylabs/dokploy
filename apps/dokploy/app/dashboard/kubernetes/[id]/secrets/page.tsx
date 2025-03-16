"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { KubernetesSecretsList } from "@/components/dashboard/kubernetes/secrets/kubernetes-secrets-list";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface Cluster {
  id: string;
  name: string;
}

export default function KubernetesSecretsPage() {
  const params = useParams();
  const clusterId = params.id as string;
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchCluster = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/kubernetes/clusters/${clusterId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch cluster details');
        }
        const data = await response.json();
        setCluster(data);
      } catch (error) {
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to fetch cluster details',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    if (clusterId) {
      fetchCluster();
    }
  }, [clusterId, toast]);

  if (loading) {
    return (
      <DashboardShell>
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <DashboardHeader
        heading={cluster ? `${cluster.name} - Secrets` : "Kubernetes Secrets"}
        description="Manage secrets for your Kubernetes cluster using external secret stores."
      />
      <Separator className="my-6" />
      <Tabs defaultValue="secrets" className="space-y-4">
        <TabsList>
          <TabsTrigger value="secrets">Secrets</TabsTrigger>
          <TabsTrigger value="config-maps">Config Maps</TabsTrigger>
        </TabsList>
        <TabsContent value="secrets" className="space-y-4">
          <KubernetesSecretsList clusterId={clusterId} />
        </TabsContent>
        <TabsContent value="config-maps" className="space-y-4">
          <div className="flex flex-col items-center justify-center h-64 border border-dashed rounded-lg p-6 text-center">
            <h3 className="text-lg font-medium">Config Maps Management</h3>
            <p className="text-muted-foreground mt-2">
              Config Maps management is coming soon.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
} 