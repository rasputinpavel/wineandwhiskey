-- Manual overrides for auto-computed B2C / B2B sold counts in the monthly
-- consignment report. NULL = trust the Loyverse aggregation; non-NULL =
-- user has corrected the number and we honor it.

alter table inventory.consignment_report_cell
  add column if not exists b2c_override integer check (b2c_override is null or b2c_override >= 0),
  add column if not exists b2b_override integer check (b2b_override is null or b2b_override >= 0);
