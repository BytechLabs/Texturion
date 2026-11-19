"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/provider";
import { useContacts } from "@/lib/api/contacts";
import { useConversations } from "@/lib/api/conversations";
import { flattenPages } from "@/lib/api/pagination";
import type { Contact } from "@/lib/api/types";

export function useCustomerConversation(contact: Contact | null) {
  const conversations = useConversations({ q: contact?.phone_e164 }, { enabled: contact !== null });
  const thread = flattenPages(conversations.data).find((row) => row.contact_id === contact?.id && !row.is_spam);
  return { id: thread?.id, pending: contact !== null && conversations.isPending };
}

export function TaskCustomerField({ id, name, onSelect }: {
  id: string;
  name?: string | null;
  onSelect: (contact: Contact | null) => void;
}) {
  const t = useT();
  const [looking, setLooking] = useState(false);
  const [search, setSearch] = useState("");
  const contacts = useContacts(search, { enabled: looking });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t("tasks.customer")}</Label>
      <Button id={id} type="button" variant="outline" className="justify-start"
        aria-expanded={looking} onClick={() => setLooking(!looking)}>
        {name ?? t("tasks.chooseCustomer")}
      </Button>
      {looking && (
        <div className="rounded-md border border-border p-2">
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            aria-label={t("tasks.chooseCustomer")} placeholder={t("tasks.chooseCustomer")} />
          {flattenPages(contacts.data).slice(0, 8).map((contact) => (
            <Button key={contact.id} type="button" variant="ghost" className="w-full justify-start"
              onClick={() => { onSelect(contact); setLooking(false); setSearch(""); }}>
              {contact.name ?? contact.phone_e164}
            </Button>
          ))}
          {name && <Button type="button" variant="ghost" onClick={() => { onSelect(null); setLooking(false); }}>
            {t("tasks.removeCustomer")}
          </Button>}
        </div>
      )}
    </div>
  );
}
