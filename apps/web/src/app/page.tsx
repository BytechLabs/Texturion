import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/shell/wordmark";

export default function Home() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <Wordmark href="/" className="text-4xl" />
      <p className="max-w-xl text-lg text-muted-foreground">
        A shared SMS inbox for small service businesses. One local number your
        whole crew can text from — reply, assign, tag, and close conversations
        together, without giving out anyone&apos;s personal cell.
      </p>
      <div className="flex items-center gap-3">
        <Button asChild size="lg">
          <Link href="/signup">Get your number</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/login">Log in</Link>
        </Button>
      </div>
    </main>
  );
}
