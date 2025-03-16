import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Edit, Trash2, Key } from "lucide-react";
import { SecretStoreForm } from "./secret-store-form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface SecretStore {
  id: string;
  name: string;
  provider: string;
  credentials: Record<string, string>;
  defaultPath?: string;
  description?: string;
  createdAt: string;
}

export function SecretStoresList() {
  const [secretStores, setSecretStores] = useState<SecretStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStore, setSelectedStore] = useState<SecretStore | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const fetchSecretStores = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/secret-stores');
      if (!response.ok) {
        throw new Error('Failed to fetch secret stores');
      }
      const data = await response.json();
      setSecretStores(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch secret stores',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSecretStores();
  }, []);

  const handleCreateSuccess = () => {
    setIsCreateDialogOpen(false);
    fetchSecretStores();
  };

  const handleEditSuccess = () => {
    setIsEditDialogOpen(false);
    setSelectedStore(null);
    fetchSecretStores();
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/secret-stores/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete secret store');
      }

      toast({
        title: 'Success',
        description: 'Secret store deleted successfully',
      });

      fetchSecretStores();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete secret store',
        variant: 'destructive',
      });
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

  const getProviderIcon = (provider: string) => {
    // For simplicity, we're using the Key icon for all providers
    // In a real app, you might want to use different icons for different providers
    return <Key className="h-5 w-5" />;
  };

  const navigateToSecrets = (storeId: string) => {
    router.push(`/dashboard/secrets/${storeId}`);
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
        <h2 className="text-2xl font-bold">Secret Stores</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Secret Store
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Add Secret Store</DialogTitle>
              <DialogDescription>
                Connect to an external secret store to manage your secrets.
              </DialogDescription>
            </DialogHeader>
            <SecretStoreForm onSubmit={handleCreateSuccess} />
          </DialogContent>
        </Dialog>
      </div>

      {secretStores.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 border border-dashed rounded-lg p-6 text-center">
          <Key className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No Secret Stores</h3>
          <p className="text-muted-foreground mt-2 mb-4">
            You haven't added any secret stores yet. Add one to start managing your secrets.
          </p>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Secret Store
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Add Secret Store</DialogTitle>
                <DialogDescription>
                  Connect to an external secret store to manage your secrets.
                </DialogDescription>
              </DialogHeader>
              <SecretStoreForm onSubmit={handleCreateSuccess} />
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {secretStores.map((store) => (
            <Card key={store.id} className="overflow-hidden">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="bg-primary/10 p-2 rounded-md">
                  {getProviderIcon(store.provider)}
                </div>
                <div>
                  <CardTitle className="text-lg">{store.name}</CardTitle>
                  <CardDescription>{getProviderLabel(store.provider)}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {store.description && (
                  <p className="text-sm text-muted-foreground mb-4">{store.description}</p>
                )}
                {store.defaultPath && (
                  <div className="text-sm">
                    <span className="font-medium">Default Path:</span> {store.defaultPath}
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-between">
                <Button variant="outline" onClick={() => navigateToSecrets(store.id)}>
                  View Secrets
                </Button>
                <div className="flex gap-2">
                  <Dialog open={isEditDialogOpen && selectedStore?.id === store.id} onOpenChange={(open) => {
                    setIsEditDialogOpen(open);
                    if (!open) setSelectedStore(null);
                  }}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => setSelectedStore(store)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[600px]">
                      <DialogHeader>
                        <DialogTitle>Edit Secret Store</DialogTitle>
                        <DialogDescription>
                          Update your secret store configuration.
                        </DialogDescription>
                      </DialogHeader>
                      {selectedStore && (
                        <SecretStoreForm 
                          onSubmit={handleEditSuccess} 
                          initialData={selectedStore}
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
                        <AlertDialogTitle>Delete Secret Store</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this secret store? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(store.id)}>
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
    </div>
  );
} 