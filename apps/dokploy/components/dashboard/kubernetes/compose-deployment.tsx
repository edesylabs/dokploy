import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { Loader2, Upload, FileText, Code, Play } from 'lucide-react';

interface KubernetesCluster {
  id: string;
  name: string;
  provider: string;
  status: string;
}

interface ComposeDeploymentProps {
  clusters: KubernetesCluster[];
  onDeploymentComplete?: () => void;
}

export function ComposeDeployment({ clusters, onDeploymentComplete }: ComposeDeploymentProps) {
  const [activeTab, setActiveTab] = useState('upload');
  const [selectedClusterId, setSelectedClusterId] = useState<string>('');
  const [namespace, setNamespace] = useState<string>('default');
  const [composeContent, setComposeContent] = useState<string>('');
  const [manifests, setManifests] = useState<Record<string, string> | null>(null);
  const [selectedManifestFile, setSelectedManifestFile] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [translating, setTranslating] = useState<boolean>(false);
  const [deploying, setDeploying] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      
      const formData = new FormData();
      formData.append('composeFile', file);
      formData.append('namespace', namespace);
      
      const response = await fetch('/api/kubernetes/compose/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload Docker Compose file');
      }
      
      const data = await response.json();
      setManifests(data.manifests);
      
      if (Object.keys(data.manifests).length > 0) {
        setSelectedManifestFile(Object.keys(data.manifests)[0]);
      }
      
      setActiveTab('preview');
      
      toast({
        title: 'Success',
        description: 'Docker Compose file translated successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to upload Docker Compose file',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTranslate = async () => {
    if (!composeContent.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter Docker Compose content',
        variant: 'destructive',
      });
      return;
    }

    try {
      setTranslating(true);
      
      const response = await fetch('/api/kubernetes/compose/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          composeContent,
          namespace,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to translate Docker Compose file');
      }
      
      const data = await response.json();
      setManifests(data.manifests);
      
      if (Object.keys(data.manifests).length > 0) {
        setSelectedManifestFile(Object.keys(data.manifests)[0]);
      }
      
      setActiveTab('preview');
      
      toast({
        title: 'Success',
        description: 'Docker Compose file translated successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to translate Docker Compose file',
        variant: 'destructive',
      });
    } finally {
      setTranslating(false);
    }
  };

  const handleDeploy = async () => {
    if (!selectedClusterId) {
      toast({
        title: 'Error',
        description: 'Please select a cluster',
        variant: 'destructive',
      });
      return;
    }

    if (!manifests || Object.keys(manifests).length === 0) {
      toast({
        title: 'Error',
        description: 'No manifests to deploy',
        variant: 'destructive',
      });
      return;
    }

    try {
      setDeploying(true);
      
      const response = await fetch('/api/kubernetes/compose/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clusterId: selectedClusterId,
          manifests,
          namespace,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to deploy to Kubernetes');
      }
      
      toast({
        title: 'Success',
        description: 'Application deployed to Kubernetes successfully',
      });
      
      // Reset form
      setComposeContent('');
      setManifests(null);
      setSelectedManifestFile('');
      setActiveTab('upload');
      
      if (onDeploymentComplete) {
        onDeploymentComplete();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to deploy to Kubernetes',
        variant: 'destructive',
      });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Deploy Docker Compose to Kubernetes</CardTitle>
        <CardDescription>
          Convert your Docker Compose application to Kubernetes resources and deploy it to your cluster
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload">Upload File</TabsTrigger>
            <TabsTrigger value="paste">Paste Content</TabsTrigger>
            <TabsTrigger value="preview" disabled={!manifests}>Preview</TabsTrigger>
          </TabsList>
          
          <TabsContent value="upload" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Upload Docker Compose File</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="file-upload"
                  type="file"
                  accept=".yml,.yaml"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="w-full h-24 flex flex-col items-center justify-center border-dashed"
                >
                  {loading ? (
                    <Loader2 className="h-6 w-6 animate-spin mb-2" />
                  ) : (
                    <Upload className="h-6 w-6 mb-2" />
                  )}
                  <span>Click to upload docker-compose.yml</span>
                </Button>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="namespace">Kubernetes Namespace</Label>
              <Input
                id="namespace"
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="default"
              />
            </div>
          </TabsContent>
          
          <TabsContent value="paste" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="compose-content">Docker Compose Content</Label>
              <Textarea
                id="compose-content"
                value={composeContent}
                onChange={(e) => setComposeContent(e.target.value)}
                placeholder="Paste your docker-compose.yml content here..."
                className="min-h-[300px] font-mono"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="namespace-paste">Kubernetes Namespace</Label>
              <Input
                id="namespace-paste"
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="default"
              />
            </div>
            
            <Button 
              onClick={handleTranslate} 
              disabled={translating || !composeContent.trim()}
              className="w-full"
            >
              {translating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Translating...
                </>
              ) : (
                <>
                  <Code className="mr-2 h-4 w-4" />
                  Translate to Kubernetes
                </>
              )}
            </Button>
          </TabsContent>
          
          <TabsContent value="preview" className="space-y-4 py-4">
            {manifests && Object.keys(manifests).length > 0 ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="manifest-file">Select Manifest File</Label>
                  <Select
                    value={selectedManifestFile}
                    onValueChange={setSelectedManifestFile}
                  >
                    <SelectTrigger id="manifest-file">
                      <SelectValue placeholder="Select a manifest file" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(manifests).map((filename) => (
                        <SelectItem key={filename} value={filename}>
                          {filename}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="manifest-content">Manifest Content</Label>
                  <Textarea
                    id="manifest-content"
                    value={selectedManifestFile ? manifests[selectedManifestFile] : ''}
                    readOnly
                    className="min-h-[300px] font-mono"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="cluster">Select Kubernetes Cluster</Label>
                  <Select
                    value={selectedClusterId}
                    onValueChange={setSelectedClusterId}
                  >
                    <SelectTrigger id="cluster">
                      <SelectValue placeholder="Select a cluster" />
                    </SelectTrigger>
                    <SelectContent>
                      {clusters.length > 0 ? (
                        clusters.map((cluster) => (
                          <SelectItem key={cluster.id} value={cluster.id}>
                            {cluster.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="none" disabled>
                          No available clusters
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                
                <Button 
                  onClick={handleDeploy} 
                  disabled={deploying || !selectedClusterId}
                  className="w-full"
                >
                  {deploying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Deploying...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Deploy to Kubernetes
                    </>
                  )}
                </Button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-[300px]">
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No manifests available</p>
                <Button 
                  variant="outline" 
                  className="mt-4"
                  onClick={() => setActiveTab('upload')}
                >
                  Upload Docker Compose File
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
} 