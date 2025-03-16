import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { kubernetes_autoscalers, kubernetes_clusters, kubernetes_deployments } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createHorizontalPodAutoscaler, getHorizontalPodAutoscalers } from "@dokploy/server/services/kubernetes";

// Schema for validating autoscaler creation
const createAutoscalerSchema = z.object({
  name: z.string().min(1, "Autoscaler name is required"),
  namespace: z.string().min(1, "Namespace is required"),
  clusterId: z.string().min(1, "Cluster ID is required"),
  deploymentId: z.string().min(1, "Deployment ID is required"),
  minReplicas: z.number().int().min(1, "Minimum replicas must be at least 1"),
  maxReplicas: z.number().int().min(1, "Maximum replicas must be at least 1"),
  targetCPUUtilizationPercentage: z.number().int().min(1).max(100).optional(),
  targetMemoryUtilizationPercentage: z.number().int().min(1).max(100).optional(),
  customMetrics: z.array(
    z.object({
      type: z.enum(["Resource", "Pods", "Object", "External"]),
      name: z.string(),
      target: z.object({
        type: z.enum(["Utilization", "AverageValue", "Value"]),
        averageUtilization: z.number().optional(),
        averageValue: z.string().optional(),
        value: z.string().optional(),
      }),
    })
  ).optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Handle GET request to list autoscalers
  if (req.method === "GET") {
    try {
      const { clusterId, namespace } = req.query;

      // Validate query parameters
      if (!clusterId || typeof clusterId !== "string") {
        return res.status(400).json({ message: "Cluster ID is required" });
      }

      // Check if the cluster exists and belongs to the user
      const cluster = await db
        .select()
        .from(kubernetes_clusters)
        .where(
          and(
            eq(kubernetes_clusters.id, clusterId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .limit(1);

      if (cluster.length === 0) {
        return res.status(404).json({ message: "Kubernetes cluster not found" });
      }

      // If namespace is provided, filter by namespace
      let query = db
        .select()
        .from(kubernetes_autoscalers)
        .where(eq(kubernetes_autoscalers.clusterId, clusterId));

      if (namespace && typeof namespace === "string") {
        query = query.where(eq(kubernetes_autoscalers.namespace, namespace));
      }

      const autoscalers = await query;

      // Get real-time autoscaler data from Kubernetes
      const clusterConfig = {
        id: cluster[0].id,
        name: cluster[0].name,
        kubeconfig: cluster[0].kubeconfig || undefined,
        context: cluster[0].context || undefined,
        server: cluster[0].server || undefined,
        certificateAuthority: cluster[0].certificateAuthority || undefined,
        token: cluster[0].token || undefined,
        insecureSkipTlsVerify: cluster[0].insecureSkipTlsVerify || false,
      };

      const k8sAutoscalers = await getHorizontalPodAutoscalers(
        clusterConfig,
        namespace as string || "default"
      );

      // Merge database and Kubernetes data
      const mergedAutoscalers = autoscalers.map(dbAutoscaler => {
        const k8sAutoscaler = k8sAutoscalers.find(
          k8s => k8s.name === dbAutoscaler.name && k8s.namespace === dbAutoscaler.namespace
        );

        return {
          ...dbAutoscaler,
          currentReplicas: k8sAutoscaler?.currentReplicas || 0,
          desiredReplicas: k8sAutoscaler?.desiredReplicas || 0,
          metrics: k8sAutoscaler?.metrics || [],
          k8sStatus: k8sAutoscaler ? "active" : "not_found",
        };
      });

      return res.status(200).json({ autoscalers: mergedAutoscalers });
    } catch (error) {
      console.error("Error fetching Kubernetes autoscalers:", error);
      return res.status(500).json({ message: "Failed to fetch Kubernetes autoscalers" });
    }
  }

  // Handle POST request to create a new autoscaler
  if (req.method === "POST") {
    try {
      const validationResult = createAutoscalerSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          message: "Invalid request data",
          errors: validationResult.error.errors,
        });
      }

      const data = validationResult.data;

      // Check if the cluster exists and belongs to the user
      const cluster = await db
        .select()
        .from(kubernetes_clusters)
        .where(
          and(
            eq(kubernetes_clusters.id, data.clusterId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .limit(1);

      if (cluster.length === 0) {
        return res.status(404).json({ message: "Kubernetes cluster not found" });
      }

      // Check if the deployment exists
      const deployment = await db
        .select()
        .from(kubernetes_deployments)
        .where(
          and(
            eq(kubernetes_deployments.id, data.deploymentId),
            eq(kubernetes_deployments.clusterId, data.clusterId)
          )
        )
        .limit(1);

      if (deployment.length === 0) {
        return res.status(404).json({ message: "Kubernetes deployment not found" });
      }

      // Create the autoscaler in Kubernetes
      const clusterConfig = {
        id: cluster[0].id,
        name: cluster[0].name,
        kubeconfig: cluster[0].kubeconfig || undefined,
        context: cluster[0].context || undefined,
        server: cluster[0].server || undefined,
        certificateAuthority: cluster[0].certificateAuthority || undefined,
        token: cluster[0].token || undefined,
        insecureSkipTlsVerify: cluster[0].insecureSkipTlsVerify || false,
      };

      const hpaConfig = {
        name: data.name,
        namespace: data.namespace,
        deploymentName: deployment[0].name,
        minReplicas: data.minReplicas,
        maxReplicas: data.maxReplicas,
        targetCPUUtilizationPercentage: data.targetCPUUtilizationPercentage,
        targetMemoryUtilizationPercentage: data.targetMemoryUtilizationPercentage,
        metrics: data.customMetrics,
      };

      await createHorizontalPodAutoscaler(clusterConfig, hpaConfig);

      // Create the autoscaler in the database
      const autoscalerId = nanoid();
      const now = new Date();

      const autoscaler = await db
        .insert(kubernetes_autoscalers)
        .values({
          id: autoscalerId,
          name: data.name,
          namespace: data.namespace,
          clusterId: data.clusterId,
          deploymentId: data.deploymentId,
          minReplicas: data.minReplicas,
          maxReplicas: data.maxReplicas,
          targetCPUUtilizationPercentage: data.targetCPUUtilizationPercentage || null,
          targetMemoryUtilizationPercentage: data.targetMemoryUtilizationPercentage || null,
          customMetrics: data.customMetrics ? JSON.stringify(data.customMetrics) : null,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return res.status(201).json({
        message: "Kubernetes autoscaler created successfully",
        autoscaler: autoscaler[0],
      });
    } catch (error) {
      console.error("Error creating Kubernetes autoscaler:", error);
      return res.status(500).json({ message: "Failed to create Kubernetes autoscaler" });
    }
  }

  // Return 405 for unsupported methods
  return res.status(405).json({ message: "Method not allowed" });
} 