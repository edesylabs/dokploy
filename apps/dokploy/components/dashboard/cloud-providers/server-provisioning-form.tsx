import { useState, useEffect } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Loader2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

// Form schema
const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  cloudProviderId: z.string().min(1, 'Cloud provider is required'),
  instanceType: z.string().optional(),
  diskSize: z.number().min(8, 'Disk size must be at least 8 GB').optional(),
  memory: z.number().min(1, 'Memory must be at least 1 GB').optional(),
  cpuCount: z.number().min(1, 'CPU count must be at least 1').optional(),
  tags: z.record(z.string()).optional(),
  autoDelete: z.object({
    enabled: z.boolean().default(false),
    idleThreshold: z.number().min(5, 'Idle threshold must be at least 5 minutes').optional(),
    maxLifetime: z.number().min(60, 'Max lifetime must be at least 60 minutes').optional(),
  }),
});

type FormValues = z.infer<typeof formSchema>;

interface ServerProvisioningFormProps {
  cloudProviders: any[];
  onSubmit: (data: FormValues) => Promise<void>;
  onCancel: () => void;
}

export function ServerProvisioningForm({ cloudProviders, onSubmit, onCancel }: ServerProvisioningFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [regions, setRegions] = useState<any[]>([]);
  const [instanceTypes, setInstanceTypes] = useState<any[]>([]);
  const [isLoadingRegions, setIsLoadingRegions] = useState(false);
  const [isLoadingInstanceTypes, setIsLoadingInstanceTypes] = useState(false);

  // Initialize form with default values
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      cloudProviderId: '',
      instanceType: '',
      diskSize: 20,
      memory: 2,
      cpuCount: 2,
      tags: {},
      autoDelete: {
        enabled: false,
        idleThreshold: 60, // 60 minutes
        maxLifetime: 1440, // 24 hours
      },
    },
  });

  // Watch for changes to cloudProviderId
  const watchCloudProviderId = form.watch('cloudProviderId');
  const watchAutoDeleteEnabled = form.watch('autoDelete.enabled');

  // Load regions when cloud provider changes
  useEffect(() => {
    if (watchCloudProviderId) {
      const provider = cloudProviders.find(p => p.id === watchCloudProviderId);
      setSelectedProvider(provider);
      
      // Load regions
      loadRegions(watchCloudProviderId);
      
      // Reset instance type
      form.setValue('instanceType', provider?.defaultInstanceType || '');
    }
  }, [watchCloudProviderId, cloudProviders, form]);

  // Load regions for a cloud provider
  const loadRegions = async (providerId: string) => {
    try {
      setIsLoadingRegions(true);
      const response = await fetch(`/api/cloud-providers/${providerId}/regions`);
      
      if (!response.ok) {
        throw new Error('Failed to load regions');
      }
      
      const data = await response.json();
      setRegions(data);
      
      // Set default region if available
      const provider = cloudProviders.find(p => p.id === providerId);
      if (provider && provider.defaultRegion) {
        // Load instance types for the default region
        loadInstanceTypes(providerId, provider.defaultRegion);
      }
    } catch (error) {
      console.error('Error loading regions:', error);
      toast.error('Failed to load regions');
    } finally {
      setIsLoadingRegions(false);
    }
  };

  // Load instance types for a region
  const loadInstanceTypes = async (providerId: string, region: string) => {
    try {
      setIsLoadingInstanceTypes(true);
      const response = await fetch(`/api/cloud-providers/${providerId}/instance-types?region=${region}`);
      
      if (!response.ok) {
        throw new Error('Failed to load instance types');
      }
      
      const data = await response.json();
      setInstanceTypes(data);
      
      // Set default instance type if available
      const provider = cloudProviders.find(p => p.id === providerId);
      if (provider && provider.defaultInstanceType) {
        form.setValue('instanceType', provider.defaultInstanceType);
      } else if (data.length > 0) {
        form.setValue('instanceType', data[0].name);
      }
    } catch (error) {
      console.error('Error loading instance types:', error);
      toast.error('Failed to load instance types');
    } finally {
      setIsLoadingInstanceTypes(false);
    }
  };

  // Handle form submission
  const handleSubmit = async (values: FormValues) => {
    try {
      setIsSubmitting(true);
      await onSubmit(values);
      toast.success('Server provisioning started');
    } catch (error) {
      console.error('Error provisioning server:', error);
      toast.error('Failed to provision server');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>Provision New Server</CardTitle>
        <CardDescription>
          Create a new server in your cloud provider.
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
                  <FormLabel>Server Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My Server" {...field} />
                  </FormControl>
                  <FormDescription>
                    A friendly name to identify this server.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="cloudProviderId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cloud Provider</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a cloud provider" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {cloudProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name} ({provider.type.toUpperCase()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    The cloud provider to provision the server with.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedProvider && (
              <div className="space-y-6">
                <FormField
                  control={form.control}
                  name="instanceType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Instance Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={isLoadingInstanceTypes ? 'Loading...' : 'Select an instance type'} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {instanceTypes.map((type) => (
                            <SelectItem key={type.name} value={type.name}>
                              {type.description} - ${type.hourlyPrice}/hr
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        The type of instance to provision.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="diskSize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Disk Size (GB): {field.value}</FormLabel>
                      <FormControl>
                        <Slider
                          min={8}
                          max={500}
                          step={1}
                          defaultValue={[field.value || 20]}
                          onValueChange={(value) => field.onChange(value[0])}
                        />
                      </FormControl>
                      <FormDescription>
                        The size of the boot disk in GB.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tags (JSON)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder='{"environment": "production", "project": "my-project"}'
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
                        Tags to apply to the server (JSON format).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Auto-Delete Configuration</h3>
                  
                  <FormField
                    control={form.control}
                    name="autoDelete.enabled"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Enable Auto-Delete</FormLabel>
                          <FormDescription>
                            Automatically delete this server when it's idle or after a certain time.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {watchAutoDeleteEnabled && (
                    <>
                      <FormField
                        control={form.control}
                        name="autoDelete.idleThreshold"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Idle Threshold (minutes): {field.value}</FormLabel>
                            <FormControl>
                              <Slider
                                min={5}
                                max={1440}
                                step={5}
                                defaultValue={[field.value || 60]}
                                onValueChange={(value) => field.onChange(value[0])}
                              />
                            </FormControl>
                            <FormDescription>
                              Delete the server if it's idle for this many minutes.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="autoDelete.maxLifetime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Maximum Lifetime (minutes): {field.value}</FormLabel>
                            <FormControl>
                              <Slider
                                min={60}
                                max={10080} // 7 days
                                step={60}
                                defaultValue={[field.value || 1440]}
                                onValueChange={(value) => field.onChange(value[0])}
                              />
                            </FormControl>
                            <FormDescription>
                              Delete the server after this many minutes, regardless of activity.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                </div>
              </div>
            )}

            <CardFooter className="px-0 pt-4 flex justify-between">
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Provision Server
              </Button>
            </CardFooter>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
} 