import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { db } from "@/lib/db";
import { kubernetes_vertical_autoscalers, kubernetes_clusters, kubernetes_deployments } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { 
  deleteVerticalPodAutoscaler, 
  updateVerticalPodAutoscaler 
} from "@dokploy/server/services/kubernetes";

// Schema for validating vertical autoscaler updates
const updateVerticalAutoscalerSchema = z.object({
  updateMode: z.enum(["Off", "Initial", "Auto", "Recreate"]).optional(),
  minAllowedCpu: z.string().optional(),
  minAllowedMemory: z.string().optional(),
  maxAllowedCpu: z.string().optional(),
  maxAllowedMemory: z.string().optional(),
  controlledResources: z.array(z.string()).optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { verticalAutoscalerId } = req.query;

  if (!verticalAutoscalerId || typeof verticalAutoscalerId !== "string") {
    return res.status(400).json({ message: "Invalid vertical autoscaler ID" });
  }

  // Handle GET request to fetch a specific vertical autoscaler
  if (req.method === "GET") {
    try {
      // Join vertical autoscaler with cluster and deployment to get all necessary data
      const verticalAutoscaler = await db
        .select({
          verticalAutoscaler: kubernetes_vertical_autoscalers,
          cluster: kubernetes_clusters,
          deployment: kubernetes_deployments,
        })
        .from(kubernetes_vertical_autoscalers)
        .innerJoin(
          kubernetes_clusters,
          eq(kubernetes_vertical_autoscalers.clusterId, kubernetes_clusters.id)
        )
        .innerJoin(
          kubernetes_deployments,
          eq(kubernetes_vertical_autoscalers.deploymentId, kubernetes_deployments.id)
        )
        .where(
          and(
            eq(kubernetes_vertical_autoscalers.id, verticalAutoscalerId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .limit(1);

      if (verticalAutoscaler.length === 0) {
        return res.status(404).json({ message: "Kubernetes vertical autoscaler not found" });
      }

      return res.status(200).json({ verticalAutoscaler: verticalAutoscaler[0] });
    } catch (error) {
      console.error("Error fetching Kubernetes vertical autoscaler:", error);
      return res.status(500).json({ message: "Failed to fetch Kubernetes vertical autoscaler" });
    }
  }

  // Handle PUT request to update a vertical autoscaler
  if (req.method === "PUT") {
    try {
      const validationResult = updateVerticalAutoscalerSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          message: "Invalid request data",
          errors: validationResult.error.errors,
        });
      }

      const data = validationResult.data;
      const now = new Date();

      // Get the vertical autoscaler with cluster and deployment info
      const verticalAutoscaler = await db
        .select({
          verticalAutoscaler: kubernetes_vertical_autoscalers,
          cluster: kubernetes_clusters,
          deployment: kubernetes_deployments,
        })
        .from(kubernetes_vertical_autoscalers)
        .innerJoin(
          kubernetes_clusters,
          eq(kubernetes_vertical_autoscalers.clusterId, kubernetes_clusters.id)
        )
        .innerJoin(
          kubernetes_deployments,
          eq(kubernetes_vertical_autoscalers.deploymentId, kubernetes_deployments.id)
        )
        .where(
          and(
            eq(kubernetes_vertical_autoscalers.id, verticalAutoscalerId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .limit(1);

      if (verticalAutoscaler.length === 0) {
        return res.status(404).json({ message: "Kubernetes vertical autoscaler not found" });
      }

      // Update the vertical autoscaler in Kubernetes
      const clusterConfig = {
        id: verticalAutoscaler[0].cluster.id,
        name: verticalAutoscaler[0].cluster.name,
        kubeconfig: verticalAutoscaler[0].cluster.kubeconfig || undefined,
        context: verticalAutoscaler[0].cluster.context || undefined,
        server: verticalAutoscaler[0].cluster.server || undefined,
        certificateAuthority: verticalAutoscaler[0].cluster.certificateAuthority || undefined,
        token: verticalAutoscaler[0].cluster.token || undefined,
        insecureSkipTlsVerify: verticalAutoscaler[0].cluster.insecureSkipTlsVerify || false,
      };

      const vpaConfig = {
        name: verticalAutoscaler[0].verticalAutoscaler.name,
        namespace: verticalAutoscaler[0].verticalAutoscaler.namespace,
        deploymentName: verticalAutoscaler[0].deployment.name,
        updateMode: data.updateMode || verticalAutoscaler[0].verticalAutoscaler.updateMode as 'Off' | 'Initial' | 'Auto' | 'Recreate',
        minAllowed: {
          cpu: data.minAllowedCpu || verticalAutoscaler[0].verticalAutoscaler.minAllowedCpu || undefined,
          memory: data.minAllowedMemory || verticalAutoscaler[0].verticalAutoscaler.minAllowedMemory || undefined,
        },
        maxAllowed: {
          cpu: data.maxAllowedCpu || verticalAutoscaler[0].verticalAutoscaler.maxAllowedCpu || undefined,
          memory: data.maxAllowedMemory || verticalAutoscaler[0].verticalAutoscaler.maxAllowedMemory || undefined,
        },
        controlledResources: data.controlledResources || verticalAutoscaler[0].verticalAutoscaler.controlledResources as string[],
      };

      await updateVerticalPodAutoscaler(clusterConfig, vpaConfig);

      // Update the vertical autoscaler in the database
      const updatedVerticalAutoscaler = await db
        .update(kubernetes_vertical_autoscalers)
        .set({
          updateMode: data.updateMode || verticalAutoscaler[0].verticalAutoscaler.updateMode,
          minAllowedCpu: data.minAllowedCpu || verticalAutoscaler[0].verticalAutoscaler.minAllowedCpu,
          minAllowedMemory: data.minAllowedMemory || verticalAutoscaler[0].verticalAutoscaler.minAllowedMemory,
          maxAllowedCpu: data.maxAllowedCpu || verticalAutoscaler[0].verticalAutoscaler.maxAllowedCpu,
          maxAllowedMemory: data.maxAllowedMemory || verticalAutoscaler[0].verticalAutoscaler.maxAllowedMemory,
          controlledResources: data.controlledResources || verticalAutoscaler[0].verticalAutoscaler.controlledResources,
          updatedAt: now,
        })
        .where(eq(kubernetes_vertical_autoscalers.id, verticalAutoscalerId))
        .returning();

      return res.status(200).json({
        message: "Kubernetes vertical autoscaler updated successfully",
        verticalAutoscaler: updatedVerticalAutoscaler[0],
      });
    } catch (error) {
      console.error("Error updating Kubernetes vertical autoscaler:", error);
      return res.status(500).json({ message: "Failed to update Kubernetes vertical autoscaler" });
    }
  }

  // Handle DELETE request to delete a vertical autoscaler
  if (req.method === "DELETE") {
    try {
      // Get the vertical autoscaler with cluster info
      const verticalAutoscaler = await db
        .select({
          verticalAutoscaler: kubernetes_vertical_autoscalers,
          cluster: kubernetes_clusters,
        })
        .from(kubernetes_vertical_autoscalers)
        .innerJoin(
          kubernetes_clusters,
          eq(kubernetes_vertical_autoscalers.clusterId, kubernetes_clusters.id)
        )
        .where(
          and(
            eq(kubernetes_vertical_autoscalers.id, verticalAutoscalerId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .limit(1);

      if (verticalAutoscaler.length === 0) {
        return res.status(404).json({ message: "Kubernetes vertical autoscaler not found" });
      }

      // Delete the vertical autoscaler from Kubernetes
      const clusterConfig = {
        id: verticalAutoscaler[0].cluster.id,
        name: verticalAutoscaler[0].cluster.name,
        kubeconfig: verticalAutoscaler[0].cluster.kubeconfig || undefined,
        context: verticalAutoscaler[0].cluster.context || undefined,
        server: verticalAutoscaler[0].cluster.server || undefined,
        certificateAuthority: verticalAutoscaler[0].cluster.certificateAuthority || undefined,
        token: verticalAutoscaler[0].cluster.token || undefined,
        insecureSkipTlsVerify: verticalAutoscaler[0].cluster.insecureSkipTlsVerify || false,
      };

      await deleteVerticalPodAutoscaler(
        clusterConfig,
        verticalAutoscaler[0].verticalAutoscaler.namespace,
        verticalAutoscaler[0].verticalAutoscaler.name
      );

      // Delete the vertical autoscaler from the database
      await db
        .delete(kubernetes_vertical_autoscalers)
        .where(eq(kubernetes_vertical_autoscalers.id, verticalAutoscalerId));

      return res.status(200).json({
        message: "Kubernetes vertical autoscaler deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting Kubernetes vertical autoscaler:", error);
      return res.status(500).json({ message: "Failed to delete Kubernetes vertical autoscaler" });
    }
  }

  // Return 405 for unsupported methods
  return res.status(405).json({ message: "Method not allowed" });
} 