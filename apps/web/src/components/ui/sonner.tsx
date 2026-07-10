"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      // #123: on a phone the bottom tab bar (fixed, 56px + safe-area) owns the
      // bottom edge, so a bottom toast landed ON TOP of it. Lift toasts clear
      // of the bar on mobile; the desktop offset is the sonner default. (The
      // desktop shell has no bottom bar.)
      mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 4.75rem)", left: "1rem", right: "1rem" }}
      toastOptions={{
        classNames: {
          // A calmer card: the app's own elevated shadow + rounded-app-card,
          // instead of sonner's flat default that read as "ugly".
          toast:
            "group-[.toaster]:rounded-app-card group-[.toaster]:border-app-line group-[.toaster]:shadow-lg",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-app-card)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
