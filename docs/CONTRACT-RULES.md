# Contract rules built into the app

Source: the "Договор за търговско посредничество и представителство" and its "Приложение № 1" (kept locally in `contracts/`, which is not committed). The app keeps track of the numbers. It does not give legal advice.

| Contract | What the app does |
|---|---|
| Art. 7(2): the standard commission is 10% of each delivery | Settings → default commission (10%). Every new producer gets it unless you set a rate for that producer. Instead of a percent, the commission can be a fixed amount per unit sold (piece, kg, l), at the producer, merchant or order level. Returns reduce a per-unit commission in the same proportion as the net value. |
| Art. 7(3): each buyer can have its own rate, and that rate wins | Not used: by the owner's decision merchants have no commission terms. The commission is set on the producer (a percent or a fixed amount per unit), optionally on a good (a fixed amount per unit, which wins over the producer's), and the admin can change it on one order. Each order saves the commission that applied when it was created. |
| Art. 7(4): the commission is calculated on the net value without VAT | `calculateOrder()` (packages/shared/src/money.ts) uses the net lines minus returns as the base. |
| Art. 7(5): commission is due on every delivery | Every order carries its own commission. |
| Art. 8(1)-(2): the commission is earned when the merchant pays | Not used, by the owner's decision: the full commission is owed once the order is delivered, whether or not the merchant has paid. Merchant payments are recorded by the producer and only show whether the merchant has paid. |
| Art. 8(3): payment within 5 working days | The commission falls due 5 Bulgarian working days after the delivery. Weekends and official holidays are skipped, including Orthodox Easter and holidays moved off a weekend (`calendar.ts`). After that date it shows as **overdue**. The admin records what was received, in one click or as a part payment. |
| Art. 10: returns, refused deliveries, unpaid parts | The order field "returned goods excl. VAT" lowers the base.  |
| Art. 4(3), 5(4): the buyer was already the producer's client | Buyer status "Existing client" means new orders carry 0% commission. |
| Art. 9: the producer buys out future commission for a buyer (100% of the first deal, at least 500 €) | Buyer status "Released" means 0% on new orders. The form suggests the fee. |
| Art. 11: the producer reports order date and number, goods and quantities, value, invoice date and number, and payments | These are the order fields: date, the merchant's number, the shop, lines, the merchant's payments, returns. Invoices are between the producer and the merchant and are not tracked on orders. Every change goes into the order history. |
| Art. 14, 15: the producer delivers and invoices | The producer sets the delivery method and the planned and actual delivery dates on each order. On their profiles the producer says how it sends invoices and the merchant how it receives them. |
| Art. 17(3)-(4): an "active buyer" has ordered in the last 30 days (or a custom period) | Each buyer has an activity period (default 30 days). The app shows active or inactive. |
| Art. 16(2), 17(2): penalties (10% of 12 months, min. 1000 €; 10% of each active buyer's turnover, min. 500 €) | Shown to the admin under Producer → Where it sells. These figures are indicative only. |
| Art. 19: 1 year, renews automatically, 30 days' notice to refuse | Producer → signing date. The dashboard and a notification (14 days before the notice deadline) show the term end and the deadline. |
| Art. 20: confidentiality | Merchants never see commission, rates or what producers pay you. Each producer and merchant sees only its own orders. |

Not automated, because it needs a decision or a document: proving that a buyer was attracted (art. 5(3)), the 5-day document requests (art. 11(3)), and charging penalties.
