import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';

// Form schema
const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['aws', 'gcp', 'azure', 'digitalocean', 'linode'], {
    required_error: 'Please select a cloud provider',
  }),
  defaultRegion: z.string().min(1, 'Default region is required'),
  defaultInstanceType: z.string().optional(),
  credentials: z.record(z.string()).refine((data) => {
    // Validate credentials based on provider type
    return true; // Simplified validation for now
  }, {
    message: 'Invalid credentials',
  }),
  defaultTags: z.record(z.string()).optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface CloudProviderFormProps {
  initialData?: any;
  onSubmit: (data: FormValues) => Promise<void>;
  onCancel: () => void;
}

export function CloudProviderForm({ initialData, onSubmit, onCancel }: CloudProviderFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(initialData?.type || 'aws');

  // Initialize form with default values or initial data
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initialData || {
      name: '',
      type: 'aws',
      defaultRegion: '',
      defaultInstanceType: '',
      credentials: {},
      defaultTags: {},
    },
  });

  // Handle form submission
  const handleSubmit = async (values: FormValues) => {
    try {
      setIsSubmitting(true);
      await onSubmit(values);
      toast.success('Cloud provider saved successfully');
    } catch (error) {
      console.error('Error saving cloud provider:', error);
      toast.error('Failed to save cloud provider');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get credential fields based on provider type
  const getCredentialFields = (providerType: string) => {
    switch (providerType) {
      case 'aws':
        return (
          <>
            <FormField
              control={form.control}
              name="credentials.accessKeyId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Access Key ID</FormLabel>
                  <FormControl>
                    <Input placeholder="AWS Access Key ID" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="credentials.secretAccessKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Secret Access Key</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="AWS Secret Access Key" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );
      case 'gcp':
        return (
          <>
            <FormField
              control={form.control}
              name="credentials.projectId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project ID</FormLabel>
                  <FormControl>
                    <Input placeholder="GCP Project ID" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="credentials.serviceAccountKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service Account Key (JSON)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Paste your GCP service account key JSON here" 
                      className="h-32"
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription>
                    Paste the entire JSON content of your service account key file.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );
      case 'azure':
        return (
          <>
            <FormField
              control={form.control}
              name="credentials.subscriptionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subscription ID</FormLabel>
                  <FormControl>
                    <Input placeholder="Azure Subscription ID" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="credentials.tenantId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tenant ID</FormLabel>
                  <FormControl>
                    <Input placeholder="Azure Tenant ID" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="credentials.clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client ID</FormLabel>
                  <FormControl>
                    <Input placeholder="Azure Client ID" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="credentials.clientSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client Secret</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Azure Client Secret" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        );
      case 'digitalocean':
        return (
          <FormField
            control={form.control}
            name="credentials.apiToken"
            render={({ field }) => (
              <FormItem>
                <FormLabel>API Token</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="DigitalOcean API Token" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );
      case 'linode':
        return (
          <FormField
            control={form.control}
            name="credentials.apiToken"
            render={({ field }) => (
              <FormItem>
                <FormLabel>API Token</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="Linode API Token" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );
      default:
        return null;
    }
  };

  // Get default region options based on provider type
  const getRegionOptions = (providerType: string) => {
    switch (providerType) {
      case 'aws':
        return [
          { value: 'us-east-1', label: 'US East (N. Virginia)' },
          { value: 'us-east-2', label: 'US East (Ohio)' },
          { value: 'us-west-1', label: 'US West (N. California)' },
          { value: 'us-west-2', label: 'US West (Oregon)' },
          { value: 'eu-west-1', label: 'EU (Ireland)' },
          { value: 'eu-central-1', label: 'EU (Frankfurt)' },
          { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
          { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
        ];
      case 'gcp':
        return [
          { value: 'us-central1', label: 'US Central (Iowa)' },
          { value: 'us-east1', label: 'US East (South Carolina)' },
          { value: 'us-west1', label: 'US West (Oregon)' },
          { value: 'europe-west1', label: 'Europe West (Belgium)' },
          { value: 'europe-west2', label: 'Europe West (London)' },
          { value: 'asia-east1', label: 'Asia East (Taiwan)' },
          { value: 'asia-southeast1', label: 'Asia Southeast (Singapore)' },
        ];
      case 'azure':
        return [
          { value: 'eastus', label: 'East US' },
          { value: 'eastus2', label: 'East US 2' },
          { value: 'westus', label: 'West US' },
          { value: 'westus2', label: 'West US 2' },
          { value: 'northeurope', label: 'North Europe' },
          { value: 'westeurope', label: 'West Europe' },
          { value: 'southeastasia', label: 'Southeast Asia' },
          { value: 'eastasia', label: 'East Asia' },
        ];
      case 'digitalocean':
        return [
          { value: 'nyc1', label: 'New York 1' },
          { value: 'nyc3', label: 'New York 3' },
          { value: 'sfo3', label: 'San Francisco 3' },
          { value: 'ams3', label: 'Amsterdam 3' },
          { value: 'sgp1', label: 'Singapore 1' },
          { value: 'lon1', label: 'London 1' },
          { value: 'fra1', label: 'Frankfurt 1' },
          { value: 'tor1', label: 'Toronto 1' },
        ];
      case 'linode':
        return [
          { value: 'us-east', label: 'Newark, NJ' },
          { value: 'us-central', label: 'Dallas, TX' },
          { value: 'us-west', label: 'Fremont, CA' },
          { value: 'us-southeast', label: 'Atlanta, GA' },
          { value: 'eu-central', label: 'Frankfurt, DE' },
          { value: 'eu-west', label: 'London, UK' },
          { value: 'ap-south', label: 'Singapore, SG' },
          { value: 'ap-northeast', label: 'Tokyo, JP' },
        ];
      default:
        return [];
    }
  };

  // Get instance type options based on provider type
  const getInstanceTypeOptions = (providerType: string) => {
    switch (providerType) {
      case 'aws':
        return [
          { value: 't3.micro', label: 't3.micro (2 vCPU, 1 GB RAM)' },
          { value: 't3.small', label: 't3.small (2 vCPU, 2 GB RAM)' },
          { value: 't3.medium', label: 't3.medium (2 vCPU, 4 GB RAM)' },
          { value: 'm5.large', label: 'm5.large (2 vCPU, 8 GB RAM)' },
          { value: 'c5.large', label: 'c5.large (2 vCPU, 4 GB RAM)' },
        ];
      case 'gcp':
        return [
          { value: 'e2-micro', label: 'e2-micro (2 vCPU, 1 GB RAM)' },
          { value: 'e2-small', label: 'e2-small (2 vCPU, 2 GB RAM)' },
          { value: 'e2-medium', label: 'e2-medium (2 vCPU, 4 GB RAM)' },
          { value: 'n1-standard-1', label: 'n1-standard-1 (1 vCPU, 3.75 GB RAM)' },
          { value: 'n1-standard-2', label: 'n1-standard-2 (2 vCPU, 7.5 GB RAM)' },
        ];
      case 'azure':
        return [
          { value: 'Standard_B1s', label: 'Standard_B1s (1 vCPU, 1 GB RAM)' },
          { value: 'Standard_B1ms', label: 'Standard_B1ms (1 vCPU, 2 GB RAM)' },
          { value: 'Standard_B2s', label: 'Standard_B2s (2 vCPU, 4 GB RAM)' },
          { value: 'Standard_D2s_v3', label: 'Standard_D2s_v3 (2 vCPU, 8 GB RAM)' },
          { value: 'Standard_F2s_v2', label: 'Standard_F2s_v2 (2 vCPU, 4 GB RAM)' },
        ];
      case 'digitalocean':
        return [
          { value: 's-1vcpu-1gb', label: 'Basic (1 vCPU, 1 GB RAM)' },
          { value: 's-1vcpu-2gb', label: 'Basic (1 vCPU, 2 GB RAM)' },
          { value: 's-2vcpu-2gb', label: 'Basic (2 vCPU, 2 GB RAM)' },
          { value: 's-2vcpu-4gb', label: 'Basic (2 vCPU, 4 GB RAM)' },
          { value: 's-4vcpu-8gb', label: 'Basic (4 vCPU, 8 GB RAM)' },
        ];
      case 'linode':
        return [
          { value: 'g6-nanode-1', label: 'Nanode 1GB (1 vCPU, 1 GB RAM)' },
          { value: 'g6-standard-1', label: 'Standard 2GB (1 vCPU, 2 GB RAM)' },
          { value: 'g6-standard-2', label: 'Standard 4GB (2 vCPU, 4 GB RAM)' },
          { value: 'g6-standard-4', label: 'Standard 8GB (4 vCPU, 8 GB RAM)' },
          { value: 'g6-standard-6', label: 'Standard 16GB (6 vCPU, 16 GB RAM)' },
        ];
      default:
        return [];
    }
  };

  // Handle provider type change
  const handleProviderChange = (value: string) => {
    setActiveTab(value);
    form.setValue('type', value as any);
    form.setValue('credentials', {});
    form.setValue('defaultRegion', '');
    form.setValue('defaultInstanceType', '');
  };

  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>{initialData ? 'Edit Cloud Provider' : 'Add Cloud Provider'}</CardTitle>
        <CardDescription>
          Configure a cloud provider to automatically provision servers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My Cloud Provider" {...field} />
                  </FormControl>
                  <FormDescription>
                    A friendly name to identify this cloud provider.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4">
              <FormLabel>Provider Type</FormLabel>
              <Tabs value={activeTab} onValueChange={handleProviderChange} className="w-full">
                <TabsList className="grid grid-cols-5 w-full">
                  <TabsTrigger value="aws">AWS</TabsTrigger>
                  <TabsTrigger value="gcp">GCP</TabsTrigger>
                  <TabsTrigger value="azure">Azure</TabsTrigger>
                  <TabsTrigger value="digitalocean">DigitalOcean</TabsTrigger>
                  <TabsTrigger value="linode">Linode</TabsTrigger>
                </TabsList>
                <TabsContent value="aws" className="pt-4 space-y-4">
                  {getCredentialFields('aws')}
                </TabsContent>
                <TabsContent value="gcp" className="pt-4 space-y-4">
                  {getCredentialFields('gcp')}
                </TabsContent>
                <TabsContent value="azure" className="pt-4 space-y-4">
                  {getCredentialFields('azure')}
                </TabsContent>
                <TabsContent value="digitalocean" className="pt-4 space-y-4">
                  {getCredentialFields('digitalocean')}
                </TabsContent>
                <TabsContent value="linode" className="pt-4 space-y-4">
                  {getCredentialFields('linode')}
                </TabsContent>
              </Tabs>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="defaultRegion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Region</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a region" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {getRegionOptions(form.getValues('type')).map((region) => (
                          <SelectItem key={region.value} value={region.value}>
                            {region.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The default region for provisioning servers.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="defaultInstanceType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Instance Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an instance type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {getInstanceTypeOptions(form.getValues('type')).map((instanceType) => (
                          <SelectItem key={instanceType.value} value={instanceType.value}>
                            {instanceType.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The default instance type for new servers.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="defaultTags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Tags (JSON)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder='{"environment": "production", "managed-by": "dokploy"}'
                      className="h-24"
                      {...field}
                      value={field.value ? JSON.stringify(field.value, null, 2) : ''}
                      onChange={(e) => {
                        try {
                          const value = e.target.value ? JSON.parse(e.target.value) : {};
                          field.onChange(value);
                        } catch (error) {
                          // Allow invalid JSON during typing
                          e.target.value ? field.onChange(e.target.value) : field.onChange({});
                        }
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    Default tags to apply to all servers provisioned with this provider (JSON format).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <CardFooter className="px-0 pt-4 flex justify-between">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {initialData ? 'Update Provider' : 'Add Provider'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
} 