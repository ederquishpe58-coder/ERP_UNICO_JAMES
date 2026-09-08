begin;

-- Reviewed application conflicts only: 18 exact definitions, 25 explicit RAISEs.
-- Stale business expectations/receipts (22), missing canonical order ACK/context
-- (2), and warehouse selection unavailable after SKIP LOCKED (1). The latter
-- can be transient; keep its RETRY message and transaction rollback visible.
-- PostgREST 14.5 / hasql-transaction 1.1.0.1 retries 40001/40P01 indefinitely
-- inside one pooled session. PT409 returns HTTP409 and preserves message/detail.
-- Primary: github.com/nikita-volkov/hasql-transaction/blob/1.1.0.1/library/Hasql/Transaction/Private/Sessions.hs
-- Primary: github.com/PostgREST/postgrest/blob/v14.5/src/PostgREST/Error.hs
-- No change to native PostgreSQL serialization/deadlock handling, predicates,
-- permissions, idempotency, locks, accounting, inventory, SRI flags or sequences.
-- No historical migration is rewritten. No grants or business rows are changed.
-- Do not roll back by restoring 40001: that reinstates the pool-exhausting loop.
-- A corrective forward migration must retain a caller-visible nonretrying code.

do $migration$
declare
  reviewed constant jsonb := $reviewed$
[
  {
    "signature": "public.erp_admin_add_existing_user_membership(uuid,uuid,text,text,uuid,text)",
    "before_md5": "20b89d9a65c754abb5555c998d860175",
    "after_md5": "361a7565358eef1da4ac58c893b1e34c",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='SECURITY_MEMBERSHIP_STATE_CHANGED';",
        "new_raise": "raise exception using errcode='PT409',message='SECURITY_MEMBERSHIP_STATE_CHANGED';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_admin_configure_user_access_plan(uuid,uuid,text,jsonb,text,uuid,text)",
    "before_md5": "766ab0957db526887760363e2562fb03",
    "after_md5": "0c43c7e93866a0dff68bf88869e5ec92",
    "count": 2,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='SECURITY_ACCESS_PLAN_STALE';",
        "new_raise": "raise exception using errcode='PT409',message='SECURITY_ACCESS_PLAN_STALE';",
        "count": 2
      }
    ]
  },
  {
    "signature": "public.erp_operations_v2_write_record(uuid,uuid,text,text,text,jsonb,bigint)",
    "before_md5": "0102a27affd130aa27d0cfc590d65cab",
    "after_md5": "9415c4344cafde43da899601f8014b2a",
    "count": 2,
    "replacements": [
      {
        "old_raise": "raise exception using errcode = '40001',\n      message = format('OPERATIONS_V2_VERSION_CONFLICT:%s:%s:SERVER_%s:CLIENT_%s', p_entity, p_record_id, v_current.version, coalesce(p_base_version, 0));",
        "new_raise": "raise exception using errcode = 'PT409',\n      message = format('OPERATIONS_V2_VERSION_CONFLICT:%s:%s:SERVER_%s:CLIENT_%s', p_entity, p_record_id, v_current.version, coalesce(p_base_version, 0));",
        "count": 1
      },
      {
        "old_raise": "raise exception using errcode = '40001',\n      message = format('OPERATIONS_V2_RECORD_MISSING:%s:%s', p_entity, p_record_id);",
        "new_raise": "raise exception using errcode = 'PT409',\n      message = format('OPERATIONS_V2_RECORD_MISSING:%s:%s', p_entity, p_record_id);",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_payroll_core_v2_approve_role_u2c4_internal(uuid,uuid,text,uuid,bigint,timestamp with time zone)",
    "before_md5": "dfa21b831f64ae1c5bb017b768d81a19",
    "after_md5": "0a11c855b66da34cce69ffac2961d139",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='PAYROLL_V2_ROLE_VERSION_CONFLICT';",
        "new_raise": "raise exception using errcode='PT409',message='PAYROLL_V2_ROLE_VERSION_CONFLICT';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_payroll_core_v2_calculate_role_u2c4_internal(uuid,uuid,text,uuid,jsonb,bigint,timestamp with time zone)",
    "before_md5": "cec4cdc409010deabfa39023d3fd30ae",
    "after_md5": "c517085947bc7ddc98f36696b19c5702",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='PAYROLL_V2_ROLE_VERSION_CONFLICT';",
        "new_raise": "raise exception using errcode='PT409',message='PAYROLL_V2_ROLE_VERSION_CONFLICT';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_payroll_core_v2_post_role_u2c4_internal(uuid,uuid,text,uuid,bigint,date,timestamp with time zone)",
    "before_md5": "0f92d183eab32e3c70e356afd6f426df",
    "after_md5": "9003c2b0ea98a2eb5ae90450e7eb6955",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='PAYROLL_V2_ROLE_VERSION_CONFLICT';",
        "new_raise": "raise exception using errcode='PT409',message='PAYROLL_V2_ROLE_VERSION_CONFLICT';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_payroll_core_v2_replace_role_u2c4_internal(uuid,uuid,text,uuid,bigint,text,timestamp with time zone)",
    "before_md5": "b06b44948b2513b9cb41421fd887463e",
    "after_md5": "e4fd71faa3ba472d6e923dbe1861767c",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='PAYROLL_V2_ROLE_VERSION_CONFLICT';",
        "new_raise": "raise exception using errcode='PT409',message='PAYROLL_V2_ROLE_VERSION_CONFLICT';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_payroll_core_v2_upsert_employee_u2c4_internal(uuid,uuid,text,jsonb,bigint,timestamp with time zone)",
    "before_md5": "e35a6c60e051c2cb05f736f5cff870ba",
    "after_md5": "5cb2b1bfaf617d6bf6f7717bac5e2e23",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='PAYROLL_V2_EMPLOYEE_VERSION_CONFLICT';",
        "new_raise": "raise exception using errcode='PT409',message='PAYROLL_V2_EMPLOYEE_VERSION_CONFLICT';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_payroll_performance_v2_save_policy_u2c4_internal(uuid,uuid,text,jsonb,uuid,bigint,timestamp with time zone)",
    "before_md5": "7c1e6016715cb33c4e3d3b03102be827",
    "after_md5": "c365d9921cc556d9eb7209aeff313484",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='PAYROLL_V2_POLICY_VERSION_CONFLICT';",
        "new_raise": "raise exception using errcode='PT409',message='PAYROLL_V2_POLICY_VERSION_CONFLICT';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_save_commercial_order_quality_legacy(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,jsonb,bigint,timestamp with time zone)",
    "before_md5": "f486063fd63b4cecf2ee35a36adfa864",
    "after_md5": "89e227b4d82b032da259aa8574806f9e",
    "count": 2,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='COMMERCIAL_ORDER_SERVER_CONFIRMATION_REQUIRED';",
        "new_raise": "raise exception using errcode='PT409',message='COMMERCIAL_ORDER_SERVER_CONFIRMATION_REQUIRED';",
        "count": 2
      }
    ]
  },
  {
    "signature": "public.erp_security_apply_approved_james_sequences_20260907(jsonb)",
    "before_md5": "ef5cb63083106eef7576944086524a17",
    "after_md5": "416a56f1f53af7ce644c8724266cf1a5",
    "count": 5,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='APPROVED_ACCESS_RECEIPT_INCOMPLETE';",
        "new_raise": "raise exception using errcode='PT409',message='APPROVED_ACCESS_RECEIPT_INCOMPLETE';",
        "count": 1
      },
      {
        "old_raise": "raise exception using errcode='40001',message='APPROVED_TARGET_STATE_CHANGED';",
        "new_raise": "raise exception using errcode='PT409',message='APPROVED_TARGET_STATE_CHANGED';",
        "count": 1
      },
      {
        "old_raise": "raise exception using errcode='40001',message='APPROVED_ACCESS_REPLAY_STATE_CHANGED';",
        "new_raise": "raise exception using errcode='PT409',message='APPROVED_ACCESS_REPLAY_STATE_CHANGED';",
        "count": 1
      },
      {
        "old_raise": "raise exception using errcode='40001',message='APPROVED_ACCESS_PLAN_STALE';",
        "new_raise": "raise exception using errcode='PT409',message='APPROVED_ACCESS_PLAN_STALE';",
        "count": 1
      },
      {
        "old_raise": "raise exception using errcode='40001',message='APPROVED_ACCESS_ALREADY_CONFIGURED';",
        "new_raise": "raise exception using errcode='PT409',message='APPROVED_ACCESS_ALREADY_CONFIGURED';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_set_variety_image_u2c3_internal(uuid,text,text,uuid,text,bigint,timestamp with time zone)",
    "before_md5": "59c787f2c296dbbb41fe2f543ee31ef5",
    "after_md5": "4b340bebffbc8bb96954001706e22d0c",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode = '40001',\n      message = format('VARIETY_IMAGE_VERSION_CONFLICT:SERVER_%s:CLIENT_%s', v_variety.version, p_expected_version);",
        "new_raise": "raise exception using errcode = 'PT409',\n      message = format('VARIETY_IMAGE_VERSION_CONFLICT:SERVER_%s:CLIENT_%s', v_variety.version, p_expected_version);",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_sri_save_emission_point(uuid,text,text,text,text,text,boolean,timestamp with time zone,uuid)",
    "before_md5": "03a731ef9ca178138a4d417c982ee627",
    "after_md5": "937be4ca1528d020c46a20e4a02129e0",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='SRI_POINT_VERSION_CONFLICT';",
        "new_raise": "raise exception using errcode='PT409',message='SRI_POINT_VERSION_CONFLICT';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_sri_save_settings(uuid,jsonb,timestamp with time zone,uuid)",
    "before_md5": "68c114bc4510f9500ce8d9c99e485e0d",
    "after_md5": "9a5ad16b8b4de84c1be1dae0d183daa8",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='SRI_SETTINGS_VERSION_CONFLICT';",
        "new_raise": "raise exception using errcode='PT409',message='SRI_SETTINGS_VERSION_CONFLICT';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_sri_set_environment_enabled(uuid,text,boolean,boolean,uuid,text)",
    "before_md5": "09378b9ce18976f79bacdfe5e5a839e1",
    "after_md5": "98f8feda358c24b2226f2da5f790d12e",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='SRI_ACTIVATION_VERSION_CONFLICT';",
        "new_raise": "raise exception using errcode='PT409',message='SRI_ACTIVATION_VERSION_CONFLICT';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_sri_set_sequence_next(uuid,text,uuid,text,bigint,bigint,uuid,text)",
    "before_md5": "1638f0fead6c184a972a8a020f82a7a6",
    "after_md5": "970ebfdc5f633d511a81293fceba8ab8",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode='40001',message='SRI_SEQUENCE_VERSION_CONFLICT';",
        "new_raise": "raise exception using errcode='PT409',message='SRI_SEQUENCE_VERSION_CONFLICT';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.erp_warehouse_v2_autoassign_dedicated_box(uuid,uuid,text,text,integer,timestamp with time zone)",
    "before_md5": "001c1212e88823394988d09750a5e5ea",
    "after_md5": "2cbed65c833ea534404a8b820cf8601e",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using errcode = '40001', message = 'DEDICATED_AUTOASSIGN_SELECTION_CHANGED_RETRY';",
        "new_raise": "raise exception using errcode = 'PT409', message = 'DEDICATED_AUTOASSIGN_SELECTION_CHANGED_RETRY';",
        "count": 1
      }
    ]
  },
  {
    "signature": "public.set_electronic_document_status(uuid,text,text,uuid,text,jsonb)",
    "before_md5": "2cf1434bb590e9086b65a8e658e7d0be",
    "after_md5": "9ca8bfee3c7e49074c155d74e10a810f",
    "count": 1,
    "replacements": [
      {
        "old_raise": "raise exception using\n      errcode = '40001',\n      message = format(\n        'SRI_STATUS_CONFLICT:expected=%s,actual=%s',\n        p_expected_status,\n        v_document.status\n      );",
        "new_raise": "raise exception using\n      errcode = 'PT409',\n      message = format(\n        'SRI_STATUS_CONFLICT:expected=%s,actual=%s',\n        p_expected_status,\n        v_document.status\n      );",
        "count": 1
      }
    ]
  }
]
$reviewed$::jsonb;
  target jsonb;
  replacement jsonb;
  planned jsonb := '[]'::jsonb;
  target_oid oid;
  prior_definition text;
  next_definition text;
  prior_metadata jsonb;
  old_count integer;
  new_count integer;
  changed_count integer := 0;
begin
  if jsonb_array_length(reviewed) <> 18 then
    raise exception 'EXPLICIT_BUSINESS_CONFLICT_MANIFEST_INVALID';
  end if;
  -- Validate every definition before replacing any function. Hash drift, missing
  -- targets or unexpected statement multiplicity fail the transaction closed.
  for target in select value from jsonb_array_elements(reviewed) loop
    target_oid := to_regprocedure(target->>'signature');
    if target_oid is null then
      raise exception 'EXPLICIT_BUSINESS_CONFLICT_TARGET_MISSING: %', target->>'signature';
    end if;
    prior_definition := pg_get_functiondef(target_oid);
    select to_jsonb(p) - 'prosrc' into prior_metadata from pg_proc p where p.oid=target_oid;
    if md5(prior_definition) not in (target->>'before_md5',target->>'after_md5') then
      raise exception 'EXPLICIT_BUSINESS_CONFLICT_DEFINITION_DRIFT: %', target->>'signature';
    end if;
    next_definition := prior_definition;
    changed_count := 0;
    for replacement in select value from jsonb_array_elements(target->'replacements') loop
      old_count := (length(next_definition)-length(replace(next_definition,replacement->>'old_raise','')))/length(replacement->>'old_raise');
      new_count := (length(next_definition)-length(replace(next_definition,replacement->>'new_raise','')))/length(replacement->>'new_raise');
      if md5(prior_definition)=target->>'after_md5' then
        if old_count<>0 or new_count<>(replacement->>'count')::integer then
          raise exception 'EXPLICIT_BUSINESS_CONFLICT_AFTER_COUNT_MISMATCH: %', target->>'signature';
        end if;
      else
        if old_count<>(replacement->>'count')::integer or new_count<>0 then
          raise exception 'EXPLICIT_BUSINESS_CONFLICT_BEFORE_COUNT_MISMATCH: %', target->>'signature';
        end if;
        next_definition := replace(next_definition,replacement->>'old_raise',replacement->>'new_raise');
      end if;
      changed_count := changed_count+(replacement->>'count')::integer;
    end loop;
    if changed_count<>(target->>'count')::integer or md5(next_definition)<>target->>'after_md5' then
      raise exception 'EXPLICIT_BUSINESS_CONFLICT_REPLACEMENT_MISMATCH: %', target->>'signature';
    end if;
    planned := planned || jsonb_build_array(jsonb_build_object(
      'oid',target_oid,'signature',target->>'signature','prior_definition',prior_definition,
      'next_definition',next_definition,'metadata',prior_metadata));
  end loop;
  for target in select value from jsonb_array_elements(planned) loop
    target_oid := (target->>'oid')::oid;
    if pg_get_functiondef(target_oid) is distinct from target->>'prior_definition'
      or (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target_oid) is distinct from target->'metadata' then
      raise exception 'EXPLICIT_BUSINESS_CONFLICT_CONCURRENT_DEFINITION_DRIFT: %', target->>'signature';
    end if;
    if target->>'next_definition' is distinct from target->>'prior_definition' then
      execute target->>'next_definition';
    end if;
    if pg_get_functiondef(target_oid) is distinct from target->>'next_definition'
      or (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target_oid) is distinct from target->'metadata' then
      raise exception 'EXPLICIT_BUSINESS_CONFLICT_METADATA_OR_DEFINITION_CHANGED: %', target->>'signature';
    end if;
  end loop;
end;
$migration$;

commit;
