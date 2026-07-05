"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";

/**
 * Contact form, the honest option (BLUEPRINT §2): email is Loonext's only
 * support channel, so this composes a pre-filled message and opens your email
 * app via a mailto: link. We say so plainly under the button rather than pretend
 * a marketing backend exists. No data is sent anywhere by this page itself.
 */
export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  function buildMailto(): string {
    const subject = name ? `Loonext question from ${name}` : "Loonext question";
    const bodyLines = [
      message,
      "",
      ", ",
      name && `Name: ${name}`,
      email && `Reply-to: ${email}`,
    ].filter(Boolean);
    const params = new URLSearchParams({
      subject,
      body: bodyLines.join("\n"),
    });
    return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Open the user's email client with the message pre-filled.
    window.location.href = buildMailto();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="contact-name">Your name</Label>
        <Input
          id="contact-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-email">Your email</Label>
        <Input
          id="contact-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="so we can reply"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-message">How can we help?</Label>
        <Textarea
          id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          required
        />
      </div>
      <Button type="submit" size="lg" className="w-full sm:w-auto">
        Open in your email app
      </Button>
      <p className="text-sm text-muted-foreground">
        This opens your email app with the message ready to send to{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>
        . Prefer to write it yourself? That address works too.
      </p>
    </form>
  );
}
