import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from "@/components/ui/use-toast";
import { Loader2, CheckCircle2 } from 'lucide-react';

interface SecretStoreFormProps {
  onSubmit: () => void;
  initialData?: {
    id?: string;
    name: string;
    provider: string;
    credentials: Record<string, string>;
    defaultPath?: string;
    description?: string;
  };
}

export function SecretStoreForm({ onSubmit, initialData }: SecretStoreFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    provider: "vault",
    credentials: {} as Record<string, string>,
    defaultPath: "",
    description: "",
  });
  const { toast } = useToast();

  // Initialize form data if editing
  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name || "",
        provider: initialData.provider || "vault",
        credentials: initialData.credentials || {},
        defaultPath: initialData.defaultPath || "",
        description: initialData.description || "",
      });
    }
  }, [initialData]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleProviderChange = (value: string) => {
    setFormData((prev) => ({ 
      ...prev, 
      provider: value,
      credentials: {}, // Reset credentials when provider changes
    }));
    setTestSuccess(null);
  };

  const handleCredentialChange = (key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      credentials: {
        ...prev.credentials,
        [key]: value,
      },
    }));
    setTestSuccess(null);
  };

  const handleTestConnection = async () => {
    if (!formData.name || !formData.provider) {
      toast({
        title: 'Error',
        description: 'Please fill in the required fields',
        variant: 'destructive',
      });
      return;
    }

    // Validate credentials based on provider
    if (!validateCredentials()) {
      return;
    }

    try {
      setIsTesting(true);
      
      let endpoint = '/api/secret-stores/test';
      let method = 'POST';
      let body: any = {
        name: formData.name,
        provider: formData.provider,
        credentials: formData.credentials,
      };
      
      // If editing, use the test endpoint for the specific store
      if (initialData?.id) {
        endpoint = `/api/secret-stores/${initialData.id}/test`;
        method = 'POST';
        body = {}; // No need to send credentials for existing store
      }
      
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        setTestSuccess(true);
        toast({
          title: 'Success',
          description: 'Connection test successful',
        });
      } else {
        setTestSuccess(false);
        toast({
          title: 'Error',
          description: data.error || 'Connection test failed',
          variant: 'destructive',
        });
      }
    } catch (error) {
      setTestSuccess(false);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Connection test failed',
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const validateCredentials = () => {
    switch (formData.provider) {
      case 'vault':
        if (!formData.credentials.address || !formData.credentials.token) {
          toast({
            title: 'Error',
            description: 'Vault requires address and token',
            variant: 'destructive',
          });
          return false;
        }
        break;
      case 'aws-secrets-manager':
        if (!formData.credentials.accessKeyId || !formData.credentials.secretAccessKey || !formData.credentials.region) {
          toast({
            title: 'Error',
            description: 'AWS Secrets Manager requires accessKeyId, secretAccessKey, and region',
            variant: 'destructive',
          });
          return false;
        }
        break;
      case 'azure-key-vault':
        if (!formData.credentials.tenantId || !formData.credentials.clientId || !formData.credentials.clientSecret || !formData.credentials.vaultUrl) {
          toast({
            title: 'Error',
            description: 'Azure Key Vault requires tenantId, clientId, clientSecret, and vaultUrl',
            variant: 'destructive',
          });
          return false;
        }
        break;
      case 'gcp-secret-manager':
        if (!formData.credentials.projectId || !formData.credentials.credentials) {
          toast({
            title: 'Error',
            description: 'GCP Secret Manager requires projectId and credentials',
            variant: 'destructive',
          });
          return false;
        }
        break;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.provider) {
      toast({
        title: 'Error',
        description: 'Please fill in the required fields',
        variant: 'destructive',
      });
      return;
    }

    // Validate credentials based on provider
    if (!validateCredentials()) {
      return;
    }

    try {
      setIsSubmitting(true);
      
      const endpoint = initialData?.id 
        ? `/api/secret-stores/${initialData.id}` 
        : '/api/secret-stores';
      
      const method = initialData?.id ? 'PUT' : 'POST';
      
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save secret store');
      }

      toast({
        title: 'Success',
        description: initialData?.id 
          ? 'Secret store updated successfully' 
          : 'Secret store created successfully',
      });

      onSubmit();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save secret store',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderCredentialsFields = () => {
    switch (formData.provider) {
      case 'vault':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="address">Vault Address</Label>
              <Input
                id="address"
                placeholder="https://vault.example.com:8200"
                value={formData.credentials.address || ''}
                onChange={(e) => handleCredentialChange('address', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="token">Vault Token</Label>
              <Input
                id="token"
                type="password"
                placeholder="hvs.xxxxxxxx"
                value={formData.credentials.token || ''}
                onChange={(e) => handleCredentialChange('token', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="namespace">Vault Namespace (optional)</Label>
              <Input
                id="namespace"
                placeholder="admin/dev"
                value={formData.credentials.namespace || ''}
                onChange={(e) => handleCredentialChange('namespace', e.target.value)}
              />
            </div>
          </>
        );
      case 'aws-secrets-manager':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="accessKeyId">AWS Access Key ID</Label>
              <Input
                id="accessKeyId"
                placeholder="AKIAXXXXXXXXXXXXXXXX"
                value={formData.credentials.accessKeyId || ''}
                onChange={(e) => handleCredentialChange('accessKeyId', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secretAccessKey">AWS Secret Access Key</Label>
              <Input
                id="secretAccessKey"
                type="password"
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={formData.credentials.secretAccessKey || ''}
                onChange={(e) => handleCredentialChange('secretAccessKey', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="region">AWS Region</Label>
              <Input
                id="region"
                placeholder="us-east-1"
                value={formData.credentials.region || ''}
                onChange={(e) => handleCredentialChange('region', e.target.value)}
              />
            </div>
          </>
        );
      case 'azure-key-vault':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="tenantId">Azure Tenant ID</Label>
              <Input
                id="tenantId"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={formData.credentials.tenantId || ''}
                onChange={(e) => handleCredentialChange('tenantId', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientId">Azure Client ID</Label>
              <Input
                id="clientId"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={formData.credentials.clientId || ''}
                onChange={(e) => handleCredentialChange('clientId', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientSecret">Azure Client Secret</Label>
              <Input
                id="clientSecret"
                type="password"
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={formData.credentials.clientSecret || ''}
                onChange={(e) => handleCredentialChange('clientSecret', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vaultUrl">Azure Key Vault URL</Label>
              <Input
                id="vaultUrl"
                placeholder="https://example.vault.azure.net"
                value={formData.credentials.vaultUrl || ''}
                onChange={(e) => handleCredentialChange('vaultUrl', e.target.value)}
              />
            </div>
          </>
        );
      case 'gcp-secret-manager':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="projectId">GCP Project ID</Label>
              <Input
                id="projectId"
                placeholder="my-project-123456"
                value={formData.credentials.projectId || ''}
                onChange={(e) => handleCredentialChange('projectId', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credentials">GCP Service Account JSON</Label>
              <Textarea
                id="credentials"
                placeholder="Paste the service account JSON here"
                className="min-h-[150px] font-mono text-xs"
                value={formData.credentials.credentials || ''}
                onChange={(e) => handleCredentialChange('credentials', e.target.value)}
              />
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          placeholder="My Secret Store"
          value={formData.name}
          onChange={handleInputChange}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="provider">Provider</Label>
        <Select
          value={formData.provider}
          onValueChange={handleProviderChange}
        >
          <SelectTrigger id="provider">
            <SelectValue placeholder="Select a provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vault">HashiCorp Vault</SelectItem>
            <SelectItem value="aws-secrets-manager">AWS Secrets Manager</SelectItem>
            <SelectItem value="azure-key-vault">Azure Key Vault</SelectItem>
            <SelectItem value="gcp-secret-manager">GCP Secret Manager</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium">Credentials</h3>
        {renderCredentialsFields()}
      </div>

      <div className="space-y-2">
        <Label htmlFor="defaultPath">Default Path (optional)</Label>
        <Input
          id="defaultPath"
          name="defaultPath"
          placeholder="secret/data"
          value={formData.defaultPath}
          onChange={handleInputChange}
        />
        <p className="text-sm text-muted-foreground">
          Default path to use when accessing secrets
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          name="description"
          placeholder="Description of this secret store"
          value={formData.description}
          onChange={handleInputChange}
        />
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleTestConnection}
          disabled={isTesting}
          className="flex-1"
        >
          {isTesting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Testing...
            </>
          ) : (
            'Test Connection'
          )}
        </Button>
        
        <Button
          type="submit"
          disabled={isSubmitting || (initialData?.id ? false : testSuccess !== true)}
          className="flex-1"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {initialData?.id ? 'Updating...' : 'Creating...'}
            </>
          ) : (
            initialData?.id ? 'Update' : 'Create'
          )}
        </Button>
      </div>
      
      {testSuccess === true && (
        <div className="flex items-center text-green-600 text-sm">
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Connection test successful
        </div>
      )}
      {testSuccess === false && (
        <div className="flex items-center text-red-600 text-sm">
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Connection test failed
        </div>
      )}
    </form>
  );
} 