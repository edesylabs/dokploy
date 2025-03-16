import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { db } from "@/lib/db";
import { kubernetes_autoscalers, kubernetes_clusters, kubernetes_deployments } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { 
  deleteHorizontalPodAutoscaler, 
  updateHorizontalPodAutoscaler 
} from "@dokploy/server/services/kubernetes";

// Schema for validating autoscaler updates
const updateAutoscalerSchema = z.object({
  minReplicas: z.number().int().min(1, "Minimum replicas must be at least 1").optional(),
  maxReplicas: z.number().int().min(1, "Maximum replicas must be at least 1").optional(),
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

  const { autoscalerId } = req.query;

  if (!autoscalerId || typeof autoscalerId !== "string") {
    return res.status(400).json({ message: "Invalid autoscaler ID" });
  }

  // Handle GET request to fetch a specific autoscaler
  if (req.method === "GET") {
    try {
      // Join autoscaler with cluster and deployment to get all necessary data
      const autoscaler = await db
        .select({
          autoscaler: kubernetes_autoscalers,
          cluster: kubernetes_clusters,
          deployment: kubernetes_deployments,
        })
        .from(kubernetes_autoscalers)
        .innerJoin(
          kubernetes_clusters,
          eq(kubernetes_autoscalers.clusterId, kubernetes_clusters.id)
        )
        .innerJoin(
          kubernetes_deployments,
          eq(kubernetes_autoscalers.deploymentId, kubernetes_deployments.id)
        )
        .where(
          and(
            eq(kubernetes_autoscalers.id, autoscalerId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .limit(1);

      if (autoscaler.length === 0) {
        return res.status(404).json({ message: "Kubernetes autoscaler not found" });
      }

      return res.status(200).json({ autoscaler: autoscaler[0] });
    } catch (error) {
      console.error("Error fetching Kubernetes autoscaler:", error);
      return res.status(500).json({ message: "Failed to fetch Kubernetes autoscaler" });
    }
  }

  // Handle PUT request to update an autoscaler
  if (req.method === "PUT") {
    try {
      const validationResult = updateAutoscalerSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          message: "Invalid request data",
          errors: validationResult.error.errors,
        });
      }

      const data = validationResult.data;
      const now = new Date();

      // Get the autoscaler with cluster and deployment info
      const autoscaler = await db
        .select({
          autoscaler: kubernetes_autoscalers,
          cluster: kubernetes_clusters,
          deployment: kubernetes_deployments,
        })
        .from(kubernetes_autoscalers)
        .innerJoin(
          kubernetes_clusters,
          eq(kubernetes_autoscalers.clusterId, kubernetes_clusters.id)
        )
        .innerJoin(
          kubernetes_deployments,
          eq(kubernetes_autoscalers.deploymentId, kubernetes_deployments.id)
        )
        .where(
          and(
            eq(kubernetes_autoscalers.id, autoscalerId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .limit(1);

      if (autoscaler.length === 0) {
        return res.status(404).json({ message: "Kubernetes autoscaler not found" });
      }

      // Update the autoscaler in Kubernetes
      const clusterConfig = {
        id: autoscaler[0].cluster.id,
        name: autoscaler[0].cluster.name,
        kubeconfig: autoscaler[0].cluster.kubeconfig || undefined,
        context: autoscaler[0].cluster.context || undefined,
        server: autoscaler[0].cluster.server || undefined,
        certificateAuthority: autoscaler[0].cluster.certificateAuthority || undefined,
        token: autoscaler[0].cluster.token || undefined,
        insecureSkipTlsVerify: autoscaler[0].cluster.insecureSkipTlsVerify || false,
      };

      const hpaConfig = {
        name: autoscaler[0].autoscaler.name,
        namespace: autoscaler[0].autoscaler.namespace,
        deploymentName: autoscaler[0].deployment.name,
        minReplicas: data.minReplicas || autoscaler[0].autoscaler.minReplicas,
        maxReplicas: data.maxReplicas || autoscaler[0].autoscaler.maxReplicas,
        targetCPUUtilizationPercentage: data.targetCPUUtilizationPercentage || autoscaler[0].autoscaler.targetCPUUtilizationPercentage,
        targetMemoryUtilizationPercentage: data.targetMemoryUtilizationPercentage || autoscaler[0].autoscaler.targetMemoryUtilizationPercentage,
        metrics: data.customMetrics || (autoscaler[0].autoscaler.customMetrics ? JSON.parse(autoscaler[0].autoscaler.customMetrics as string) : undefined),
      };

      await updateHorizontalPodAutoscaler(clusterConfig, hpaConfig);

      // Update the autoscaler in the database
      const updatedAutoscaler = await db
        .update(kubernetes_autoscalers)
        .set({
          minReplicas: data.minReplicas || autoscaler[0].autoscaler.minReplicas,
          maxReplicas: data.maxReplicas || autoscaler[0].autoscaler.maxReplicas,
          targetCPUUtilizationPercentage: data.targetCPUUtilizationPercentage || autoscaler[0].autoscaler.targetCPUUtilizationPercentage,
          targetMemoryUtilizationPercentage: data.targetMemoryUtilizationPercentage || autoscaler[0].autoscaler.targetMemoryUtilizationPercentage,
          customMetrics: data.customMetrics ? JSON.stringify(data.customMetrics) : autoscaler[0].autoscaler.customMetrics,
          updatedAt: now,
        })
        .where(eq(kubernetes_autoscalers.id, autoscalerId))
        .returning();

      return res.status(200).json({
        message: "Kubernetes autoscaler updated successfully",
        autoscaler: updatedAutoscaler[0],
      });
    } catch (error) {
      console.error("Error updating Kubernetes autoscaler:", error);
      return res.status(500).json({ message: "Failed to update Kubernetes autoscaler" });
    }
  }

  // Handle DELETE request to delete an autoscaler
  if (req.method === "DELETE") {
    try {
      // Get the autoscaler with cluster info
      const autoscaler = await db
        .select({
          autoscaler: kubernetes_autoscalers,
          cluster: kubernetes_clusters,
        })
        .from(kubernetes_autoscalers)
        .innerJoin(
          kubernetes_clusters,
          eq(kubernetes_autoscalers.clusterId, kubernetes_clusters.id)
        )
        .where(
          and(
            eq(kubernetes_autoscalers.id, autoscalerId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .limit(1);

      if (autoscaler.length === 0) {
        return res.status(404).json({ message: "Kubernetes autoscaler not found" });
      }

      // Delete the autoscaler from Kubernetes
      const clusterConfig = {
        id: autoscaler[0].cluster.id,
        name: autoscaler[0].cluster.name,
        kubeconfig: autoscaler[0].cluster.kubeconfig || undefined,
        context: autoscaler[0].cluster.context || undefined,
        server: autoscaler[0].cluster.server || undefined,
        certificateAuthority: autoscaler[0].cluster.certificateAuthority || undefined,
        token: autoscaler[0].cluster.token || undefined,
        insecureSkipTlsVerify: autoscaler[0].cluster.insecureSkipTlsVerify || false,
      };

      await deleteHorizontalPodAutoscaler(
        clusterConfig,
        autoscaler[0].autoscaler.namespace,
        autoscaler[0].autoscaler.name
      );

      // Delete the autoscaler from the database
      await db
        .delete(kubernetes_autoscalers)
        .where(eq(kubernetes_autoscalers.id, autoscalerId));

      return res.status(200).json({
        message: "Kubernetes autoscaler deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting Kubernetes autoscaler:", error);
      return res.status(500).json({ message: "Failed to delete Kubernetes autoscaler" });
    }
  }

  // Return 405 for unsupported methods
  return res.status(405).json({ message: "Method not allowed" });
} 