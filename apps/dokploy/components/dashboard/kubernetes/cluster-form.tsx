import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

interface ServerOption {
  id: string;
  name: string;
  status: string;
}

interface KubernetesClusterFormProps {
  onSubmit: () => void;
  servers: ServerOption[];
}

export function KubernetesClusterForm({ onSubmit, servers }: KubernetesClusterFormProps) {
  const [activeTab, setActiveTab] = useState("kubeconfig");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    kubeconfig: "",
    context: "",
    server: "",
    token: "",
    certificateAuthority: "",
    insecureSkipTlsVerify: false,
  });
  const { toast } = useToast();
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [clusterName, setClusterName] = useState<string>('');

  const availableServers = servers.filter(server => server.status === 'running');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSwitchChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, insecureSkipTlsVerify: checked }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedServerId) {
      toast({
        title: 'Error',
        description: 'Please select a server',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsSubmitting(true);
      
      const response = await fetch(`/api/servers/${selectedServerId}/install-kubernetes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clusterName: clusterName.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create Kubernetes cluster');
      }

      toast({
        title: 'Success',
        description: 'Kubernetes cluster created successfully',
      });

      setSelectedServerId('');
      setClusterName('');
      onSubmit();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create Kubernetes cluster',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cluster-name">Cluster Name</Label>
        <Input
          id="cluster-name"
          placeholder="My Kubernetes Cluster"
          value={clusterName}
          onChange={(e) => setClusterName(e.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          Optional. If not provided, a name will be generated based on the server name.
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="server">Master Node Server</Label>
        <Select
          value={selectedServerId}
          onValueChange={setSelectedServerId}
        >
          <SelectTrigger id="server">
            <SelectValue placeholder="Select a server" />
          </SelectTrigger>
          <SelectContent>
            {availableServers.length > 0 ? (
              availableServers.map((server) => (
                <SelectItem key={server.id} value={server.id}>
                  {server.name}
                </SelectItem>
              ))
            ) : (
              <SelectItem value="none" disabled>
                No available servers
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          Select a server to use as the master node for your Kubernetes cluster.
          Only running servers are available.
        </p>
      </div>

      <Button type="submit" disabled={!selectedServerId || isSubmitting} className="w-full">
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating...
          </>
        ) : (
          'Create Kubernetes Cluster'
        )}
      </Button>
    </form>
  );
} 