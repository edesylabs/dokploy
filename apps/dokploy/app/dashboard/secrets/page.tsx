"use client";

import { SecretStoresList } from "@/components/dashboard/secrets/secret-stores-list";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";

export default function SecretsPage() {
  return (
    <DashboardShell>
      <DashboardHeader
        heading="Secret Stores"
        description="Connect to external secret stores to manage your application secrets."
      />
      <div className="space-y-4">
        <SecretStoresList />
      </div>
    </DashboardShell>
  );
} 