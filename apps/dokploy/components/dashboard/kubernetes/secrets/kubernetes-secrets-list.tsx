import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Edit, Trash2, Key, FileText } from "lucide-react";
import { KubernetesSecretForm } from "./kubernetes-secret-form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

interface SecretReference {
  id: string;
  storeId: string;
  path: string;
  key: string;
  store: {
    name: string;
    provider: string;
  };
}

interface KubernetesSecret {
  id: string;
  name: string;
  namespace: string;
  secretReferences: SecretReference[];
  createdAt: string;
}

interface KubernetesSecretsListProps {
  clusterId: string;
}

export function KubernetesSecretsList({ clusterId }: KubernetesSecretsListProps) {
  const [secrets, setSecrets] = useState<KubernetesSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSecret, setSelectedSecret] = useState<KubernetesSecret | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewManifestDialogOpen, setIsViewManifestDialogOpen] = useState(false);
  const [secretManifest, setSecretManifest] = useState<string>("");
  const [loadingManifest, setLoadingManifest] = useState(false);
  const { toast } = useToast();

  const fetchSecrets = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/kubernetes/secrets?clusterId=${clusterId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch Kubernetes secrets');
      }
      const data = await response.json();
      setSecrets(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch Kubernetes secrets',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clusterId) {
      fetchSecrets();
    }
  }, [clusterId]);

  const handleCreateSuccess = () => {
    setIsCreateDialogOpen(false);
    fetchSecrets();
  };

  const handleEditSuccess = () => {
    setIsEditDialogOpen(false);
    setSelectedSecret(null);
    fetchSecrets();
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/kubernetes/secrets/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete Kubernetes secret');
      }

      toast({
        title: 'Success',
        description: 'Kubernetes secret deleted successfully',
      });

      fetchSecrets();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete Kubernetes secret',
        variant: 'destructive',
      });
    }
  };

  const viewSecretManifest = async (id: string) => {
    try {
      setLoadingManifest(true);
      const response = await fetch(`/api/kubernetes/secrets/${id}/manifest`);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch secret manifest');
      }
      
      const data = await response.json();
      setSecretManifest(JSON.stringify(data, null, 2));
      setIsViewManifestDialogOpen(true);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch secret manifest',
        variant: 'destructive',
      });
    } finally {
      setLoadingManifest(false);
    }
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'vault':
        return 'HashiCorp Vault';
      case 'aws-secrets-manager':
        return 'AWS Secrets Manager';
      case 'azure-key-vault':
        return 'Azure Key Vault';
      case 'gcp-secret-manager':
        return 'GCP Secret Manager';
      default:
        return provider;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Kubernetes Secrets</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Secret
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create Kubernetes Secret</DialogTitle>
              <DialogDescription>
                Create a new Kubernetes secret from external secret stores.
              </DialogDescription>
            </DialogHeader>
            <KubernetesSecretForm 
              clusterId={clusterId} 
              onSubmit={handleCreateSuccess} 
            />
          </DialogContent>
        </Dialog>
      </div>

      {secrets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 border border-dashed rounded-lg p-6 text-center">
          <Key className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No Kubernetes Secrets</h3>
          <p className="text-muted-foreground mt-2 mb-4">
            You haven't created any Kubernetes secrets yet. Create one to start managing your application secrets.
          </p>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Secret
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Create Kubernetes Secret</DialogTitle>
                <DialogDescription>
                  Create a new Kubernetes secret from external secret stores.
                </DialogDescription>
              </DialogHeader>
              <KubernetesSecretForm 
                clusterId={clusterId} 
                onSubmit={handleCreateSuccess} 
              />
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {secrets.map((secret) => (
            <Card key={secret.id} className="overflow-hidden">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{secret.name}</CardTitle>
                    <CardDescription>
                      Namespace: {secret.namespace}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{secret.secretReferences.length} references</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Secret References:</h4>
                  <ul className="space-y-2">
                    {secret.secretReferences.map((ref) => (
                      <li key={ref.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {ref.store.name}
                          </Badge>
                          <span className="text-muted-foreground">
                            {ref.path} → {ref.key}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
              <CardFooter className="flex justify-between">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => viewSecretManifest(secret.id)}
                  disabled={loadingManifest}
                >
                  {loadingManifest ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <FileText className="mr-2 h-4 w-4" />
                      View Manifest
                    </>
                  )}
                </Button>
                <div className="flex gap-2">
                  <Dialog open={isEditDialogOpen && selectedSecret?.id === secret.id} onOpenChange={(open) => {
                    setIsEditDialogOpen(open);
                    if (!open) setSelectedSecret(null);
                  }}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => setSelectedSecret(secret)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[600px]">
                      <DialogHeader>
                        <DialogTitle>Edit Kubernetes Secret</DialogTitle>
                        <DialogDescription>
                          Update your Kubernetes secret configuration.
                        </DialogDescription>
                      </DialogHeader>
                      {selectedSecret && (
                        <KubernetesSecretForm 
                          clusterId={clusterId}
                          onSubmit={handleEditSuccess} 
                          initialData={selectedSecret}
                        />
                      )}
                    </DialogContent>
                  </Dialog>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Kubernetes Secret</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this Kubernetes secret? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(secret.id)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isViewManifestDialogOpen} onOpenChange={setIsViewManifestDialogOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Kubernetes Secret Manifest</DialogTitle>
            <DialogDescription>
              This is the Kubernetes secret manifest that will be applied to your cluster.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted p-4 rounded-md overflow-auto max-h-[400px]">
            <pre className="text-xs font-mono whitespace-pre-wrap">{secretManifest}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
} 