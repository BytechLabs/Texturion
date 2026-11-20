export interface ExportTable {
  table: string;
  columns: string;
  liveOnly?: boolean;
  parent?: string;
  key?: readonly [string, string];
}

export const EXPORT_TABLES: readonly ExportTable[] = [
  {
    table: "contacts",
    columns:
      "id,phone_e164,name,email,business_name,address,notes,custom_fields," +
      "locale,timezone,consent_source,consent_at,created_at,updated_at",
    liveOnly: true,
  },
  {
    table: "contact_phones",
    columns: "id,contact_id,phone_e164,label,created_at",
    parent: "contacts",
  },
  {
    table: "contact_addresses",
    columns: "id,contact_id,address,label,is_primary,created_at,updated_at",
    parent: "contacts",
  },
  {
    table: "contact_tags",
    columns: "contact_id,tag_id,created_at",
    parent: "contacts",
    key: ["contact_id", "tag_id"],
  },
  {
    table: "contact_field_defs",
    columns: "id,key,kind,label,options,position,updated_at",
  },
  {
    table: "conversations",
    columns:
      "id,contact_id,phone_number_id,assigned_user_id,status,is_spam,last_message_at,closed_at,created_at",
    liveOnly: true,
  },
  {
    table: "messages",
    columns:
      "id,conversation_id,direction,body,status,sent_by_user_id,done_at,created_at,source," +
      "reaction_emoji,reaction_to_message_id,reaction_removed",
    liveOnly: true,
    parent: "conversations",
  },
  {
    table: "scheduled_messages",
    columns: "id,conversation_id,task_id,body,send_at,status,created_by,origin,created_at",
    parent: "conversations",
  },
  {
    table: "tasks",
    columns:
      "id,number,contact_id,conversation_id,message_id,source_call_id,title,description," +
      "assigned_user_id,created_by_user_id,priority,due_at,done_at,done_by_user_id," +
      "confirmed_at,confirmed_by,series_id,occurrence_no,occurrence_on,reminders_off," +
      "addr_street,addr_unit,addr_city,addr_state,addr_postal_code,addr_country," +
      "creation_origin,created_at,updated_at,due_on,dispatch_estimate,dispatch_windows",
    liveOnly: true,
  },
  {
    table: "task_schedule_blocks",
    columns: "id,task_id,assignee_id,starts_at,ends_at,locked",
    parent: "tasks",
  },
  {
    table: "task_assignees",
    columns: "task_id,user_id,added_by,added_at",
    parent: "tasks",
    key: ["task_id", "user_id"],
  },
  {
    table: "task_comments",
    columns: "id,task_id,author_user_id,body,created_at,edited_at",
    liveOnly: true,
    parent: "tasks",
  },
  {
    table: "task_series",
    columns:
      "id,contact_id,conversation_id,title,description,assigned_user_id,assignee_ids,priority," +
      "addr_street,addr_unit,addr_city,addr_state,addr_postal_code,addr_country," +
      "kind,every,unit,weekdays,month_day,nth,nth_weekday,anchor_on,due_time,time_zone," +
      "ends_kind,ends_after,ends_on,paused,stopped_at,created_at,updated_at",
  },
  {
    table: "calls",
    columns:
      "id,contact_id,conversation_id,caller_e164,caller_name,direction,outcome," +
      "answered_by_user_id,voicemail_seconds,voicemail_transcript,voicemail_deleted_at,started_at,ended_at",
    liveOnly: true,
  },
  {
    table: "quotes",
    columns:
      "id,contact_id,conversation_id,message_id,created_by,amount_cents,currency,description," +
      "status,created_at,sent_at,viewed_at,decided_at,expires_at",
  },
  {
    table: "payment_requests",
    columns:
      "id,contact_id,conversation_id,message_id,created_by,amount_cents,currency,description," +
      "status,amount_received_cents,amount_refunded_cents,created_at,paid_at,refunded_at,cancelled_at," +
      "disputed_at,expires_at",
  },
  {
    table: "job_ratings",
    columns:
      "id,contact_id,conversation_id,task_id,rated_user_id,score,asked_at,answered_at,created_at",
  },
  {
    table: "company_members",
    columns: "id,user_id,role,created_at,deactivated_at",
  },
  {
    table: "templates",
    columns: "id,name,body,created_at,updated_at,deleted_at",
  },
  { table: "tags", columns: "id,name,color,created_at" },
  {
    table: "opt_outs",
    columns: "id,phone_e164,source,created_at,revoked_at",
  },
  {
    table: "attachments",
    columns:
      "id,conversation_id,owner_type,owner_id,file_name,content_type,size_bytes,storage_path,created_at",
    liveOnly: true,
    parent: "conversations",
  },
  {
    table: "message_attachments",
    columns: "id,message_id,content_type,size_bytes,storage_path,created_at",
    parent: "messages",
  },
];
