-- STEP 11: Sync retainer backlog rows into activities (update + insert)
-- Source: DSLAW RETAINER2026.xlsx
-- Parsed rows: 97
-- Safe to re-run.

create extension if not exists pgcrypto;

begin;

with source_rows (
  row_no,
  client_name,
  occurred_on,
  matter,
  billing_status,
  billable,
  workflow_status,
  invoice_no,
  source_note,
  amount,
  activity_type
) as (
  values
    (1, 'ACHELOUS', '2024-02-24', 'Letter to DOLE - 7S of Good Housekeeping Training Invitation (Orientation)', 'billable', true, 'pending', 'INV-0978', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: DOLE', 420.00, 'communication'),
    (2, 'ACHELOUS', '2025-08-26', 'Notary of GIS2025', 'billable', true, 'pending', 'INV-0978', 'DSLAW RETAINER2026.xlsx | Assignee: Chavez', 950.00, 'appearance'),
    (3, 'ANCC CCC', '2024-02-27', 'Letter to DOLE - 7S of Good Housekeeping Training Invitation (Orientation)', 'billable', true, 'pending', 'INV-0976', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: DOLE', 420.00, 'communication'),
    (4, 'ANCC CCC', '2025-05-16', 'Notary of Statement of Management Responsibility for Financial Statement', 'billed', true, 'pending', '', 'DSLAW RETAINER2026.xlsx | Assignee: Brioso', 300.00, 'appearance'),
    (5, 'ANCC CCC', '2025-05-16', 'Notary of Sec Cert & Affidavit of Loss of Cert of Reg - due to loss of access the account (SEC)', 'non_billable', false, 'pending', 'INV-0976', 'DSLAW RETAINER2026.xlsx | Assignee: Brioso', 600.00, 'appearance'),
    (6, 'ANCC CCC', '2025-05-21', 'Payment for Penalty re AFS', 'non_billable', false, 'pending', '1KPENALTY', 'DSLAW RETAINER2026.xlsx | Assignee: Epong', 1350.00, 'appearance'),
    (7, 'ANCC CCC', '2025-11-25', 'Notary for GIS2025', 'billable', true, 'pending', 'INV-0976', 'DSLAW RETAINER2026.xlsx | Assignee: Chavez', 800.00, 'appearance'),
    (8, 'ANCTCM', '2024-11-28', 'Notarized Secretary Certificate (Meeting Held - Nov 18,2024)', 'billable', true, 'pending', 'INV-0977', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 710.00, 'appearance'),
    (9, 'ANCTCM', '2025-02-12', 'Secretary Certificate not notarized(Printing Only)', 'billable', true, 'pending', 'INV-0977', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 150.00, 'communication'),
    (10, 'ANCTCM', '2025-02-27', 'Transmitted requested copies of Document via Grab (GIS2023 & 2024 of ANCTCM, AFS2024 and ITR 2023)', 'billable', true, 'pending', 'INV-0977', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: FORD COMMONWEALTH', 811.50, 'communication'),
    (11, 'ANCTCM', '2025-05-16', 'Notary of Sec Cert & Affidavit of Loss of Cert of Reg - due to loss of access the account (SEC)', 'non_billable', false, 'pending', 'INV-0977', 'DSLAW RETAINER2026.xlsx | Assignee: Brioso', 600.00, 'appearance'),
    (12, 'ANCTCM', '2025-08-04', 'Notary of GIS2025', 'billable', true, 'pending', 'INV-0977', 'DSLAW RETAINER2026.xlsx | Assignee: Chavez', 850.00, 'appearance'),
    (13, 'ANCTCM', '2025-09-15', 'Secretary Certificate not notarized(Printing Only)', 'billable', true, 'pending', 'INV-0977', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 150.00, 'communication'),
    (14, 'ANCTCM', '2025-09-18', 'Tranmitted of Documents via grab (Sec Cert)', 'billable', true, 'pending', 'INV-0977', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: 9 Corinthians Gardens QC', 280.00, 'communication'),
    (15, 'ANCTCM', '2025-11-19', 'Transmitted requested copies of Document via Grab (GIS2025)', 'billable', true, 'pending', 'INV-0977', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: FORD COMMONWEALTH', 231.50, 'communication'),
    (16, 'BAC HOLDINGS', '2025-02-20', 'Notary of GIS2025', 'billable', true, 'pending', 'INV-0980', 'DSLAW RETAINER2026.xlsx | Assignee: Chavez', 950.00, 'appearance'),
    (17, 'BAC HOLDINGS', '2025-02-23', 'Recieved of Dcouments to BIR (eAFS) - due to Loss of access the account (SEC)', 'non_billable', false, 'pending', '', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: RDO 33 Ermita Mall', 363.00, 'communication'),
    (18, 'BAC HOLDINGS', '2025-05-16', 'Notary of Sec Cert & Affidavit of Loss of Cert of Reg - due to loss of access the account (SEC)', 'non_billable', false, 'pending', '', 'DSLAW RETAINER2026.xlsx | Assignee: Brioso', 600.00, 'appearance'),
    (19, 'BAC HOLDINGS', '2025-05-27', 'Notary of Statement of Management Responsibility for Financial Statement', 'billed', true, 'pending', '', 'DSLAW RETAINER2026.xlsx | Assignee: Brioso', 200.00, 'appearance'),
    (20, 'CABREBALD', '2023-09-29', 'Notarized Secretary Certificate (Meeting Held Sept 25,2023)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (21, 'CABREBALD', '2023-11-10', 'Notarized Secretary Certificate (Meeting Held Oct 24,2023)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (22, 'CABREBALD', '2023-11-12', 'Notarized Secretary Certificate (Meeting Held Oct 24,2023)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (23, 'CABREBALD', '2024-01-09', 'Notarized Secretary Certificate (Meeting Held Jan 08,2024)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (24, 'CABREBALD', '2024-01-24', 'Notarized Secretary Certificate (Meeting Held Jan 15,2024)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (25, 'CABREBALD', '2024-04-08', 'Notarized Secretary Certificate (Meeting Held April 05,2024)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (26, 'CABREBALD', '2024-05-23', 'Notarized Secretary Certificate (Meeting Held April 21,2024)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (27, 'CABREBALD', '2024-09-10', 'Notarized Secretary Certificate (Meeting Held Sept 09,2024/Uniqu Ref - 09-01)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (28, 'CABREBALD', '2024-09-23', 'Notarized Secretary Certificate (Meeting Held Sept 09,2024/Uniqu Ref - 09-02)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (29, 'CABREBALD', '2024-09-23', 'Notarized Secretary Certificate (Meeting Held Sept 09,2024/Uniqu Ref - 09-03)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (30, 'CABREBALD', '2024-11-08', 'Notarized Secretary Certificate (Meeting Held Nov 06,2024/Uniqu Ref - MANILA WATER)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (31, 'CABREBALD', '2024-11-08', 'Notarized Secretary Certificate (Meeting Held Nov 06,2024/Uniqu Ref - MERALCO)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (32, 'CABREBALD', '2025-02-20', 'Notary of GIS2025', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Chavez | Handling: Atty. NTF', 950.00, 'appearance'),
    (33, 'CABREBALD', '2025-02-27', 'Notarized Secretary Certificate (Meeting Held Jan 08,2024/Uniqu Ref - MERALCO)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 650.00, 'appearance'),
    (34, 'CABREBALD', '2025-05-16', 'Notary of Sec Cert & Affidavit of Loss of Cert of Reg - due to loss of access the account (SEC)', 'non_billable', false, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Brioso', 600.00, 'appearance'),
    (35, 'CABREBALD', '2026-01-13', 'Secretary Certificate not notarized(Printing Only)', 'billable', true, 'pending', 'INV-0975', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. NTF', 258.00, 'communication'),
    (36, 'TAC HOLDINGS', '2023-11-10', 'Notarized Secretary Certificate (Meeting Held - Oct 31,2023)', 'billable', true, 'pending', 'INV-0981', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. JRV', 650.00, 'appearance'),
    (37, 'TAC HOLDINGS', '2024-12-06', 'Notarized Secretary Certificate (Meeting Held - Dec 02,2024)', 'billable', true, 'pending', 'INV-0981', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. JRV', 650.00, 'appearance'),
    (38, 'TAC HOLDINGS', '2025-02-02', 'Secretary Certificate not notarized - Meeting Held Feb 10,2025(Printing Only)', 'billable', true, 'pending', '', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Handling: Atty. JRV', 150.00, 'communication'),
    (39, 'TAC HOLDINGS', '2025-02-27', 'Transmitted requested copies of Document via Grab (GIS2023 & 2024 of ANCTCM, AFS2024 and ITR 2023)', 'billable', true, 'pending', 'INV-0981', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: FORD COMMONWEALTH', 811.50, 'communication'),
    (40, 'TAC HOLDINGS', '2025-05-05', 'Grab of Secretary Certificate not notarized - Meeting Held May 02,2025(Printing Only)', 'billable', true, 'pending', 'INV-0981', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: 9 Corinthians Gardens QC | Handling: Atty. JRV', 303.00, 'communication'),
    (41, 'TAC HOLDINGS', '2025-05-15', 'Notary of GIS2025', 'billable', true, 'pending', 'INV-0981', 'DSLAW RETAINER2026.xlsx | Assignee: Chavez', 800.00, 'appearance'),
    (42, 'TAC HOLDINGS', '2025-05-16', 'Notary of Sec Cert & Affidavit of Loss of Cert of Reg - due to loss of access the account (SEC)', 'non_billable', false, 'pending', 'INV-0981', 'DSLAW RETAINER2026.xlsx | Assignee: Brioso', 600.00, 'appearance'),
    (43, 'TAC HOLDINGS', '2025-05-23', 'Recieved of Documents to BIR (eAFS) - due to Loss of access the account (SEC)', 'non_billable', false, 'pending', '', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: RDO 40 Fisher Mall', 273.00, 'communication'),
    (44, 'TAC HOLDINGS', '2025-05-27', 'Notary of Statement of Management Responsibility for Financial Statement', 'billed', true, 'pending', '', 'DSLAW RETAINER2026.xlsx | Assignee: Brioso', 200.00, 'appearance'),
    (45, 'TAC HOLDINGS', '2025-09-18', 'Tranmitted of Documents via grab (Sec Cert)', 'billable', true, 'pending', 'INV-0981', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: 9 Corinthians Gardens QC', 230.00, 'communication'),
    (46, 'TAC HOLDINGS', '2025-11-19', 'Transmitted requested copies of Document via Grab (GIS2025)', 'billable', true, 'pending', 'INV-0981', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: FORD COMMONWEALTH', 231.50, 'communication'),
    (47, 'PRIME RITZ', '2025-08-04', 'Tranmitted of GIS2025 for signatory of corp sec (Lalamove)', 'billable', true, 'pending', 'INV-0982', 'DSLAW RETAINER2026.xlsx | Assignee: Chavez | Location: Makati City', 125.00, 'communication'),
    (48, 'PRIME RITZ', '2025-08-05', 'Lalamove Pick up of signed GIS2025', 'billable', true, 'pending', 'INV-0982', 'DSLAW RETAINER2026.xlsx | Assignee: Chavez | Location: Makati to Pasig', 124.00, 'communication'),
    (49, 'PRIME RITZ', '2025-08-04', 'Notary of GIS2025 (dated Aug 04,2025)', 'billable', true, 'pending', 'INV-0982', 'DSLAW RETAINER2026.xlsx | Assignee: Chavez', 950.00, 'appearance'),
    (50, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-01-08', 'Notarized Secretary Certificate (Meeting Held Jan 15,2024)-Scafell Pike Motors', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 650.00, 'appearance'),
    (51, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-01-08', 'Notarized Secretary Certificate (Meeting Held March 04,2024)-Mckinley Motors', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 650.00, 'appearance'),
    (52, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-01-08', 'Notarized Secretary Certificate (Meeting Held Nov 04,2024)-Barrhorn Motors', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 650.00, 'appearance'),
    (53, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-01-13', 'Grab Sec Cert of Timothy Cheng', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 871.00, 'appearance'),
    (54, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-02-28', 'Grab of BDO form and Sec Cert', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 295.00, 'communication'),
    (55, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-04-15', 'Pick up of collections', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: FORD COMMONWEALTH', 519.00, 'communication'),
    (56, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-05-27', 'Pick up of collections', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: FORD COMMONWEALTH', 724.20, 'communication'),
    (57, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-07-01', 'Pick up of collections', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: FORD COMMONWEALTH', 639.00, 'communication'),
    (58, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-08-01', 'Pick up of collections', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: FORD COMMONWEALTH', 643.80, 'communication'),
    (59, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-08-28', 'Pick up of collections', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: FORD COMMONWEALTH', 571.80, 'communication'),
    (60, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-09-12', 'Pick up of collections', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: FORD COMMONWEALTH', 519.00, 'communication'),
    (61, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-10-20', 'Pick up of collections', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: FORD COMMONWEALTH', 595.80, 'communication'),
    (62, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2025-11-21', 'Pick up of collections', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: FORD COMMONWEALTH', 583.80, 'communication'),
    (63, 'ANC DEALERSHIP (Ford, Honda & Suzuki)', '2026-01-16', 'Pick up of Collections', 'billable', true, 'pending', 'INV-0983', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: FORD COMMONWEALTH', 583.80, 'communication'),
    (64, 'ASHTON TECH', '2023-12-11', 'Notarized Secretary Certificate (Meeting Held Dec 06,2023) - Jennifer Sy', 'billable', true, 'draft', 'INV-0957', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 650.00, 'appearance'),
    (65, 'ASHTON TECH', '2025-11-14', 'Transmitted via lalamove (Books of account ) to Ms. Ana', 'billable', true, 'draft', 'INV-0957', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: 105 General Mercado St., Caloocan City', 212.40, 'communication'),
    (66, 'CALAYAN', '2026-01-23', 'Request for Review of Draft of MoU with Kaya Natin Youth - Lucena (email)', 'non_billable', false, 'draft', 'INV-0960', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (67, 'CALAYAN', '2026-01-22', 'Reviw MOA between CEFI and Mayao Crossing (CEFI''s Adopted Community) - email', 'non_billable', false, 'draft', 'INV-0960', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (68, 'CALAYAN', '2025-12-05', 'Revised SLA - email', 'non_billable', false, 'draft', 'INV-0960', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (69, 'CALAYAN', '2025-12-02', 'Inquiry re tax Exemption on Other Income - email', 'non_billable', false, 'draft', 'INV-0960', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (70, 'CALAYAN', '2025-03-07', 'LBC filing (Request of letter for classification of CEFI as non-top withholding agent)', 'billable', true, 'draft', 'INV-0960', 'DSLAW RETAINER2026.xlsx | Assignee: Dionela | Location: BIR Quezon', 549.00, 'communication'),
    (71, 'CHEMICAL PROVIDER INC.', '2026-01-14', 'employee data privacy memorandum and the employee data privacy and consent form - email', 'non_billable', false, 'draft', 'INV-0962', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (72, 'CHEMICAL PROVIDER INC.', '2026-01-19', 'Memorandum addressing legal concerns re Mr. Nocedo - return to work order(email)', 'non_billable', false, 'draft', 'INV-0962', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (73, 'CHEMICAL PROVIDER INC.', '2025-12-02', 'Response inquiry re the legal implications of Ms. Marilyn Balme''s resignation on possible redundancy (email)', 'non_billable', false, 'draft', 'INV-0962', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (74, 'CHEMICAL PROVIDER INC.', '2025-10-08', 'Request for the legal advice re employee probation extension and potential termination (email)', 'non_billable', false, 'draft', 'INV-0962', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (75, 'CHEMICAL PROVIDER INC.', '2025-06-16', 'Request for legal review and approval - Employee Handbook and Code of Conduct(email)', 'non_billable', false, 'draft', 'INV-0962', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (76, 'CHEMICAL PROVIDER INC.', '2025-06-27', 'Request for legal review and approval - Employee Handbook and Code of Conduct,(email)', 'non_billable', false, 'draft', 'INV-0962', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (77, 'CHEMICAL PROVIDER INC.', '2025-12-18', 'Transmitted Letter Final Demand to pay outstanding Obligation (lalamove and LBC filing)', 'billable', true, 'draft', 'INV-0962', 'DSLAW RETAINER2026.xlsx', 424.00, 'communication'),
    (78, 'CITI HRM', '2025-07-01', 'Pick up collection (failed - error on Payee''s name)', 'billable', true, 'draft', 'INV-0964', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: Malate Manila', 559.20, 'communication'),
    (79, 'CITI HRM', '2025-07-02', 'Pick up new cheque - collection', 'billable', true, 'draft', 'INV-0964', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: Malate Manila', 559.20, 'communication'),
    (80, 'CITI HRM', '2025-11-12', 'Pick up collection', 'billable', true, 'draft', 'INV-0964', 'DSLAW RETAINER2026.xlsx | Assignee: Epong | Location: Malate Manila', 559.20, 'communication'),
    (81, 'PT RARA KAMAR', '2025-01-06', 'LBC (Customer BDO Information)', 'billable', true, 'draft', 'INV-0958', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante | Location: BDO Makati', 130.00, 'communication'),
    (82, 'PT RARA KAMAR', '2025-10-27', 'Notary of GIS', 'billable', true, 'draft', 'INV-0958', 'DSLAW RETAINER2026.xlsx | Assignee: Epong', 350.00, 'appearance'),
    (83, 'PT RARA KAMAR', '2025-11-13', 'Notary of GIS', 'billable', true, 'draft', 'INV-0958', 'DSLAW RETAINER2026.xlsx | Assignee: Epong', 300.00, 'appearance'),
    (84, 'RYKOM FINANCE CORP.', '2026-01-22', 'Drafting and preparations of MOA for Rykom Urban Agreement emailed to Mr. Zenon Surara and Mr. Cong Paul Daza, on Jan 22 2026', 'non_billable', false, 'draft', 'INV-0961', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 0.00, 'communication'),
    (85, 'RYKOM FINANCE CORP.', '2026-01-08', 'Meeting re Rykom and Urban Eco-living and Edwin Roceles with Atty. Kristine Bernadette Villanueva at DSLaw Offices, on Jan 08 2026', 'billable', true, 'draft', 'INV-0961', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 4000.00, 'appearance'),
    (86, 'RYKOM FINANCE CORP.', '2025-10-02', 'Summary Meeting re Corporate Rehabilitation, People vs R. De Jesus and Corporate Salary Loan with Atty. Nestor Fernandez Jr. and Atty. Kristine Villanueva at DSLaw Offices, on Oct 02 2025', 'billable', true, 'draft', 'INV-0961', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 8000.00, 'appearance'),
    (87, 'RYKOM FINANCE CORP.', '2025-10-02', 'Drafting and preparations of MOA re Request for review and legal opinion, Emailed to Mr. Marlon Jaranella, on Oct 02 2025', 'non_billable', false, 'draft', 'INV-0961', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 0.00, 'communication'),
    (88, 'RYKOM FINANCE CORP.', '2025-09-11', 'Preparations in relation to the Request for subsidiary ledger and case Information, Emailed to Mr. Garry Agcaoili', 'non_billable', false, 'draft', 'INV-0961', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 0.00, 'communication'),
    (89, 'RYKOM FINANCE CORP.', '2025-08-20', 'Drafting and preparations of Contract for deposits for future subscription, Emailed to Ms. Karen Minas', 'non_billable', false, 'draft', 'INV-0961', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 12000.00, 'communication'),
    (90, 'FOREST PARK', '2025-09-17', 'Letter of Demand for Rectification of Detective SPA - Email only (Ms. Linda Sison as per Cassandra)', 'non_billable', false, 'pending', '', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 0.00, 'communication'),
    (91, 'FOREST PARK', '2025-09-26', 'Lalamove of Letter for Rectification', 'billable', true, 'draft', 'INV-1002', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 532.00, 'communication'),
    (92, 'FOREST PARK', '2025-10-24', 'Email - Reply to to Response Letter of Ester Gamboa', 'non_billable', false, 'draft', 'INV-1002', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 0.00, 'communication'),
    (93, 'FOREST PARK', '2025-11-19', 'Grab of Docs(Response letter of Ester Gamboa)', 'billable', true, 'draft', 'INV-1002', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 321.00, 'communication'),
    (94, 'FOREST PARK', '2025-11-24', 'Email -Legal Memorandum on Conjugal Property Sale - Ms. Linda Sison', 'non_billable', false, 'draft', 'INV-1002', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 0.00, 'communication'),
    (95, 'FOREST PARK', '2025-12-19', 'Email - Request for Transfer of Interment Lot - Emmanuel Culilap (email to Mr. Victor Uy)', 'non_billable', false, 'draft', 'INV-1002', 'DSLAW RETAINER2026.xlsx | Assignee: Mediante', 853.00, 'communication'),
    (96, 'CBL', '2025-10-17', 'Confidentiality Agreement Review(email)', 'non_billable', false, 'draft', 'INV-0963', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication'),
    (97, 'CBL', '2025-10-03', 'Legal Opinion on Lucky''s Memorandum of Agreement(email)', 'non_billable', false, 'draft', 'INV-0963', 'DSLAW RETAINER2026.xlsx', 0.00, 'communication')
),
actor as (
  select coalesce(
    (select p.id from public.profiles p where lower(trim(coalesce(p.role,''))) in ('super_admin','admin') order by p.created_at asc nulls last limit 1),
    (select p.id from public.profiles p order by p.created_at asc nulls last limit 1)
  ) as actor_id
),
default_lawyer as (
  select coalesce(
    (select p.id from public.profiles p where lower(trim(coalesce(p.role,'')))='lawyer' order by p.created_at asc nulls last limit 1),
    (select actor_id from actor)
  ) as lawyer_id
),
ensure_accounts as (
  insert into public.accounts (title, category, status, created_by)
  select distinct s.client_name, 'retainer', 'active', a.actor_id
  from source_rows s
  cross join actor a
  where not exists (
    select 1
    from public.accounts x
    where public.norm_key(x.title) = public.norm_key(s.client_name)
      and lower(trim(coalesce(x.category, ''))) = 'retainer'
  )
  returning id
),
target_accounts as (
  select a.id, a.title
  from public.accounts a
  where lower(trim(coalesce(a.category, ''))) = 'retainer'
    and public.norm_key(a.title) in (select public.norm_key(client_name) from source_rows)
),
ensure_members as (
  insert into public.account_members (account_id, user_id)
  select ta.id, a.actor_id
  from target_accounts ta
  cross join actor a
  where not exists (
    select 1 from public.account_members am where am.account_id = ta.id and am.user_id = a.actor_id
  )
  returning account_id
),
resolved as (
  select
    s.row_no,
    ta.id as account_id,
    s.matter,
    s.occurred_on::date as occurred_on,
    s.billing_status,
    s.billable,
    case when s.workflow_status='draft' then 'draft' else 'pending' end as status,
    s.invoice_no,
    s.source_note,
    greatest(coalesce(s.amount,0::numeric),0::numeric) as amount,
    (select actor_id from actor) as actor_id,
    (select lawyer_id from default_lawyer) as handling_lawyer_id,
    case when s.activity_type in ('appearance','pleading_major','pleading_minor','communication') then s.activity_type else 'communication' end as activity_type,
    'retainer_backlog' as task_category,
    case when lower(s.matter) like '%notary%' then 'NF' else null end as fee_code,
    concat(
      'Retainer Backlog | Invoice: ', coalesce(nullif(s.invoice_no,''), '-'),
      ' | Source: ', s.source_note
    ) as description
  from source_rows s
  join target_accounts ta on public.norm_key(ta.title) = public.norm_key(s.client_name)
),
updated as (
  update public.activities a
  set
    activity_type = r.activity_type,
    description = r.description,
    minutes = coalesce(a.minutes,0),
    status = r.status,
    billable = r.billable,
    task_category = r.task_category,
    fee_code = r.fee_code,
    amount = r.amount,
    billing_status = r.billing_status,
    handling_lawyer_id = r.handling_lawyer_id,
    performed_by = coalesce(a.performed_by, r.actor_id),
    submitted_at = case when r.status='draft' then null else coalesce(a.submitted_at, now()) end,
    draft_expires_at = case when r.status='draft' then coalesce(a.draft_expires_at, now()+interval '30 minutes') else null end,
    updated_at = now()
  from resolved r
  where a.account_id = r.account_id
    and public.norm_key(a.matter) = public.norm_key(r.matter)
    and a.occurred_at::date = r.occurred_on
  returning a.id
),
inserted as (
  insert into public.activities (
    batch_id, line_no, account_id, matter, billing_status, billable,
    created_by, activity_type, performed_by, handling_lawyer_id, status,
    fee_code, task_category, amount, minutes, description, occurred_at,
    attachment_urls, submitted_at, draft_expires_at
  )
  select
    gen_random_uuid(), r.row_no, r.account_id, r.matter, r.billing_status, r.billable,
    r.actor_id, r.activity_type, r.actor_id, r.handling_lawyer_id, r.status,
    r.fee_code, r.task_category, r.amount, 0, r.description, (r.occurred_on::timestamptz + time '09:00'),
    null,
    case when r.status='draft' then null else now() end,
    case when r.status='draft' then now()+interval '30 minutes' else null end
  from resolved r
  where not exists (
    select 1 from public.activities a
    where a.account_id = r.account_id
      and public.norm_key(a.matter) = public.norm_key(r.matter)
      and a.occurred_at::date = r.occurred_on
  )
  returning id
)
select
  (select count(*) from source_rows) as source_rows_count,
  (select count(*) from ensure_accounts) as accounts_created,
  (select count(*) from ensure_members) as memberships_created,
  (select count(*) from updated) as activities_updated,
  (select count(*) from inserted) as activities_inserted;

commit;
