begin;
-- ISO 3166-1: Debian iso-codes data/iso_3166-1.json; Spanish names: Unicode CLDR.
-- Source hashes: ISO f01b812b57fba9f31ff621bf33e7c7570a01964dbeb5be2167e94decf538c89f
-- CLDR 027b9c91d4e923d506b404415648691ef41ebde721aa454cee4d9f7f66b3ea62
-- Complete the EXISTING company catalogs. No parallel table or frontend fallback.
-- Existing IDs, names, codes, status and orders are retained, including legacy duplicates.
create temporary table country_seed(iso2 text primary key,iso3 text,name text,aliases text[]) on commit drop;
insert into country_seed values
('AD','AND','Andorra',array['ANDORRA','ANDORRA']),
('AE','ARE','Emiratos Árabes Unidos',array['EMIRATOS ÁRABES UNIDOS','UNITED ARAB EMIRATES']),
('AF','AFG','Afganistán',array['AFGANISTÁN','AFGHANISTAN']),
('AG','ATG','Antigua y Barbuda',array['ANTIGUA Y BARBUDA','ANTIGUA AND BARBUDA']),
('AI','AIA','Anguila',array['ANGUILA','ANGUILLA']),
('AL','ALB','Albania',array['ALBANIA','ALBANIA']),
('AM','ARM','Armenia',array['ARMENIA','ARMENIA']),
('AO','AGO','Angola',array['ANGOLA','ANGOLA']),
('AQ','ATA','Antártida',array['ANTÁRTIDA','ANTARCTICA']),
('AR','ARG','Argentina',array['ARGENTINA','ARGENTINA']),
('AS','ASM','Samoa Americana',array['SAMOA AMERICANA','AMERICAN SAMOA']),
('AT','AUT','Austria',array['AUSTRIA','AUSTRIA']),
('AU','AUS','Australia',array['AUSTRALIA','AUSTRALIA']),
('AW','ABW','Aruba',array['ARUBA','ARUBA']),
('AX','ALA','Islas Aland',array['ISLAS ALAND','ÅLAND ISLANDS']),
('AZ','AZE','Azerbaiyán',array['AZERBAIYÁN','AZERBAIJAN']),
('BA','BIH','Bosnia y Herzegovina',array['BOSNIA Y HERZEGOVINA','BOSNIA AND HERZEGOVINA']),
('BB','BRB','Barbados',array['BARBADOS','BARBADOS']),
('BD','BGD','Bangladés',array['BANGLADÉS','BANGLADESH']),
('BE','BEL','Bélgica',array['BÉLGICA','BELGIUM']),
('BF','BFA','Burkina Faso',array['BURKINA FASO','BURKINA FASO']),
('BG','BGR','Bulgaria',array['BULGARIA','BULGARIA']),
('BH','BHR','Baréin',array['BARÉIN','BAHRAIN']),
('BI','BDI','Burundi',array['BURUNDI','BURUNDI']),
('BJ','BEN','Benín',array['BENÍN','BENIN']),
('BL','BLM','San Bartolomé',array['SAN BARTOLOMÉ','SAINT BARTHÉLEMY']),
('BM','BMU','Bermudas',array['BERMUDAS','BERMUDA']),
('BN','BRN','Brunéi',array['BRUNÉI','BRUNEI DARUSSALAM']),
('BO','BOL','Bolivia',array['BOLIVIA','BOLIVIA, PLURINATIONAL STATE OF']),
('BQ','BES','Caribe neerlandés',array['CARIBE NEERLANDÉS','BONAIRE, SINT EUSTATIUS AND SABA']),
('BR','BRA','Brasil',array['BRASIL','BRAZIL']),
('BS','BHS','Bahamas',array['BAHAMAS','BAHAMAS']),
('BT','BTN','Bután',array['BUTÁN','BHUTAN']),
('BV','BVT','Isla Bouvet',array['ISLA BOUVET','BOUVET ISLAND']),
('BW','BWA','Botsuana',array['BOTSUANA','BOTSWANA']),
('BY','BLR','Bielorrusia',array['BIELORRUSIA','BELARUS']),
('BZ','BLZ','Belice',array['BELICE','BELIZE']),
('CA','CAN','Canadá',array['CANADÁ','CANADA']),
('CC','CCK','Islas Cocos',array['ISLAS COCOS','COCOS (KEELING) ISLANDS']),
('CD','COD','República Democrática del Congo',array['REPÚBLICA DEMOCRÁTICA DEL CONGO','CONGO, THE DEMOCRATIC REPUBLIC OF THE']),
('CF','CAF','República Centroafricana',array['REPÚBLICA CENTROAFRICANA','CENTRAL AFRICAN REPUBLIC']),
('CG','COG','Congo',array['CONGO','CONGO']),
('CH','CHE','Suiza',array['SUIZA','SWITZERLAND']),
('CI','CIV','Côte d’Ivoire',array['CÔTE D’IVOIRE','CÔTE D''IVOIRE']),
('CK','COK','Islas Cook',array['ISLAS COOK','COOK ISLANDS']),
('CL','CHL','Chile',array['CHILE','CHILE']),
('CM','CMR','Camerún',array['CAMERÚN','CAMEROON']),
('CN','CHN','China',array['CHINA','CHINA']),
('CO','COL','Colombia',array['COLOMBIA','COLOMBIA']),
('CR','CRI','Costa Rica',array['COSTA RICA','COSTA RICA']),
('CU','CUB','Cuba',array['CUBA','CUBA']),
('CV','CPV','Cabo Verde',array['CABO VERDE','CABO VERDE']),
('CW','CUW','Curazao',array['CURAZAO','CURAÇAO']),
('CX','CXR','Isla de Navidad',array['ISLA DE NAVIDAD','CHRISTMAS ISLAND']),
('CY','CYP','Chipre',array['CHIPRE','CYPRUS']),
('CZ','CZE','Chequia',array['CHEQUIA','CZECHIA']),
('DE','DEU','Alemania',array['ALEMANIA','GERMANY']),
('DJ','DJI','Yibuti',array['YIBUTI','DJIBOUTI']),
('DK','DNK','Dinamarca',array['DINAMARCA','DENMARK']),
('DM','DMA','Dominica',array['DOMINICA','DOMINICA']),
('DO','DOM','República Dominicana',array['REPÚBLICA DOMINICANA','DOMINICAN REPUBLIC','REPUBLICA DOMINICANA']),
('DZ','DZA','Argelia',array['ARGELIA','ALGERIA']),
('EC','ECU','Ecuador',array['ECUADOR','ECUADOR']),
('EE','EST','Estonia',array['ESTONIA','ESTONIA']),
('EG','EGY','Egipto',array['EGIPTO','EGYPT']),
('EH','ESH','Sáhara Occidental',array['SÁHARA OCCIDENTAL','WESTERN SAHARA']),
('ER','ERI','Eritrea',array['ERITREA','ERITREA']),
('ES','ESP','España',array['ESPAÑA','SPAIN']),
('ET','ETH','Etiopía',array['ETIOPÍA','ETHIOPIA']),
('FI','FIN','Finlandia',array['FINLANDIA','FINLAND']),
('FJ','FJI','Fiyi',array['FIYI','FIJI']),
('FK','FLK','Islas Malvinas',array['ISLAS MALVINAS','FALKLAND ISLANDS (MALVINAS)']),
('FM','FSM','Micronesia',array['MICRONESIA','MICRONESIA, FEDERATED STATES OF']),
('FO','FRO','Islas Feroe',array['ISLAS FEROE','FAROE ISLANDS']),
('FR','FRA','Francia',array['FRANCIA','FRANCE']),
('GA','GAB','Gabón',array['GABÓN','GABON']),
('GB','GBR','Reino Unido',array['REINO UNIDO','UNITED KINGDOM']),
('GD','GRD','Granada',array['GRANADA','GRENADA']),
('GE','GEO','Georgia',array['GEORGIA','GEORGIA']),
('GF','GUF','Guayana Francesa',array['GUAYANA FRANCESA','FRENCH GUIANA']),
('GG','GGY','Guernesey',array['GUERNESEY','GUERNSEY']),
('GH','GHA','Ghana',array['GHANA','GHANA']),
('GI','GIB','Gibraltar',array['GIBRALTAR','GIBRALTAR']),
('GL','GRL','Groenlandia',array['GROENLANDIA','GREENLAND']),
('GM','GMB','Gambia',array['GAMBIA','GAMBIA']),
('GN','GIN','Guinea',array['GUINEA','GUINEA']),
('GP','GLP','Guadalupe',array['GUADALUPE','GUADELOUPE']),
('GQ','GNQ','Guinea Ecuatorial',array['GUINEA ECUATORIAL','EQUATORIAL GUINEA']),
('GR','GRC','Grecia',array['GRECIA','GREECE']),
('GS','SGS','Islas Georgia del Sur y Sandwich del Sur',array['ISLAS GEORGIA DEL SUR Y SANDWICH DEL SUR','SOUTH GEORGIA AND THE SOUTH SANDWICH ISLANDS']),
('GT','GTM','Guatemala',array['GUATEMALA','GUATEMALA']),
('GU','GUM','Guam',array['GUAM','GUAM']),
('GW','GNB','Guinea-Bisáu',array['GUINEA-BISÁU','GUINEA-BISSAU']),
('GY','GUY','Guyana',array['GUYANA','GUYANA']),
('HK','HKG','RAE de Hong Kong (China)',array['RAE DE HONG KONG (CHINA)','HONG KONG']),
('HM','HMD','Islas Heard y McDonald',array['ISLAS HEARD Y MCDONALD','HEARD ISLAND AND MCDONALD ISLANDS']),
('HN','HND','Honduras',array['HONDURAS','HONDURAS']),
('HR','HRV','Croacia',array['CROACIA','CROATIA']),
('HT','HTI','Haití',array['HAITÍ','HAITI']),
('HU','HUN','Hungría',array['HUNGRÍA','HUNGARY']),
('ID','IDN','Indonesia',array['INDONESIA','INDONESIA']),
('IE','IRL','Irlanda',array['IRLANDA','IRELAND']),
('IL','ISR','Israel',array['ISRAEL','ISRAEL']),
('IM','IMN','Isla de Man',array['ISLA DE MAN','ISLE OF MAN']),
('IN','IND','India',array['INDIA','INDIA']),
('IO','IOT','Territorio Británico del Océano Índico',array['TERRITORIO BRITÁNICO DEL OCÉANO ÍNDICO','BRITISH INDIAN OCEAN TERRITORY']),
('IQ','IRQ','Irak',array['IRAK','IRAQ']),
('IR','IRN','Irán',array['IRÁN','IRAN, ISLAMIC REPUBLIC OF']),
('IS','ISL','Islandia',array['ISLANDIA','ICELAND']),
('IT','ITA','Italia',array['ITALIA','ITALY']),
('JE','JEY','Jersey',array['JERSEY','JERSEY']),
('JM','JAM','Jamaica',array['JAMAICA','JAMAICA']),
('JO','JOR','Jordania',array['JORDANIA','JORDAN']),
('JP','JPN','Japón',array['JAPÓN','JAPAN']),
('KE','KEN','Kenia',array['KENIA','KENYA']),
('KG','KGZ','Kirguistán',array['KIRGUISTÁN','KYRGYZSTAN','KYRGYSTAN']),
('KH','KHM','Camboya',array['CAMBOYA','CAMBODIA']),
('KI','KIR','Kiribati',array['KIRIBATI','KIRIBATI']),
('KM','COM','Comoras',array['COMORAS','COMOROS']),
('KN','KNA','San Cristóbal y Nieves',array['SAN CRISTÓBAL Y NIEVES','SAINT KITTS AND NEVIS']),
('KP','PRK','Corea del Norte',array['COREA DEL NORTE','KOREA, DEMOCRATIC PEOPLE''S REPUBLIC OF']),
('KR','KOR','Corea del Sur',array['COREA DEL SUR','KOREA, REPUBLIC OF']),
('KW','KWT','Kuwait',array['KUWAIT','KUWAIT']),
('KY','CYM','Islas Caimán',array['ISLAS CAIMÁN','CAYMAN ISLANDS']),
('KZ','KAZ','Kazajistán',array['KAZAJISTÁN','KAZAKHSTAN','KAZAJSTAN']),
('LA','LAO','Laos',array['LAOS','LAO PEOPLE''S DEMOCRATIC REPUBLIC']),
('LB','LBN','Líbano',array['LÍBANO','LEBANON']),
('LC','LCA','Santa Lucía',array['SANTA LUCÍA','SAINT LUCIA']),
('LI','LIE','Liechtenstein',array['LIECHTENSTEIN','LIECHTENSTEIN']),
('LK','LKA','Sri Lanka',array['SRI LANKA','SRI LANKA']),
('LR','LBR','Liberia',array['LIBERIA','LIBERIA']),
('LS','LSO','Lesoto',array['LESOTO','LESOTHO']),
('LT','LTU','Lituania',array['LITUANIA','LITHUANIA']),
('LU','LUX','Luxemburgo',array['LUXEMBURGO','LUXEMBOURG']),
('LV','LVA','Letonia',array['LETONIA','LATVIA']),
('LY','LBY','Libia',array['LIBIA','LIBYA']),
('MA','MAR','Marruecos',array['MARRUECOS','MOROCCO']),
('MC','MCO','Mónaco',array['MÓNACO','MONACO']),
('MD','MDA','Moldavia',array['MOLDAVIA','MOLDOVA, REPUBLIC OF']),
('ME','MNE','Montenegro',array['MONTENEGRO','MONTENEGRO']),
('MF','MAF','San Martín',array['SAN MARTÍN','SAINT MARTIN (FRENCH PART)']),
('MG','MDG','Madagascar',array['MADAGASCAR','MADAGASCAR']),
('MH','MHL','Islas Marshall',array['ISLAS MARSHALL','MARSHALL ISLANDS']),
('MK','MKD','Macedonia del Norte',array['MACEDONIA DEL NORTE','NORTH MACEDONIA']),
('ML','MLI','Mali',array['MALI','MALI']),
('MM','MMR','Myanmar (Birmania)',array['MYANMAR (BIRMANIA)','MYANMAR']),
('MN','MNG','Mongolia',array['MONGOLIA','MONGOLIA']),
('MO','MAC','RAE de Macao (China)',array['RAE DE MACAO (CHINA)','MACAO']),
('MP','MNP','Islas Marianas del Norte',array['ISLAS MARIANAS DEL NORTE','NORTHERN MARIANA ISLANDS']),
('MQ','MTQ','Martinica',array['MARTINICA','MARTINIQUE']),
('MR','MRT','Mauritania',array['MAURITANIA','MAURITANIA']),
('MS','MSR','Montserrat',array['MONTSERRAT','MONTSERRAT']),
('MT','MLT','Malta',array['MALTA','MALTA']),
('MU','MUS','Mauricio',array['MAURICIO','MAURITIUS']),
('MV','MDV','Maldivas',array['MALDIVAS','MALDIVES']),
('MW','MWI','Malaui',array['MALAUI','MALAWI']),
('MX','MEX','México',array['MÉXICO','MEXICO']),
('MY','MYS','Malasia',array['MALASIA','MALAYSIA']),
('MZ','MOZ','Mozambique',array['MOZAMBIQUE','MOZAMBIQUE']),
('NA','NAM','Namibia',array['NAMIBIA','NAMIBIA']),
('NC','NCL','Nueva Caledonia',array['NUEVA CALEDONIA','NEW CALEDONIA']),
('NE','NER','Níger',array['NÍGER','NIGER']),
('NF','NFK','Isla Norfolk',array['ISLA NORFOLK','NORFOLK ISLAND']),
('NG','NGA','Nigeria',array['NIGERIA','NIGERIA']),
('NI','NIC','Nicaragua',array['NICARAGUA','NICARAGUA']),
('NL','NLD','Países Bajos',array['PAÍSES BAJOS','NETHERLANDS','NETHERLANDS']),
('NO','NOR','Noruega',array['NORUEGA','NORWAY']),
('NP','NPL','Nepal',array['NEPAL','NEPAL']),
('NR','NRU','Nauru',array['NAURU','NAURU']),
('NU','NIU','Niue',array['NIUE','NIUE']),
('NZ','NZL','Nueva Zelanda',array['NUEVA ZELANDA','NEW ZEALAND']),
('OM','OMN','Omán',array['OMÁN','OMAN']),
('PA','PAN','Panamá',array['PANAMÁ','PANAMA']),
('PE','PER','Perú',array['PERÚ','PERU']),
('PF','PYF','Polinesia Francesa',array['POLINESIA FRANCESA','FRENCH POLYNESIA']),
('PG','PNG','Papúa Nueva Guinea',array['PAPÚA NUEVA GUINEA','PAPUA NEW GUINEA']),
('PH','PHL','Filipinas',array['FILIPINAS','PHILIPPINES']),
('PK','PAK','Pakistán',array['PAKISTÁN','PAKISTAN']),
('PL','POL','Polonia',array['POLONIA','POLAND']),
('PM','SPM','San Pedro y Miquelón',array['SAN PEDRO Y MIQUELÓN','SAINT PIERRE AND MIQUELON']),
('PN','PCN','Islas Pitcairn',array['ISLAS PITCAIRN','PITCAIRN']),
('PR','PRI','Puerto Rico',array['PUERTO RICO','PUERTO RICO']),
('PS','PSE','Territorios Palestinos',array['TERRITORIOS PALESTINOS','PALESTINE, STATE OF']),
('PT','PRT','Portugal',array['PORTUGAL','PORTUGAL']),
('PW','PLW','Palaos',array['PALAOS','PALAU']),
('PY','PRY','Paraguay',array['PARAGUAY','PARAGUAY']),
('QA','QAT','Catar',array['CATAR','QATAR']),
('RE','REU','Reunión',array['REUNIÓN','RÉUNION']),
('RO','ROU','Rumanía',array['RUMANÍA','ROMANIA']),
('RS','SRB','Serbia',array['SERBIA','SERBIA']),
('RU','RUS','Rusia',array['RUSIA','RUSSIAN FEDERATION','RUSIA']),
('RW','RWA','Ruanda',array['RUANDA','RWANDA']),
('SA','SAU','Arabia Saudí',array['ARABIA SAUDÍ','SAUDI ARABIA']),
('SB','SLB','Islas Salomón',array['ISLAS SALOMÓN','SOLOMON ISLANDS']),
('SC','SYC','Seychelles',array['SEYCHELLES','SEYCHELLES']),
('SD','SDN','Sudán',array['SUDÁN','SUDAN']),
('SE','SWE','Suecia',array['SUECIA','SWEDEN']),
('SG','SGP','Singapur',array['SINGAPUR','SINGAPORE']),
('SH','SHN','Santa Elena',array['SANTA ELENA','SAINT HELENA, ASCENSION AND TRISTAN DA CUNHA']),
('SI','SVN','Eslovenia',array['ESLOVENIA','SLOVENIA']),
('SJ','SJM','Svalbard y Jan Mayen',array['SVALBARD Y JAN MAYEN','SVALBARD AND JAN MAYEN']),
('SK','SVK','Eslovaquia',array['ESLOVAQUIA','SLOVAKIA']),
('SL','SLE','Sierra Leona',array['SIERRA LEONA','SIERRA LEONE']),
('SM','SMR','San Marino',array['SAN MARINO','SAN MARINO']),
('SN','SEN','Senegal',array['SENEGAL','SENEGAL']),
('SO','SOM','Somalia',array['SOMALIA','SOMALIA']),
('SR','SUR','Surinam',array['SURINAM','SURINAME']),
('SS','SSD','Sudán del Sur',array['SUDÁN DEL SUR','SOUTH SUDAN']),
('ST','STP','Santo Tomé y Príncipe',array['SANTO TOMÉ Y PRÍNCIPE','SAO TOME AND PRINCIPE']),
('SV','SLV','El Salvador',array['EL SALVADOR','EL SALVADOR']),
('SX','SXM','Sint Maarten',array['SINT MAARTEN','SINT MAARTEN (DUTCH PART)']),
('SY','SYR','Siria',array['SIRIA','SYRIAN ARAB REPUBLIC']),
('SZ','SWZ','Esuatini',array['ESUATINI','ESWATINI']),
('TC','TCA','Islas Turcas y Caicos',array['ISLAS TURCAS Y CAICOS','TURKS AND CAICOS ISLANDS']),
('TD','TCD','Chad',array['CHAD','CHAD']),
('TF','ATF','Territorios Australes Franceses',array['TERRITORIOS AUSTRALES FRANCESES','FRENCH SOUTHERN TERRITORIES']),
('TG','TGO','Togo',array['TOGO','TOGO']),
('TH','THA','Tailandia',array['TAILANDIA','THAILAND']),
('TJ','TJK','Tayikistán',array['TAYIKISTÁN','TAJIKISTAN']),
('TK','TKL','Tokelau',array['TOKELAU','TOKELAU']),
('TL','TLS','Timor-Leste',array['TIMOR-LESTE','TIMOR-LESTE']),
('TM','TKM','Turkmenistán',array['TURKMENISTÁN','TURKMENISTAN']),
('TN','TUN','Túnez',array['TÚNEZ','TUNISIA']),
('TO','TON','Tonga',array['TONGA','TONGA']),
('TR','TUR','Turquía',array['TURQUÍA','TÜRKIYE','TURQUIA']),
('TT','TTO','Trinidad y Tobago',array['TRINIDAD Y TOBAGO','TRINIDAD AND TOBAGO']),
('TV','TUV','Tuvalu',array['TUVALU','TUVALU']),
('TW','TWN','Taiwán',array['TAIWÁN','TAIWAN, PROVINCE OF CHINA']),
('TZ','TZA','Tanzania',array['TANZANIA','TANZANIA, UNITED REPUBLIC OF']),
('UA','UKR','Ucrania',array['UCRANIA','UKRAINE']),
('UG','UGA','Uganda',array['UGANDA','UGANDA']),
('UM','UMI','Islas menores alejadas de EE. UU.',array['ISLAS MENORES ALEJADAS DE EE. UU.','UNITED STATES MINOR OUTLYING ISLANDS']),
('US','USA','Estados Unidos',array['ESTADOS UNIDOS','UNITED STATES','USA']),
('UY','URY','Uruguay',array['URUGUAY','URUGUAY']),
('UZ','UZB','Uzbekistán',array['UZBEKISTÁN','UZBEKISTAN','UZBEKISTAN']),
('VA','VAT','Ciudad del Vaticano',array['CIUDAD DEL VATICANO','HOLY SEE (VATICAN CITY STATE)']),
('VC','VCT','San Vicente y las Granadinas',array['SAN VICENTE Y LAS GRANADINAS','SAINT VINCENT AND THE GRENADINES']),
('VE','VEN','Venezuela',array['VENEZUELA','VENEZUELA, BOLIVARIAN REPUBLIC OF']),
('VG','VGB','Islas Vírgenes Británicas',array['ISLAS VÍRGENES BRITÁNICAS','VIRGIN ISLANDS, BRITISH']),
('VI','VIR','Islas Vírgenes de EE. UU.',array['ISLAS VÍRGENES DE EE. UU.','VIRGIN ISLANDS, U.S.']),
('VN','VNM','Vietnam',array['VIETNAM','VIET NAM']),
('VU','VUT','Vanuatu',array['VANUATU','VANUATU']),
('WF','WLF','Wallis y Futuna',array['WALLIS Y FUTUNA','WALLIS AND FUTUNA']),
('WS','WSM','Samoa',array['SAMOA','SAMOA']),
('YE','YEM','Yemen',array['YEMEN','YEMEN']),
('YT','MYT','Mayotte',array['MAYOTTE','MAYOTTE']),
('ZA','ZAF','Sudáfrica',array['SUDÁFRICA','SOUTH AFRICA']),
('ZM','ZMB','Zambia',array['ZAMBIA','ZAMBIA']),
('ZW','ZWE','Zimbabue',array['ZIMBABUE','ZIMBABWE']);

do $$
declare c uuid; s record; r record; matched boolean; meta jsonb;
begin
 foreach c in array array['cf331b82-7ac3-4065-9e38-d0bbcde96cd5'::uuid,'ab60abdc-fe53-4289-9ae2-8f749ee21cff'::uuid] loop
  if not exists(select 1 from public.companies where id=c) then raise exception 'COUNTRY_SEED_COMPANY_MISSING'; end if;
  perform pg_advisory_xact_lock(hashtextextended('commercial_country_seed:'||c::text,0));
  for s in select * from country_seed order by iso2 loop
   matched:=false;
   for r in select * from public.erp_entity_records where company_id=c and entity='commercial_countries'
    and (upper(payload->>'iso2')=s.iso2 or upper(payload->>'code') in(s.iso2,'PAIS-'||s.iso2)
      or upper(payload->>'name')=any(s.aliases)) for update loop
    matched:=true;
    meta:=jsonb_build_object('iso2',s.iso2,'iso3',s.iso3,'searchName',s.name);
    if r.payload->>'iso2' is not null and r.payload->>'iso2'<>'' and upper(r.payload->>'iso2')<>s.iso2 then
      raise exception 'COUNTRY_SEED_IDENTITY_CONFLICT';
    end if;
    if not r.payload @> meta then
      update public.erp_entity_records set payload=payload||meta,version=version+1,updated_at=now()
       where company_id=c and entity='commercial_countries' and record_id=r.record_id;
    end if;
   end loop;
   if not matched then
    insert into public.erp_entity_records(company_id,entity,record_id,payload)
    values(c,'commercial_countries','COM-PAIS-'||s.iso2,jsonb_build_object('id','COM-PAIS-'||s.iso2,
      'code',s.iso2,'name',s.name,'status','ACTIVO','iso2',s.iso2,'iso3',s.iso3,'searchName',s.name));
   end if;
  end loop;
 end loop;
end$$;

create or replace function public.erp_commercial_order_countries(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid; result jsonb;
begin
 actor:=public.erp_u2a_assert_company_read_access(p_company_id);
 if not exists(select 1 from public.user_profiles where user_id=actor and is_active=true)
  or not exists(select 1 from public.user_company_memberships where user_id=actor and company_id=p_company_id and membership_status='ACTIVE') then
  raise exception using errcode='42501',message='COUNTRY_CATALOG_ACTIVE_MEMBERSHIP_REQUIRED';
 end if;
 if not (public.erp_security_has_capability(p_company_id,'commercial.orders.view')
   or public.erp_security_has_capability(p_company_id,'commercial.orders.create')
   or public.erp_security_has_capability(p_company_id,'commercial.orders.edit')) then
  raise exception using errcode='42501',message='COUNTRY_CATALOG_ORDER_CAPABILITY_REQUIRED';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',record_id,'code',payload->>'code',
   'name',coalesce(nullif(payload->>'searchName',''),payload->>'name'), 'legacy_name',payload->>'name',
   'iso2',payload->>'iso2','iso3',payload->>'iso3',
   'active',deleted_at is null and upper(coalesce(payload->>'status','ACTIVO')) not in('INACTIVO','INACTIVE')
       and coalesce(payload->>'active','true')<>'false') order by coalesce(payload->>'searchName',payload->>'name'),record_id),'[]'::jsonb)
 into result from public.erp_entity_records where company_id=p_company_id and entity='commercial_countries';
 return jsonb_build_object('company_id',p_company_id,'source','commercial_countries','read_only',true,'records',result);
end$$;
revoke all on function public.erp_commercial_order_countries(uuid) from public,anon,service_role;
grant execute on function public.erp_commercial_order_countries(uuid) to authenticated;

-- Validate only new/changed maritime destination references at the persistence boundary.
-- Existing historical IDs/text snapshots remain valid unchanged, even after inactivation.
create or replace function public.erp_guard_order_country() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare country public.erp_entity_records%rowtype; ident text; expected text;
begin
 if new.entity<>'commercial_orders' or new.deleted_at is not null
   or upper(coalesce(new.payload->>'transportType','')) not in('MARITIMO','MARÍTIMO') then return new; end if;
 if TG_OP='UPDATE' and old.company_id=new.company_id and old.entity=new.entity
   and upper(coalesce(old.payload->>'transportType','')) in('MARITIMO','MARÍTIMO')
   and old.payload->'destinationId' is not distinct from new.payload->'destinationId'
   and old.payload->'destination' is not distinct from new.payload->'destination'
   and old.payload->'destinationCountry' is not distinct from new.payload->'destinationCountry' then return new; end if;
 ident:=nullif(new.payload->>'destinationId','');
 select * into country from public.erp_entity_records where company_id=new.company_id
   and entity='commercial_countries' and record_id=ident for share;
 if not found or country.deleted_at is not null or upper(coalesce(country.payload->>'status','ACTIVO')) in('INACTIVO','INACTIVE')
   or coalesce(country.payload->>'active','true')='false' then
   raise exception using errcode='23514',message='Seleccione un país activo del catálogo canónico para el pedido marítimo.',detail='COMMERCIAL_ORDER_COUNTRY_INVALID';
 end if;
 expected:=coalesce(nullif(country.payload->>'searchName',''),country.payload->>'name');
 if new.payload->>'destination' is distinct from expected or new.payload->>'destinationCountry' is distinct from expected then
   raise exception using errcode='23514',message='El país cambió en el catálogo. Vuelva a consultarlo y seleccionarlo.',detail='COMMERCIAL_ORDER_COUNTRY_SNAPSHOT_MISMATCH';
 end if;
 return new;
end$$;
revoke all on function public.erp_guard_order_country() from public,anon,authenticated,service_role;
drop trigger if exists erp_order_country_guard on public.erp_entity_records;
create trigger erp_order_country_guard before insert or update of payload,company_id,entity on public.erp_entity_records
for each row when(new.entity='commercial_orders') execute function public.erp_guard_order_country();
-- Compensation: revert consuming app first, revoke reader and drop only this trigger.
-- Never delete seeded countries that may have acquired order references after deployment.
commit;
