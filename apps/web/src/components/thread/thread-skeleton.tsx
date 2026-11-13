import { Skeleton } from "@/components/ui/skeleton";

/** The whole thread screen before anything about the conversation is known. */
export function ThreadSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <ThreadBodySkeleton />
    </div>
  );
}

/** The message area and a composer-height bar, below a header. */
export function ThreadBodySkeleton() {
  return (
    <>
      <div className="flex-1 space-y-4 px-6 py-4" aria-hidden>
        <div className="flex justify-start">
          <Skeleton className="h-14 w-3/5 rounded-[10px]" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-10 w-2/5 rounded-[10px]" />
        </div>
      </div>
      <div className="border-t border-border p-3">
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </>
  );
}
