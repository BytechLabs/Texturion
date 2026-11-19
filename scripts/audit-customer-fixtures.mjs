import { createHash } from "node:crypto";

export const ONBOARDING_AUDIT_USER = {
  email: "onboarding-audit@loonext.local",
  displayName: "Onboarding Audit",
};

const CUSTOMERS = [
  {
    locale: "en",
    business: "Northbank Heating",
    area: "613",
    description: "Furnace inspection",
    accept: "Accept this quote",
    paid: "This has been paid",
    photos: "Photos from Northbank Heating",
  },
  {
    locale: "fr-CA",
    business: "Chauffage du Canal",
    area: "418",
    description: "Inspection de la fournaise",
    accept: "Accepter ce devis",
    paid: "Ce paiement a été effectué",
    photos: "Photos de Chauffage du Canal",
  },
];

const LINKS = [
  { path: "q", purpose: "quote_view", subject: "quote" },
  { path: "pay", purpose: "payment", subject: "payment_request" },
  { path: "photos", purpose: "photo_set", subject: "task" },
];

function token(locale, purpose) {
  return createHash("sha256").update(`loonext-local-audit/${locale}/${purpose}`).digest("base64url");
}

export const CUSTOMER_SURFACES = CUSTOMERS.flatMap((customer) => {
  const [quote, payment, photos] = LINKS.map(({ path, purpose }) => ({
    path: `/${path}/${token(customer.locale, purpose)}`,
    locale: customer.locale,
    localOnly: true,
    auth: false,
  }));
  return [
    { ...quote, label: `customer quote (${customer.locale})`, ready: `role=button[name="${customer.accept}"]` },
    { ...payment, label: `customer receipt (${customer.locale})`, ready: `role=heading[name="${customer.paid}"]` },
    { ...photos, label: `customer job photos (${customer.locale})`, ready: `role=heading[name="${customer.photos}"]` },
  ];
});

export function customerFixtureSql(ownerId) {
  return CUSTOMERS.map(({ locale, business, area, description }, index) => {
    const id = (record) => `fd${index}${record}0000-0000-4000-8000-000000000001`;
    const [company, number, contact, thread, message, task, quote, payment] =
      Array.from({ length: 8 }, (_, record) => id(record));
    const targets = [quote, payment, task];
    const tokenRows = LINKS.map(({ purpose, subject }, linkIndex) => {
      const hash = createHash("sha256").update(token(locale, purpose)).digest("hex");
      return `('${hash}', '${company}', '${purpose}', '${subject}', '${targets[linkIndex]}', now() + interval '3 days')`;
    }).join(",\n");
    return `
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at, plan, subscription_status, locale)
values ('${company}', '${business}', '${ownerId}', 'CA', '${area}', now(), 'pro', 'active', '${locale}')
on conflict (id) do nothing;
insert into public.phone_numbers
  (id, company_id, status, provisioning_key, requested_area_code, country, number_e164, source)
values ('${number}', '${company}', 'active', 'audit-number-${locale}', '${area}', 'CA',
  '+1${area}5560190', 'provisioned')
on conflict (id) do nothing;
insert into public.contacts (id, company_id, phone_e164)
values ('${contact}', '${company}', '+1${area}5560191')
on conflict (id) do nothing;
insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('${thread}', '${company}', '${contact}', '${number}', 'open')
on conflict (id) do nothing;
insert into public.messages (id, company_id, conversation_id, direction, body)
values ('${message}', '${company}', '${thread}', 'note', '${description}')
on conflict (id) do nothing;
insert into public.tasks (id, company_id, conversation_id, message_id, title, created_by_user_id)
values ('${task}', '${company}', '${thread}', '${message}', '${description}', '${ownerId}')
on conflict (id) do nothing;
insert into public.quotes
  (id, company_id, conversation_id, contact_id, amount_cents, currency, description, status, expires_at)
values ('${quote}', '${company}', '${thread}', '${contact}', 18000, 'cad', '${description}', 'sent',
  now() + interval '3 days')
on conflict (id) do update set expires_at = excluded.expires_at;
insert into public.payment_requests
  (id, company_id, conversation_id, contact_id, amount_cents, currency, description, status,
   stripe_account_id, paid_at, amount_received_cents, expires_at)
values ('${payment}', '${company}', '${thread}', '${contact}', 18000, 'cad', '${description}', 'paid',
  'acct_local_audit', now(), 18000, now() + interval '3 days')
on conflict (id) do nothing;
insert into public.public_links (token_hash, company_id, purpose, subject_type, subject_id, expires_at)
values ${tokenRows}
on conflict (token_hash) do update set expires_at = excluded.expires_at;
`;
  }).join("\n");
}
