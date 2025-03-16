import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";

interface SecretStore {
  id: string;
  name: string;
  provider: string;
}

interface SecretReference {
  id?: string;
  storeId: string;
  path: string;
  key: string;
}

interface KubernetesSecretFormProps {
  clusterId: string;
  onSubmit: () => void;
  initialData?: {
    id?: string;
    name: string;
    namespace: string;
    secretReferences: SecretReference[];
  };
}

export function KubernetesSecretForm({ clusterId, onSubmit, initialData }: KubernetesSecretFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [secretStores, setSecretStores] = useState<SecretStore[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [formData, setFormData] = useState({
    name: "",
    namespace: "default",
    secretReferences: [] as SecretReference[],
  });
  const { toast } = useToast();

  // Initialize form data if editing
  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name || "",
        namespace: initialData.namespace || "default",
        secretReferences: initialData.secretReferences || [],
      });
    }
  }, [initialData]);

  // Fetch secret stores
  useEffect(() => {
    const fetchSecretStores = async () => {
      try {
        setLoadingStores(true);
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
        setLoadingStores(false);
      }
    };

    fetchSecretStores();
  }, [toast]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleNamespaceChange = (value: string) => {
    setFormData((prev) => ({ ...prev, namespace: value }));
  };

  const addSecretReference = () => {
    if (secretStores.length === 0) {
      toast({
        title: 'Error',
        description: 'No secret stores available. Please add a secret store first.',
        variant: 'destructive',
      });
      return;
    }

    setFormData((prev) => ({
      ...prev,
      secretReferences: [
        ...prev.secretReferences,
        {
          storeId: secretStores[0].id,
          path: "",
          key: "",
        },
      ],
    }));
  };

  const removeSecretReference = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      secretReferences: prev.secretReferences.filter((_, i) => i !== index),
    }));
  };

  const updateSecretReference = (index: number, field: keyof SecretReference, value: string) => {
    setFormData((prev) => {
      const updatedReferences = [...prev.secretReferences];
      updatedReferences[index] = {
        ...updatedReferences[index],
        [field]: value,
      };
      return {
        ...prev,
        secretReferences: updatedReferences,
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.namespace) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    if (formData.secretReferences.length === 0) {
      toast({
        title: 'Error',
        description: 'Please add at least one secret reference',
        variant: 'destructive',
      });
      return;
    }

    // Validate secret references
    for (const ref of formData.secretReferences) {
      if (!ref.storeId || !ref.path || !ref.key) {
        toast({
          title: 'Error',
          description: 'Please fill in all secret reference fields',
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      setIsSubmitting(true);
      
      const payload = {
        ...formData,
        clusterId,
      };
      
      const endpoint = initialData?.id 
        ? `/api/kubernetes/secrets/${initialData.id}` 
        : '/api/kubernetes/secrets';
      
      const method = initialData?.id ? 'PUT' : 'POST';
      
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save Kubernetes secret');
      }

      toast({
        title: 'Success',
        description: initialData?.id 
          ? 'Kubernetes secret updated successfully' 
          : 'Kubernetes secret created successfully',
      });

      onSubmit();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save Kubernetes secret',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadingStores) {
    return (
      <div className="flex justify-center items-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Secret Name</Label>
        <Input
          id="name"
          name="name"
          placeholder="my-secret"
          value={formData.name}
          onChange={handleInputChange}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="namespace">Namespace</Label>
        <Select
          value={formData.namespace}
          onValueChange={handleNamespaceChange}
        >
          <SelectTrigger id="namespace">
            <SelectValue placeholder="Select a namespace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">default</SelectItem>
            <SelectItem value="kube-system">kube-system</SelectItem>
            <SelectItem value="kube-public">kube-public</SelectItem>
            <SelectItem value="app">app</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-medium">Secret References</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSecretReference}
            disabled={secretStores.length === 0}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Reference
          </Button>
        </div>

        {secretStores.length === 0 && (
          <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-md">
            No secret stores available. Please add a secret store first.
          </div>
        )}

        {formData.secretReferences.length === 0 && secretStores.length > 0 && (
          <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
            No secret references added yet. Click "Add Reference" to add a secret reference.
          </div>
        )}

        {formData.secretReferences.map((reference, index) => (
          <div key={index} className="border rounded-md p-4 space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="text-sm font-medium">Reference #{index + 1}</h4>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeSecretReference(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`store-${index}`}>Secret Store</Label>
              <Select
                value={reference.storeId}
                onValueChange={(value) => updateSecretReference(index, 'storeId', value)}
              >
                <SelectTrigger id={`store-${index}`}>
                  <SelectValue placeholder="Select a secret store" />
                </SelectTrigger>
                <SelectContent>
                  {secretStores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name} ({store.provider})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`path-${index}`}>Secret Path</Label>
              <Input
                id={`path-${index}`}
                placeholder="secret/data/my-app"
                value={reference.path}
                onChange={(e) => updateSecretReference(index, 'path', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`key-${index}`}>Secret Key</Label>
              <Input
                id={`key-${index}`}
                placeholder="api-key"
                value={reference.key}
                onChange={(e) => updateSecretReference(index, 'key', e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <Button
        type="submit"
        disabled={isSubmitting || formData.secretReferences.length === 0}
        className="w-full"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {initialData?.id ? 'Updating...' : 'Creating...'}
          </>
        ) : (
          initialData?.id ? 'Update Secret' : 'Create Secret'
        )}
      </Button>
    </form>
  );
} 