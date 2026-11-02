-- Undoes 0035. Every paragraph is treated as prose again, as before M41 R1c; nothing else changes.
ALTER TABLE sections DROP COLUMN form;
DELETE FROM app_settings WHERE name = 'section-forms';
