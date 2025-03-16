import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { kubernetes_vertical_autoscalers, kubernetes_clusters, kubernetes_deployments } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createVerticalPodAutoscaler, getVerticalPodAutoscalers } from "@dokploy/server/services/kubernetes";

// Schema for validating vertical autoscaler creation
const createVerticalAutoscalerSchema = z.object({
  name: z.string().min(1, "Autoscaler name is required"),
  namespace: z.string().min(1, "Namespace is required"),
  clusterId: z.string().min(1, "Cluster ID is required"),
  deploymentId: z.string().min(1, "Deployment ID is required"),
  updateMode: z.enum(["Off", "Initial", "Auto", "Recreate"]).default("Auto"),
  minAllowedCpu: z.string().optional(),
  minAllowedMemory: z.string().optional(),
  maxAllowedCpu: z.string().optional(),
  maxAllowedMemory: z.string().optional(),
  controlledResources: z.array(z.string()).default(["cpu", "memory"]),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Handle GET request to list vertical autoscalers
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
        .from(kubernetes_vertical_autoscalers)
        .where(eq(kubernetes_vertical_autoscalers.clusterId, clusterId));

      if (namespace && typeof namespace === "string") {
        query = query.where(eq(kubernetes_vertical_autoscalers.namespace, namespace));
      }

      const verticalAutoscalers = await query;

      // Get real-time vertical autoscaler data from Kubernetes
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

      const k8sVerticalAutoscalers = await getVerticalPodAutoscalers(
        clusterConfig,
        namespace as string || "default"
      );

      // Merge database and Kubernetes data
      const mergedVerticalAutoscalers = verticalAutoscalers.map(dbAutoscaler => {
        const k8sAutoscaler = k8sVerticalAutoscalers.find(
          k8s => k8s.name === dbAutoscaler.name && k8s.namespace === dbAutoscaler.namespace
        );

        return {
          ...dbAutoscaler,
          recommendation: k8sAutoscaler?.recommendation || {},
          k8sStatus: k8sAutoscaler ? "active" : "not_found",
        };
      });

      return res.status(200).json({ verticalAutoscalers: mergedVerticalAutoscalers });
    } catch (error) {
      console.error("Error fetching Kubernetes vertical autoscalers:", error);
      return res.status(500).json({ message: "Failed to fetch Kubernetes vertical autoscalers" });
    }
  }

  // Handle POST request to create a new vertical autoscaler
  if (req.method === "POST") {
    try {
      const validationResult = createVerticalAutoscalerSchema.safeParse(req.body);

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

      // Create the vertical autoscaler in Kubernetes
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

      const vpaConfig = {
        name: data.name,
        namespace: data.namespace,
        deploymentName: deployment[0].name,
        updateMode: data.updateMode,
        minAllowed: {
          cpu: data.minAllowedCpu,
          memory: data.minAllowedMemory,
        },
        maxAllowed: {
          cpu: data.maxAllowedCpu,
          memory: data.maxAllowedMemory,
        },
        controlledResources: data.controlledResources,
      };

      await createVerticalPodAutoscaler(clusterConfig, vpaConfig);

      // Create the vertical autoscaler in the database
      const verticalAutoscalerId = nanoid();
      const now = new Date();

      const verticalAutoscaler = await db
        .insert(kubernetes_vertical_autoscalers)
        .values({
          id: verticalAutoscalerId,
          name: data.name,
          namespace: data.namespace,
          clusterId: data.clusterId,
          deploymentId: data.deploymentId,
          updateMode: data.updateMode,
          minAllowedCpu: data.minAllowedCpu || null,
          minAllowedMemory: data.minAllowedMemory || null,
          maxAllowedCpu: data.maxAllowedCpu || null,
          maxAllowedMemory: data.maxAllowedMemory || null,
          controlledResources: data.controlledResources,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return res.status(201).json({
        message: "Kubernetes vertical autoscaler created successfully",
        verticalAutoscaler: verticalAutoscaler[0],
      });
    } catch (error) {
      console.error("Error creating Kubernetes vertical autoscaler:", error);
      return res.status(500).json({ message: "Failed to create Kubernetes vertical autoscaler" });
    }
  }

  // Return 405 for unsupported methods
  return res.status(405).json({ message: "Method not allowed" });
} 