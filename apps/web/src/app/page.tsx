import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">JobText</h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        A shared SMS inbox for small service businesses. One local number your
        whole crew can text from — reply, assign, tag, and close conversations
        together, without giving out anyone&apos;s personal cell.
      </p>
      <Button asChild size="lg">
        <Link href="/login">Log in</Link>
      </Button>
    </main>
  );
}
