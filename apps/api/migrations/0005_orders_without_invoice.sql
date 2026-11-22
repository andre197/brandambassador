-- Invoices are between the producer and the merchant, not the intermediary: orders no longer carry them.
-- How each party sends or receives invoices stays on the producer and merchant profiles.
ALTER TABLE orders
  DROP COLUMN invoice_number,
  DROP COLUMN invoice_date,
  DROP COLUMN invoice_method,
  DROP COLUMN invoice_note,
  DROP COLUMN invoice_receive_method;
