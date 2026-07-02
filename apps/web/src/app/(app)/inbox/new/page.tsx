import { Suspense } from "react";

import { NewConversation } from "@/components/inbox/new-conversation";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * /inbox/new — outbound-first compose (G5). Mobile: full-screen push (the
 * FAB routes here); desktop: replaces the thread pane beside the list.
 */
export default function NewConversationPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-xl space-y-4 p-6" aria-busy>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-9 w-32" />
        </div>
      }
    >
      <NewConversation />
    </Suspense>
  );
}
