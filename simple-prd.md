# Simple PRD — Sales, Inventory & Accounts

## Goal
Build a basic system for a business to record stock, sales, purchases, customers, suppliers, and money owed. A cashier records sales; an administrator manages the business and views reports. The example business shown is **Dalamin Tech**.

## Core users
- **Administrator:** sets up business details, products, warehouses, people, and accounts; reviews activity and reports.
- **Cashier:** records sales through the point of sale.

## Core requirements
1. **Dashboard and setup:** Show a simple overview. Set up the business name/logo and tax number; create staff accounts and their access. Maintain products, units (such as pieces and cartons), warehouses, customers, and suppliers.
2. **Inventory:** Record opening stock, purchases, sales, stock issues and receipts, damaged items, stock counts, and count adjustments. Support unit conversion (for example, one carton = 10 pieces). Update stock automatically when a purchase or sale is recorded; prevent inconsistent balances.
3. **Sales and point of sale:** Create a sale at the cashier, select products and quantities, apply discounts, and produce a receipt or invoice. Support a larger tax invoice, quotations, sales orders, and returns. Link every completed transaction to stock and the customer's balance where applicable.
4. **Purchasing:** Record purchase orders and supplier invoices, including tax details. Received quantities increase stock and the supplier balance reflects what is owed. Support purchase returns.
5. **Accounts and staff:** Record money received and paid, customer and supplier balances, and account statements. Keep a basic chart of accounts. Record staff attendance, salaries, and expenses if staff are used.
6. **Reports:** Show sales (including monthly and quarterly), tax, returns, and inventory balance and valuation. For inventory reports, allow a date range and optional warehouse filter; show quantities in units and monetary value.

## Minimum working flow
An admin sets up a warehouse, a product sold by piece and carton, and its opening quantity. The cashier sells three pieces. The system saves the sale, issues its receipt, and immediately reduces the warehouse balance by three pieces. The admin can see the resulting stock balance and value in a report filtered by date and warehouse. A supplier purchase adds stock in the same way and updates the supplier's account.

## Scope note
The reference screenshot shows the business modules and a **Stock Balance & Valuation** report with date and optional warehouse filters. It is evidence of the business functions above, **not** a visual design specification. Manufacturing recipes were mentioned in the audio, but can wait until the basic sales, purchasing, and stock flow works.
