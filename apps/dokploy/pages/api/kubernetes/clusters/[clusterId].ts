import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { db } from "@/lib/db";
import { kubernetes_clusters } from "@/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

// Schema for validating cluster updates
const updateClusterSchema = z.object({
  name: z.string().min(1, "Cluster name is required").optional(),
  kubeconfig: z.string().optional(),
  context: z.string().optional(),
  server: z.string().optional(),
  token: z.string().optional(),
  certificateAuthority: z.string().optional(),
  insecureSkipTlsVerify: z.boolean().optional(),
  status: z.enum(["connected", "disconnected", "error"]).optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { clusterId } = req.query;

  if (!clusterId || typeof clusterId !== "string") {
    return res.status(400).json({ message: "Invalid cluster ID" });
  }

  // Handle GET request to fetch a specific cluster
  if (req.method === "GET") {
    try {
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

      return res.status(200).json({ cluster: cluster[0] });
    } catch (error) {
      console.error("Error fetching Kubernetes cluster:", error);
      return res.status(500).json({ message: "Failed to fetch Kubernetes cluster" });
    }
  }

  // Handle PUT request to update a cluster
  if (req.method === "PUT") {
    try {
      const validationResult = updateClusterSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          message: "Invalid request data",
          errors: validationResult.error.errors,
        });
      }

      const data = validationResult.data;
      const now = new Date();

      // Check if the cluster exists and belongs to the user
      const existingCluster = await db
        .select()
        .from(kubernetes_clusters)
        .where(
          and(
            eq(kubernetes_clusters.id, clusterId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .limit(1);

      if (existingCluster.length === 0) {
        return res.status(404).json({ message: "Kubernetes cluster not found" });
      }

      // Update the cluster
      const updatedCluster = await db
        .update(kubernetes_clusters)
        .set({
          ...data,
          updatedAt: now,
        })
        .where(
          and(
            eq(kubernetes_clusters.id, clusterId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .returning();

      return res.status(200).json({
        message: "Kubernetes cluster updated successfully",
        cluster: updatedCluster[0],
      });
    } catch (error) {
      console.error("Error updating Kubernetes cluster:", error);
      return res.status(500).json({ message: "Failed to update Kubernetes cluster" });
    }
  }

  // Handle DELETE request to delete a cluster
  if (req.method === "DELETE") {
    try {
      // Check if the cluster exists and belongs to the user
      const existingCluster = await db
        .select()
        .from(kubernetes_clusters)
        .where(
          and(
            eq(kubernetes_clusters.id, clusterId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        )
        .limit(1);

      if (existingCluster.length === 0) {
        return res.status(404).json({ message: "Kubernetes cluster not found" });
      }

      // Delete the cluster
      await db
        .delete(kubernetes_clusters)
        .where(
          and(
            eq(kubernetes_clusters.id, clusterId),
            eq(kubernetes_clusters.userId, session.user.id)
          )
        );

      return res.status(200).json({
        message: "Kubernetes cluster deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting Kubernetes cluster:", error);
      return res.status(500).json({ message: "Failed to delete Kubernetes cluster" });
    }
  }

  // Return 405 for unsupported methods
  return res.status(405).json({ message: "Method not allowed" });
} 