import { AppShell } from "@/components/shell/app-shell";
import { CompanyProvider } from "@/lib/company/provider";
import { RealtimeProvider } from "@/lib/realtime/provider";

/**
 * The signed-in application: company context (X-Company-Id source), one
 * realtime channel per company, and the G3 responsive shell. Middleware
 * guarantees a session before anything here renders.
 *
 * Feature tracks mount their pages inside this group (/inbox, /contacts,
 * /templates, /settings) — no page stubs live here by design.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <CompanyProvider>
      <RealtimeProvider>
        <AppShell>{children}</AppShell>
      </RealtimeProvider>
    </CompanyProvider>
  );
}
