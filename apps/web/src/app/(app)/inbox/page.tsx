import { MessagesSquare } from "lucide-react";

/**
 * /inbox with no thread selected. Mobile shows the list (the layout hides
 * this pane); tablet/desktop shows a quiet placeholder in the thread region.
 */
export default function InboxIndexPage() {
  return (
    <div className="hidden h-full items-center justify-center md:flex">
      <div className="flex flex-col items-center gap-3 text-center">
        <MessagesSquare
          className="size-8 text-muted-foreground/50"
          strokeWidth={1.75}
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          Select a conversation to read it here.
        </p>
      </div>
    </div>
  );
}
