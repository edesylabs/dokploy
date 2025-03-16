import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { kubernetes_clusters } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

// Schema for validating cluster creation
const createClusterSchema = z.object({
  name: z.string().min(1, "Cluster name is required"),
  kubeconfig: z.string().optional(),
  context: z.string().optional(),
  server: z.string().optional(),
  token: z.string().optional(),
  certificateAuthority: z.string().optional(),
  insecureSkipTlsVerify: z.boolean().optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Handle GET request to list clusters
  if (req.method === "GET") {
    try {
      const clusters = await db.select().from(kubernetes_clusters).where(
        eq(kubernetes_clusters.userId, session.user.id)
      );

      return res.status(200).json({ clusters });
    } catch (error) {
      console.error("Error fetching Kubernetes clusters:", error);
      return res.status(500).json({ message: "Failed to fetch Kubernetes clusters" });
    }
  }

  // Handle POST request to create a new cluster
  if (req.method === "POST") {
    try {
      const validationResult = createClusterSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          message: "Invalid request data",
          errors: validationResult.error.errors,
        });
      }

      const data = validationResult.data;

      // Ensure either kubeconfig or server is provided
      if (!data.kubeconfig && !data.server) {
        return res.status(400).json({
          message: "Either kubeconfig or server URL must be provided",
        });
      }

      // Create the cluster
      const clusterId = nanoid();
      const now = new Date();

      const cluster = await db
        .insert(kubernetes_clusters)
        .values({
          id: clusterId,
          name: data.name,
          userId: session.user.id,
          kubeconfig: data.kubeconfig || null,
          context: data.context || null,
          server: data.server || null,
          token: data.token || null,
          certificateAuthority: data.certificateAuthority || null,
          insecureSkipTlsVerify: data.insecureSkipTlsVerify || false,
          status: "connected", // Default status
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return res.status(201).json({
        message: "Kubernetes cluster created successfully",
        cluster: cluster[0],
      });
    } catch (error) {
      console.error("Error creating Kubernetes cluster:", error);
      return res.status(500).json({ message: "Failed to create Kubernetes cluster" });
    }
  }

  // Return 405 for unsupported methods
  return res.status(405).json({ message: "Method not allowed" });
} 