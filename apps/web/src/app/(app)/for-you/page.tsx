import { Home } from "lucide-react";

import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = {
  title: "For You",
};

/**
 * /for-you — the member focus queue (D23, provisional; docs/HOME-AND-VIEWS.md).
 * Wired into the nav now for shell placement (APP-LAYOUT-V2 §1.3); the full
 * focus-queue surface lands in the later features wave. Placeholder keeps the
 * nav link live (zero dead links).
 */
export default function ForYouPage() {
  return (
    <ComingSoon
      icon={Home}
      title="For You"
      description="Your focus queue — the conversations and tasks assigned to you — is coming soon. For now, your shared inbox has everything."
    />
  );
}
