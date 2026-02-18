-- STEP 13: Seed missing accounts from Retainer/Litigation/Special sources
-- Source files: Retainer CSV batch + existing sync SQL (10/12)
-- Parsed accounts: 108
-- Safe to re-run.

begin;

with source_accounts (
  row_no,
  title,
  category
) as (
  values
    (1, 'ADERITO YUJUICO', 'litigation'),
    (2, 'ALDER DELLORO', 'litigation'),
    (3, 'AMELIA SANTOS', 'litigation'),
    (4, 'CBL', 'litigation'),
    (5, 'CEFI', 'litigation'),
    (6, 'FREDDIERICK DOMINGO', 'litigation'),
    (7, 'GERARDO DOMAGAS', 'litigation'),
    (8, 'GIL ORENSE', 'litigation'),
    (9, 'HARRY LERO', 'litigation'),
    (10, 'LUZ YAP', 'litigation'),
    (11, 'NICHOLAS GUYSAYKO', 'litigation'),
    (12, 'Philcare Pharma, Inc.', 'litigation'),
    (13, 'RAYMUND YAP', 'litigation'),
    (14, 'RICKY SY', 'litigation'),
    (15, 'RODITO BANICO', 'litigation'),
    (16, 'RONALDO SANTOS', 'litigation'),
    (17, 'RYKOM', 'litigation'),
    (18, 'SPS. CHENG', 'litigation'),
    (19, 'SPS. DOMINGO UY & MARIA CRISTINA UY', 'litigation'),
    (20, 'ACHELOUS', 'retainer'),
    (21, 'ACHELOUS CORP', 'retainer'),
    (22, 'ACHELOUS CORP.', 'retainer'),
    (23, 'ANC CAR DEALERSHIPS', 'retainer'),
    (24, 'ANC CAR DEALERSHIPS (CONSOLIDATED)', 'retainer'),
    (25, 'ANC CCC Holding', 'retainer'),
    (26, 'ANC CCC HOLDING CORP', 'retainer'),
    (27, 'ANC FORD CAR DEALERSHIPS', 'retainer'),
    (28, 'ANC Ford Card Dealerships', 'retainer'),
    (29, 'ANC HONDA CAR DEALERSHIPS', 'retainer'),
    (30, 'ANC Honda Card Dealerships', 'retainer'),
    (31, 'ANC SUZUKI CAR DEALERSHIPS', 'retainer'),
    (32, 'ANC Suzuki Card Dealerships', 'retainer'),
    (33, 'ANCTCM INC.', 'retainer'),
    (34, 'ANNALYN PATRICINIO', 'retainer'),
    (35, 'ASHTON TECH CORP', 'retainer'),
    (36, 'ASHTON TECHNOLOGIES CORP.', 'retainer'),
    (37, 'BAC HOLDING', 'retainer'),
    (38, 'Bac Holdings', 'retainer'),
    (39, 'BAC HOLDINGS CORP', 'retainer'),
    (40, 'Cabrebald', 'retainer'),
    (41, 'CABREBALD CORP', 'retainer'),
    (42, 'CABREBALD HOLDING CORP', 'retainer'),
    (43, 'CALAYAN EDUCATIONAL FOUNDATION INC.', 'retainer'),
    (44, 'CBL (CARLITA LUNA)', 'retainer'),
    (45, 'CBL FREIGHT FORWADER & COURIER', 'retainer'),
    (46, 'CBL Freight Forwarded & Courier Express Intl. LTD (Initiation of Criminal Complaint against Employee)', 'retainer'),
    (47, 'CHEMICAL PROVIDER INC', 'retainer'),
    (48, 'CHEMICAL PROVIDER INC.', 'retainer'),
    (49, 'CITI HRM CORP', 'retainer'),
    (50, 'FOREST PARK', 'retainer'),
    (51, 'FOREST PARK (MANUEL UY & SONS, INC)', 'retainer'),
    (52, 'FOREST PARK (Muygers Inc.)', 'retainer'),
    (53, 'FOREST PARK (MUYGRES INC.)', 'retainer'),
    (54, 'FOREST PARK (PHILIPPINE MEMORIAL PARK)', 'retainer'),
    (55, 'FOREST PARK( Manuel Uy & Sons)', 'retainer'),
    (56, 'FROILAN CASER', 'retainer'),
    (57, 'FROILAN EVAN CASER', 'retainer'),
    (58, 'IDR. ANNALYN PAMELA P. PATROCINIO', 'retainer'),
    (59, 'LCC INFINI', 'retainer'),
    (60, 'LLC INFINI', 'retainer'),
    (61, 'MERAKI ATHEREA SPA', 'retainer'),
    (62, 'PHILCARE PHARMA INC.', 'retainer'),
    (63, 'PRIME RITZ', 'retainer'),
    (64, 'PT RAJA KAMAR INTERNATIONAL CORP.', 'retainer'),
    (65, 'PT RAJA KAMAR INTERNATIONAL INC.', 'retainer'),
    (66, 'RYKOM FINANCE CORP', 'retainer'),
    (67, 'RYKOM FINANCE CORP.', 'retainer'),
    (68, 'SOMMET PROPERTIES', 'retainer'),
    (69, 'STORYSELLER STRATEGY & SYSTEM, INC.', 'retainer'),
    (70, 'STORYSELLER STRATEGY & SYSTEM,INC(ANNA KATRINA VIOLETA)', 'retainer'),
    (71, 'Tac Holdings', 'retainer'),
    (72, 'TAC HOLDINGS PHILS INC', 'retainer'),
    (73, 'ASHTON TECHNOLOGIES CORP.', 'special_project'),
    (74, 'AYNS VICEROY EAST REALTY INC.', 'special_project'),
    (75, 'CALAYAN', 'special_project'),
    (76, 'CYRUS ANDREI FERAER SIERRA & JHAYEHD SALAZAR TUA O', 'special_project'),
    (77, 'DR. MASANGKAY', 'special_project'),
    (78, 'DYNAMIC TRANSINVEST LTD.', 'special_project'),
    (79, 'FULL POTENTIAL BPO INC.', 'special_project'),
    (80, 'HEIRS OF MANUEL YAP', 'special_project'),
    (81, 'HON. PAUL R. DAZA', 'special_project'),
    (82, 'IDR. ANNALYN PAMELA P. PATROCINIO', 'special_project'),
    (83, 'LUZ YAP', 'special_project'),
    (84, 'MR. ALLAN JAYSON LOPEZ', 'special_project'),
    (85, 'MR. ANTHONY N. CHENG', 'special_project'),
    (86, 'MR. FREDDIE RICK C. DOMINGO', 'special_project'),
    (87, 'MR. GILBERT T. DEE, JR.', 'special_project'),
    (88, 'MR. GILBERT T. DEE, JR. (UMC)', 'special_project'),
    (89, 'MR. JULIUS DEL MUNDO', 'special_project'),
    (90, 'MR. MICHAEL KOOZNETSOFF', 'special_project'),
    (91, 'MR. RONALDO SANTOS', 'special_project'),
    (92, 'MS. CARLITA N. LUNA', 'special_project'),
    (93, 'MS. CINDY RIVERA', 'special_project'),
    (94, 'MS. FLORA L. VILLAROSA', 'special_project'),
    (95, 'MS. GRACIALITA C. CHUA', 'special_project'),
    (96, 'MS. JENNY TAN', 'special_project'),
    (97, 'MS. JENTLY O. RIVERA', 'special_project'),
    (98, 'MS. JULIE TAN', 'special_project'),
    (99, 'MS. LAURA IGNACIO', 'special_project'),
    (100, 'MS. NENITA MARTIN DE TORRES', 'special_project'),
    (101, 'OLIVER JOHNSTON SY', 'special_project'),
    (102, 'PHILCARE PHARMA, INC.', 'special_project'),
    (103, 'SPOUSES ALFRED and MARY JANE THERESE AUBREY MANALILI', 'special_project'),
    (104, 'SPOUSES ANTHONY N. CHENG & CHARLOTTE CHENG', 'special_project'),
    (105, 'SPOUSES WOODEN PLASABAS CORTEL AND JASHMINE MENDOZA CORTEL', 'special_project'),
    (106, 'UNION MOTORS CORP.', 'special_project'),
    (107, 'WINSTON FABRIKOID CORP', 'special_project'),
    (108, 'WINSTON FABRIKOID CORPORATION', 'special_project')
),
actor as (
  select coalesce(
    (select p.id from public.profiles p where lower(trim(coalesce(p.role,''))) in ('super_admin','admin') order by p.created_at asc nulls last limit 1),
    (select p.id from public.profiles p order by p.created_at asc nulls last limit 1)
  ) as actor_id
),
inserted as (
  insert into public.accounts (title, category, status, created_by, notes)
  select
    s.title,
    s.category,
    'active',
    a.actor_id,
    'seeded from source import'
  from source_accounts s
  cross join actor a
  where not exists (
    select 1
    from public.accounts acc
    where lower(trim(coalesce(acc.title,''))) = lower(trim(s.title))
      and lower(trim(coalesce(acc.category,''))) = lower(trim(s.category))
  )
  returning id
),
target_accounts as (
  select acc.id
  from public.accounts acc
  join source_accounts s
    on lower(trim(coalesce(acc.title,''))) = lower(trim(s.title))
   and lower(trim(coalesce(acc.category,''))) = lower(trim(s.category))
),
inserted_members as (
  insert into public.account_members (account_id, user_id)
  select ta.id, a.actor_id
  from target_accounts ta
  cross join actor a
  where not exists (
    select 1 from public.account_members am
    where am.account_id = ta.id
      and am.user_id = a.actor_id
  )
  returning account_id
)
select
  (select count(*) from source_accounts) as source_accounts_count,
  (select count(*) from inserted) as accounts_created,
  (select count(*) from inserted_members) as memberships_created;

commit;
