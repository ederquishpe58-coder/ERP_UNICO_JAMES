-- Installed legacy generator captured in the acceptance review. Fixture only.
-- The function body is unchanged; local table scaffolding is in the test runner.
CREATE OR REPLACE FUNCTION public.generate_sri_accounting_entry(p_document_id uuid, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_document public.electronic_documents%rowtype;
  v_link public.accounting_document_links%rowtype;
  v_rule public.accounting_generation_rules%rowtype;
  v_entry public.journal_entries%rowtype;
  v_net numeric(18, 6);
  v_sale_type text;
  v_country_code text;
  v_sales_channel text;
  v_lines jsonb;
begin
  select *
  into v_document
  from public.electronic_documents
  where id = p_document_id
  for update;

  if not found
     or v_document.status <> 'AUTORIZADO'
     or v_document.document_type not in ('01', '04') then
    raise exception using errcode = '23514', message = 'SRI_ACCOUNTING_REQUIRES_AUTHORIZED_FINANCIAL_DOCUMENT';
  end if;

  select *
  into v_link
  from public.accounting_document_links
  where document_id = p_document_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SRI_ACCOUNTING_LINK_NOT_FOUND';
  end if;
  if v_link.status = 'POSTED' and v_link.journal_entry_id is not null then
    select *
    into v_entry
    from public.journal_entries
    where id = v_link.journal_entry_id;

    select coalesce(jsonb_agg(to_jsonb(entry_line) order by entry_line.line_number), '[]'::jsonb)
    into v_lines
    from public.journal_entry_lines entry_line
    where entry_line.journal_entry_id = v_entry.id;

    return to_jsonb(v_entry) || jsonb_build_object('journal_entry_lines', v_lines);
  end if;

  v_sale_type := upper(coalesce(
    v_document.source_snapshot #>> '{invoice,commerceType}',
    v_document.source_snapshot ->> 'saleType',
    ''
  ));
  v_country_code := upper(coalesce(
    v_document.source_snapshot #>> '{invoice,destinationCountryCode}',
    v_document.source_snapshot #>> '{buyer,countryCode}',
    ''
  ));
  v_sales_channel := upper(coalesce(
    v_document.source_snapshot #>> '{invoice,salesChannel}',
    v_document.source_snapshot ->> 'salesChannel',
    ''
  ));

  select rule.*
  into v_rule
  from public.accounting_generation_rules rule
  where rule.company_id = v_document.company_id
    and rule.document_type = v_document.document_type
    and rule.active
    and (rule.effective_from is null or rule.effective_from <= v_document.issue_date)
    and (rule.effective_until is null or rule.effective_until >= v_document.issue_date)
    and (rule.customer_id is null or rule.customer_id = v_document.customer_id)
    and (rule.currency is null or upper(rule.currency) = upper(v_document.currency))
    and (rule.sale_type is null or upper(rule.sale_type) = v_sale_type)
    and (rule.country_code is null or upper(rule.country_code) = v_country_code)
    and (rule.sales_channel is null or upper(rule.sales_channel) = v_sales_channel)
    and (
      rule.product_id is null
      or exists (
        select 1
        from public.electronic_document_lines document_line
        where document_line.document_id = v_document.id
          and document_line.product_id = rule.product_id
      )
    )
    and (
      rule.product_category is null
      or exists (
        select 1
        from public.electronic_document_lines document_line
        where document_line.document_id = v_document.id
          and upper(coalesce(document_line.additional_details ->> 'productCategory', ''))
            = upper(rule.product_category)
      )
    )
    and (
      rule.tax_code is null
      or exists (
        select 1
        from public.electronic_document_taxes document_tax
        where document_tax.document_id = v_document.id
          and document_tax.tax_code = rule.tax_code
      )
    )
  order by
    rule.priority asc,
    (
      (rule.customer_id is not null)::integer
      + (rule.product_id is not null)::integer
      + (rule.product_category is not null)::integer
      + (rule.tax_code is not null)::integer
      + (rule.currency is not null)::integer
      + (rule.sale_type is not null)::integer
      + (rule.country_code is not null)::integer
      + (rule.sales_channel is not null)::integer
    ) desc,
    rule.created_at asc
  limit 1;

  if not found then
    raise exception using errcode = '23514', message = 'SRI_ACCOUNTING_RULE_NOT_FOUND';
  end if;
  if v_document.grand_total <= 0 then
    raise exception using errcode = '23514', message = 'SRI_ACCOUNTING_TOTAL_MUST_BE_POSITIVE';
  end if;
  if v_document.tax_total > 0 and v_rule.tax_account_code is null then
    raise exception using errcode = '23514', message = 'SRI_TAX_ACCOUNT_REQUIRED';
  end if;

  v_net := v_document.subtotal - v_document.discount_total;
  if v_net < 0 or v_net + v_document.tax_total <> v_document.grand_total then
    raise exception using errcode = '23514', message = 'SRI_ACCOUNTING_TOTALS_DO_NOT_BALANCE';
  end if;

  insert into public.journal_entries (
    company_id,
    entry_number,
    entry_date,
    description,
    status,
    source_type,
    source_document_id,
    currency,
    total_debit,
    total_credit,
    created_by,
    posted_by
  )
  values (
    v_document.company_id,
    'SRI-' || v_document.document_type || '-' || v_document.full_number,
    v_document.issue_date,
    case
      when v_document.document_type = '01' then 'Factura SRI ' || v_document.full_number
      else 'Nota de credito SRI ' || v_document.full_number
    end,
    'POSTED',
    'SRI',
    v_document.id,
    v_document.currency,
    v_document.grand_total,
    v_document.grand_total,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (source_document_id) do update
    set source_document_id = excluded.source_document_id
  returning * into v_entry;

  if not exists (
    select 1
    from public.journal_entry_lines existing_line
    where existing_line.journal_entry_id = v_entry.id
  ) then
    if v_document.document_type = '01' then
      insert into public.journal_entry_lines (
        company_id, journal_entry_id, line_number, account_code,
        description, debit, credit, customer_id, cost_center_id
      )
      values (
        v_document.company_id, v_entry.id, 1, v_rule.debit_account_code,
        'Cuenta por cobrar ' || v_document.full_number,
        v_document.grand_total, 0, v_document.customer_id, v_rule.cost_center_id
      );

      if v_net > 0 then
        insert into public.journal_entry_lines (
          company_id, journal_entry_id, line_number, account_code,
          description, debit, credit, customer_id, cost_center_id
        )
        values (
          v_document.company_id, v_entry.id, 2, v_rule.credit_account_code,
          'Ingreso factura ' || v_document.full_number,
          0, v_net, v_document.customer_id, v_rule.cost_center_id
        );
      end if;

      if v_document.tax_total > 0 then
        insert into public.journal_entry_lines (
          company_id, journal_entry_id, line_number, account_code,
          description, debit, credit, customer_id, cost_center_id
        )
        values (
          v_document.company_id, v_entry.id, 3, v_rule.tax_account_code,
          'Impuesto factura ' || v_document.full_number,
          0, v_document.tax_total, v_document.customer_id, v_rule.cost_center_id
        );
      end if;
    else
      if v_net > 0 then
        insert into public.journal_entry_lines (
          company_id, journal_entry_id, line_number, account_code,
          description, debit, credit, customer_id, cost_center_id
        )
        values (
          v_document.company_id, v_entry.id, 1, v_rule.credit_account_code,
          'Reversion ingreso ' || v_document.full_number,
          v_net, 0, v_document.customer_id, v_rule.cost_center_id
        );
      end if;

      if v_document.tax_total > 0 then
        insert into public.journal_entry_lines (
          company_id, journal_entry_id, line_number, account_code,
          description, debit, credit, customer_id, cost_center_id
        )
        values (
          v_document.company_id, v_entry.id, 2, v_rule.tax_account_code,
          'Reversion impuesto ' || v_document.full_number,
          v_document.tax_total, 0, v_document.customer_id, v_rule.cost_center_id
        );
      end if;

      insert into public.journal_entry_lines (
        company_id, journal_entry_id, line_number, account_code,
        description, debit, credit, customer_id, cost_center_id
      )
      values (
        v_document.company_id, v_entry.id, 3, v_rule.debit_account_code,
        'Disminucion cuenta por cobrar ' || v_document.full_number,
        0, v_document.grand_total, v_document.customer_id, v_rule.cost_center_id
      );
    end if;
  end if;

  update public.accounting_document_links
  set
    status = 'POSTED',
    journal_entry_id = v_entry.id,
    error_message = null
  where id = v_link.id;

  insert into public.electronic_document_audit_logs (
    company_id,
    document_id,
    actor_user_id,
    actor_type,
    action,
    old_status,
    new_status,
    reason,
    new_values
  )
  values (
    v_document.company_id,
    v_document.id,
    p_actor_user_id,
    case when p_actor_user_id is null then 'SYSTEM' else 'USER' end,
    'ACCOUNTING_ENTRY_POSTED',
    v_document.status,
    v_document.status,
    'Asiento contable generado desde documento SRI autorizado',
    jsonb_build_object(
      'journal_entry_id', v_entry.id,
      'entry_number', v_entry.entry_number
    )
  );

  select coalesce(jsonb_agg(to_jsonb(entry_line) order by entry_line.line_number), '[]'::jsonb)
  into v_lines
  from public.journal_entry_lines entry_line
  where entry_line.journal_entry_id = v_entry.id;

  return to_jsonb(v_entry) || jsonb_build_object('journal_entry_lines', v_lines);
end;
$function$
