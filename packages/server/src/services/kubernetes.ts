import {
  execAsync,
  execAsyncRemote,
} from "@dokploy/server/utils/process/execAsync";
import { KubeConfig, CoreV1Api, AppsV1Api, NetworkingV1Api, AutoscalingV2Api, CustomObjectsApi } from '@kubernetes/client-node';

// Interface for Kubernetes cluster configuration
export interface KubernetesClusterConfig {
  id: string;
  name: string;
  kubeconfig?: string;
  context?: string;
  server?: string;
  certificateAuthority?: string;
  token?: string;
  username?: string;
  password?: string;
  insecureSkipTlsVerify?: boolean;
}

// Interface for Kubernetes deployment
export interface KubernetesDeployment {
  name: string;
  namespace: string;
  replicas: number;
  image: string;
  ports: Array<{ containerPort: number, protocol: string }>;
  env: Array<{ name: string, value: string }>;
  resources?: {
    limits?: { cpu?: string, memory?: string };
    requests?: { cpu?: string, memory?: string };
  };
  volumes?: Array<{ name: string, mountPath: string, type: string, source: string }>;
}

// Interface for Horizontal Pod Autoscaler
export interface KubernetesHorizontalPodAutoscaler {
  name: string;
  namespace: string;
  deploymentName: string;
  minReplicas: number;
  maxReplicas: number;
  targetCPUUtilizationPercentage?: number;
  targetMemoryUtilizationPercentage?: number;
  metrics?: Array<{
    type: 'Resource' | 'Pods' | 'Object' | 'External';
    name: string;
    target: {
      type: 'Utilization' | 'AverageValue' | 'Value';
      averageUtilization?: number;
      averageValue?: string;
      value?: string;
    };
  }>;
}

// Interface for Vertical Pod Autoscaler
export interface KubernetesVerticalPodAutoscaler {
  name: string;
  namespace: string;
  deploymentName: string;
  updateMode: 'Off' | 'Initial' | 'Auto' | 'Recreate';
  minAllowed?: {
    cpu?: string;
    memory?: string;
  };
  maxAllowed?: {
    cpu?: string;
    memory?: string;
  };
  controlledResources?: string[];
}

// Get Kubernetes client for a cluster
const getKubernetesClient = (clusterConfig: KubernetesClusterConfig) => {
  const kc = new KubeConfig();
  
  if (clusterConfig.kubeconfig) {
    // Load from kubeconfig file content
    kc.loadFromString(clusterConfig.kubeconfig);
    if (clusterConfig.context) {
      kc.setCurrentContext(clusterConfig.context);
    }
  } else {
    // Create cluster config from individual fields
    kc.loadFromOptions({
      clusters: [{
        name: clusterConfig.name,
        server: clusterConfig.server || '',
        skipTLSVerify: clusterConfig.insecureSkipTlsVerify,
        caData: clusterConfig.certificateAuthority,
      }],
      users: [{
        name: clusterConfig.name,
        token: clusterConfig.token,
        username: clusterConfig.username,
        password: clusterConfig.password,
      }],
      contexts: [{
        name: clusterConfig.name,
        cluster: clusterConfig.name,
        user: clusterConfig.name,
      }],
      currentContext: clusterConfig.name,
    });
  }
  
  return {
    coreApi: kc.makeApiClient(CoreV1Api),
    appsApi: kc.makeApiClient(AppsV1Api),
    networkingApi: kc.makeApiClient(NetworkingV1Api),
    autoscalingApi: kc.makeApiClient(AutoscalingV2Api),
    customObjectsApi: kc.makeApiClient(CustomObjectsApi),
  };
};

// Get clusters using kubectl
export const getClusters = async (serverId?: string | null) => {
  try {
    const command = "kubectl config get-contexts --output=name";
    let stdout = "";
    let stderr = "";

    if (serverId) {
      const result = await execAsyncRemote(serverId, command);
      stdout = result.stdout;
      stderr = result.stderr;
    } else {
      const result = await execAsync(command);
      stdout = result.stdout;
      stderr = result.stderr;
    }

    if (stderr) {
      console.error(`Error: ${stderr}`);
      return [];
    }

    return stdout.trim().split('\n').filter(Boolean);
  } catch (error) {
    console.error('Error getting Kubernetes clusters:', error);
    return [];
  }
};

// Get namespaces in a cluster
export const getNamespaces = async (clusterConfig: KubernetesClusterConfig) => {
  try {
    const { coreApi } = getKubernetesClient(clusterConfig);
    const response = await coreApi.listNamespace();
    return response.body.items.map(namespace => ({
      name: namespace.metadata?.name || '',
      status: namespace.status?.phase || '',
      creationTimestamp: namespace.metadata?.creationTimestamp || '',
    }));
  } catch (error) {
    console.error('Error getting Kubernetes namespaces:', error);
    return [];
  }
};

// Get deployments in a namespace
export const getDeployments = async (
  clusterConfig: KubernetesClusterConfig,
  namespace: string = 'default'
) => {
  try {
    const { appsApi } = getKubernetesClient(clusterConfig);
    const response = await appsApi.listNamespacedDeployment(namespace);
    return response.body.items.map(deployment => ({
      name: deployment.metadata?.name || '',
      namespace: deployment.metadata?.namespace || '',
      replicas: deployment.spec?.replicas || 0,
      availableReplicas: deployment.status?.availableReplicas || 0,
      creationTimestamp: deployment.metadata?.creationTimestamp || '',
    }));
  } catch (error) {
    console.error('Error getting Kubernetes deployments:', error);
    return [];
  }
};

// Get pods in a namespace
export const getPods = async (
  clusterConfig: KubernetesClusterConfig,
  namespace: string = 'default'
) => {
  try {
    const { coreApi } = getKubernetesClient(clusterConfig);
    const response = await coreApi.listNamespacedPod(namespace);
    return response.body.items.map(pod => ({
      name: pod.metadata?.name || '',
      namespace: pod.metadata?.namespace || '',
      status: pod.status?.phase || '',
      podIP: pod.status?.podIP || '',
      nodeName: pod.spec?.nodeName || '',
      creationTimestamp: pod.metadata?.creationTimestamp || '',
    }));
  } catch (error) {
    console.error('Error getting Kubernetes pods:', error);
    return [];
  }
};

// Get services in a namespace
export const getServices = async (
  clusterConfig: KubernetesClusterConfig,
  namespace: string = 'default'
) => {
  try {
    const { coreApi } = getKubernetesClient(clusterConfig);
    const response = await coreApi.listNamespacedService(namespace);
    return response.body.items.map(service => ({
      name: service.metadata?.name || '',
      namespace: service.metadata?.namespace || '',
      type: service.spec?.type || '',
      clusterIP: service.spec?.clusterIP || '',
      ports: service.spec?.ports?.map(port => ({
        port: port.port,
        targetPort: port.targetPort,
        protocol: port.protocol,
      })) || [],
      creationTimestamp: service.metadata?.creationTimestamp || '',
    }));
  } catch (error) {
    console.error('Error getting Kubernetes services:', error);
    return [];
  }
};

// Create a deployment in a namespace
export const createDeployment = async (
  clusterConfig: KubernetesClusterConfig,
  deployment: KubernetesDeployment
) => {
  try {
    const { appsApi } = getKubernetesClient(clusterConfig);
    
    const deploymentManifest = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: deployment.name,
        namespace: deployment.namespace,
        labels: {
          app: deployment.name,
          'dokploy.com/managed-by': 'dokploy',
        },
      },
      spec: {
        replicas: deployment.replicas,
        selector: {
          matchLabels: {
            app: deployment.name,
          },
        },
        template: {
          metadata: {
            labels: {
              app: deployment.name,
            },
          },
          spec: {
            containers: [
              {
                name: deployment.name,
                image: deployment.image,
                ports: deployment.ports,
                env: deployment.env,
                resources: deployment.resources,
              },
            ],
          },
        },
      },
    };
    
    const response = await appsApi.createNamespacedDeployment(
      deployment.namespace,
      deploymentManifest
    );
    
    return {
      name: response.body.metadata?.name,
      namespace: response.body.metadata?.namespace,
      created: true,
    };
  } catch (error) {
    console.error('Error creating Kubernetes deployment:', error);
    throw error;
  }
};

// Create a service for a deployment
export const createService = async (
  clusterConfig: KubernetesClusterConfig,
  namespace: string,
  name: string,
  ports: Array<{ port: number, targetPort: number, protocol: string }>,
  type: string = 'ClusterIP'
) => {
  try {
    const { coreApi } = getKubernetesClient(clusterConfig);
    
    const serviceManifest = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name,
        namespace,
        labels: {
          app: name,
          'dokploy.com/managed-by': 'dokploy',
        },
      },
      spec: {
        type,
        selector: {
          app: name,
        },
        ports,
      },
    };
    
    const response = await coreApi.createNamespacedService(
      namespace,
      serviceManifest
    );
    
    return {
      name: response.body.metadata?.name,
      namespace: response.body.metadata?.namespace,
      created: true,
    };
  } catch (error) {
    console.error('Error creating Kubernetes service:', error);
    throw error;
  }
};

// Delete a deployment
export const deleteDeployment = async (
  clusterConfig: KubernetesClusterConfig,
  namespace: string,
  name: string
) => {
  try {
    const { appsApi } = getKubernetesClient(clusterConfig);
    await appsApi.deleteNamespacedDeployment(name, namespace);
    return { deleted: true };
  } catch (error) {
    console.error('Error deleting Kubernetes deployment:', error);
    throw error;
  }
};

// Get logs for a pod
export const getPodLogs = async (
  clusterConfig: KubernetesClusterConfig,
  namespace: string,
  podName: string,
  containerName?: string,
  tailLines?: number
) => {
  try {
    const { coreApi } = getKubernetesClient(clusterConfig);
    const response = await coreApi.readNamespacedPodLog(
      podName,
      namespace,
      containerName,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tailLines
    );
    return response.body;
  } catch (error) {
    console.error('Error getting Kubernetes pod logs:', error);
    throw error;
  }
};

// Get horizontal pod autoscalers in a namespace
export const getHorizontalPodAutoscalers = async (
  clusterConfig: KubernetesClusterConfig,
  namespace: string = 'default'
) => {
  try {
    const { autoscalingApi } = getKubernetesClient(clusterConfig);
    const response = await autoscalingApi.listNamespacedHorizontalPodAutoscaler(namespace);
    
    return response.body.items.map(hpa => {
      // Extract metrics information
      const metrics = hpa.spec?.metrics?.map(metric => {
        if (metric.resource) {
          return {
            type: 'Resource',
            name: metric.resource.name,
            target: {
              type: metric.resource.target.type,
              averageUtilization: metric.resource.target.averageUtilization,
              averageValue: metric.resource.target.averageValue,
              value: metric.resource.target.value,
            }
          };
        }
        return null;
      }).filter(Boolean) || [];

      return {
        name: hpa.metadata?.name || '',
        namespace: hpa.metadata?.namespace || '',
        deploymentName: hpa.spec?.scaleTargetRef?.name || '',
        minReplicas: hpa.spec?.minReplicas || 1,
        maxReplicas: hpa.spec?.maxReplicas || 1,
        currentReplicas: hpa.status?.currentReplicas || 0,
        desiredReplicas: hpa.status?.desiredReplicas || 0,
        metrics,
        creationTimestamp: hpa.metadata?.creationTimestamp || '',
      };
    });
  } catch (error) {
    console.error('Error getting Kubernetes horizontal pod autoscalers:', error);
    return [];
  }
};

// Create a horizontal pod autoscaler
export const createHorizontalPodAutoscaler = async (
  clusterConfig: KubernetesClusterConfig,
  hpa: KubernetesHorizontalPodAutoscaler
) => {
  try {
    const { autoscalingApi } = getKubernetesClient(clusterConfig);
    
    // Build metrics array
    const metrics = [];
    
    // Add CPU metric if specified
    if (hpa.targetCPUUtilizationPercentage) {
      metrics.push({
        type: 'Resource',
        resource: {
          name: 'cpu',
          target: {
            type: 'Utilization',
            averageUtilization: hpa.targetCPUUtilizationPercentage
          }
        }
      });
    }
    
    // Add Memory metric if specified
    if (hpa.targetMemoryUtilizationPercentage) {
      metrics.push({
        type: 'Resource',
        resource: {
          name: 'memory',
          target: {
            type: 'Utilization',
            averageUtilization: hpa.targetMemoryUtilizationPercentage
          }
        }
      });
    }
    
    // Add custom metrics if specified
    if (hpa.metrics && hpa.metrics.length > 0) {
      hpa.metrics.forEach(metric => {
        if (metric.type === 'Resource') {
          metrics.push({
            type: 'Resource',
            resource: {
              name: metric.name,
              target: {
                type: metric.target.type,
                averageUtilization: metric.target.averageUtilization,
                averageValue: metric.target.averageValue,
                value: metric.target.value
              }
            }
          });
        }
      });
    }
    
    const hpaManifest = {
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: {
        name: hpa.name,
        namespace: hpa.namespace,
        labels: {
          app: hpa.deploymentName,
          'dokploy.com/managed-by': 'dokploy',
        },
      },
      spec: {
        scaleTargetRef: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: hpa.deploymentName,
        },
        minReplicas: hpa.minReplicas,
        maxReplicas: hpa.maxReplicas,
        metrics: metrics.length > 0 ? metrics : undefined,
      },
    };
    
    const response = await autoscalingApi.createNamespacedHorizontalPodAutoscaler(
      hpa.namespace,
      hpaManifest
    );
    
    return {
      name: response.body.metadata?.name,
      namespace: response.body.metadata?.namespace,
      created: true,
    };
  } catch (error) {
    console.error('Error creating Kubernetes horizontal pod autoscaler:', error);
    throw error;
  }
};

// Update a horizontal pod autoscaler
export const updateHorizontalPodAutoscaler = async (
  clusterConfig: KubernetesClusterConfig,
  hpa: KubernetesHorizontalPodAutoscaler
) => {
  try {
    const { autoscalingApi } = getKubernetesClient(clusterConfig);
    
    // Build metrics array
    const metrics = [];
    
    // Add CPU metric if specified
    if (hpa.targetCPUUtilizationPercentage) {
      metrics.push({
        type: 'Resource',
        resource: {
          name: 'cpu',
          target: {
            type: 'Utilization',
            averageUtilization: hpa.targetCPUUtilizationPercentage
          }
        }
      });
    }
    
    // Add Memory metric if specified
    if (hpa.targetMemoryUtilizationPercentage) {
      metrics.push({
        type: 'Resource',
        resource: {
          name: 'memory',
          target: {
            type: 'Utilization',
            averageUtilization: hpa.targetMemoryUtilizationPercentage
          }
        }
      });
    }
    
    // Add custom metrics if specified
    if (hpa.metrics && hpa.metrics.length > 0) {
      hpa.metrics.forEach(metric => {
        if (metric.type === 'Resource') {
          metrics.push({
            type: 'Resource',
            resource: {
              name: metric.name,
              target: {
                type: metric.target.type,
                averageUtilization: metric.target.averageUtilization,
                averageValue: metric.target.averageValue,
                value: metric.target.value
              }
            }
          });
        }
      });
    }
    
    // Get the current HPA to patch it
    const currentHPA = await autoscalingApi.readNamespacedHorizontalPodAutoscaler(
      hpa.name,
      hpa.namespace
    );
    
    const hpaPatch = {
      spec: {
        minReplicas: hpa.minReplicas,
        maxReplicas: hpa.maxReplicas,
        metrics: metrics.length > 0 ? metrics : undefined,
      },
    };
    
    const response = await autoscalingApi.patchNamespacedHorizontalPodAutoscaler(
      hpa.name,
      hpa.namespace,
      hpaPatch,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: {
          'Content-Type': 'application/strategic-merge-patch+json',
        },
      }
    );
    
    return {
      name: response.body.metadata?.name,
      namespace: response.body.metadata?.namespace,
      updated: true,
    };
  } catch (error) {
    console.error('Error updating Kubernetes horizontal pod autoscaler:', error);
    throw error;
  }
};

// Delete a horizontal pod autoscaler
export const deleteHorizontalPodAutoscaler = async (
  clusterConfig: KubernetesClusterConfig,
  namespace: string,
  name: string
) => {
  try {
    const { autoscalingApi } = getKubernetesClient(clusterConfig);
    await autoscalingApi.deleteNamespacedHorizontalPodAutoscaler(name, namespace);
    return { deleted: true };
  } catch (error) {
    console.error('Error deleting Kubernetes horizontal pod autoscaler:', error);
    throw error;
  }
};

// Get vertical pod autoscalers in a namespace
export const getVerticalPodAutoscalers = async (
  clusterConfig: KubernetesClusterConfig,
  namespace: string = 'default'
) => {
  try {
    // VPA uses a custom resource definition, so we need to use the CustomObjectsApi
    const kc = new KubeConfig();
    
    if (clusterConfig.kubeconfig) {
      kc.loadFromString(clusterConfig.kubeconfig);
      if (clusterConfig.context) {
        kc.setCurrentContext(clusterConfig.context);
      }
    } else {
      kc.loadFromOptions({
        clusters: [{
          name: clusterConfig.name,
          server: clusterConfig.server || '',
          skipTLSVerify: clusterConfig.insecureSkipTlsVerify,
          caData: clusterConfig.certificateAuthority,
        }],
        users: [{
          name: clusterConfig.name,
          token: clusterConfig.token,
          username: clusterConfig.username,
          password: clusterConfig.password,
        }],
        contexts: [{
          name: clusterConfig.name,
          cluster: clusterConfig.name,
          user: clusterConfig.name,
        }],
        currentContext: clusterConfig.name,
      });
    }
    
    const customObjectsApi = kc.makeApiClient(CustomObjectsApi);
    
    const response = await customObjectsApi.listNamespacedCustomObject(
      'autoscaling.k8s.io',
      'v1',
      namespace,
      'verticalpodautoscalers'
    );
    
    const items = response.body.items || [];
    return items.map((vpa: any) => {
      const targetRef = vpa.spec?.targetRef || {};
      const updatePolicy = vpa.spec?.updatePolicy || {};
      const resourcePolicy = vpa.spec?.resourcePolicy || {};
      
      return {
        name: vpa.metadata?.name || '',
        namespace: vpa.metadata?.namespace || '',
        deploymentName: targetRef.name || '',
        deploymentKind: targetRef.kind || '',
        updateMode: updatePolicy.updateMode || 'Auto',
        minAllowed: resourcePolicy.containerPolicies?.[0]?.minAllowed || {},
        maxAllowed: resourcePolicy.containerPolicies?.[0]?.maxAllowed || {},
        controlledResources: resourcePolicy.containerPolicies?.[0]?.controlledResources || ['cpu', 'memory'],
        recommendation: vpa.status?.recommendation?.containerRecommendations?.[0]?.target || {},
        creationTimestamp: vpa.metadata?.creationTimestamp || '',
      };
    });
  } catch (error) {
    console.error('Error getting Kubernetes vertical pod autoscalers:', error);
    return [];
  }
};

// Create a vertical pod autoscaler
export const createVerticalPodAutoscaler = async (
  clusterConfig: KubernetesClusterConfig,
  vpa: KubernetesVerticalPodAutoscaler
) => {
  try {
    const kc = new KubeConfig();
    
    if (clusterConfig.kubeconfig) {
      kc.loadFromString(clusterConfig.kubeconfig);
      if (clusterConfig.context) {
        kc.setCurrentContext(clusterConfig.context);
      }
    } else {
      kc.loadFromOptions({
        clusters: [{
          name: clusterConfig.name,
          server: clusterConfig.server || '',
          skipTLSVerify: clusterConfig.insecureSkipTlsVerify,
          caData: clusterConfig.certificateAuthority,
        }],
        users: [{
          name: clusterConfig.name,
          token: clusterConfig.token,
          username: clusterConfig.username,
          password: clusterConfig.password,
        }],
        contexts: [{
          name: clusterConfig.name,
          cluster: clusterConfig.name,
          user: clusterConfig.name,
        }],
        currentContext: clusterConfig.name,
      });
    }
    
    const customObjectsApi = kc.makeApiClient(CustomObjectsApi);
    
    // Build container policies
    const containerPolicies = [{
      containerName: '*', // Apply to all containers
      controlledResources: vpa.controlledResources || ['cpu', 'memory'],
      minAllowed: vpa.minAllowed,
      maxAllowed: vpa.maxAllowed,
    }];
    
    const vpaManifest = {
      apiVersion: 'autoscaling.k8s.io/v1',
      kind: 'VerticalPodAutoscaler',
      metadata: {
        name: vpa.name,
        namespace: vpa.namespace,
        labels: {
          app: vpa.deploymentName,
          'dokploy.com/managed-by': 'dokploy',
        },
      },
      spec: {
        targetRef: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: vpa.deploymentName,
        },
        updatePolicy: {
          updateMode: vpa.updateMode,
        },
        resourcePolicy: {
          containerPolicies: containerPolicies,
        },
      },
    };
    
    const response = await customObjectsApi.createNamespacedCustomObject(
      'autoscaling.k8s.io',
      'v1',
      vpa.namespace,
      'verticalpodautoscalers',
      vpaManifest
    );
    
    return {
      name: vpa.name,
      namespace: vpa.namespace,
      created: true,
    };
  } catch (error) {
    console.error('Error creating Kubernetes vertical pod autoscaler:', error);
    throw error;
  }
};

// Update a vertical pod autoscaler
export const updateVerticalPodAutoscaler = async (
  clusterConfig: KubernetesClusterConfig,
  vpa: KubernetesVerticalPodAutoscaler
) => {
  try {
    const kc = new KubeConfig();
    
    if (clusterConfig.kubeconfig) {
      kc.loadFromString(clusterConfig.kubeconfig);
      if (clusterConfig.context) {
        kc.setCurrentContext(clusterConfig.context);
      }
    } else {
      kc.loadFromOptions({
        clusters: [{
          name: clusterConfig.name,
          server: clusterConfig.server || '',
          skipTLSVerify: clusterConfig.insecureSkipTlsVerify,
          caData: clusterConfig.certificateAuthority,
        }],
        users: [{
          name: clusterConfig.name,
          token: clusterConfig.token,
          username: clusterConfig.username,
          password: clusterConfig.password,
        }],
        contexts: [{
          name: clusterConfig.name,
          cluster: clusterConfig.name,
          user: clusterConfig.name,
        }],
        currentContext: clusterConfig.name,
      });
    }
    
    const customObjectsApi = kc.makeApiClient(CustomObjectsApi);
    
    // Build container policies
    const containerPolicies = [{
      containerName: '*', // Apply to all containers
      controlledResources: vpa.controlledResources || ['cpu', 'memory'],
      minAllowed: vpa.minAllowed,
      maxAllowed: vpa.maxAllowed,
    }];
    
    const vpaPatch = {
      spec: {
        updatePolicy: {
          updateMode: vpa.updateMode,
        },
        resourcePolicy: {
          containerPolicies: containerPolicies,
        },
      },
    };
    
    const response = await customObjectsApi.patchNamespacedCustomObject(
      'autoscaling.k8s.io',
      'v1',
      vpa.namespace,
      'verticalpodautoscalers',
      vpa.name,
      vpaPatch,
      undefined,
      undefined,
      undefined,
      { headers: { 'Content-Type': 'application/merge-patch+json' } }
    );
    
    return {
      name: vpa.name,
      namespace: vpa.namespace,
      updated: true,
    };
  } catch (error) {
    console.error('Error updating Kubernetes vertical pod autoscaler:', error);
    throw error;
  }
};

// Delete a vertical pod autoscaler
export const deleteVerticalPodAutoscaler = async (
  clusterConfig: KubernetesClusterConfig,
  namespace: string,
  name: string
) => {
  try {
    const kc = new KubeConfig();
    
    if (clusterConfig.kubeconfig) {
      kc.loadFromString(clusterConfig.kubeconfig);
      if (clusterConfig.context) {
        kc.setCurrentContext(clusterConfig.context);
      }
    } else {
      kc.loadFromOptions({
        clusters: [{
          name: clusterConfig.name,
          server: clusterConfig.server || '',
          skipTLSVerify: clusterConfig.insecureSkipTlsVerify,
          caData: clusterConfig.certificateAuthority,
        }],
        users: [{
          name: clusterConfig.name,
          token: clusterConfig.token,
          username: clusterConfig.username,
          password: clusterConfig.password,
        }],
        contexts: [{
          name: clusterConfig.name,
          cluster: clusterConfig.name,
          user: clusterConfig.name,
        }],
        currentContext: clusterConfig.name,
      });
    }
    
    const customObjectsApi = kc.makeApiClient(CustomObjectsApi);
    
    await customObjectsApi.deleteNamespacedCustomObject(
      'autoscaling.k8s.io',
      'v1',
      namespace,
      'verticalpodautoscalers',
      name
    );
    
    return { deleted: true };
  } catch (error) {
    console.error('Error deleting Kubernetes vertical pod autoscaler:', error);
    throw error;
  }
}; 