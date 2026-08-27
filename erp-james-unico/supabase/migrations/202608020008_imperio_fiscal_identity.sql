-- Completa la identidad fiscal verificada de Imperio Flowers.
-- No crea usuarios, no carga certificados y no habilita produccion SRI.

update public.companies
set legal_name = 'Lanchimba Tipanluisa Sandy Anahi',
    commercial_name = 'Imperio Flowers',
    tax_id = '1727970137001',
    sri_environment = 'TEST',
    is_active = true,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'accounting_mode', 'BASIC_COMMERCIAL',
      'inventory_owner', false,
      'availability_source_company_key', 'COMP-BLESS-FLOWER',
      'taxpayer_type', 'NATURAL_PERSON',
      'tax_regime', 'GENERAL',
      'accounting_required', false,
      'withholding_agent', false,
      'special_taxpayer', false,
      'province', 'PICHINCHA',
      'canton', 'CAYAMBE',
      'parish', 'CANGAHUA',
      'matrix_address', 'CALLE 3 DE NOVIEMBRE, LOTE 4 E INTERSECCION CACHICUNGO, A DOS CUADRAS DE LA CANCHA COMUNAL CARRERA',
      'phone', '0987694901',
      'email', 'imperioflower@gmail.com',
      'tax_registration_date', '2025-06-16',
      'vat_declaration_frequency', 'SEMIANNUAL',
      'fiscal_identity_verified_at', '2026-08-02'
    ),
    updated_at = now()
where company_key = 'COMP-IMPERIO-FLOWERS';

create unique index if not exists user_profiles_username_lower_unique
  on public.user_profiles (lower(username))
  where username is not null;

comment on index public.user_profiles_username_lower_unique is
  'Evita que dos cuentas utilicen el mismo usuario de ingreso sin distinguir mayusculas.';
