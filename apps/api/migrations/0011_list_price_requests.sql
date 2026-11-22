-- A producer asks the admin to change the price of a good (its list price) once the good has links
-- with merchants. Such a request has no merchant. Approving it changes only the good's price:
-- agreed prices and existing orders stay as they are.
ALTER TABLE price_requests ALTER COLUMN merchant_id DROP NOT NULL;
