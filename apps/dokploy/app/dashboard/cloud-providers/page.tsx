'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Loader2 } from 'lucide-react';
import { CloudProviderForm } from '@/components/dashboard/cloud-providers/cloud-provider-form';
import { ServerList } from '@/components/dashboard/cloud-providers/server-list';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';

export default function CloudProvidersPage() {
  const [activeTab, setActiveTab] = useState('servers');
  const [isAddProviderDialogOpen, setIsAddProviderDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [cloudProviders, setCloudProviders] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  // Load all data
  const loadData = async () => {
    setIsLoading(true);
    try {
      await Promise.all([
        loadCloudProviders(),
        loadServers(),
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  // Load cloud providers
  const loadCloudProviders = async () => {
    try {
      const response = await fetch('/api/cloud-providers');
      
      if (!response.ok) {
        throw new Error('Failed to load cloud providers');
      }
      
      const data = await response.json();
      setCloudProviders(data);
    } catch (error) {
      console.error('Error loading cloud providers:', error);
      throw error;
    }
  };

  // Load servers
  const loadServers = async () => {
    try {
      const response = await fetch('/api/servers');
      
      if (!response.ok) {
        throw new Error('Failed to load servers');
      }
      
      const data = await response.json();
      setServers(data);
    } catch (error) {
      console.error('Error loading servers:', error);
      throw error;
    }
  };

  // Handle adding a cloud provider
  const handleAddCloudProvider = async (data: any) => {
    try {
      const response = await fetch('/api/cloud-providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add cloud provider');
      }

      setIsAddProviderDialogOpen(false);
      await loadCloudProviders();
      toast.success('Cloud provider added successfully');
    } catch (error) {
      console.error('Error adding cloud provider:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to add cloud provider');
      throw error;
    }
  };

  return (
    <DashboardShell>
      <DashboardHeader
        heading="Cloud Providers"
        description="Manage your cloud providers and servers."
      >
        <Dialog open={isAddProviderDialogOpen} onOpenChange={setIsAddProviderDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Provider
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl">
            <CloudProviderForm
              onSubmit={handleAddCloudProvider}
              onCancel={() => setIsAddProviderDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </DashboardHeader>

      <Tabs defaultValue="servers" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="servers">Servers</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
        </TabsList>
        <TabsContent value="servers" className="space-y-4">
          <ServerList
            servers={servers}
            cloudProviders={cloudProviders}
            onRefresh={loadData}
            isLoading={isLoading}
          />
        </TabsContent>
        <TabsContent value="providers" className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {cloudProviders.map((provider) => (
                <div
                  key={provider.id}
                  className="border rounded-lg p-4 hover:border-primary transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-medium">{provider.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {provider.type.toUpperCase()} - {provider.defaultRegion}
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // TODO: Implement edit provider
                          toast.info('Edit provider functionality coming soon');
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 text-sm">
                    <div className="flex justify-between">
                      <span>Default Instance:</span>
                      <span>{provider.defaultInstanceType || 'None'}</span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span>Servers:</span>
                      <span>
                        {servers.filter(s => s.cloudProviderId === provider.id).length}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setActiveTab('servers');
                        // TODO: Filter servers by provider
                      }}
                    >
                      View Servers
                    </Button>
                  </div>
                </div>
              ))}
              
              <div
                className="border rounded-lg p-4 hover:border-primary transition-colors flex flex-col items-center justify-center cursor-pointer"
                onClick={() => setIsAddProviderDialogOpen(true)}
              >
                <Plus className="h-12 w-12 text-muted-foreground" />
                <p className="mt-2 text-muted-foreground">Add Provider</p>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
} 