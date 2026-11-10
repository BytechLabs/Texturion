/**
 * SQL that deletes test companies and every row that belongs to them.
 *
 * Each suite used to list the tables to clear by hand, so every new table with
 * a `company_id ... on delete restrict` broke every suite's cleanup until
 * somebody added it to each list (#714's record_activity did exactly that).
 * This reads the tables from the catalogue instead.
 *
 * Deletes repeat until a pass removes nothing: a row another table still
 * references fails with a foreign key error and goes on the next pass, and a
 * delete whose trigger writes an activity row gets that row cleared too. The
 * audit log refuses deletes, so its append-only trigger is off for the duration.
 */
export function deleteCompaniesSql(companyIds: readonly string[]): string {
  if (companyIds.length === 0) return "";
  const ids = companyIds.map((id) => `'${id}'::uuid`).join(",");
  return `
    begin;
    alter table public.audit_log disable trigger audit_log_append_only;
    do $cleanup$
    declare
      t text;
      removed bigint;
      total bigint;
      blocked boolean;
      pass int := 0;
      ids uuid[] := array[${ids}];
    begin
      loop
        pass := pass + 1;
        total := 0;
        blocked := false;
        for t in
          select c.table_name
            from information_schema.columns c
            join information_schema.tables tb
              on tb.table_schema = c.table_schema and tb.table_name = c.table_name
           where c.table_schema = 'public'
             and c.column_name = 'company_id'
             and tb.table_type = 'BASE TABLE'
             and c.table_name <> 'companies'
        loop
          begin
            execute format('delete from public.%I where company_id = any ($1)', t) using ids;
            get diagnostics removed = row_count;
            total := total + removed;
          exception when foreign_key_violation then
            blocked := true;
          end;
        end loop;
        exit when total = 0 and not blocked;
        -- Nothing moved but something is still referenced: a row with no
        -- company_id points at these companies' rows, and only the suite knows
        -- which, so it has to delete it first.
        if total = 0 or pass >= 25 then
          raise exception 'company cleanup is stuck after % passes', pass;
        end if;
      end loop;
    end
    $cleanup$;
    alter table public.audit_log enable trigger audit_log_append_only;
    delete from public.companies where id = any (array[${ids}]);
    commit;
  `;
}
