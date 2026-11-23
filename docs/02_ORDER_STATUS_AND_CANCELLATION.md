# Feature 02: Order Lifecycle Transitions & Atomic Cancellation Restock

## 1. State Machine & Business Rules

Allowed order statuses (`public.orders.status`):
`PENDING`, `PREPARING`, `READY`, `SERVED`, `COMPLETED`, `CANCELLED`

### Permitted Transitions (`ALLOWED_TRANSITIONS`)

- `PENDING` $\rightarrow$ `PREPARING`, `CANCELLED`
- `PREPARING` $\rightarrow$ `READY`, `CANCELLED`
- `READY` $\rightarrow$ `SERVED`, `COMPLETED`, `CANCELLED`
- `SERVED` $\rightarrow$ `COMPLETED`
- `COMPLETED` $\rightarrow$ _(terminal)_
- `CANCELLED` $\rightarrow$ _(terminal)_

### Invariants

1. **No Invalid Jumps or Re-Cancels:** Orders cannot move backward, skip required stages, or transition out of terminal states (`COMPLETED`, `CANCELLED`).
2. **Single Restock Guarantee:** Transitioning to `CANCELLED` restores `items.stock_count += order_items.quantity` **at most once** per order.
3. **Serialized Concurrency:** Concurrent status updates or duplicate cancel clicks on the same order must serialize cleanly without race conditions.

---

## 2. Transaction & Locking Flow (`transitionOrderStatus` in `models/orderModel.js`)

1. Validates `orderId` (positive integer) and `nextStatus` (`VALID_STATUSES` uppercase match) $\rightarrow$ `400` on invalid input.
2. Opens a dedicated client connection (`pool.connect()`) and executes `BEGIN`.
3. Locks the target order row first:
   ```sql
   SELECT * FROM public.orders WHERE id = $1 FOR UPDATE
   ```
