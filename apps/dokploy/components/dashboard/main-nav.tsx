import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Icons } from "@/components/icons";

export function MainNav({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const pathname = usePathname();

  return (
    <nav
      className={cn("flex items-center space-x-4 lg:space-x-6", className)}
      {...props}
    >
      <Link
        href="/dashboard"
        className={cn(
          buttonVariants({ variant: "ghost" }),
          pathname === "/dashboard"
            ? "bg-muted hover:bg-muted"
            : "hover:bg-transparent hover:underline",
          "justify-start"
        )}
      >
        <Icons.dashboard className="mr-2 h-4 w-4" />
        Dashboard
      </Link>
      <Link
        href="/dashboard/servers"
        className={cn(
          buttonVariants({ variant: "ghost" }),
          pathname === "/dashboard/servers" || pathname.startsWith("/dashboard/servers/")
            ? "bg-muted hover:bg-muted"
            : "hover:bg-transparent hover:underline",
          "justify-start"
        )}
      >
        <Icons.server className="mr-2 h-4 w-4" />
        Servers
      </Link>
      <Link
        href="/dashboard/kubernetes"
        className={cn(
          buttonVariants({ variant: "ghost" }),
          pathname === "/dashboard/kubernetes" || pathname.startsWith("/dashboard/kubernetes/")
            ? "bg-muted hover:bg-muted"
            : "hover:bg-transparent hover:underline",
          "justify-start"
        )}
      >
        <Icons.kubernetes className="mr-2 h-4 w-4" />
        Kubernetes
      </Link>
      <Link
        href="/dashboard/secrets"
        className={cn(
          buttonVariants({ variant: "ghost" }),
          pathname === "/dashboard/secrets" || pathname.startsWith("/dashboard/secrets/")
            ? "bg-muted hover:bg-muted"
            : "hover:bg-transparent hover:underline",
          "justify-start"
        )}
      >
        <Icons.key className="mr-2 h-4 w-4" />
        Secrets
      </Link>
      <Link
        href="/dashboard/settings"
        className={cn(
          buttonVariants({ variant: "ghost" }),
          pathname === "/dashboard/settings"
            ? "bg-muted hover:bg-muted"
            : "hover:bg-transparent hover:underline",
          "justify-start"
        )}
      >
        <Icons.settings className="mr-2 h-4 w-4" />
        Settings
      </Link>
    </nav>
  );
} 